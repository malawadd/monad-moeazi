# Future Design

## Contracts

`CollateralAssetSpec` defines exact chain/token identity and decimals; issuer, bridge,
wrapper, custodian and venue dependencies; redemption/withdrawal mechanisms;
collateral/index/settlement relationships; policy and artifact hashes; expiry.

`CollateralObservation` records authoritative free, locked and withdrawable balances;
executable side/size depth, spread and basis; dependency state; withdrawal caps,
queues and estimated latency; source, observed time and expiry.

`CollateralStressPolicy` is versioned per asset, venue and instrument and contains
depeg, basis, issuer/bridge/custodian/wrapper outage, withdrawal haircut/delay, depth
loss and correlated-concentration scenarios.

`ExitCapacityReceipt` separates close, settlement and withdrawal capacity, costs,
fees, impact, horizon, dependency, route and certification hashes.

`CollateralRiskEnvelope` returns `allow_new | reduce_only | block`, reasons, binding
scenario, maximum incremental exposure, all input hashes and expiry.

## Deterministic rules

`allow_new` requires every mandated scenario to satisfy:

- stressed usable collateral is at least native stressed maintenance plus frozen
  reserve; and
- executable close capacity over the configured horizon is at least the required
  risk reduction.

Missing identity, dependency mapping, withdrawal state, executable-side quote or
calibrated policy is `unknown` and blocks increases. Midpoints are not exit capacity.
`withdrawable_now`, queued/estimated and unavailable are distinct. Haircuts and
thresholds are deterministic policy, never model output.

## Flow and ownership

1. Registry and venue adapters provide certified asset/dependency identities.
2. Gateway/sidecar captures authoritative balances, executable quotes and withdrawal
   state; data fabric supplies time-aligned dependency evidence.
3. The deterministic risk service runs scenarios and emits receipts/envelope.
4. Authoritative risk snapshot and portfolio sizing consume the envelope; routing
   owns the actual close route.
5. Timescale owns detailed history, Convex current projection, Temporal durable
   refresh/reconciliation and Redis short-lived observation caches only.

Unknown/degraded collateral blocks increases. `reduce_only` requires a separate
certified route and never initiates a close, swap, bridge or withdrawal automatically.
Particle/Magic remain owner signers and models see only bounded evidence summaries.

## Sequencing, rollback, cost and latency

Start with native Arbitrum USDC/WETH plus one recorded Hyperliquid collateral fixture.
Add local stress/replay, then Shadow envelope generation and Approval dry-runs.
Rollback returns the affected asset/venue cell to no-new-exposure while keeping close
and reconciliation available.

Costs are adapter work, market/dependency reads, scenario computation and storage; no
model calls are required. Target added p95 is under 250 ms with coherent observations
and under 1 second on refresh, subordinate to quote freshness.

Failure modes include stale dependency state, unavailable exit quotes and incomplete
settlement paths; each yields unknown capacity or no-new-exposure, never optimistic
zero haircuts.
