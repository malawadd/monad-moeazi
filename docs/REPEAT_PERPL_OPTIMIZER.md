# Operate the deterministic Perpl optimizer

This guide covers the fresh direct optimizer run. The earlier [three-cycle
manual scenario guide](REPEAT_PERPL_DIRECT_CYCLES.md) documents the October 7
acceptance workflow; it is historical. Do not queue those operator scenarios
for a deterministic optimizer run.

New direct optimizer runs use the Mera-reviewed **duration soak** profile. The
funding amount remains **100 AUSD**. Select a signed duration from 10 minutes
to 12 hours; the default is **120 minutes**. The run selects eligible markets
itself, opens one position at a time, and completes at most 15 fully reconciled
entry and exit cycles. Positive cycles do not stop entries; the soak continues
until the signed duration expires or the 15-cycle cap is reached. This does not
guarantee a profit or a particular number of cycles. Historical
`perpl-deterministic-v2` runs retain their original 12-hour, two-win behavior
and reporting.

## Review and start

Use the Perpl Testnet setup in the Monad app and choose the **direct onchain**
route. Confirm the selected duration in Mera review: the exact duration is
included in the signed mandate and run expiry. Check the displayed
vault, account, live markets, exposure/leverage limits and operator permission,
then use Mera to approve the exact AUSD transfer and mandate. The direct
operator pays MON gas; gas is recorded separately from AUSD cycle PnL.

The backend enforces the optimizer's per-order sizing: at most 30 AUSD
notional, 25 AUSD margin, 20% of displayed depth, and a 0.15 AUSD planned loss
budget. It uses 1× to 4× leverage only when the live market and signed mandate
allow it. You do not need to choose the market, direction, order size or
leverage manually.

## What the run does

- It normally scans every five minutes, including while a position is open,
  comparing finalized one-minute observations across the
  reviewed open markets. It requires a 40 bps directional five-minute move,
  an agreeing fifteen-minute trend, two confirming one-minute changes, fresh
  books and enough executable depth after fees, spread, impact and funding.
- After three consecutive scans without an eligible proposal, it records the
  rejection reasons for investigation. A separate scheduled scanner check
  compares those records with every live open Perpl market, checks observation
  freshness and book depth, and fixes defects supported by evidence. The
  scanner keeps its reviewed five-minute schedule; a quiet market may still
  yield no proposal. A proposal while a position is open is recorded and
  deferred. Only one position can be open, and a deferred proposal never
  submits an order.
- It checks executable close depth every minute. Normal exits can begin after
  ten minutes and happen by 30 minutes. It can exit sooner for the planned loss
  limit, an owner stop or run expiry.
- It reconciles orders against finalized receipts and account state. Submitted
  or unfilled orders are not cycles. A cycle counts only after a finalized
  close leaves the account flat.
- After a loss, the next cycle changes at most one bounded parameter. After a
  win, parameters stay fixed for the next cycle. The frozen settings and any
  change are written to the append-only journal before another entry.

## Monitor cycles and records

For the current multi-phone test, the **Moeazi standalone phone monitor**
opens a new local chat every ten minutes and checks scanner, position, order,
receipt, service and settlement state across all owners. It appends checkpoints
to [PHONE_TWO_HOUR_TEST.md](PHONE_TWO_HOUR_TEST.md). Three consecutive
no-proposal scans trigger an evidence-based scanner investigation, not an
automatic entry. The two older five-minute heartbeats covered the completed
October 10 v2 run and are paused.

In **Perpl status**, check the profile and entry stop condition, cycle count,
scanner cadence and proposal count, current parameters, active position, latest
cycle PnL, fees and operator gas. Duration soaks show positive cycles instead
of a two-win streak. Historical v2 runs continue to show the two-win target.
**Perpl
history** shows each completed cycle and the journal. **Activity** adds an event
after each finalized cycle, including per-cycle and cumulative AUSD PnL and the
profile-specific positive-cycle count or historical v2 win streak. Refresh
before taking any manual action.

For a read-only operator export, run this from `backend/` after the local stack
is available:

```powershell
node --env-file=.env.local --import tsx scripts/perpl-optimizer-report.ts [runId]
```

Omit `runId` to find the latest persisted direct optimizer run. The script
prints the run status, active positions and orders, cycle outcomes and journal,
then regenerates `docs/PERPL_OPTIMIZER_LIVE_REPORT.html`. To write the HTML to a
different file, add `--html <path>`. The export reads saved Convex records and
does not submit orders. Completed historical v2 runs retain their existing
acceptance-report publishing behavior; a duration soak never writes into the
historical v2 outcome section of [`PERPL_TESTNET_REPORT.html`](PERPL_TESTNET_REPORT.html).

The live report also lists recent persisted scan decisions and each market's
rejection reason. A zero-cycle run has made no cycle-based parameter adjustment.
The active mandate contains all eight markets currently open in Perpl Testnet.
Future enrollment fails visibly if Perpl offers more than the deployed vault's
16-market mandate capacity; it never silently scans only the first markets.
Check these decisions before diagnosing inactivity: a threshold or trend rejection
means the reviewed rule withheld an entry; repeated `insufficient_observations`
across every market while finalized observations are present is a worker/data
fault. The trend uses finalized bid/ask midpoints, and the worker timestamps a
decision after its market and book reads finish.

The cycle ledger and journal are persisted in Convex, so restarting the API or
worker resumes the same run and does not reset its counters or learned
parameters. If the account has a pending or uncertain order, wait for
reconciliation; do not start a second run or scenario to get around it.

## Stop, settle and report

For a duration soak, the worker keeps scanning and may open later positions
after positive cycles, subject to the reviewed strategy filters and caps. At
the 15-cycle cap it stops new entries and waits flat for signed expiry; at
signed expiry it closes any open position and settles. Historical v2 runs stop
new entries at their two-win target or the cycle cap. Early settlement
requires a fresh owner-signed Mera stop. Keep the funded gates available until the app confirms
the final AUSD transfer, a flat Perpl account and revoked operator permission.
Record incomplete settlement as incomplete; do not mark the run complete from
an order submission alone.

The standalone live report is generated from the saved cycle records while the
run is in progress. Its result section remains distinct from signal estimates:
only finalized balance changes are realized PnL. For a soak, state whether it
settled at signed expiry or the 15-cycle cap; for historical v2, report the
two-win target or cap/expiry. Show Perpl fees, funding and operator MON gas
separately.
