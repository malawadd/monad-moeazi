# Operate the deterministic Perpl optimizer

This guide covers the fresh direct optimizer run. The earlier [three-cycle
manual scenario guide](REPEAT_PERPL_DIRECT_CYCLES.md) documents the October 7
acceptance workflow; it is historical. Do not queue those operator scenarios
for a deterministic optimizer run.

The optimizer uses a fresh Mera-reviewed mandate for **100 AUSD and 12 hours**.
It selects eligible markets itself, opens one position at a time, and completes
at most 15 fully reconciled entry and exit cycles. It stops opening positions
after two consecutive cycles each realize at least 0.01 AUSD net. This target
does not guarantee a profit or a particular number of cycles.

## Review and start

Use the Perpl Testnet setup in the Monad app and choose the **direct onchain**
route. The review fixes the funding amount and duration. Check the displayed
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

For an active optimizer run, use two five-minute Codex heartbeats: **Perpl
market scanner monitor** checks full-market coverage, missed signals and scan
data; **Perpl position and settlement monitor** checks orders, exits, cycle
records and final return. The scanner monitor investigates three consecutive
no-proposal scans and changes code only when evidence supports a correction.
Both remain quiet while healthy and stop after settlement and cleanup. The
October 10 run reached its target, settled, and both monitors were paused.

In **Perpl status**, check the optimizer's cycle count, success target, scanner
cadence and proposal count, current parameters, active position, latest cycle
PnL, fees and operator gas. **Perpl
history** shows each completed cycle and the journal. **Activity** adds an event
after each finalized cycle, including per-cycle and cumulative AUSD PnL and the
win streak. Refresh before taking any manual action.

For a read-only operator export, run this from `backend/` after the local stack
is available:

```powershell
node --env-file=.env.local --import tsx scripts/perpl-optimizer-report.ts [runId]
```

Omit `runId` to find the latest persisted direct optimizer run. The script
prints the run status, active positions and orders, cycle outcomes and journal,
then regenerates `docs/PERPL_OPTIMIZER_LIVE_REPORT.html`. To write the HTML to a
different file, add `--html <path>`. The export reads saved Convex records and
does not submit orders. It never overwrites the separate
[`PERPL_TESTNET_REPORT.html`](PERPL_TESTNET_REPORT.html), which retains prior
acceptance evidence.

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

At the two-win target or the 15-cycle cap, the worker stops new entries and
keeps the account flat. Early settlement requires a fresh owner-signed Mera
stop; otherwise the account remains flat until the approved run expires and
settles automatically. Keep the funded gates available until the app confirms
the final AUSD transfer, a flat Perpl account and revoked operator permission.
Record incomplete settlement as incomplete; do not mark the run complete from
an order submission alone.

The standalone live report is generated from the saved cycle records while the
run is in progress. Its result section remains distinct from signal estimates:
only finalized balance changes are realized PnL. State whether two qualifying
cycles were reached or the run ended at its cap/expiry, and show Perpl fees,
funding and operator MON gas separately.
