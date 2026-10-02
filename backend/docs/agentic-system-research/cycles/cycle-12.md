# Cycle 12 — Time, Instrument Identity, and Economic Cost

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Temporal Integrity and Causal Sequencing Envelope | Approve | 94 | Explicit domains/uncertainty and signer-scoped nonce leases close a distinct wall-clock/causality gap |
| Canonical Instrument Lifecycle Registry/Event Gate | Approve | 95 | Stable native identity, immutable terms and lifecycle operation state are prerequisite to safe multi-venue routing |
| Execution Economic Cost Reservation/Attribution Control | Hold/fold | 74 | Useful direct-charge lines belong in risk reservation, execution receipt, journal and TCA rather than a new ledger/authority |

## Key decisions

Temporal integrity never compares unrelated clocks as exact or infers causality from
UTC order. Protocol-specific nonces remain separate from idempotency and are never
reused after signing/possible submission. Instrument symbols/indices are aliases bound
to exact environment, native namespace and metadata version; lifecycle drift blocks
new exposure but preserves certified safe operations.

The folded economic-cost work reserves direct charges pessimistically, settles exact
fees/gas/funding/rebates once from authoritative evidence and journals exact units.
Slippage/impact/opportunity cost remains TCA analytics. A separate cost ledger,
estimator or settlement authority is rejected.

## Evidence limitations

Spanner/TigerBeetle/FIX demonstrate mechanisms, not infrastructure to adopt. Venue
documentation does not prove clock accuracy, complete lifecycle events or cost
attribution. All percentages remain mutation-corpus hypotheses; no global clock,
universal symbology, lower-cost or PnL claim is made.

## Stop-condition state

This cycle approved **two** dossiers. The consecutive zero-approval count remains
**0**. Research continues until six consecutive cycles approve no new dossiers.
