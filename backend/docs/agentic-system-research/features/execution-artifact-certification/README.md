# Execution Artifact Certification Registry and Drift Gate

## Decision

**Approved as the highest-priority execution-certification owner — 95/100.**

Score: fit 14, evidence 11, safety 14, execution boundary 14, benefit 10,
evaluation 10, data 8, cost 7, latency 7.

## Problem and target user

Operators and customers need proof that the exact contracts, proxies, domains,
schemas and adapter builds used at preparation are still the reviewed artifacts at
signing. Existing certification flags and isolated hook checks do not canonically own
transitive implementation identity or invalidate dependants after drift.

## Why implement it

- Resolves target, proxy, beacon, implementation, admin and upgrade authority.
- Binds ABI/selectors, EIP-712 domain, hook/pool configuration and adapter/SDK/image
  versions to reviewed evidence.
- Invalidates routes, grants and prepared-equivalence receipts on drift.
- Preserves only a separately certified close/reconciliation artifact set.

## Why it should work

Runtime code, standardized proxy slots, configuration and build identities are
observable at deterministic boundaries. A canonical reviewed specification plus
fresh observations can therefore detect identity drift before signing. Identity is
not proof of code safety, governance honesty or review quality.

## Benefit, confidence and assumptions

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Executable targets and transitive dependencies under current certification | 100% | High |
| Unknown, expired or drifted artifacts used for new exposure | Zero | High |
| Dependent plans/grants/equivalence receipts invalidated on drift | 100% | High |
| Stale-integration incidents | 60–95% reduction | Medium |

The percentage is a fault-injection/Shadow hypothesis, not exploit reduction or a
safety proof. It assumes relevant identity/configuration state is observable and the
dependency graph is complete.

## Boundaries and dependencies

The registry owns artifact identity, dependency and certification—not delegation,
routing, price formulas, transaction equivalence or general analytical provenance.
Gateway/sidecar enforcement remains deterministic; Particle/Magic remain owner
signers; all EVM targets remain Arbitrum `42161`.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Assumptions, costs, risks, and confidence

## Local implementation status

The registry is implemented as a local, fixture-backed Test Center capability. It
does not make the product available, certify a live venue, or authorize signing,
broadcast, setup, or external network access.

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
