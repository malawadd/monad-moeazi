# Multi-phone Perpl Testnet checkpoint checklist

Use this with the [running phone test log](PHONE_TWO_HOUR_TEST.md) and the
[optimizer runbook](REPEAT_PERPL_OPTIMIZER.md). The optimizer scans every five
minutes; this monitor records observations every ten minutes.

## Observe each ten-minute checkpoint

1. Compare the snapshot inventory with the previous checkpoint. Add every new
   `runId`, owner and phone label, including a run whose report is not ready yet.
2. For each run, record `status`, `phase`, `startedAt`, `expiresAt`, optimizer
   cycle count and win streak. Mark missing or stale reports explicitly.
3. Record scanner timestamp/cadence, scan count, proposals, recent decisions and
   rejection reasons. A proposal deferred for an open position is not an order.
4. Record each entry/exit order ID, request ID, status, transaction hash, receipt
   block and confirmation/finality evidence. An acknowledgement or submitted
   transaction is not a fill; only the finalized receipt and reconciled account
   state establish execution.
5. Record the position (market, side, size, entry and unrealized PnL), or state
   that the account is flat. For each finalized cycle, record realized AUSD PnL,
   fees, funding, operator MON gas, and both order receipts.
6. Record settlement phase, returned AUSD, settlement transaction and finalized
   receipt. Keep a run open in the log if settlement or final flatness is
   incomplete.
7. Check local `http://127.0.0.1:3102/health` and the public tunnel
   `https://moeazi-monad.kiyan.finance/health`. Record all seven Testnet gates
   as booleans from the ignored local environment and the three onchain factory
   enrollment states; never change them during a monitoring pass or copy
   secrets into the log. Mainnet and live agent execution remain off.
8. Record errors with the observed evidence, affected run IDs, impact, confirmed
   fix and follow-up result. The snapshot script is read-only; the scheduled
   monitor may repair proven code or service faults, run focused checks, and
   deploy or restart the affected local service. Never duplicate or force trades,
   and respect later gate changes initiated by the user. Reconcile uncertain
   execution from its persisted hash and nonce before taking another action.

## Start on each phone

Install the internal ARM APK from [ANDROID_BUILDS.md](ANDROID_BUILDS.md). Create
or sign in with the phone's Mera passkey and note the displayed Monad Testnet
deposit address and a non-sensitive phone label. Fund each distinct address with
at least **100 testnet AUSD** for Perpl enrollment; the owner also needs enough
testnet MON to submit the reviewed setup transaction. The operator pays gas for
routine direct orders. In Perp setup choose the direct Perpl venue, enter
**120 minutes**, review the 100 AUSD transfer and duration-soak mandate, and
complete the Mera approval. Check Perp status and Activity for the new run ID.
The observation window starts with the first phone's confirmed enrollment and
ends only after every phone's settlement and returned balance are reconciled.

## Checkpoint template

```text
Observed UTC:
Snapshot generatedAt / pagesRead / runCount:
Service health: local API / public tunnel:
Gate booleans: actions / broadcast / operator trades / Spot autonomy / mock Perp autonomy / Perpl autonomy / Perpl direct execution:
Onchain factory states: Spot autonomy / mock Perp / Perpl:
Mainnet actions / live agent execution:
New, missing, or stale runs:
- Phone label | owner suffix | runId | status/phase | startedAt/expiresAt | optimizer cycles/win streak:
Orders and receipts (submitted, filled, finalized or uncertain):
Scanner coverage and last decisions:
Positions (or flat):
Cycle PnL / fees / funding / operator gas:
Settlement / returned balance / finality:
Errors and evidence:
Confirmed fix and follow-up result:
Next observation due (UTC):
```
