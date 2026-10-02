# Future Design

## Contracts

`VenuePriceSemantics`

- `venue`, `market_id`, `venue_domain`, `owner_chain_id`
- named components and deterministic formula reference
- trigger, margin, funding and liquidation use by operation
- adapter/config/source revision, fixture hash, review and expiry

`VenuePriceObservationSet`

- component values, timestamps, sequence/block/round identifiers and provenance
- account, position and collateral snapshot references where applicable
- observation hash, capture time and availability/dispute status

`PriceSafetyDecision`

- `pass | close_only | block | unknown`
- operation, reason codes, thresholds, semantic and observation hashes
- policy/certification revisions and expiry

`LiquidationSafetyReceipt`

- account/position/market identity and authoritative snapshot hash
- native calculation inputs, current and stressed liquidation distances
- funding, fee, tier and cross-margin dependencies
- formula/adapter revision, decision, reasons and timestamp

All structures are strict, versioned and reject unknown fields.

## Data flow and ownership

1. A code-reviewed venue adapter loads certified semantics from the execution
   artifact registry.
2. The gateway or sidecar fetches the complete native observation set at a pinned
   sequence, block or venue snapshot boundary.
3. Deterministic code validates identity, provenance, freshness, completeness,
   ordering and configured divergence bounds.
4. The risk service calculates the account-bound receipt using the certified formula
   and authoritative positions/collateral.
5. Policy consumes only the resulting decision and hashes; the model sees a bounded
   summary after the decision.
6. Timescale stores detailed observations and receipts. Convex owns the current
   customer-facing projection. Redis may cache observations but never authority.
   Temporal owns refresh and reconciliation.

`owner_chain_id=42161` identifies the Particle/Magic ownership root. Each venue also
has an explicit domain/network identifier; no adapter may infer one from the other.

## Failure behavior

Missing, stale, disputed, out-of-order, gapped or divergent observations; wrong
account/market identity; an expired certification; or formula/config drift returns
`block` or `unknown` for exposure increases. A routing midpoint, external oracle or
cross-venue mark cannot fill a missing native component.

Certified reduce-only close, cancel and reconciliation may remain available through
an explicit safe-operation matrix. Unknown state never silently becomes a normal
pass. Every retry preserves the same operation/idempotency key and records the prior
receipt.

## Security and compatibility

- Particle and Magic remain the only owner signers.
- LLM workers receive no credentials, signing tools or calculation authority.
- Existing `TradeProposal`, deterministic policy, Temporal workflow, gateway and
  sidecar remain; this is an additional hard input at execution certification.
- Discovery-only proxy prices retain their labels and can never cross into margin.

## Sequencing, rollback, cost and latency

1. Register semantics and native recorded fixtures for one venue/market class.
2. Run parity and mutation tests locally, then Shadow dual calculation.
3. Expand only after fixture and staleness coverage pass per venue.
4. Promotion makes the receipt mandatory for increases; rollback returns that venue
   to Shadow/Approval or close-only rather than bypassing the gate.

Expected cost is engineering, storage and one bounded native observation read per
fresh decision; there is no required provider-model cost. Target added p95 preflight
latency is under 150 ms with a fresh coherent cache and under 750 ms on a native
refresh. These are design budgets, not measured results.
