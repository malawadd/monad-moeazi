# Future Design

## Contracts

- `DataElementClass`: strict field/path/schema class including `prohibited`, secret,
  personal/linkable, financial, customer-confidential, internal and public.
- `DataHandlingPolicy`: producer, purpose, sink, class, transforms, roles, retention,
  export/deletion behavior, version and expiry.
- `PersistenceDecision`: exact inputs and `allow | transformed | drop | quarantine |
  block | unknown` with stable reasons.
- `TransformReceipt`: processor/version/outcome without original secret or reversible
  low-entropy hash.
- `RetentionSchedule`, `AccessReceipt`, `ExportReceipt` and `DeletionReceipt` with
  per-copy outcomes: verified/logical/crypto-erased, retained, provider-reported,
  pending, partial, unverifiable, public-onchain or not-applicable.

## Boundary flow

1. Inventory every Convex, Timescale, Redis, Temporal, log, backup, cache, provider,
   export and onchain sink.
2. Classify and minimize before persistence or transmission. Unknown external sinks
   and privileged persistence fail closed.
3. Evidence Fabric receives only approved sanitized content plus policy/receipt refs.
4. Temporal executes expiry/deletion and retries partial outcomes. Timescale stores
   minimal lifecycle receipts and permitted history; Convex current status; Redis only
   shorter-lived cache.
5. External provider deletion is `requested | provider_reported | unverifiable`, never
   promoted to verified without evidence.

Wallet keys, venue credentials, reusable signatures, authorization headers, BYOK and
hidden chain-of-thought are rejected, not post-storage redacted. Subject-link maps may
be separately erasable without falsifying asset/safety history. Raw evidence needs an
explicit purpose, rights class and retention.

## Failure behavior

Transform failure, policy drift, unknown field/sink or tenant mismatch blocks export
and privileged persistence. Partial deletion blocks further disclosure, records every
residual copy and retries/escalates. Holds are explicit, expiring and reviewable; they
are never indefinite defaults. Public chain references remain `public_onchain`.

## Cost, latency and rollout

Start with synthetic fixture sinks and Shadow decisions, then enforce prohibited
fields and narrow sinks before broader Evidence Fabric ingestion. Target sanitizer p95
is under 10 ms and collector throughput degradation under 5%, both measured.
Per-domain KMS/vendor APIs are out of scope without cost approval. Rollback blocks new
raw ingestion; it preserves minimal receipts and never restores prohibited export.
