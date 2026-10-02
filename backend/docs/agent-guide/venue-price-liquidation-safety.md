# Venue Price-Safety and Liquidation Receipt

Feature 12 is an isolated, checked-in synthetic Test Center proof. It evaluates
integer-only fixture observations for separate mark, index, oracle, funding,
liquidity, constraint and liquidation roles, then persists immutable local receipts
in Timescale. It is not a price feed, oracle, risk engine, venue adapter,
liquidation guarantee, signer, quote service or execution route.

The only prerequisite is a frozen Feature 07 fixture binding. Its status remains
`requires_revalidation`; Features 09–11 are attribution-only context and cannot
authorize an outcome. A local pass means one frozen scenario met one local registry
matrix. Product availability is always `unavailable`.

Input semantics use UTC half-open validity, canonical base-10 integer strings,
explicit units/scales and registry-owned limits. Missing or unverifiable evidence is
`unknown`; known unsafe evidence is `block`. `close_only` requires independently
proved cancel/reduce/close/reconcile lanes and never substitutes a proxy price.

Rollback turns the feature lease off and freezes the registry while preserving
immutable history. It never deletes history, falls back to scalar/proxy prices, or
opens product execution. Future native validation requires authoritative source and
formula ownership, independent review, recorded parity/replay, Shadow dual
calculation, operational recovery review, cost disclosure and explicit approval.
