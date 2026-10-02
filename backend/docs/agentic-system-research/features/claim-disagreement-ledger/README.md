# Claim-Level Disagreement Ledger and Conditional Escalation

## Decision

**Implemented locally — isolated Test Center only.** The product runtime remains unavailable.

Unimoazi already has duplicated critical roles, a Pro critic, Max challenger
syntheses, and an arbiter. The missing unit is not another debating persona; it is a
typed claim that lets deterministic code identify what the agents disagree about,
whether the conflict is material, and whether the final synthesis addressed it.

## Target user and problem

Customers and operators currently see reports and flat conflict strings, but cannot
reliably answer which evidence-backed assertions conflict, whether agreement comes
from independent model families, or why expensive escalation was necessary.

## Why implement it

- Makes quorum inspectable at the assertion level rather than the report-count level.
- Prevents synthesis prose from hiding unresolved material contradictions.
- Supplies compact, evidence-linked input to existing critic and arbiter stages.
- Creates a deterministic basis for selective escalation and abstention.
- Improves monitoring and evaluation without giving models more authority.

## Why the mechanism should work

TradingAgents and FinCon support structured specialist/manager communication, but the
transferable idea is disciplined information exchange, not unrestricted debate. A
typed ledger turns role outputs into comparable records. Deterministic grouping and
materiality rules decide when existing escalation stages receive a conflict packet.
The model still analyzes; code still validates, routes, and blocks.

## Proposed benefit

| Hypothesis | Test target | Confidence |
| --- | --- | --- |
| Fewer final outputs with an unaddressed material contradiction | 15–35% relative reduction | Medium-low |
| Lower escalation usage after selective routing | 10–25% fewer escalation tokens versus the current unconditional tier path | Low-medium |
| Better conflict traceability | 100% of material conflicts link claims, evidence, model families, and a resolution or abstention | High |

The percentage ranges are hypotheses. Claim fields add baseline tokens, so the
validation must measure net tokens and latency per tier. No trading-return improvement
is claimed.

## Dependencies and boundaries

- Preserve current critical-role and canonical model-family quorum.
- Do not change Focus, Pro, or Max customer semantics during ledger-only evaluation.
- Reserve the maximum possible conditional calls before a run; do not make spend
  unpreviewable.
- Store detailed ledgers in Timescale and expose only bounded current summaries through
  Convex.
- Escalation never votes on signing or execution.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Local implementation status

The fixture-only evaluator has typed claims, deterministic grouping/materiality,
bounded hypothetical escalation, append-only local history, and an explicit
Feature 25 selection that remains `requires_revalidation`. It does not change
SignalReport, synthesis, Pro/Max routing, providers, execution, or product authority.
The separate activation gate remains in force.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
