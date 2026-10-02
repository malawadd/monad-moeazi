# Future Design

Contracts: `UsageRightsRulepack`, `UsageRightsAssertion`, `UsageSubjectSpec`,
`UsageRightsDecision` (`allow|deny|unknown|manual_legal_review_required`),
`UsageObligationReceipt`, `RulepackChange` and activation receipt. Bind exact subject/
revision, agreement/plan/terms, operation, purpose, destination/provider/recipient,
retention/quantity, obligations, sources, golden cases and expiry.

Qualified legal/commercial humans own interpretation/content; deterministic code
evaluates. Timescale immutable packs/decisions; Convex bounded current status; Temporal
expiry/remediation; Redis immutable-input cache. Fabric gates fetch/replay, Lifecycle
storage/deletion, model routes provider sharing/training, UI export/display.

Fetch never implies prompt/display/export; public/free/API/CC label never implies
unrestricted use. Missing/conflict/expiry blocks only the requested use. Derived/model
outputs do not automatically escape restrictions. Changes append and prospectively
block/remediate without rewriting history. No LLM terms parsing, opaque combined legal
engine, destructive auto-delete or trade authority.

Local cached decision target below 10 ms. Counsel/licensed data may be billable and
requires approval.

## Implemented boundary

The local Test Center implementation freezes one selected Feature 03 fixture context,
uses strict canonical contracts and a bounded subject lineage, and persists the request,
decision, leaf matches, obligations, bundle, and Test Center event history atomically.
It has a scoped idempotency claim, durable conflict record, append-only tables, and an
isolated safe projection. It never reaches Convex, Temporal, Redis, a provider, signer,
wallet, venue, RPC, or execution path.

The measured pure evaluator p95 is 3.294 ms for 10,000 local iterations; the local
disposable persistence p95 is 25.092 ms for actual writes. These are fixture-only
performance observations, not a production service-level objective or permission claim.

## Failure and rollback

Missing, conflicting or expired assertions block only the requested operation and
produce a reviewable receipt. Rollback deactivates a rulepack prospectively, preserves
past decisions and applies an approved prior or stricter version. It never deletes
evidence automatically or converts `unknown` into `allow`.
