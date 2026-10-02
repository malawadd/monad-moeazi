# Evidence — Risk-Tiered Approval Quality and Consent Receipts

## Claim-to-source map

| Claim | Source | Status and limit |
| --- | --- | --- |
| Current approval binds only ownership/status/expiry before changing rows | [U13](../../SOURCES.md#unimoazi-sources) | Direct repository evidence; the later workflow does requote/preflight |
| Typed structured messages can bind an exact packet and domain | [S51](../../SOURCES.md#external-sources) | EIP-712 standard; explicitly no replay protection and no comprehension proof |
| Step-up authentication can provide stronger claimant assurance | [S52](../../SOURCES.md#external-sources) | Current NIST SP 800-63B-4; authentication analogy only |
| Repeated security decisions can create fatigue/avoidance | [S53](../../SOURCES.md#external-sources) | Forty-person qualitative security study, not trading consent |
| Ordinary notifications can habituate attention to critical warnings | [S54](../../SOURCES.md#external-sources) | Usable-security experiment; transfer requires product testing |

## Evidence boundaries

- A valid EIP-712 signature proves acceptance of bytes by a signer under a domain. It
  does not prove understanding, policy compliance, quote freshness, or authorization
  to dispatch. Replay defense is application-owned.
- NIST authentication guidance does not certify a trade-consent flow.
- Fatigue and warning studies justify testing selective presentation. They do not
  support the proposed percentage reductions.
- No general study proves human approval improves trading returns or prevents loss.

## Material-delta correction

Exact post-approval quote-hash equality would create a confirmation loop because the
workflow must requote. The packet therefore binds the reviewed snapshot plus a signed,
visible envelope: same account/proposal/market/side; maximum debit/size/leverage,
exposure, slippage, all-in cost/gas/funding; minimum output or worst entry; normally an
exact route/venue; policy/risk revisions; and expiry. Favorable/non-material movement
inside the envelope is recorded. Everything else invalidates.

Protocol-specific permit or transaction data may still be quote-bound. The signing
matrix must not imply that one consent signature makes stale protocol data reusable.

## Freshness

Sources were checked on 2026-08-05. NIST SP 800-63B-4 (July 2025) supersedes the
withdrawn SP 800-63B. Wallet, EIP-712, venue, delegation, and quote-bound signing
capabilities must be revalidated before implementation.
