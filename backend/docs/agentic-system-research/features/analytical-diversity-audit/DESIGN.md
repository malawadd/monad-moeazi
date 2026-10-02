# Design — Analytical Diversity and Correlated-Error Audit

## Contracts

The implemented local slice uses frozen strict contracts, canonical SHA-256 hashes,
integer BPS values, and registry-bound aliases. It only accepts checked-in synthetic
fixtures through the isolated Test Center; it does not implement the optional policy.

`AnalyticalPathIdentity` binds role, canonical family, requested/served model,
provider/gateway/route, prompt/schema/evidence/retrieval versions, claim/evidence
cluster IDs, timestamps, and completeness. The same family behind different gateways
remains the same canonical family.

`PathObservation` contains one point-in-time typed forecast or claim decision,
horizon, direction/value, confidence/calibration asset, abstention/failure, and exact
lineage. It is never reconstructed from freeform text or final synthesis.

`MatureCaseOutcome` freezes outcome, neutral band, cost convention, maturity time, and
source. `CohortSpec` pre-registers market, horizon, regime/event/outage, version set,
cutoff, embargo, dependence adjustment, metrics, and minimum samples.

`PairwiseDependenceMetric` records residual correlation, disagreement, double-fault,
high-confidence common-wrong, claim/evidence overlap, lineage overlap, and
latency/failure co-occurrence with sample and interval.

`CommonModeEvent` and `DiversityAuditReport` retain group estimates, wrong-consensus
events, estimator-dependent effective-member estimate, sensitivity, missing data,
cost, and limitations. An optional `DiversityPolicyDecision` is a separate later
artifact.

## Evaluation flow

1. Freeze a chronological cohort and all identity/outcome definitions.
2. Require exact point-in-time path observations or mark them unscorable.
3. Embargo overlapping outcomes and adjust effective sample for serial dependence and
   repeated evidence/cases.
4. Stratify by market, horizon, regime, event, outage, route and version.
5. Calculate pairwise and group measures with intervals and sensitivity analysis.
6. Separate shared evidence, shared base family, prompt lineage, and independent-looking
   host/provider labels.
7. Publish every metric; never collapse them into a truth or authority score.

## Storage and ownership

- Timescale owns observations, mature outcomes, cohort specs, pair metrics, reports,
  common-mode incidents, and detailed lineage.
- Convex may store a bounded current operator summary and report hash.
- Temporal runs finite frozen audits and later bounded policy evaluations.
- Redis is not durable lineage or outcome truth.

Auditing existing outcomes is local. Any new model-case collection must use the
Evaluation Lab preview and reserve the complete maximum provider spend before start.

## Optional future policy

A separately versioned, explicitly activated policy can only `cap`, invoke an existing
bounded escalation, or `abstain`. It cannot relax quorum, pick a winner, change routes,
promote configurations, or interpret a diverse minority/majority as truth. Insufficient
sample, drift, or unknown lineage yields no production action.

## Failure, cost, latency, and rollback

Sparse cohorts remain exploratory. Drift expires reports. Invalid labels or lineage
make observations unscorable. Offline metric cost is bounded by frozen cohort size;
runtime latency is zero until a policy is separately approved. Rollback disables new
audits/policy decisions while retaining reports; canonical quorum is unchanged.
