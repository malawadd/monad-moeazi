# Multi-phone Perpl Testnet monitoring log

This is the running operations log for a two-hour, multi-phone Perpl Testnet
observation window. A separate ten-minute monitor should append one checkpoint
per invocation while the window is active. Keep older entries intact. Use UTC
timestamps and one entry per Mera owner/run pair.

The active Codex schedule is **Moeazi standalone phone monitor**. Each
execution opens a new local chat in this project every ten minutes. It stays
active while phones are being enrolled and while runs are settling; unchanged
healthy checks stay quiet.

The inventory is local-operator-only and includes direct Perpl runs created in
the last 24 hours plus older active runs across Mera owners, with bounded pages
of up to 100 recent rows. Run the read-only snapshot from `backend/` while the
Monad local stack is available:

```powershell
node --env-file=.env.local --import tsx scripts/perpl-optimizer-snapshot.mjs --summary
```

The compact mode prints per-run lifecycle and optimizer status, the latest
measured cycle and finalized receipts, the last three scans with market
rejection reasons, pending orders, positions, and settlement/returned funds.
Use the default full JSON output for investigations. The script does not place
or cancel orders, change gates, sign transactions, or settle a run. A direct
run with no optimizer state yet still appears in the inventory; its report
fields are `null` until optimizer state is persisted. A snapshot covers up to
10,000 recent rows plus active runs and fails visibly if that cap is reached. The existing
`scripts/perpl-optimizer-report.ts` remains a single-run HTML export and can
update acceptance documentation after settlement; do not use it for routine
checkpoints.

The detailed monitoring steps, phone setup and checkpoint template are in the
[phone test checklist](PHONE_TWO_HOUR_TEST_CHECKLIST.md). The operational
strategy runbook is [REPEAT_PERPL_OPTIMIZER.md](REPEAT_PERPL_OPTIMIZER.md).

## Test window

- Window start (UTC): `2026-10-10 16:06:08`
- Window end (UTC): first phone run settled in finalized block at `2026-10-10 18:07:47` after signed expiry `18:06:01`; further phone enrollment is pending
- Local API health: HTTP 200 at the 18:12 UTC settlement check
- Tunnel health: public HTTPS health and Android asset links HTTP 200 on repeat at the 18:12 UTC settlement check
- Gate and factory state (reported by supervising operator on 2026-10-10):
  - Testnet actions / broadcast / operator trades: `enabled`
  - Mock Spot autonomy / mock Perp autonomy: `enabled`
  - Perpl autonomy / Perpl direct execution: `enabled`
  - Onchain Spot autonomy / mock Perp / Perpl factory enrollment: `open`
  - Mainnet actions / live agent execution: `off`
- Phone labels and owner wallet suffixes: first phone label pending; owner `…96e848`
- Phone runs: `7971a58c-54c0-4409-89a9-08fcbae4ee75` completed and settled

## Append-only checkpoint log

Append a new checkpoint below this line. Keep one compact run row per run and
include evidence links or transaction hashes where applicable.

## Preflight observations

[Earlier setup and repair observations](PHONE_TWO_HOUR_TEST_PREFLIGHT_2026-10-10.md) are preserved in the linked archive. Active-run checkpoints follow.

### Active run checkpoint — 2026-10-10 16:13 UTC

- Snapshot: generated `16:13:27 UTC`, one page, three direct Perpl runs across
  Mera owners: one new active duration soak and two completed historical v2 runs.
  First phone label pending | owner `…96e848` | run
  `7971a58c-54c0-4409-89a9-08fcbae4ee75` | active,
  `optimizer_market_scan_not_due` | started `16:06:08`, signed expiry
  `18:06:01 UTC` | 0/15 finalized cycles, 0 positive cycles, win streak 0.
