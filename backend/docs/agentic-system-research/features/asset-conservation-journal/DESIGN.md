# Future Design

## Contracts

- `AssetUnit`: chain/domain, token contract or native identifier, decimals, base-unit
  encoding and certification hash; symbols are presentation only.
- `JournalAccount`: tenant/account, custody location and bucket such as wallet
  available, venue available/locked, pending settlement, bridge-in-transit, fee,
  funding, realized PnL or external counterparty.
- `JournalTransaction`: stable authoritative source/event revision, evidence,
  idempotency, lifecycle and receipt/reconciliation/correction links.
- `JournalPosting`: transaction, account, exact non-negative integer decimal string,
  asset-unit and debit/credit side.
- `ConservationCheck`: balanced/unbalanced/partial/unknown per-asset totals and coverage.
- `CatchUpReceipt`: source watermarks, gaps, ranges, corrections and incomplete state.

## Invariants

Debits equal credits independently for every exact asset unit. ETH, native/bridged
USDC and venue-internal claims never balance against each other through dollars.
Cross-asset swaps link separate ledgers. Bridge transfers use source, in-transit claim
and destination records. Position notional/unrealized PnL belongs to a linked position
subledger; only observed collateral locks, funding, fees and realized settlement post.

Pending, posted, voided, expired, reorged and corrected are append-only. Corrections
reverse and replace; there is no balancing plug. One authoritative source event and
revision maps to at most one logical transaction. Opening balances declare evidence
and cutoff rather than pretending complete history.

Direct economic charges post once from their authoritative fee/funding/gas identity
and reference the existing risk reservation and execution receipt. Rebates post only
when realized. The journal records exact units but never decides the cost ceiling or
releases reserved capacity.

## Ownership and failure behavior

Timescale owns postings/checks/watermarks/corrections; Convex current bounded status;
Temporal catch-up/reorg/correction; adapters and reconciliation receipts remain
authoritative. Redis may lease work but owns no posting or asset truth.

Unknown event/asset/unit, missing evidence, duplicate ID with changed payload,
unbalanced group, source gap or unresolved reorg returns partial/unknown/mismatch and
latches new exposure through the existing risk gate. Certified close and
reconciliation remain available. The journal never signs or moves funds.

## Rollout, rollback, cost and latency

Start with recorded Arbitrum USDC/WETH swap and fee fixtures, then venue fills/funding
and bridge-in-transit cases. Shadow-write beside current flows before gating. Rollback
stops new posting consumers but preserves history and forces explicit incomplete
status; it never rewrites entries.

Expected storage is roughly 2–8 postings plus observations per economic event and
medium-high mapping/migration effort. Target local commit p95 is at most 20 ms; normal
async reconciliation reaches terminal/explicit-unknown within five minutes in 99% of
ordinary replay cases. No model cost is required.
