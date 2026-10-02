# Cross-Layer Dependency Safety Envelope

## Decision

**Approved as the first Cycle 6 safety priority — 94/100.**

Implementation status (2026-08-06): the v2 retrofit is implemented with the tracked
product default in observe mode. V2 adds canonical scope keys, owner-current broader
receipt loading, exact request/binding hashes, deterministic tie-breaks, durable
idempotency conflicts, aligned recovery parameters, quote pre-admission and connected
reconciliation. The authenticated local Test Center may exercise isolated synthetic
enforcement only. V1 history remains readable but cannot authorize v2 boundaries.
Authoritative risk, reconciliation clearance, certified owner-signer readiness,
product enforcement and live execution remain activation-gated.

Score: fit 14, evidence 10, safety 14, execution boundary 14, benefit 9,
evaluation 10, data 7, cost 8, latency 8.

## Target user and problem

Operators and every customer mode need predictable behavior when a provider, source,
policy/credit owner, gateway, signer, sidecar, or venue is stale or failing. Current
authority reduces a coarse `system_healthy` boolean and the runbook describes manual
breakers, but there is no canonical scoped receipt and dependency-by-operation matrix.

## Why implement it

- Stops retry amplification and new risky work during a relevant incident.
- Keeps safe recovery work—especially reconciliation of uncertain submissions—alive.
- Makes degraded analysis/snapshot behavior explicit instead of silently weakening a
  tier, quorum, policy, or customer mode.
- Gives Effective Authority and operators one receipt-backed explanation without
  turning health into authorization.

## Why the mechanism should work

Circuit breakers suppress calls that are likely to fail and permit bounded recovery
probes. Reliability guidance explains how retries and overloaded dependencies create
cascading positive feedback. A deterministic matrix can apply these mechanisms to
Unimoazi's distinct operations while failing closed at authority-increasing boundaries.
These sources do not quantify a trading benefit.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Relevant preflight/submit under stale, open, or unknown required dependency | Zero | High |
| Covered decisions bound to fresh dependency receipts | 100% | High |
| Silent quorum, tier, policy, or authority relaxation | Zero | High |
| Futile incident retries | 30–60% relative reduction | Medium |

A futile retry is a non-probe call made while the current incident marks that
dependency/operation unavailable. Report by dependency, operation, and incident,
separating bounded probes and later successful retries.

## Dependencies and boundaries

The envelope consumes owner health; it does not replace risk snapshots, Evidence
Fabric, run planning, policy, EAD, promotion, or execution preflight. A decision is not
an authorization token. Recovery cannot raise customer authority. Half-open probes are
read-only/idempotent and cannot sign, broadcast, or mutate external state.

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
