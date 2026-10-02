# Future Design

## Contracts and state

`StrategyTerminationRequest`, `TerminationLatch`, `TerminationInventorySnapshot`,
`TerminationPlan`, `TerminationStep`, `TerminationStepReceipt`, `ResidualObligation`,
`TerminationStatusDecision` and `TerminationCompletionReceipt` are strict. Stable step
ID is `strategy:termination_revision:step_kind:subject_hash`.

State moves from requested → latched → inventory-ready → awaiting-owner/decommissioning
→ stopped-with-residuals/blocked/fully-terminated. The latch commits before cleanup and
never relaxes after failure.

Inventory covers schedules/jobs, proposals/approvals, artifacts/reservations,
signed/submitted/uncertain transactions, orders/TWAP/triggers, positions/collateral/LP,
fees/funding, deposits/withdrawals/bridges, provider credentials, delegates/EIP-7702/
allowances/Permit2, assets/gas/refunds and evidence holds.

## Ownership and rules

Convex owns request/latch/current projection; Temporal durable inventory/steps/retry;
Timescale immutable plans/receipts/residuals; Redis no durable state. Schedule Sync,
Capability, Execution/Temporal Integrity, venue adapters, Journal/Reconciliation and
Evidence Lifecycle remain domain owners.

No cleanup compensation reopens exposure, schedule, grant or credential. Unknown
submission reconciles before release. Cancel uses certified cancel-only authority;
closing is a trade and owner checkpoint. Never auto-fund/withdraw/bridge/pay/revoke.
Particle/Magic remain owners; no fallback key; models do not plan/execute steps.
Hyperliquid API-wallet addresses are never reused after deregistration/expiry.

## Cost and rollback

Local/Shadow fixtures are free. Real steps can incur unknown gas, fee and slippage and
need per-step approval. Rollback cannot remove the latch or erase receipts; it leaves
explicit residual state and recovery instructions.
