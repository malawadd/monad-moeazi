# Effective Authority Decision

Feature 19 is an isolated local Test Center fixture. It consumes only checked-in,
untrusted normalized gate rows and creates an immutable, sanitized explanation with a
hard `PREFLIGHT_ONLY` ceiling. Every output is non-authorizing, product unavailable,
and has authority effect `none`; it is not imported by Convex, workflows, gateway,
sidecar, signing, wallet, provider, venue, or network code.

Missing, stale, conflicting, wrong-scope, wrong-version, or untrusted rows reduce
authority. Timescale migration 031 is append-only and its current-fixture view is
read-only. Rollback removes the isolated UI/route exposure only; it never deletes the
ledger or changes product authority.
