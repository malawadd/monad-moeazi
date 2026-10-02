# Design — Outcome-Linked Immutable Decision Memory

## Implemented boundary

The current implementation covers local synthetic contracts, deterministic
evaluation, append-only fixture persistence, and isolated Test Center presentation.
Redis retrieval caching, embeddings, model-generated lessons, Temporal scheduling,
Convex product projections, and production retrieval are intentionally absent.

## Design principle

History is evidence, not instruction. Raw episodes remain immutable. Deterministic
code decides when an outcome is mature and what a retrieval query may see. Models may
draft a lesson candidate, but only frozen evaluation and operator action can promote
it into a versioned evaluation asset or later production configuration.

## Proposed records

### `DecisionEpisode`

Required fields:

- episode, analysis, account, market, chain, role/tier, and proposal identifiers;
- evidence-set IDs, hashes, event/observed times, and freshness result;
- prompt bundle, role graph, model route, policy, strategy, and adapter versions;
- specialist claims/reports, synthesis, forecast distribution, abstention, and typed
  trade intent when present;
- proposal, quote, sizing, routing, simulated/real execution, fee/funding/slippage,
  and reconciliation references when present;
- outcome horizon and maturity state;
- immutable content hash and created timestamp.

An episode is append-only. Corrections create a new outcome revision linked to the
original; they never rewrite the historical input.

### `OutcomeObservation`

For each declared horizon:

- evaluation timestamp and point-in-time market source;
- realized direction/return and evaluation price convention;
- simulated or actual fill result, including entry/exit assumptions, fees, funding,
  gas, slippage, and maximum adverse/favorable excursion where available;
- forecast score components and deterministic error labels;
- data quality, correction status, and maturity result.

Maturity requires the full horizon to elapse, all referenced price/fill data to pass
quality checks, and any execution/reconciliation outcome to be resolved. Late or
corrected data produces a new revision and invalidates dependent scorecards until
recomputed.

### `LessonCandidate`

Required fields:

- candidate ID and version;
- supporting episode IDs and mandatory counterexample episode IDs;
- precise applicability filters: tenant scope, chain, market, horizon, regime, role,
  evidence type, and time window;
- concise lesson, causal hypothesis, falsifier, known exceptions, confidence, expiry,
  and source hashes;
- generating route/prompt details and operator review state;
- states: `draft`, `rejected`, `evaluation_only`, `frozen`, `expired`, `rolled_back`.

The model may propose text, but deterministic validation rejects missing provenance,
counterexamples, falsifiers, or expiry.

### `MemoryBundle`

The bounded retrieval result contains:

- query/as-of hash and retrieval algorithm version;
- at most five lesson candidates or episodes;
- matched filters and similarity/recency/quality components;
- balanced positive, negative, abstention, and counterexample representation;
- token count, expiry, and all episode/source references.

## Storage and ownership

- Timescale owns episodes, outcome revisions, candidate evidence, retrieval indexes,
  and complete evaluation history.
- Redis may cache immutable retrieval results by query/version with a short TTL.
- Convex stores only current operator-visible asset summaries and active version
  references; it does not store detailed memories.
- Temporal matures outcomes and schedules recomputation. No worker polls Convex.

## Cost and latency budget

- Episode/outcome capture is deterministic storage work and must not add provider
  calls. Lesson drafting is a separately previewed, finite Evaluation Lab expense.
- Retrieval freezes maximum top-K, token budget, cache TTL, embedding/version, and p95
  latency before an experiment starts.
- Report storage/index growth, offline lesson cost, added input tokens, provider cost,
  and retrieval latency separately. A cache miss never expands the token or latency
  ceiling and may fall back to memory-off behavior.

## Retrieval rules

1. Filter by tenant/account permission before any similarity operation.
2. Require `chain_id=42161`, matching market, horizon, deterministic regime, and
   `outcome_mature=true` by default.
3. Enforce `episode.as_of < evaluation decision time` to prevent future leakage.
4. Exclude expired, corrected-but-unrecomputed, disputed, and low-quality episodes.
5. Rank with a versioned deterministic combination of similarity, recency, outcome
   quality, and diversity; apply decay by horizon/evidence type.
6. Select top-K `<=5` under a fixed token budget and require at least one relevant
   counterexample when any lesson is returned.
7. Return no bundle when support is sparse or filters cannot be satisfied.

Embeddings may generate candidates offline, but exact filters and final eligibility
remain deterministic. Embedding model/version belongs in the frozen query hash.

## Lesson lifecycle

1. Mature episodes are scored deterministically.
2. A bounded offline critic may draft a `LessonCandidate` from a preselected cohort.
3. Deterministic validation attaches counterexamples, coverage, and expiry.
4. An operator accepts the candidate as evaluation-only or rejects it.
5. Evaluation Lab freezes memory-off and memory-on subjects with chronological inputs.
6. Passing evidence allows a new versioned asset; it never mutates an existing prompt.
7. Production activation, if later requested, uses the existing explicit configuration
   activation path and supports instant rollback.

## Failure behavior

- Insufficient mature cases: retrieval returns empty and current behavior continues.
- Regime drift or expired lesson: omit it and mark the asset for reevaluation.
- Outcome correction: invalidate dependent bundles and scorecards.
- Cross-tenant/market/horizon match: reject and record a security/quality event.
- Retrieval/index failure: run without memory; do not fail open to unfiltered history.
- Poisoning or anomalous lesson: block the candidate and retain immutable evidence.

## Later implementation sequence

1. Add immutable episode/outcome contracts and backfill only verifiable existing runs.
2. Implement deterministic maturity and scoring with no model calls.
3. Accumulate coverage and publish operator-visible sufficiency reports.
4. Add evaluation-only retrieval and frozen memory bundles.
5. Add lesson drafting after the counterexample and review workflow exists.
6. Consider production retrieval only after chronological promotion thresholds pass.

Rollback deactivates the memory asset and returns to the exact champion configuration;
episodes and audit records remain immutable.
