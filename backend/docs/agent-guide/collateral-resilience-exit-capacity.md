# Collateral resilience and exit-capacity envelope

Feature 13 is an isolated, local Test Center proof using checked-in synthetic data.
It computes integer-only stressed collateral and independent exit-capacity legs, then
returns `pass`, `close_only`, `block`, or `unknown`. It cannot sign, move assets,
contact a venue, or alter product authority.

Feature 12 is frozen only as a `requires_revalidation` attribution binding. It is not
price, margin, liquidity, finality, or safe-lane authority. Durable local fixture
graphs and receipts are append-only in Timescale/Postgres; Redis carries only existing
expiring Test Center controls.

Rollback sets the local control off and preserves history for read-only inspection.
Do not down-migrate or substitute nominal collateral/midpoint depth. Native validation
requires separately approved authoritative owners, certification, review, and cost
approval before any external, cloud, provider, or on-chain action.
