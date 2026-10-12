# Perpl worker health and recovery

## 12 October 2026 incident

The direct Perpl run `1e1e9fca-a07f-4755-80f0-72766b2fbd2a` held a LIT short
after its scheduled exit checks stopped. The last successful check occurred near
01:43 UTC. A worker retry scheduled `monadVenueActions.dispatchTick` with a
`holderId` field that the action's validator does not accept. The failed
scheduled function was visible in local Convex, but the chained worker made no
further progress. The user-facing estimate had not yet reached the planned
loss exit at the last successful check; later market movement did, while no
worker was checking it.

The original tick was retried after verifying the lease had expired and there
was no pending exit order. The exit transaction
`0x8c943afdec17f1e6de939f3447880934f731bb1059f184540f5254487506640a`
finalized at block `70296647`. The account was subsequently reconciled flat.
Cycle 1 returned **99.240265 AUSD** from 100 AUSD, a **−0.759735 AUSD** net
realized result, including Perpl fees and funding. Operator gas was
`0.087020892 MON` and is reported separately. New entries for this run were
paused with reason `stalled_tick_recovery`; its existing mandate and settlement
path remain intact.

Later on 12 October, the operator resumed entries after a fresh finalized
account read at block `70302217` showed 99.240265 AUSD, no position, and no
open orders. Both persisted orders were finalized, the worker had a successful
post-pause tick, all five required gates were on, and the health page had no
critical alerts. The resume cleared only the entry pause; it did not place a
trade. Tick 59 completed afterward with the normal
`optimizer_market_scan_not_due` phase and no health alerts.

## Controls

- Worker dispatch now sends only the action's declared `runId` and `tickId`.
  The private lease holder never enters a scheduled action argument.
- Every completed tick records its success time and next due time. Failed API
  callbacks record a short error and consecutive failure count.
- A separate one-minute Convex cron checks active Perpl venue runs. Once a tick
  is more than 90 seconds overdue, the cron schedules its **same tick ID**
  after the lease expires. The existing lease and persisted order/nonce
  reconciliation remain the guards against duplicate broadcast.
- When an optimizer has had no successful tick for over three minutes, the cron
  pauses new entries. Exit and settlement work can continue. It does not
  loosen the strategy or place a replacement trade.
- The local operator console's **Health & monitoring** page shows active runs,
  worker and position-check age, unresolved orders, market observations,
  settlement status, readiness, gates, and visible alerts. Its Perpl panel is
  read-only and refreshes while the console is open.
- `monadVenueWorker.resumeEntries` is an operator-only, compare-and-swap
  recovery action. It requires the original pause timestamp, an active and
  unexpired optimizer with enough time for a normal hold, a fresh successful
  post-pause tick, no worker error or active lease, a valid queued next tick,
  flat persisted account state, and terminal persisted orders. The operator
  must separately verify a fresh finalized onchain account and service/gate
  health before invoking it. Resuming does not submit an order.

## Operator response to an alert

1. Check the run ID, last successful tick, next due time, lease, and the most
   recent worker error on the Health page. Inspect the persisted order and
   receipt before considering any intervention.
2. If there is an uncertain transaction, reconcile its existing hash and nonce
   against finalized chain state. Never submit a fresh exit merely because the
   API response was uncertain.
3. For an overdue position check, confirm whether the watchdog retried the
   same tick and whether the account position subsequently changed. Keep new
   entries paused until the cause is understood.
4. An incomplete settlement retains owner recovery. Verify the final wallet
   AUSD transfer and operator revocation before closing funded gates.

The watchdog depends on local Convex and the Hono callback being available.
If either service is down, the console will show a readiness alert when it is
open, but automatic exit cannot proceed until the service recovers. A closed
browser does not deliver a push alert from this operator page.
