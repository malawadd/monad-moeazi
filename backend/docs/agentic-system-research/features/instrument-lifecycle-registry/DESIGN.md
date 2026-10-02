# Future Design

## Local implementation boundary

The current implementation is a deterministic checked-in fixture registry and
operation evaluator only. It has no product projection, external adapter, live
metadata pull, position migration, settlement, routing, signing, or broadcast path.

## Contracts

- `NativeInstrumentIdentity`: venue/domain/environment, namespace/DEX, native ID/name
  and exact metadata revision.
- `InstrumentDefinitionVersion`: stable internal ID, immutable version, type,
  underlying/quote/settlement/collateral assets, multiplier, precision/tick/lot,
  expiry/delivery, oracle/index, status, effective interval, source and hash.
- `InstrumentAlias`: scoped display/input alias with validity; never identity.
- `InstrumentLifecycleEvent`: native event/sequence, old/new hashes, effective/observed
  times and typed state/change.
- `ContinuityTransform`: same/successor/redenomination/split/migration/no-continuity/
  unknown with exact rational factors/rounding and review.
- `InstrumentOperationDecision`, `RebaselinePlan` and `RebaselineReceipt`.

## Rules and flow

Stable IDs never derive from symbols. Environment, venue namespace, spot/perp and
outcome/Dex identity cannot collide. An index is valid only with its exact universe
revision. Rename does not imply continuity. Material multiplier, underlying,
collateral, settlement, oracle, expiry or contract change creates a new version and
usually rebaseline; old positions/fills retain their version.

Evidence Fabric transports observations into the registry. Timescale owns immutable
definitions/events/transforms/rebaseline; Convex current catalog/state; Temporal
propagation; Redis cache. Routing/gateway consume the exact native ID and operation
decision. Artifact Certification still owns code/config compatibility; the journal
references versions without owning lifecycle.

Missing/conflicting/late/stale state blocks open/increase and invalidates routes,
proposals, approvals and equivalence receipts. Certified cancel/reduce/settle/reconcile
remains where native state permits. No automatic migration/settlement occurs.

## Rollout/cost

Start with point-in-time Hyperliquid metadata and Arbitrum GMX/Uniswap identities,
then synthetic lifecycle transforms. Shadow dual-map before removing string safety
dependencies. Target cached decision p95 below 10 ms and healthy push event-to-latch
below five seconds. Local validation is unmetered; future paid feeds need approval.
Rollback marks affected cells unknown/no-new-exposure and preserves history.

Failure modes include ambiguous aliases, missing terms and out-of-order lifecycle
events; all block affected new exposure until an explicit versioned resolution exists.
