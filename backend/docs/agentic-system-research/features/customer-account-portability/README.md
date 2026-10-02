# Customer Account Portability and Verified Export

## Decision

**Approved design — 89/100; privacy/legal and delivery gated.**

Score: fit 14, evidence 11, safety 13, boundary 14, benefit 10, evaluation 10,
data 6, cost 6, latency 5.

## Causal argument and usefulness

This feature owns the authenticated export request, per-domain collection, explicit
coverage/omissions, package integrity and transient delivery. Evidence Lifecycle and
Usage Rights still decide which fields may leave each sink.

## Projected benefit

Targets: every configured domain has a receipt/omission, every file verifies against
the manifest, and zero secrets/cross-tenant data escape. Estimated 30–60% less repeated
manual assembly is a medium-low-confidence hypothesis. No “all data,” legal-compliance,
global-snapshot or interoperability claim is made.

This assumes domain owners can expose bounded export cursors and qualified owners can
decide omissions. Production staging/object storage and egress may be billable and
require approval.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Local implementation status

The local Test Center implementation is deterministic and fixture-only: it verifies ten
configured synthetic domains, bounded in-memory bytes, descriptor/manifest integrity,
aggregate-only projection, simulated single-use delivery states, and cleanup. Product
availability remains unavailable; it performs no download, archive, provider, network,
storage, customer-data, or external delivery operation.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
