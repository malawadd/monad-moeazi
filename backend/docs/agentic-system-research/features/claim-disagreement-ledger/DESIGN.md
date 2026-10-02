# Design — Claim-Level Disagreement Ledger

## Proposed typed records

### `Claim`

Each specialist report may emit a bounded list of claims with:

- `claim_id`, `market`, `claim_type`, and normalized `subject`;
- horizon bucket, polarity, bounded magnitude band, and confidence;
- role, provider, served model, and canonical model family;
- cited evidence IDs and content hashes, plus observed/event times;
- falsifier, invalidation condition, and expiry;
- `supports | opposes | neutral` risk implication;
- short decision summary with no hidden chain-of-thought.

The initial `claim_type` vocabulary is closed and versioned: trend, liquidity,
volatility, liquidation risk, basis/funding, flow, catalyst, market integrity,
portfolio exposure, and execution quality. Unknown types fail validation rather than
falling back to prose.

### `ConflictGroup`

Required fields:

- deterministic group key and algorithm version;
- member claim IDs and canonical model families;
- agreement, contradiction, freshness, and evidence-quality scores;
- materiality reasons;
- required resolution: `none | explain | critic | challenger_arbiter | abstain`;
- final status: `resolved | unresolved | expired | invalid_input`;
- resolution claim IDs or synthesis references.

### `ConflictPacket`

This is the only additional material sent to an existing critic/challenger/arbiter. It
contains bounded claims, evidence references, deterministic scores, and the exact
question to resolve. It excludes raw evidence text not already admitted to the run.

## Deterministic grouping

Version 1 must avoid model-based clustering. A conflict key is:

`market + claim_type + normalized_subject + overlapping_horizon_bucket`.

Claims can conflict only when all key fields match and their unexpired evidence
windows overlap. Polarity rules are type-specific and table-driven. Opposite polarity
is a contradiction; disjoint magnitude intervals are a contradiction when the claim
type defines a comparable magnitude. Different horizons remain separate.

Evidence quality is computed from existing evidence scores, freshness, and source
independence. Same-family repetitions are recorded but do not add family diversity.
No score declares truth; it only describes support and conflict.

## Materiality rules

A group is material when any condition holds:

- it contains a critical role and opposite valid claims;
- it could change direction, abstention, risk band, venue eligibility, or proposal
  creation under the frozen synthesis policy;
- high-quality evidence directly contradicts the current consensus;
- all supporting claims share one canonical model family;
- a required claim lacks a falsifier, valid evidence, or freshness.

Thresholds and rule versions are frozen in each Evaluation Lab subject. They cannot be
changed after a plan is previewed.

## Pipeline insertion

1. Specialists return strict reports plus claims.
2. Deterministic validation rejects invalid claims without discarding an otherwise
   valid report unless a critical claim is required by the evaluation subject.
3. The ledger groups claims and emits conflict packets.
4. Ledger-only experiments give the existing tier stages the same reports plus the
   ledger summary; production orchestration is unchanged.
5. Conditional-escalation experiments compare three subjects: current orchestration,
   ledger-only, and ledger plus conditional escalation.
6. Final synthesis must reference every material group and mark it resolved or abstain.

## Tier matrix

| Tier | Ledger-only behavior | Conditional experiment ceiling |
| --- | --- | --- |
| Lite | No new provider calls; deterministic warning/abstention only | None |
| Focus | Existing synthesis receives bounded ledger | At most one critic call for a material critical conflict |
| Pro | Existing critic and synthesis remain baseline | Skip critic only when no material conflict and non-inferiority is proven; maximum remains current path |
| Max | Existing two syntheses and arbiter remain baseline | Any reduction requires separate evidence; maximum remains current path |

Critical-role quorum and two-family quorum are never relaxed. Cost preview reserves
the maximum path even when expected conditional cost is lower.

## Storage and monitoring

- Timescale stores complete claims, groups, rule versions, and resolution events.
- Convex stores the current bounded conflict summary required by product UI.
- Monitoring shows claim/evidence links, family diversity, materiality reasons,
  escalation route, resolution, tokens, latency, and cost.
- No hidden chain-of-thought is stored or displayed.

## Failure behavior

- Unknown claim type or malformed claim: mark invalid; do not parse free-form prose.
- Stale evidence: exclude support and require abstention when the claim is critical.
- Missing falsifier: flag incomplete and prevent a high-confidence resolved status.
- Conflicting horizons: keep separate rather than manufacturing a contradiction.
- Grouping ambiguity: prefer an unresolved conservative group; do not use an LLM to
  silently merge it.
- Ledger or rule failure: fall back to the unchanged current tier path, record the
  failure, and disable conditional cost savings.

## Later implementation sequence

1. Add evaluation-only contracts and deterministic grouping fixtures.
2. Produce a human-adjudicated conflict corpus from frozen runs.
3. Run ledger-only experiments without changing call topology.
4. Add conditional paths only inside Evaluation Lab with full maximum cost reserved.
5. Consider production ledger visibility after quality acceptance.
6. Consider production conditional routing separately, per tier, after non-inferiority
   and cost/latency evidence.

Rollback removes conditional routing first. Stored claims remain immutable audit
evidence; current tier behavior remains available as the champion.
