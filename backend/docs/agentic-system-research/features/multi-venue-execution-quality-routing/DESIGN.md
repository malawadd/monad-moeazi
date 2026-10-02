# Design — Productionized Multi-Venue Execution-Quality Routing

## One-router rule

Extend the current `RouteRequest`/venue-snapshot/cost-breakdown implementation. There
must be one canonical feasibility and ranking library used by public preview, proposal
construction, Shadow simulation, Approval preflight, and Autopilot. Each surface may
filter by authority/readiness, but cannot implement a different cost formula.

## Source classifications

Every venue observation has exactly one class:

- `exact_executable`: account/side/size-specific, certified, and suitable for fresh
  preflight;
- `exact_public`: exact public book/quote data suitable for comparison and Shadow; live
  eligibility still requires account readiness and certified preparation;
- `indicative`: useful display estimate without complete execution guarantees;
- `proxy`: derived from another venue or conservative synthetic model.

Only `exact_executable`, or `exact_public` followed by certified account-specific
preparation, may reach an execution route. `indicative` and `proxy` are display/Shadow
only and must be labeled in every UI and receipt.

## Proposed contracts

### `ExecutionRequest`

- proposal and sizing-decision IDs/hashes;
- account, chain, exact market/instrument, side, size, leverage, and horizon;
- allowed venues, maximum all-in cost/slippage, policy revision, deadline, and
  idempotency key.

### `VenueQuoteEvidence`

- venue, adapter/instrument version, source class, observed time, server sequence,
  snapshot/book hash, TTL, and reconnect/gap status;
- exact depth/VWAP curve for side and size, entry/exit fee tier/rebate, funding method
  and horizon, gas/settlement estimate, collateral/margin/limits;
- account readiness, venue-health observations, exclusions, and data-quality result.

### `RoutePlan`

- request/snapshot/policy/router version hashes;
- every candidate, exclusion reason, and normalized cost component;
- selected venue and runner-up, stable tie-break reason, validity window, and route
  constraints;
- no signed payload or credential.

### `RouteReceipt`

- route-plan hash, fresh reroute/requote result, preparation/preflight reference,
  submission/fill/fee/funding/gas result, and reconciliation reference;
- lifecycle state and explicit failed receipt for each failure boundary.

The receipt may be implemented as a specialized view of the shared
`ExecutionReceipt`; it must not create duplicate durable truth.

### Submission-channel fold-in

`SubmissionChannelCapability` records a certified channel's venue/network, ordering
and privacy properties, authentication boundary, fee model, supported operation,
freshness, review and expiry. `SubmissionChannelDecision` binds the selected channel
and any privacy or inclusion claim to the exact route, prepared artifact, policy and
account state. A `SubmissionAttempt` subrecord captures one actual send without
creating a second execution lifecycle.

Channel selection is deterministic and happens after route feasibility but before
dispatch. A channel cannot be advertised as private, protected or priority unless its
current certification proves that exact property on the target network. A change of
channel, payload, fee, nonce or privacy class invalidates the prior decision and may
require a fresh route, risk snapshot and approval.

## Feasibility order

Exclude a candidate before ranking when any condition fails:

1. policy allowlist and active chain;
2. certified adapter/action and exact instrument mapping;
3. account permission, collateral, available margin, and venue readiness;
4. fresh, sequence-complete quote/book and funding/fee inputs;
5. exact side/size depth, minimum notional, leverage, liquidation, slippage, and
   deadline constraints;
6. venue-health and unresolved-reconciliation gates.

An empty eligible set returns `abstain/no executable route` with reasons.

## Ranking

For eligible candidates compute versioned normalized basis-point components:

`entry fee + exit fee + round-trip depth impact + horizon funding + gas/settlement`.

Rank by rounded all-in cost, then freshness, then stable configured priority, matching
the existing deterministic pattern. Production version 1 uses health as a hard gate,
not an uncalibrated probabilistic penalty. Fill/retry risk may be displayed and tested
in Shadow; it enters ranking only after its estimator passes a separate calibration
review.

## Execution integration

1. Build `ExecutionRequest` from the existing proposal and approved sizing decision.
2. Invoke the canonical router and store the immutable `RoutePlan` in Timescale; expose
   the current bounded summary in Convex.
3. Before preflight, refresh account state and reroute/requote for the same request.
4. If venue, cost, size, quote, policy, account, or health changed outside the frozen
   tolerance, invalidate the plan and return to sizing/routing.
5. Bind the accepted plan into the risk snapshot and execution receipt.
6. Reconcile predicted versus actual price, fees, funding, gas, timing, and fills.
7. Update deterministic health statistics without silently changing authority.

A user preference may narrow allowed venues but cannot override feasibility,
certification, freshness, risk, or reconciliation.

## Feed and venue failure behavior

Each certified adapter has a `MarketDataAdapterSpec` and emits typed `MarketDataFrame`,
`BookStateReceipt`, `MarketDataConformanceDecision` and `BookRecoveryReceipt` records.
Venue-native numeric strings remain exact until decimal/base-unit validation; no
float-derived hash/checksum is authoritative. Adapter fan-out always returns typed
success or failure and cannot silently shrink the candidate set.

- Sequence gap/disconnect: mark stale, rebuild from a fresh snapshot, and exclude until
  continuity is proven.
- Checksum mismatch, impossible deletion, unsupported frame or native snapshot/delta
  mismatch quarantines the stream. Re-entry requires the venue-specific recovery
  procedure and receipt; there is no shared heuristic repair or universal truth score.
- Empty/crossed/malformed book: quarantine the observation and exclude venue.
- Fee/funding/account drift: invalidate and recompute.
- Partial fill: enter the shared partial/reconciliation path; no automatic cross-venue
  hedge until separately certified.
- Submission unknown: do not fail over until reconciliation proves no accepted order.
- No concurrent channel fanout. A different channel or rebuilt payload is allowed
  only after authoritative non-acceptance/expiry and a complete fresh preflight.
- Non-cancelable AMM transaction: use deadline/slippage semantics, not order-cancel
  language.

## Later implementation sequence

1. Inventory the existing router and eliminate alternative ranking logic.
2. Add source classifications, sequences, account-specific inputs, and fixtures.
3. Persist route plans/receipts and integrate Shadow proposal routing.
4. Add sizing and risk-snapshot binding.
5. Replace proxies venue-by-venue only after exact adapter validation.
6. Add Approval dry-run integration; live use remains certification-gated.

Rollback disables executable use of the extension while retaining public/Shadow
comparison and all immutable route receipts.
