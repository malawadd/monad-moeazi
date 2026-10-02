# Unimoazi Agentic-System Research Program

## Purpose

This program turns external agentic-trading research into evidence-backed,
Unimoazi-specific feature dossiers. Approved dossiers now enter a separate sequential
implementation program; this research record does not itself authorize activation.
Implementation state is generated in [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md).

Unimoazi already has tiered specialists, model-family quorum, critic/challenger/arbiter
stages, strict typed outputs, immutable Evaluation Lab plans, and a deterministic
execution boundary. Research must close a demonstrated gap or materially improve a
measurable outcome. Adding more agents is not, by itself, a feature.

## Non-negotiable boundaries

- Arbitrum `42161` remains the active strategy chain.
- Particle and Magic remain owner signers.
- Models never receive wallet keys, venue credentials, signing adapters, broadcast
  tools, or deterministic policy authority.
- Convex owns current authenticated product state, Timescale owns detailed evidence
  and history, Redis owns ephemeral coordination and reservations, and Temporal owns
  durable work.
- Strict structured outputs, idempotency, cost reservations, and replay/shadow-first
  evaluation are preserved.
- No paid provider probe, cloud deployment, CI run, mainnet transaction, or funded
  canary is authorized by these documents.

## Operating model

The program runs in cycles of exactly three materially new candidates:

1. A low-cost research pass gathers primary sources and separates production
   evidence, research/backtest evidence, and platform or marketing claims.
2. A repository-aware audit checks each proposal against current Unimoazi behavior.
3. Hard-gate failures are rejected before scoring.
4. Approved candidates receive a feature folder. Held and rejected candidates remain
   in [DECISIONS.md](./DECISIONS.md).
5. Any approval resets the saturation streak to zero. The final continuation stops
   after six consecutive cycles approve no features.

Research was performed with `codex-auto-review` at medium reasoning. Auditing was
performed with `gpt-5.6-sol` at high reasoning. The exact Codex model-usage cost was
not exposed; the user explicitly approved that usage before the continuation.

## Hard gates

A candidate is rejected or must be materially reframed if it:

- exposes signing, credentials, wallet actions, or execution tools to a model;
- bypasses strict output validation or deterministic policy checks;
- creates a conflicting source of truth or revives Convex job polling;
- cannot preserve idempotency through retries and uncertain submissions;
- creates an unbounded autonomous loop or unpreviewable model spend;
- cannot be evaluated first with frozen replay, adversarial fixtures, or Shadow mode;
- treats a model output, quote, prepared transaction, or simulation as authority to
  execute.

## Weighted audit rubric

| Dimension | Weight |
| --- | ---: |
| Architectural fit | 14 |
| Evidence quality | 12 |
| Safety and failure behavior | 14 |
| Execution-boundary compatibility | 14 |
| Projected product or trading benefit | 12 |
| Evaluation feasibility | 10 |
| Data availability | 8 |
| Cost | 8 |
| Latency | 8 |

Decision bands:

- `75–100`: approved for a bounded implementation dossier.
- `60–74`: Evaluation Lab research only; no product integration dossier.
- Below `60`: reject or defer.
- Any hard-gate failure: reject regardless of score.
- A materially different reframe is scored under a new name.

## Evidence and benefit rules

- Every causal claim must link to a source in [SOURCES.md](./SOURCES.md).
- Backtests and papers support hypotheses, not production performance claims.
- Marketing claims are never sufficient for approval.
- A projected benefit must name the metric, range or invariant, assumptions,
  confidence, and falsifying experiment.
- PnL, Sharpe, or drawdown benefits are not claimed until Unimoazi produces held-out,
  cost-adjusted replay and Shadow evidence.
- Runtime observability, calibration, safety, cost, and latency are valid benefits
  even when no PnL claim is justified.

## Current status

Research is complete and stopped at Cycle 23. The program reviewed 69 candidates,
created 38 approved dossiers and ended with six consecutive zero-approval cycles.

| Cycle | Status | Candidates | Approved |
| --- | --- | ---: | ---: |
| [01](./cycles/cycle-01.md) | Complete | 3 | 3 after one material reframe |
| [02](./cycles/cycle-02.md) | Complete | 3 | 3 with prerequisites/narrowing |
| [03](./cycles/cycle-03.md) | Complete | 3 | 3, with one split into two rollout dossiers |
| [04](./cycles/cycle-04.md) | Complete | 3 | 3 with production gates |
| [05](./cycles/cycle-05.md) | Complete | 3 | 3 with strict production/data gates |
| [06](./cycles/cycle-06.md) | Complete | 3 | 3 with narrow authority/evidence claims |
| [07](./cycles/cycle-07.md) | Complete; zero streak 1 | 3 | 0 new dossiers; useful artifacts folded |
| [08](./cycles/cycle-08.md) | Complete; prior stop condition met | 3 | 0 new dossiers; one Evidence Fabric fold |
| [09](./cycles/cycle-09.md) | Complete; zero streak reset | 3 | 2 new dossiers; one lifecycle fold |
| [10](./cycles/cycle-10.md) | Complete; zero streak remains 0 | 3 | 3 new dossiers |
| [11](./cycles/cycle-11.md) | Complete; zero streak remains 0 | 3 | 3 new dossiers; one staffing-gated |
| [12](./cycles/cycle-12.md) | Complete; zero streak remains 0 | 3 | 2 new dossiers; one cost-control fold |
| [13](./cycles/cycle-13.md) | Complete; zero streak remains 0 | 3 | 2 new dossiers; one market-data fold |
| [14](./cycles/cycle-14.md) | Complete; zero streak remains 0 | 3 | 2 new dossiers; one analytical-dependency fold |
| [15](./cycles/cycle-15.md) | Complete; zero streak remains 0 | 3 | 2 new dossiers; one commercial-trigger fold |
| [16](./cycles/cycle-16.md) | Complete; zero streak remains 0 | 3 | 1 new dossier; one fold and one rejection |
| [17](./cycles/cycle-17.md) | Complete; zero streak reset | 3 | 2 new dossiers; one SLO fold |
| [18](./cycles/cycle-18.md) | Complete; zero streak 1 | 3 | 0; one fold, two rejects |
| [19](./cycles/cycle-19.md) | Complete; zero streak 2 | 3 | 0; two folds, one reject |
| [20](./cycles/cycle-20.md) | Complete; zero streak 3 | 3 | 0; two folds, one reject |
| [21](./cycles/cycle-21.md) | Complete; zero streak 4 | 3 | 0; three folds |
| [22](./cycles/cycle-22.md) | Complete; zero streak 5 | 3 | 0; one fold, two rejects |
| [23](./cycles/cycle-23.md) | Complete; stop condition met | 3 | 0; two folds, one reject |

The exact dependency-safe implementation queue, availability, modes, layer states and
direct dependencies are machine-readable in
[FEATURE-REGISTRY.json](./FEATURE-REGISTRY.json). Its generated human ledger is
[IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md). The roadmap explains the
dependency graph; it is not a second ordering source. Feature 01 is implemented in
product observe mode with isolated synthetic Test Center enforcement. Features 02–38
remain unavailable.
