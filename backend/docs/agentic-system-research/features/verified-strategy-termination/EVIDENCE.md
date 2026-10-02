# Evidence

| Claim | Evidence | Status |
| --- | --- | --- |
| Current pause/revoke state cannot prove cross-domain termination | Cycle-14 repository audit, U19 | Repository evidence |
| Token revocation has defined behavior and propagation limits | S145 | Internet standard/analogy |
| Account disabling and audit are recognized lifecycle controls | NIST SP 800-53 AC-2 | Government guidance |
| Temporal supports durable long-running orchestration patterns | S146 | Production documentation |
| Hyperliquid signer nonce/address lifecycle and cancel operations are protocol-specific | S116, S46 | Production documentation |

References are registered in [SOURCES.md](../../SOURCES.md). These sources support
durable lifecycle/revocation/cancel patterns, not one
generic cancel-all command or proof an external venue is available.

## Limitations

- External state can remain unavailable or ambiguous indefinitely.
- Closing positions, withdrawing and onchain revocation can cost gas/fees/slippage and
  require explicit owner action.
- OAuth success is not native venue/onchain post-state proof.
- Termination cannot erase evidence holds or guarantee asset recovery.
- Venue-specific ordering cannot be abstracted away safely.

No account-closure, full asset recovery, legal record deletion or loss-prevention
claim is made.
