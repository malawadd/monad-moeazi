# Risk-tiered approval quality and consent receipts

Feature 20 is an isolated, checked-in fixture/replay proof in Test Center. It assesses
synthetic source closure, creates a deterministic tiered packet and one-use synthetic
consent receipt, then compares a fresh fixture manifest. Its Timescale graph is
append-only. Results are non-authorizing: product approval, EIP-712 signing, dispatch,
providers, wallets, gateways, sidecars, venues, and network access remain unavailable.

`ordinary`, `elevated`, and `high` only change the local fixture ceremony. Any missing,
stale, disputed, forked, wrong-scope, or materially changed input blocks or invalidates
the fixture result. A nonce is consumed once; exact retries return the stored result and
different requests conflict. Nothing reissues, retries, or dispatches automatically.

Product activation needs independent authoritative inputs, a Convex transaction design,
Temporal expiry workflow, certified Particle/Magic EIP-712 behavior, execution parity,
security and accessibility review, and explicit authorization for external validation.
