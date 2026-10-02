# Intent–Execution Equivalence Receipt

Feature 11 is an isolated Test Center fixture proof. It decodes only checked-in inert
Universal Router exact-input fixture bytes and compares frozen `prepared`,
`signing_request`, and `dispatch` observations exactly. It does not prepare a
transaction, request a signature, broadcast, call an RPC/provider, or make product
execution available.

Timescale owns immutable, scope-qualified local fixture bundles and receipts. Redis
holds only the existing expiring Test Center control lease. Feature 10 is a direct
prerequisite but remains `requires_revalidation` untrusted context; Feature 11 cannot
convert it into settlement, risk, signing, or execution authority.

Only Arbitrum fixture chain `42161` is accepted. Any unsupported decoder family,
ambiguous or incomplete bytes, stale/unpinned context, drift, unexplained delta, or
storage uncertainty is `unknown`; known disagreement is `fail`. There is no implicit
tolerance. A local `pass` means a single frozen synthetic package matched exactly and
still reports product signing and dispatch as unavailable.

Rollback disables the Feature 11 local control and blocks new evaluations. Immutable
attempts and receipts remain read-only; there is no down-migration or target-only
fallback. Live validation remains documentation-only pending separate cost disclosure
and authoritative, certification, recovery, security, operations, and funded/onchain gates.
