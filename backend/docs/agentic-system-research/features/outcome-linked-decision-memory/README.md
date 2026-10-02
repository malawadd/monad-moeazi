# Outcome-Linked Immutable Decision Memory

## Implementation status

Implemented as a local, fixture-only Test Center slice with deterministic episode
capture, append-only outcome revisions, maturity/scoring, bounded retrieval, and
invalidation behavior. Product memory and online prompt modification remain
unavailable. Activation still requires authoritative outcome ownership, Feature 25
revalidation, powered chronological evidence, Feature 36 review, and separate
approval.

## Decision

**Approved in phases — 89/100.**

Unimoazi already stores detailed runs and has a frozen Evaluation Lab. The approved
feature is not generic chat memory. It is an immutable link between the exact evidence,
decision, proposal, and later observable outcome, followed by tightly bounded
retrieval and an operator-reviewed lesson lifecycle.

## Target user and problem

The agent team can repeat an error because prior traces are audit history rather than
validated decision context. Conversely, feeding raw history back into prompts would
create selection bias, future leakage, poisoning, and silent self-modification.

## Why implement it

- Converts existing traces into testable, versioned learning evidence.
- Preserves losing, abstaining, contradicted, and counterfactual examples instead of
  learning only from wins.
- Makes outcome-based improvements reproducible in Evaluation Lab.
- Allows stale or regime-specific lessons to expire without rewriting history.

## Why the mechanism should work

FinMem shows that retrieval breadth and memory decay materially affect its backtest.
FinCon and QuantAgent provide evidence for episodic feedback and an outer outcome
evaluation loop. Unimoazi adds the missing safety layer: deterministic maturity,
immutable episodes, chronological evaluation, and explicit asset promotion. This
should reduce repeated documented mistakes if comparable mature cases exist.

## Proposed benefit

| Hypothesis | Test target | Confidence |
| --- | --- | --- |
| Forecast calibration | 5–15% relative improvement in Brier score or log loss | Low-medium |
| Repeated classified errors | 10–25% relative reduction | Medium for operational errors; low for market errors |
| Historical trace reuse | 100% of retrieved lessons link to mature episodes and counterexamples | High |

These are experiment hypotheses, not projections of return. No PnL benefit is claimed
until chronological, net-of-cost Unimoazi evidence demonstrates one.

## Dependencies and boundaries

- Outcome capture can begin immediately; retrieval waits for adequate mature data.
- `>=200` comparable mature cases is only an eligibility floor, never an automatic
  approval threshold. Power analysis and per-market/regime/horizon coverage decide.
- Retrieval is bounded by tenant, chain, market, horizon, regime, time, token budget,
  and top-K.
- No lesson changes a live prompt, route, policy, role graph, customer mode, or
  execution authority automatically.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
