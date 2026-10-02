# Design — Authoritative Risk Snapshot and Reconciliation Receipt

## Existing behavior to preserve

- `TradeProposal` remains the model-to-product proposal contract.
- `ExecutionDecision` remains the deterministic policy result.
- Approval and Autopilot enter the same Temporal execution workflow.
- The workflow obtains a fresh quote and calls gateway preflight before dispatch.
- The existing proposal idempotency key remains stable across every retry.
- Signing and venue credentials remain confined to the certified execution boundary.

## Proposed contracts

The later implementation should introduce three internal typed records. Names are
provisional but their responsibilities are fixed.

### `RiskSnapshot`

Required fields:

- identity: `snapshot_id`, `proposal_id`, `account_id`, `market`, `chain_id=42161`;
- time: `as_of`, `expires_at`, and per-source `observed_at`;
- versions: policy, agent configuration, analysis, portfolio snapshot, credit ledger,
  venue-health revision, and reconciliation revision;
- account values: settled and reserved daily volume, gross/net exposure, realized
  daily loss, drawdown, settled and reserved position count, seconds since last trade,
  credits spent and reserved today, available credits;
- analysis values: confidence, absolute consensus, provider quorum result, evidence
  completeness/freshness result;
- execution values: selected venue, quote reference and expiry, venue-health result,
  reconciliation status, emergency-stop state;
- source status for every input: authoritative source, revision, freshness limit, and
  `available | stale | missing | disputed`;
- `snapshot_hash` over canonical secret-free JSON.

Any `stale`, `missing`, or `disputed` required input makes the existing policy result
fail closed. Defaults are not permitted.

### `RiskReservation`

Required fields:

- stable `reservation_id` derived from the proposal idempotency key;
- account, market, proposed volume/exposure/position/credit deltas;
- snapshot and policy hashes;
- `reserved_at`, `expires_at`, owner workflow ID, and state;
- states: `reserved`, `consumed`, `released`, `expired`, `reconciliation_hold`.

Redis owns the atomic hot reservation. Convex stores the current customer-visible
summary. Timescale records the detailed immutable lifecycle.

Each reservation may contain `EconomicCostReservationLine` entries for direct charges
only: network gas/data, venue/builder/affiliate fees, funding/borrow, withdrawal,
bridge and setup charges. Lines bind exact asset units, worst-case amount, derivation
and source hashes. Expected rebates or favorable funding never reduce the upfront
reservation. Uncertain submission retains applicable lines.

### `ExecutionReceipt`

Required fields:

- proposal, analysis, evidence-set, configuration, policy, snapshot, reservation, and
  quote identifiers/hashes;
- adapter/compiler version, chain, venue, idempotency key, requested action summary,
  and prepared-transaction hash;
- transaction hash when known, block/confirmation data, fills, fees, slippage,
  funding, and resulting position delta;
- lifecycle state, timestamps, retry/attempt identity, error classification, and
  reconciliation comparison;
- no secrets, raw credentials, signed payloads, or hidden chain-of-thought.

Every transition emits a receipt, including a failed receipt when no transaction was
prepared or submitted.

`EconomicCostActual` subrecords bind authoritative fill/transaction/funding identity,
exact asset amount, category and Asset Conservation Journal transaction. Builder fees
already included in a venue total are not counted twice. Slippage, impact, adverse
selection and opportunity cost remain TCA analytics rather than journal charges.

## Source ownership

| Input | Authoritative source | Freshness rule |
| --- | --- | --- |
| Active policy/profile/mode/emergency stop | Convex | Reload immediately before reservation and again before signing |
| Current positions and customer-visible balances | Convex reconciled snapshot | Must carry venue reconciliation revision and be inside the venue-specific SLA |
| Detailed fills, realized PnL, and reconciliation evidence | Timescale | Derived through the latest completed reconciliation watermark |
| Pending proposal reservations | Redis atomic reservation set | Read and mutate in one script |
| Credits and credit reservations | Convex ledger plus Redis in-flight reservation | Ledger revision must match the reservation input |
| Quote and venue health | Execution gateway/sidecar | Fresh quote deadline; health checked during preflight |
| Quorum and evidence completeness | Frozen analysis result and deterministic validator | Must match proposal analysis/configuration hashes |

