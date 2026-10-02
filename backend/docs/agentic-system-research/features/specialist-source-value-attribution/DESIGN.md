# Design — Specialist Source-Value Attribution and Evidence Gating

## Phase 0: honest citations

Change the future analytical contract so a specialist returns bounded
`cited_evidence_ids`. Deterministic code resolves those IDs against the exact allowed
manifest:

- unknown, cross-market, cross-tenant, or unavailable IDs invalidate the citation;
- `suppliedEvidenceIds`, `citedEvidenceIds`, and `supportingEvidenceIds` remain distinct;
- the system never replaces cited IDs with every supplied reference;
- source event and syndication/lineage IDs are retained;
- a claim without supporting evidence cannot inherit the report's full evidence set.

This phase is required before measuring citation alignment.

## Source-family taxonomy

Use a closed, versioned taxonomy rather than per-document categories:

- exact venue price/OHLC, executable depth, funding/open interest, liquidation data;
- onchain state/flow, official protocol/governance, market integrity;
- primary curated news, secondary news/syndication, verified social, unverified social;
- portfolio/account state and execution/reconciliation evidence.

Each event has one primary family and optional lineage tags. Taxonomy changes create a
new evidence-contract and experiment version.

## `RoleEvidenceContract`

For each role/horizon, freeze:

- allowed, required, optional, and forbidden source families;
- maximum age and source/ingest lag;
- minimum multidimensional quality and independent-source count;
- maximum items/tokens per family and total;
- behavior when a required or optional source fails;
- rare-risk sources that may be retained without ordinary marginal-value proof;
- contract version, authorizer, expiry, and rollback version.

## `RoleEvidenceStatus`

Pure evaluation returns:

- `eligible | degraded | omit | block`;
- supplied/cited/supporting IDs and family counts;
- freshness/quality/coverage results and missing requirements;
- contract/manifest hashes and deterministic reason codes.

For a critical role, missing required evidence blocks action eligibility unless a
separately frozen customer-facing degraded tier contract exists. It never silently
substitutes another family or waives critical-role/model-family quorum.

## Attribution experiment

### `RoleSourceAblationPlan`

- frozen cases, role/route/prompt, source taxonomy/contract, markets/regimes/horizons;
- source-family masks/coalitions, deterministic sampling seed, repetitions;
- outcome maturity, metrics, non-inferiority margins, multiple-comparison method;
- expected/maximum calls, tokens, cost, duration, and stop rules.

Start with paired leave-one-family-out and a small fractional-factorial design. Use
approximate Shapley/coalition allocation only when redundancy makes simple ablation
misleading. Freeze the value function and report convergence/error bounds.

### Outputs

`RoleSourceAttribution` records estimate, interval, stratum, effective sample, model/
prompt/contract versions, offline cost, runtime cost hypothesis, and expiry for each
separate objective:

- forecast/log loss/Brier/ECE;
- grounding/citation validity;
- contradiction and abstention quality;
- simulated strategy outcome;
- latency, tokens, and provider cost.

Never collapse these into causal “source truth” or one opaque score.

## Activation behavior

- Attribution results are evaluation evidence only.
- An operator may propose a new evidence-contract version after held-out acceptance.
- Optional source removal begins in replay/live shadow.
- A source with uncertain contribution is retained, especially when it covers rare
  risks.
- No production source or role is removed automatically.

## Storage and ownership

- Timescale stores manifests, ablation plans, observations, attribution, citations,
  gate decisions, and detailed cost.
- Convex stores current source-health/role eligibility summaries and explicitly active
  contract versions.
- Redis may cache eligibility for one immutable manifest/version.
- Temporal owns finite evaluation plans; no unbounded combinatorial run is allowed.

## Failure behavior

- Citation resolution failure: invalidate citation and apply contract behavior.
- Correlated/redundant sources: group by source family/lineage and report instability.
- Sparse or drifting stratum: expire attribution and retain the source.
- Provider cost cap reached: stop with incomplete evidence; do not extrapolate.
- Critical source unavailable: block or abstain according to the frozen contract.

## Later implementation sequence

1. Correct citation identity and add regression tests.
2. Activate source taxonomy and role evidence contracts in Evaluation Lab only.
3. Add paired ablation planner with finish-safe budget.
4. Accumulate and publish attribution with uncertainty and offline cost.
5. Test candidate evidence contracts in replay/live shadow.
6. Consider production gating only after per-role non-inferiority acceptance.

Rollback restores the previous evidence contract; immutable attribution remains.
