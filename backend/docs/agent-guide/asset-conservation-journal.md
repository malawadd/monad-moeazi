# Asset Conservation Journal

Feature 10 is an isolated local Test Center proof. It records only checked-in synthetic fixtures and is not a product ledger, balance statement, custody system, signer, venue adapter, or external-truth source.

The journal conserves each namespaced `AssetUnit` independently: debit and credit totals are canonical base-10 integer strings and must close exactly for every unit. Symbols, prices, USD totals, rounding and cross-unit offsets are excluded. Asset unit identity binds domain, locator, decimals, definition revision and evidence hashes.

Timescale/Postgres owns immutable local fixture attempts, manifests, checks and receipts. Redis has no journal namespace or journal truth. Convex, Temporal, gateways, sidecars, providers, wallets and normal product routes are deliberately not wired.

The evaluator returns `mismatch`, `unknown`, `partial`, or `balanced`, in that precedence. Non-balanced results display only the local safe lanes `catch_up`, `correct`, `reconcile`, and `settle_existing`; they are never authority grants. A frozen Feature 09 control closure is untrusted context and always records `requires_revalidation`.

Migration `022_asset_conservation_journal.sql` is append-only and rerunnable. It uses scope-qualified identities, immutable triggers, idempotency uniqueness and a transaction-scoped advisory lock. Exact retries may replay their existing receipt; changed requests are conflicts and never add postings.

Do not claim this feature is live, product-available, authoritative, reconciled, or capable of execution. Product activation needs Feature 09 revalidation, authoritative source/finality/current-state owners, native reconciliation, certified owner signing and venues, recovery/security/operations approval, funded validation, and separately approved deployment/onchain work.