- Funding: persisted raw signed transaction hash
  `0xb9d7ccbf7dfdab3d1ac4ca51de6cd07814fc57969264f77c84853a2afb920146`
  matches its computed hash; transaction nonce 0, chain 10143. Receipt succeeded
  in block 69868445, its block is canonical and below finalized block 69870147;
  run funding status is `finalized` for 100 AUSD.
- Scanner: 2 scans, 0 proposals, 2 consecutive no-proposal results. Scans at
  `16:06:16` and `16:12:01 UTC` covered all eight signed markets (BTC, ETH,
  SOL, MON, ZEC, LIT, PUMP, NEAR); configured cadence 5 minutes. The first
  rejected all eight for insufficient observations. The second lacked 15-minute
  history for ETH/MON/NEAR and one-minute confirmation for the other five.
  No three-miss investigation is due yet.
- No entry or exit order, pending or uncertain hash, position, or finalized
  cycle. Account flat; realized PnL, fees, funding and per-cycle operator gas
  all zero. One-minute exit checks have no position to close. Settlement and
  returned AUSD remain pending; the delegated account confirms operator
  permission is active at finalized block 69870294, as expected during the run.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset
  links returned HTTP 200. Cloudflared and scoped Compose services are running;
  no new worker or Hono error appeared. All seven local Testnet gates are true;
  finalized Spot, mock Perp and Perpl factory enrollment states are open.
  Manual Guard and Lite Mode are true; mainnet setup and live execution are off.
  Operator balance: 5.192649 MON at finalized block 69869900.
- Next observation due: approximately `16:22 UTC`.

### Active run checkpoint — 2026-10-10 16:25 UTC

- Snapshot: one active run (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner
  `…96e848`, phone label pending) and two unchanged completed historical runs.
  Duration soak remains active through signed expiry `18:06:01 UTC`; 0/15
  completed cycles, 0 positive cycles, 0 AUSD realized PnL or funding.
- Scanner: scans at `16:06:16`, `16:12:01`, `16:17:46`, `16:23:34 UTC`
  covered all eight signed live markets, including the latest 5-minute scan.
  The first three had no proposal; at the third scan the run was only 11.6
  minutes old, so seven markets lacked a 15-minute history and MON's last
  one-minute changes reversed. All eight had fresh finalized observations;
  public books returned HTTP 200 with bids and asks for every market. No
  scanner defect is supported. The fourth scan proposed a LIT short after
  15-minute history became available (5-minute move -61 bps, 15-minute -49
  bps, estimated net move 52 bps), resetting consecutive misses to zero.
- Entry order `7971a58c-54c0-4409-89a9-08fcbae4ee75:1`, request 1:
  persisted signed hash `0x398335299fbbd7d6a6aa3e3dc9c7907c5b16345d66cb2494b535f71b4d1ee426`
  matches raw transaction, operator nonce 161. Canonical successful receipt
  in block 69871980 is below finalized block 69872143; one taker fill opened
  LIT short size 42 at 370165, 4× leverage, 15.625 AUSD planned notional.
  Entry fee 0.005364 AUSD; receipt gas 0.047161332 MON.
- At `16:25:53 UTC`, the onchain account still held that short; unrealized PnL
  was +0.040320 AUSD, which is not realized cycle PnL. The next worker decision
  checked executable exit depth about 70 seconds after entry and held under
  the signed rules. No pending or uncertain order, exit receipt, settlement,
  returned AUSD or operator revocation yet. Operator balance: 5.145488 MON.
- Hono, console, local Convex, public HTTPS health and Android asset links:
  HTTP 200. Cloudflared and scoped Compose services running. Seven Testnet
  gates and three finalized factory enrollment switches open; Manual Guard
  and Lite Mode on; mainnet setup and live execution off.
- Separate Python Compose worker fault: both replicas logged PostgreSQL
  `too many clients already` around `16:19 UTC`. Perpl Hono/Convex continued
  scanning and finalized the LIT entry. Database pool diagnosis and a focused
  repair are in progress; no service restart or trade action was taken.
- Next observation due: approximately `16:32 UTC`.

