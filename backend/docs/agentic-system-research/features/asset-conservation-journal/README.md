# Asset Conservation Journal

## Implementation status

Implemented and locally verified for synthetic fixture use in the isolated Test Center.
Product runtime remains unavailable pending authoritative owners, native reconciliation,
certified execution boundaries, and separate activation approval. The implementation
was independently reviewed, with detailed audit material archived privately for the
later roadmap remediation goal.

## Decision

**Approved for Shadow before live-execution certification — 94/100.**

Score: fit 14, evidence 11, safety 14, execution boundary 14, benefit 10,
evaluation 10, data 7, cost 7, latency 7.

## Problem and causal argument

Execution rows and audit JSON do not prove that every observed customer-asset movement
was recorded once and balanced in exact units. Immutable debit/credit postings make a
missing, duplicate, asymmetric or wrong-unit record deterministically detectable and
give reconciliation a localized difference. External chain/venue state remains truth.

## Why implement it

- Journals wallet, venue, locked, pending, bridge, fee, funding and realized-settlement
  movements with stable source identities.
- Conserves each exact namespaced asset separately—never USD values or symbols.
- Represents pending/final/reorg/correction states append-only.
- Exposes `balanced | partial | unknown | mismatch` to the existing risk gate.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Supported postings balanced per exact asset unit | 100% | High |
| Seeded missing/duplicate/wrong-unit/asymmetric defects detected | 100% required corpus | High |
| Duplicate logical movement under retry/replay | Zero | High |
| Median injected-mismatch localization time | At least 50% reduction | Medium hypothesis |

No accounting-correctness, custody, statutory-record or loss-prevention claim is made.

## Boundaries

The journal records Unimoazi's observed movements; it does not decide actual balances,
value collateral, grant authority, move assets or replace authoritative reconciliation
and `ExecutionReceipt`. Timescale/Postgres is the initial design; TigerBeetle is
mechanism evidence, not an adoption decision.

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
