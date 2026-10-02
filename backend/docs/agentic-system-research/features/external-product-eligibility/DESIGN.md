# Future Design

## Contracts

`ExternalEligibilityRulepack` declares accountable author/approver, jurisdiction,
customer/product/venue/operation taxonomy, required assertions, closed deterministic
clauses, unknown/review behavior, sources/tests, effective interval and version.
`EligibilityAssertion`, `ProductEligibilityDecision` (`eligible | ineligible | unknown
| manual_legal_review_required`), `RulepackChange` and `RulepackActivationReceipt`
bind exact scope and hashes.

## Ownership

Qualified legal/compliance humans own applicability/content. Deterministic code only
validates/evaluates. Timescale owns immutable packs/sources/tests/decisions; Convex
minimal current assertions/review/projection; Temporal expiry/re-evaluation; Redis
expiring cache. Instrument Registry supplies exact product version, Evidence Lifecycle
governs personal data, Safety Change Quorum loosening, and EAD consumes the result
without treating it as authorization.

## Hard gates

No LLM interpretation, authorship, conflict resolution or activation; no autonomous
regulatory scraping. Never infer residence/nationality/class from IP, wallet, name or
chain history. Missing/stale/disputed assertion or absent/expired pack is unknown/manual
review. Customer self-attestation alone cannot clear identity-sensitive restrictions.

A decision applies only to exact account, Arbitrum `42161` product version, venue,
operation and time. Tightening may use declared monotonic emergency handling; loosening
requires legal re-review and quorum. Raw KYC/list data never enters models, Redis,
general traces or unnecessary Convex fields. Eligibility cannot approve or move funds.

## Rollout/cost

Design schemas and synthetic golden cases only. Shadow compares would-block outcomes
without contacting vendors. Activation waits for counsel, lawful sources and reviewed
test vectors. Local cached target p95 is below 5 ms. External legal/KYC/list services
may be billable at unknown cost and are not authorized.

## Failure and rollback

Source, identity or rulepack failure returns `unknown` or manual review and cannot
increase authority. Rollback deactivates the affected version prospectively, retains
its decisions for audit and re-evaluates current projections under an approved prior
or stricter pack. It never silently marks customers eligible.

## Implemented local fixture boundary

The local fixture evaluates exact opaque values from a closed corpus and records
append-only scope, request, decision, leaf, bundle, conflict and lifecycle-shaped
receipts. Feature 21 is explicit `requires_revalidation` context and is never
inherited as permission. No current product projection, job, cache, vendor lookup,
signer, venue call, or customer-data ingestion was added.