### Active run checkpoint — 2026-10-10 16:36 UTC

- Inventory: one active Mera-owner duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`, phone label pending) and two unchanged completed historical runs. The signed expiry is `18:06:01 UTC`; the first cycle is now finalized, 1/15 cycles and one positive cycle. The run continues with no pending order or open position.
- LIT short cycle: entry request 1 filled at 370165; exit request 2 filled at 368314 after about 10.7 minutes. The exit's persisted raw signed hash `0x22648f6780eeed413bed7ce8b93cfcb9a2d43cc0e2da179669d3ecc03f2d2214` matches the computed hash, with operator nonce 162. Its successful receipt in canonical block 69874106 was below finalized block 69874400; the account ended flat. The verified entry receipt was in block 69871980.
- Realized net PnL: +0.067041 AUSD; ending balance 100.067041 AUSD. Entry/exit fees total 0.010701 AUSD, funding 0, and operator gas totals 0.085876962 MON. The worker checked exits roughly every minute and chose `net_take_profit_exit`; the winning-cycle journal kept reviewed parameters unchanged. Operator balance was 5.106772 MON at finalized block 69874464.
- Scanner made five full eight-market passes through `16:29:35 UTC`, including one while the position was open. It recorded one proposal and one no-proposal scan since that proposal. All other markets were rejected by documented price-history, move, or one-minute confirmation filters; no new three-miss investigation is due. Settlement, returned AUSD, and operator revocation remain pending until signed expiry or the cycle cap.
- The separate Python worker PostgreSQL pool fault is repaired: the two worker replicas now share one bounded SQLAlchemy engine each. Focused tests passed (2); only the scoped worker image was rebuilt and its replicas recreated. Both remain up with no new worker errors, and database sessions stabilized at one idle connection per worker instead of more than 50 before repair. Hono, console, local Convex, public HTTPS health and Android asset links returned HTTP 200; Cloudflared is running. Seven Testnet gates and three finalized enrollment switches remain open; Manual Guard and Lite Mode remain on, mainnet setup and live execution off.
- Next observation due: approximately `16:42 UTC`.

### Active run checkpoint — 2026-10-10 16:37 UTC

- The read-only inventory still has one active phone run (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two completed historical runs. The first finalized cycle remains 1/15 and +0.067041 AUSD net, with 0.010701 AUSD fees, zero funding and 0.085876962 MON gas; no pending order or position. Signed expiry remains `18:06:01 UTC`, with no settlement or returned AUSD yet. The delegated account's operator permission is still enabled at finalized block 69874817, appropriate while the run is active; operator gas balance is 5.106772 MON.
- A sixth scanner pass at `16:35:36 UTC` covered all eight signed live markets. BTC/ETH missed the five-minute threshold; the other six lacked one-minute confirmation. Scanner totals: six passes, one proposal, two consecutive no-proposal scans since the LIT entry. No three-miss investigation is due yet; no entry was forced. One-minute exit checks ended with the finalized flat cycle, so no open-position exit is pending.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links: HTTP 200. Cloudflared is running. Both rebuilt worker replicas remain up without new errors; PostgreSQL holds one idle connection per worker. All seven local Testnet gates and the three finalized factory enrollment switches are open. Manual Guard and Lite Mode remain on; mainnet setup and live execution remain off.
- Next observation due: approximately `16:42 UTC`.

### Active run checkpoint — 2026-10-10 16:49 UTC

- Inventory: one active duration-soak phone run (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) plus two completed historical runs. The finalized LIT short remains the only cycle: 1/15, +0.067041 AUSD realized net PnL, 0.010701 AUSD fees, zero funding, 0.085876962 MON operator gas. No position, pending/uncertain order, new signed transaction, settlement, or returned AUSD. Signed expiry remains `18:06:01 UTC`; operator permission remains enabled at finalized block 69877095 and MON balance is 5.106772.
- Scans at `16:41:23` and `16:47:09 UTC` each covered all eight signed live markets, bringing totals to eight scans, one proposal and four consecutive no-proposal scans. The third miss triggered a persisted investigation audit: BTC observations were irregular, ETH/SOL missed the five-minute threshold, and the other five lacked one-minute confirmation. In the fourth miss, ETH alone was marked `market_or_book_unavailable`, while the other seven failed move or confirmation filters.
- Three-miss investigation: public context and all-market ticker returned chain 10143 and all eight open markets. All eight 100-level books returned HTTP 200 with bids and asks; ETH had 9 bids and 8 asks. Finalized observation histories had 33-36 samples per market, with the latest seven markets about a minute old; ETH was about two minutes old. A repeat through the same finalized-market adapter returned fresh prices and nonempty books for all eight, including ETH. Hono and worker logs showed no new error. The isolated ETH rejection is consistent with a transient stale/unfinalized snapshot; no persistent scanner defect or qualifying rejected signal was demonstrated. No policy or cadence was changed and no entry was forced.
- Hono, console, local Convex, public HTTPS health and Android asset links: HTTP 200. Cloudflared and both scoped Python worker replicas are running; each worker still holds one idle PostgreSQL connection, with no new errors. All seven Testnet gates and three finalized enrollment switches remain open. Manual Guard and Lite Mode remain on; mainnet setup and live execution remain off.
- Next observation due: approximately `16:57 UTC`.

### Active run checkpoint — 2026-10-10 16:58 UTC

- Inventory: one active duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two completed historical runs. Cycle 1 remains the only completed cycle, +0.067041 AUSD realized net; signed expiry remains `18:06:01 UTC`. The ninth five-minute scanner pass at `16:52:54 UTC` covered all eight signed markets and proposed another LIT short after a -60 bps five-minute and -104 bps fifteen-minute move, resetting consecutive misses to zero. Other markets failed documented history, move or confirmation filters; reviewed parameters stayed unchanged.
- Entry order `7971a58c-54c0-4409-89a9-08fcbae4ee75:3`, request 3: persisted signed hash `0x9f3cecb15a2f2e8151ed18a9244fb77c230c9702abddd4330456c3a51986830c` matches the raw transaction, operator nonce 163. Its successful receipt in canonical block 69877802 is below finalized block 69878734, and one taker fill opened LIT short size 82 at 362991, 4× leverage, 30 AUSD planned notional. Entry fee was 0.010270 AUSD and operator gas 0.047208150 MON. This is an entry, not a second completed cycle.
- At the `16:57:17 UTC` snapshot, the position remained open with +0.312338 AUSD unrealized PnL and zero funding. Exit checks about every 70 seconds held under the signed minimum-duration rules; no exit order or uncertain hash. Cumulative realized PnL remains +0.067041 AUSD; total recorded fees including this entry are 0.020971 AUSD. No settlement or returned funds; operator permission remains enabled at finalized block 69878801 and operator balance is 5.059564 MON.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links: HTTP 200. Cloudflared, both Python worker replicas and scoped database remain healthy with one idle connection per replica and no new errors. Seven Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode remain on, mainnet setup and live execution off.
- Next observation due: approximately `17:07 UTC`.

### Active run checkpoint — 2026-10-10 17:08 UTC

- One active phone duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two completed historical runs. LIT short cycle 2 closed at 361120 after about 10.7 minutes, with one finalized exit fill and a flat account. The raw signed exit hash `0x54510cb11f199235bd2b5d385fac64f14164ebb177074c36f493fb46ddcf767e` matches the persisted hash, operator nonce 164; its successful receipt in canonical block 69879929 is below finalized block 69880794. No pending/uncertain order or position.
- Cycle 2 realized net +0.133812 AUSD, with 0.020487 AUSD fees, +0.000877 AUSD funding, and 0.085942038 MON entry/exit gas. The duration soak continues at 2/15 finalized positive cycles, +0.200853 AUSD cumulative realized net and 0.031188 AUSD total fees; cumulative cycle gas is 0.171819 MON. The winning-cycle journal kept reviewed parameters unchanged. The run-level funding field still reports zero despite the cycle ledger's +0.000877; this reporting discrepancy is under focused investigation and does not change the finalized balance or trading policy.
- One-minute exit checks ran about every 70 seconds and ended with `net_take_profit_exit`. Scans at `16:58:54 UTC` (while the position was open) and `17:04:57 UTC` covered all eight signed markets, found no proposal and reset the miss count to two since the `16:52:54 UTC` LIT proposal. Rejections were one-minute confirmation or trend disagreement; no new three-miss investigation is due. Signed expiry remains `18:06:01 UTC`; settlement and returned funds remain pending. Operator permission is enabled at finalized block 69880990; gas balance 5.020830 MON.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links: HTTP 200. Cloudflared and both scoped worker replicas are running without new errors, with one idle database connection per replica. Seven Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode on, mainnet setup and live execution off.
- Next observation due: approximately `17:17 UTC`.

### Active run checkpoint — 2026-10-10 17:18 UTC

- Inventory: one active duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two unchanged completed historical runs. Two finalized positive cycles remain 2/15 with +0.200853 AUSD realized net PnL, 0.031188 AUSD finalized-cycle fees, +0.000877 AUSD funding and 0.171819 MON cycle gas. Signed expiry remains `18:06:01 UTC`; settlement and returned funds remain pending.
- The `17:10:42 UTC` five-minute scanner pass covered all eight signed live markets and proposed LIT short (five-minute -43 bps, fifteen-minute -57 bps, estimated net 31 bps), resetting consecutive misses. Entry request 5/order `…:5` has one taker fill, short size 69 at 360014. Persisted raw signed hash `0x52f86c92bbbfdb1bb620fd807791469b16b88ed113842031ab10e64e12230b65` matches the parsed transaction, nonce 165; successful canonical receipt block 69881341 was below finalized block 69882139. Entry fee 0.008571 AUSD and gas 0.047301786 MON. This is an open position, not cycle 3.
- At `17:18 UTC`, LIT short size 69 remained open, with fluctuating unrealized PnL (latest -0.028428 AUSD); no pending or uncertain order. Approximately 70-second exit checks continued to hold within signed rules. Scanner pass 13 at `17:16:43 UTC` covered all eight markets while the position was open; it found no proposal (one miss). BTC book unavailable and PUMP observations irregular in that pass; other rejections were threshold/confirmation. Three-miss investigation is not due.
- The run-level funding display defect was fixed in local Convex and deployed at `17:16:28 UTC`: operator report now derives +0.000877 AUSD from the two finalized cycles and the owner run DTO uses the same total. Focused Perpl tests (20) and API build passed; read-only snapshot verified the corrected total with trading state unchanged. No Hono restart or transaction was made.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links returned HTTP 200. Cloudflared and both scoped worker replicas run without new errors; one idle PostgreSQL connection per replica. Seven Testnet gates and three finalized enrollment switches remain open; Manual Guard and Lite Mode on, mainnet setup and live execution off. Operator permission remains enabled at finalized block 69882771, with 4.973529 MON balance.
- Next observation due: approximately `17:27 UTC`.

### Active run checkpoint — 2026-10-10 17:20 UTC

- One active Mera-owner duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two unchanged completed historical runs. Still 2/15 finalized positive cycles, +0.200853 AUSD realized net, +0.000877 AUSD funding, 0.039759 AUSD fees including the open third entry, and 0.219120786 MON gas including that entry. Signed expiry `18:06:01 UTC`; no settlement or returned funds.
- The third LIT short remains size 69 at 360014, with -0.009867 AUSD unrealized PnL in the `17:19:07 UTC` snapshot. No pending or uncertain order or new transaction. The latest one-minute exit decision at `17:19:05 UTC` held within signed rules after 8.2 minutes. Scanner totals remain 13 full eight-market passes, three proposals, one consecutive no-proposal scan; the last pass at `17:16:43 UTC` ran with the position open. No three-miss investigation is due.
- Hono 3102, console 3104, local Convex and public Android asset links returned HTTP 200. A single public `/health` request timed out, then three immediate repeats returned HTTP 200; Cloudflared remained running. Both scoped workers are up without new errors. All seven Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode on, mainnet/live-agent execution off. Operator permission remains enabled at finalized block 69883167, with 4.973529 MON.
- Next observation due: approximately `17:29 UTC`.

### Active run checkpoint — 2026-10-10 17:31 UTC

- Inventory: one active duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two unchanged completed historical runs. Cycle 3 LIT short closed after 14.21 minutes at `17:25:06 UTC`: entry 360014, exit 362010, one finalized exit taker fill size 69 and a flat account. The `17:24:57 UTC` one-minute check chose `planned_loss_risk_exit` when estimated net was -0.157624 AUSD. Realized cycle net was -0.154913 AUSD (0.004913 beyond the 0.15 AUSD planned-loss budget), with 0.017189 AUSD fees, zero funding and 0.086015682 MON gas. Earlier approximately 70-second exit checks held under the reviewed rules; no evidence of a delayed or duplicate exit.
- Exit order `7971a58c-54c0-4409-89a9-08fcbae4ee75:6`, request 6: persisted raw signed hash `0x93380a01685138ba4a0e4d3b38267254f50fb79692324c862756a900799953eb` matches the parsed transaction, operator nonce 166. Its successful receipt in canonical block 69884164 was below finalized block 69885204; order status is finalized. No pending or uncertain order remains. The cycle journal classified a trend reversal/stall and changed only the signed-bounded momentum threshold from 40 to 50 bps before another entry.
- Run totals: 3/15 finalized cycles, two positive, +0.045940 AUSD cumulative realized net, 0.048377 AUSD fees, +0.000877 AUSD funding and 0.257834682 MON cycle gas. The signed expiry remains `18:06:01 UTC`; no settlement or returned AUSD. Operator permission remains enabled at finalized block 69885204, with 4.934815 MON balance.
- Scanner passes 14 (`17:22:34 UTC`, with position open) and 15 (`17:28:35 UTC`, flat) covered the signed eight-market set. Pass 14 proposed a LIT long but deferred it because the position was open; it placed no order. Pass 15 rejected all eight for missing one-minute confirmation. Totals: 15 scans, four proposals, one consecutive no-proposal scan; no three-miss investigation due.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links returned HTTP 200. Cloudflared and two scoped workers are running without recent errors, each with one idle database connection. All seven local Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode on, mainnet/live-agent execution off.
- Next observation due: approximately `17:39 UTC`.

### Active run checkpoint — 2026-10-10 17:42 UTC

- Inventory: one active duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two unchanged completed historical runs. The account remains flat with no pending/uncertain order or new signed transaction since finalized exit request 6 (verified raw hash/nonce 166 and canonical receipt in the 17:31 checkpoint). Totals remain 3/15 finalized cycles, two positive, +0.045940 AUSD realized net, 0.048377 AUSD fees, +0.000877 AUSD funding and 0.257834682 MON cycle gas. Signed expiry `18:06:01 UTC`; settlement and returned funds pending. Operator permission is still enabled at finalized block 69887106; balance 4.934815 MON.
- Scans 16 (`17:34:22 UTC`) and 17 (`17:40:08 UTC`) each covered all eight signed live markets while flat. Totals: 17 scans, four proposals, three consecutive no-proposal scans. The third miss persisted an investigation audit: six markets lacked two confirming one-minute moves; LIT (-10 bps five-minute, +26 bps fifteen-minute) and NEAR (-11/-16 bps) missed the reviewed 50 bps threshold. No proposal was forced.
- Independent read-only investigation at `17:41:41 UTC`: public context offered all eight open markets; all eight current prices and 100-level books were reachable, each with bids and asks (book age 0–24 seconds). Each market had at least 60 saved finalized observations; latest observations were 25–46 seconds old, with recent intervals 50–75 seconds. Hono error log was empty and both scoped worker logs had no recent errors. The evidence supports the persisted `no_qualified_live_signal` audit, not a scanner/data defect; reviewed rules and cadence stay unchanged.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links returned HTTP 200. Cloudflared and both scoped workers are running, with one idle database connection each. Seven Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode on, mainnet/live-agent execution off.
- Next observation due: approximately `17:49 UTC`.

### Active run checkpoint — 2026-10-10 17:50 UTC

- Inventory: one active duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two unchanged completed historical runs. The `17:45:54 UTC` scanner pass covered all eight signed live markets and proposed NEAR short after a -110 bps five-minute and -118 bps fifteen-minute move, estimated net 101 bps. It reset three consecutive no-proposal scans to zero; totals are 18 scans and five proposals. The reviewed post-loss momentum threshold of 50 bps remained in effect.
- Entry order `7971a58c-54c0-4409-89a9-08fcbae4ee75:7`, request 7: persisted raw signed hash `0x92750172904f1b338c5849e56b9f2626e86a350b877e4e9c4e00048301781029` matches the parsed transaction, nonce 167. Its successful canonical receipt in block 69888334 was below finalized block 69889049; order status finalized with one taker fill. NEAR short size 204 opened at 53218, 1× leverage and 10.869565 AUSD planned notional. Entry fee 0.003746 AUSD and operator gas 0.047294034 MON. This is an open entry, not cycle 4.
- At `17:50:18 UTC`, the position remained size 204 with -0.035496 AUSD unrealized PnL, no pending or uncertain order. Exit checks ran about every 70 seconds and held within signed rules, latest at `17:49:35 UTC`. Completed-cycle totals remain 3/15, two positive, +0.045940 AUSD realized net and +0.000877 AUSD funding; total recorded fees including this entry are 0.052123 AUSD, and gas including this entry is 0.305128716 MON. Signed expiry `18:06:01 UTC`; no settlement or returned funds. Operator permission remains enabled at finalized block 69889049, balance 4.887521 MON.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links returned HTTP 200. Cloudflared and both scoped workers are running with no recent errors, each with one idle database connection; Hono error log is empty. Seven Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode on, mainnet/live-agent execution off.
- Next observation due: approximately `17:59 UTC`.

### Active run checkpoint — 2026-10-10 18:01 UTC

- Inventory: one active Mera-owner duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) and two unchanged completed historical runs. The fourth NEAR short remains size 204 at 53218; unrealized PnL was -0.021828 AUSD at `18:00:51 UTC`. No pending or uncertain order or new signed transaction since finalized entry request 7 (raw hash/nonce 167 and canonical receipt verified in the 17:50 checkpoint). The `18:00:06 UTC` one-minute exit check held within signed rules after 14.0 minutes. Signed expiry is `18:06:01 UTC`.
- Completed-cycle totals remain 3/15, two positive, +0.045940 AUSD realized net, +0.000877 AUSD funding and 0.257834682 MON cycle gas; 0.052123 AUSD fees and 0.305128716 MON gas include the open NEAR entry. No settlement or returned AUSD. Operator permission remains enabled at finalized block 69891237 and its balance is 4.887521 MON.
- Scanner passes 19 (`17:51:55 UTC`) and 20 (`17:57:46 UTC`) covered all eight signed live markets while the position was open. Both found no proposal; totals are 20 scans, five proposals and two consecutive misses. The latest rejections were missing one-minute confirmation or five-minute move below 50 bps, except one transient MON book-unavailable result. No three-miss audit is due yet; no entry was forced.
- Hono 3102, console 3104, local Convex, public HTTPS health and Android asset links returned HTTP 200. Cloudflared and both scoped workers remain running without recent errors, with one idle database connection each; Hono error log is empty. All seven Testnet gates and three finalized factory enrollment switches remain open; Manual Guard and Lite Mode on, mainnet/live-agent execution off.
- Next observation due: approximately `18:09 UTC`, after signed expiry; verify flat account, final order receipts, returned AUSD and operator revocation before marking settlement complete.

### Settled phone run — 2026-10-10 18:13 UTC

- The sole enrolled duration soak (`7971a58c-54c0-4409-89a9-08fcbae4ee75`, owner `…96e848`) completed after signed expiry, with four finalized flat-account cycles: two positive, two negative. NEAR short cycle 4 closed at 53414 after about 21.2 minutes under `owner_stop_or_expiry_exit`, with one exit taker fill size 204 and -0.047490 AUSD realized net (0.007506 AUSD fees, zero funding, 0.085990284 MON entry/exit gas). Final run net is -0.001550 AUSD from 100 AUSD funded; total fees 0.055883 AUSD, funding +0.000877 AUSD, cycle gas 0.343824966 MON. The loss journal changed only the momentum threshold from 50 to 60 bps; no further entry occurred.
- Exit order `…:8`/request 8 has a persisted raw signed hash `0xe8a073b7b29c09757300125f258b3bf481e36a8e2d059e310bc82066c55ca9cd` matching nonce 168. Its successful receipt in canonical block 69892552 was below finalized block 69893337; order status is finalized, account flat, no pending or uncertain order. Settlement-ready nonce 169/hash `0x4ef6fcf3df6c4a86aa0d74274349a8484e7dcbd39f510cffac62a116880bb955` and completion nonce 170/hash `0x762379522ed5b4c7c6b0416f22b1b4a863cc78e843395c7f726e5def2f0a78a0` likewise match stored raw signed transactions and successful canonical finalized receipts in blocks 69892631/69892672. The settlement event returned 99.998450 AUSD to the owner; onchain owner balance is 9,999.998450 AUSD, vault AUSD is zero, vault status is settled (4), and delegated operator permission is revoked at finalized block 69893403. Settlement transactions used 0.060719784 MON gas, separate from cycle gas.
- Scanner pass 21 at `18:03:38 UTC` covered all eight signed markets while NEAR remained open and triggered a three-miss audit: four lacked one-minute confirmation, three missed the 50 bps threshold, and MON had irregular minute observations. Saved finalized observations existed for all eight (latest at the scan 6–35 seconds old), with MON's preceding interval 46 seconds; all public markets/books were reachable on follow-up, although MON's later public book was stale. Hono and worker logs had no errors. No qualifying rejected signal or backend defect was demonstrated; no policy was relaxed or order forced.
- Hono 3102, console 3104, local Convex and public Android asset links returned HTTP 200; one public health timeout cleared on three immediate HTTP 200 repeats. Cloudflared and both scoped workers run without errors, with one idle database connection each. Seven Testnet gates and three finalized factory enrollment switches remain open as requested; Manual Guard and Lite Mode on, mainnet/live-agent execution off. Two older direct runs remain historical/completed. The recurring monitor stays active for further phone enrollment until the user changes it.

### Settlement report correction — 2026-10-10 18:20 UTC

- The final operator export still displayed optimizer status `running` from the frozen cycle state after the run and vault were settled. The local Convex read model now reports completed v3 soaks as `settled` without inferring whether an early owner stop or expiry ended them; active and historical v2 statuses are unchanged. Focused tests (7), type checks and API build passed. The local-only Convex deployment completed and read-only inventory/operator snapshots returned `completed`/`settlement_reconciled`/`settled`, four cycles, zero positions/orders and the same 99.998450 AUSD return. The standalone [live optimizer report](PERPL_OPTIMIZER_LIVE_REPORT.html) was regenerated with the settled status. Hono, console, local Convex and public HTTPS health/asset links returned HTTP 200 after deployment; no trade or gate state changed.