If current position/PnL state cannot be proven from these owners, the implementation
must add the missing reconciliation projection before enabling the policy check. It
must not substitute a zero.

## Execution flow

1. Claim the proposal through its existing idempotent transition.
2. Reload current Convex context and frozen analysis metadata.
3. Require no unresolved submission or reconciliation drift for the account/venue.
4. Fetch a fresh executable quote and venue-health result.
5. Build the candidate `RiskSnapshot`; reject missing, stale, or disputed inputs.
6. Atomically reserve volume, exposure, position, and credit capacity in Redis using
   the proposal idempotency key and current policy/source revisions.
7. Re-read emergency stop and policy revision. Release and restart preflight if either
   changed.
8. Hash the final snapshot and pass it to the existing deterministic preflight.
9. On failure, record the decision receipt and release the reservation.
10. On pass, bind proposal, decision, snapshot, reservation, quote, and adapter version
    into a prepared receipt.
11. Submit once. A timeout becomes `submission_unknown`; do not rebroadcast until the
    venue/chain is queried by idempotency key, client order ID, transaction hash, and
    relevant account state.
12. Record confirmed, failed, partial, or unresolved evidence. Keep risk reserved while
    submission is uncertain or a partial fill remains unreconciled.
13. Reconcile venue state to Convex, append detailed Timescale receipts, then consume
    or release the reservation.

## Lifecycle mapping

Keep existing customer-facing proposal states wherever possible. Add detailed
execution outcome states to the execution record rather than a parallel proposal
authority machine:

`prepared -> submitted | submission_unknown -> confirmed | partially_filled | failed
-> reconciled`

`blocked` and `emergency` may occur before submission. After a possible submission,
they stop new work but do not skip reconciliation.

Each possible submission also carries an `InclusionReceipt` in the shared receipt:
channel decision and attempt IDs, acknowledgement evidence, first-seen time,
sequencer/block or venue-order identity, confirmation/finality observations and the
current authoritative outcome. Onchain states distinguish `sequenced`, `included`,
`confirmed`, `reverted` and `reorged`; venue APIs distinguish `accepted`, `open`,
`partial`, `filled`, `canceled` and `rejected`. Transport success is never acceptance,
and acceptance is never execution.

## Failure behavior

- Missing/stale input: fail preflight and release safe-to-release reservations.
- Concurrent proposal: the Redis script accepts only the set that fits all ceilings.
- Policy or emergency-stop revision change: invalidate the snapshot and restart.
- Quote expiry or route change: invalidate the snapshot and reservation binding.
- Timeout after possible broadcast: mark unknown and reconcile; never blind retry.
- Partial fill: reserve actual filled exposure plus unresolved remainder until resolved.
- Reorg: revert confirmation state, retain reservation, and reconcile again.
- Receipt persistence failure before signing: block submission.
- Receipt persistence failure after possible signing: enter unknown and reconcile.

## Delivery sequence for a later implementation

1. Add contracts and canonical hashing with fixtures; no production behavior change.
2. Add authoritative read models and prove every `RiskContext` field has a source.
3. Add Redis atomic reservations and concurrency tests.
4. Add receipt storage and the extended execution outcome state machine.
5. Route Shadow executions through snapshot/receipt generation without signing.
6. Enable Approval dry-run use after replay and fault-injection acceptance.
7. Keep Autopilot/live gates closed until certification and funded canaries receive
   separate approval.

## Rollback

Feature flags may disable new proposal dispatch, but must never discard outstanding
reservations or unknown submissions. Rollback drains new work, completes
reconciliation, exports unresolved receipts, and only then returns to the prior path.
