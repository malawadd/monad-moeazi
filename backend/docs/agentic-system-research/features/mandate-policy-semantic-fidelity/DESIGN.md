# Design — Mandate-to-Policy Semantic Fidelity and Change Consent

## Contracts

`MandateSpec` contains user/account, stable typed clause IDs, field/operator/value/unit,
scope, allowed markets/venues/modes, caps, approval requirement, cadence, effective and
expiry times, schema version, and canonical hash.

Optional `PolicyDraftProjection` maps each prose clause to
`supported | ambiguous | unsupported | contradictory` with candidate typed fields and
source span. It is advisory only; unresolved status blocks.

`PolicyCompiler` accepts validated typed clauses only and emits a complete canonical
strict `AutomationPolicy`, per-clause mapping, explicit default provenance,
schema/compiler versions, test inputs, and policy hash. Unknown/missing fields fail
unless every default was explicitly approved.

`PolicySemanticDiff` records every field before/after, `tightening | loosening |
neutral | unknown`, stable reason, and aggregate `contains_loosening`/`contains_unknown`.
Mixed changes retain each class and never flatten to neutral.

`PolicyActivationReceipt` binds mandate, draft, prior-active and new-policy hashes;
complete mapping; compiler/schema; test artifact IDs/hashes; confirmer; one-time
challenge/nonce; time/expiry; activation ID and idempotency key.

## Deterministic diff rules

- Maximum notional/loss/leverage/concurrent position/credit budget up: loosening.
- Minimum confidence/consensus down: loosening.
- Cooldown down: loosening.
- Market/venue addition: loosening; removal: tightening.
- Required stop/take-profit `true -> false`: loosening.

Every schema field must declare direction or `unknown`. Any loosening or unknown needs
fresh exact-hash confirmation. Tightening may still require normal confirmation based
on product policy, but cannot reuse stale hashes.

## Unified activation flow

1. Text assistance or direct UI produces/edits a typed `MandateSpec`.
2. Resolve every ambiguous/unsupported/contradictory clause explicitly.
3. Compile canonically and run frozen deterministic policy cases.
4. Diff against the exact current active-policy revision.
5. Render clause map, defaults, tests, and per-field semantic diff.
6. Authenticate the owner and consume one exact-hash confirmation challenge.
7. Convex atomically rechecks user/account, current hashes, compiler/schema/tests,
   active revision, consent and expiry, then supersedes/activates idempotently.
8. Append immutable activation history through a durable outbox/retry path.

Models cannot perform steps 3–8 or fill unresolved/default values.

## Ownership, cost, latency, rollback

- Convex owns current mandate, policy, challenge/consent and activation receipt.
- Timescale owns immutable mapping, diff, tests and activation history.
- Redis has no policy or consent authority.
- Temporal may own long review/expiry, not activation semantics.

Compilation/testing is local and adds seconds at activation, not execution latency.
Optional model projection may incur provider cost only after preview/reservation and is
never needed for validation. Rollback activates a separately compiled, tested, and
confirmed prior mandate/policy; it cannot reuse old consent silently.

Failure modes include unmapped clauses, compiler-version drift, ambiguous bounds and
semantic-diff disagreement; all block activation rather than retaining a permissive
projection.

The local implementation uses an append-only Timescale fixture ledger and a synthetic
Test Center confirmer only. It has no Convex product owner projection.
