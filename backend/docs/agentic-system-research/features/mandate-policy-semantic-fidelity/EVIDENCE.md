# Evidence — Mandate-to-Policy Semantic Fidelity and Change Consent

## Claim-to-source map

| Claim | Source | Status and limit |
| --- | --- | --- |
| Current text drafting silently retains defaults and activation lacks clause/hash/test consent artifacts | [U14](../../SOURCES.md#unimoazi-sources) | Direct repository evidence |
| Schema validation detects policy type/entity/action incompatibilities | [S61](../../SOURCES.md#external-sources) | Production documentation; cannot know author meaning |
| Strict mode rejects policies that fail the schema | [S62](../../SOURCES.md#external-sources) | Vendor implementation analogy |
| Declarative policy decisions can have executable tests | [S60](../../SOURCES.md#external-sources) | Production documentation; not mandate-comprehension evidence |

## Mandatory evidence correction

Do not describe this mechanism as preserving natural-language intent. The authoritative
artifact is the structured mandate the user reviews and approves. Free text can be
mapped into a non-authoritative projection, but ambiguity, contradiction, unsupported
clauses, missing units, or silent defaults block activation until resolved in typed
fields.

## Counterevidence and limitations

- A valid schema can encode an unsafe or unintended policy.
- Deterministic tests cover declared cases, not every market or future situation.
- Users can misunderstand units, scope, mixed changes, or long-lived consequences.
- More explicit resolution/confirmation increases activation time and abandonment.
- A clause projector may fail on negation, context, language, compound constraints,
  or unsupported concepts. Its metrics never authorize a policy.
- Existing authenticated/atomic activation is useful and must be preserved rather
  than replaced by a second policy owner.

## Freshness

Sources were checked on 2026-08-05. The active automation-policy schema, default rules,
field semantics, UI, and compiler version must be audited together. Any schema,
compiler, mandate, prior policy, test, or diff change invalidates stale consent.

Local fixture verification records deterministic coverage and replay evidence only; it
does not change the stated limitation on natural-language intent or product activation.
