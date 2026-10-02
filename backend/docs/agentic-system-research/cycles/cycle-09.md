# Cycle 09 — Submission, Venue Prices, and Capability State

## Research question

Which execution-boundary gaps remain after routing, risk snapshots, consent and
dependency safety: submission-channel semantics, venue-native liquidation inputs, or
the complete lifecycle of delegated authority?

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Submission Channel Policy and Inclusion Receipt | Hold/fold | 74 | Useful dispatch evidence belongs in routing, consent and the shared reconciliation receipt; a standalone lifecycle would duplicate authority |
| Venue Price-Safety and Liquidation Receipt | Approve | 95 | Certified venue-native semantics and account-bound calculations close an unsafe proxy/scalar margin gap |
| Capability and Delegation Lifecycle Ledger | Approve | 97 | Effective grants and verified revocation require an independent cross-provider/onchain/venue authority ledger |

## Approved mechanisms

### Venue price and liquidation safety

Exposure increases must bind a certified `VenuePriceSemantics`, complete fresh
`VenuePriceObservationSet`, deterministic `PriceSafetyDecision` and account-specific
`LiquidationSafetyReceipt`. Native margin inputs cannot be filled with a cross-venue
mark, routing midpoint or public proxy. Missing or drifted state blocks increases but
does not disable a separately certified risk-reducing close.

### Capability and delegation lifecycle

The ledger distinguishes requested, awaiting-user, unknown, active-verified,
expiring, pending-revocation, revocation-unknown and verified-revoked. Root EIP-7702
delegation is never sufficient by itself: effective authority is the intersection of
certified root code and exact, bounded, expiring, revocable subordinate grants. Local
rows cannot claim revocation without authoritative post-state.

## Folded submission-channel lessons

- Add certified channel capabilities and a deterministic decision to the existing
  route/preflight flow.
- Store each send as a `SubmissionAttempt` and each acknowledgement/inclusion/finality
  observation in the shared `ExecutionReceipt`.
- Never fan out concurrently or retry blindly after uncertain acceptance.
- A privacy downgrade is a material consent change.
- Transport acknowledgement, acceptance, inclusion, confirmation and execution are
  different states.

## Evidence and limitations

Official Arbitrum/Flashbots material establishes ordering and channel vocabulary but
does not prove privacy, inclusion or price improvement for Unimoazi. Hyperliquid and
GMX documentation establishes distinct price/liquidation semantics but not oracle
truth. EIP-7702, Particle, Magic and Permit2 document mechanisms, not end-to-end
least-privilege certification. All quantitative ranges remain labeled engineering
hypotheses.

## Changes from earlier cycles

Cycle 01 owns the risk/reservation/reconciliation lifecycle; Cycle 02 owns routing;
Cycle 05 owns approval consent; Cycle 06 owns dependency safety. This cycle extends
those owners instead of introducing a second submission machine, while adding two
independent prerequisites: native venue risk semantics and effective capability
state.

## Stop-condition state

This cycle approved **two** new dossiers. The consecutive zero-approval count resets
to **0**. Research continues until six consecutive cycles approve no new dossiers.
