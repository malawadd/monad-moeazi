# Perpl run health panel

The local operator console's **Health & monitoring → Autonomous run health** panel is a read-only view of Perpl Testnet autonomous runs. It calls `GET /api/operator/perpl-health` through the authenticated operator bridge. The API reads a Convex snapshot, Monad Testnet RPC chain/finality, and Perpl's public Testnet context. It does not submit transactions, repair schedules, change gates, or alter a run.

The panel polls every 30 seconds while the console is visible and supports manual refresh. It shows up to 32 active or recently updated runs; a coverage note appears if the bounded snapshot contains more. Owner addresses are masked. Order IDs, status, hashes, and sanitized failure details are shown to support reconciliation.

## Alerts

| Alert | Meaning |
| --- | --- |
| Worker tick failed | Latest worker failure has not been followed by a successful tick. |
| Worker tick overdue | Persisted next-tick deadline has passed, with a short grace period. Older records use a tick interval fallback. |
| Scheduled worker tick is missing | A non-terminal run has no next tick ID. The panel deliberately does not create a replacement. |
| Worker lease expired | The persisted worker lease expired. Reconcile its original tick before any retry. |
| Position check overdue | An open position or optimizer cycle has no exit evaluation in the last 150 seconds. |
| Uncertain order / pending order | An unresolved order needs reconciliation. Pending or acknowledged status is never reported as a fill. |
| Open venue orders | The latest account snapshot still reports open Perpl orders. |
| Market observations stale or missing | A mandated market has no finalized observation, or its newest one is older than seven minutes. The seven-minute threshold allows a normal five-minute all-market scan. |
| Settlement overdue / incomplete | Expiry or a prolonged stopping phase needs attention, or the run explicitly records incomplete settlement. |
| Repeated worker failures | At least three consecutive attempts failed. |
| New entries paused | A safety pause is active. Exit and settlement processing may still be enabled. |
| Service unavailable / gate closed | Monad RPC, Convex, Perpl context, or a configured execution dependency is unavailable while exposure may need resolution. |

When an optimizer cycle is persisted, the run card shows its market, direction, start and entry-fill timestamps, last exit check, and persisted exit decision or best estimate when available. The estimate is labeled as strategy data; it is not a fresh quote, finalized PnL, or proof that an exit order was sent. Finalized receipts and account state remain authoritative.

Configured action, broadcast, operator, autonomy, and direct-execution gate states are displayed without controls. They are the local API configuration at read time, not a promise that every route is effective or that a position can be exited. Use the existing recovery workflow to act on an alert; the health panel itself has no trade or recovery controls.
