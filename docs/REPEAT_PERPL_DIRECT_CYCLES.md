# Repeat the direct Perpl Testnet cycles

This walkthrough repeats **three BTC round trips** (long, short, long) through
Perpl's real Testnet exchange. It uses a fresh Mera-approved AUSD run and the
local operator scenario runner. The previous run's [measured report](PERPL_TESTNET_REPORT.html)
is evidence, not a price or PnL target: Perpl prices and depth cannot be controlled.
Orders can lose AUSD. The operator pays MON gas; the Mera wallet needs MON for
funding and, if used, owner stop. No Perpl API key or Origin approval is needed.

Use only this repository and its `moeazi-monad` local stack. Keep keys in the
ignored `backend/.data` directory. The steps below broadcast funded Testnet
transactions; do them only with a deliberately capped amount.

## 1. Start the local stack and passkey host

In PowerShell at the repository root:

```powershell
cd backend
npm run stack:start
Invoke-WebRequest http://127.0.0.1:3102/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3104/ -UseBasicParsing
```

If the stack is already running, check the URLs without restarting it. The
Cloudflare Tunnel must forward `moeazi-monad.kiyan.finance` to local port `3102`
for the emulator's Mera passkey. Confirm the Android association response is
public, HTTP 200, and has no redirect or login gate:

```powershell
Invoke-WebRequest https://moeazi-monad.kiyan.finance/.well-known/assetlinks.json -UseBasicParsing -MaximumRedirection 0
```

The emulator calls `http://10.0.2.2:3102`; Metro uses `8082`. The local stack
and port map are described in [LOCAL_STACK.md](../LOCAL_STACK.md).

## 2. Check the wallet and market

The Mera test wallet needs at least **100 AUSD** for the same sized initial
account funding, plus a little Testnet MON. On a reused Perpl account the live
minimum may differ; always follow the app's current minimum. Check the app's
wallet balance. AUSD is Agora Testnet collateral, contract
`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`; Circle USDC cannot fund
this Perpl run. The operator wallet also needs Testnet MON.

From `backend/`, a read-only public Perpl check is:

```powershell
node scripts/check-perpl-public.mjs
```

On the app's **Perpl markets** screen, check that BTC is open, the order book
has executable depth, and market ID `16` is still BTC. Market IDs, size units,
limits, and depth are live venue data. The example below uses `size: 50`, the
quantity that was accepted in the previous capped run; reduce or revise it if
the current review or venue rejects it. A rejected action is blocked, not a fill.

## 3. Open the five local gates and factory enrollment

Edit the ignored `backend/.env.local` to set these five values to `true`:

```text
MONAD_TESTNET_ACTIONS_ENABLED=true
MONAD_TESTNET_BROADCAST_ENABLED=true
MONAD_TESTNET_OPERATOR_TRADES_ENABLED=true
MONAD_TESTNET_PERPL_AUTONOMY_ENABLED=true
MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED=true
```

Keep `LIVE_EXECUTION_ENABLED=false`, `MAINNET_VENUE_SETUP_ENABLED=false`,
Manual Guard on, and Lite Mode on. From `backend/`, restart only Hono and open
the **verified** factory using the ignored local operator key:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-monad-api.ps1
node --env-file=.env.local --import tsx scripts/perpl-factory-gate.ts status
node --env-file=.env.local --import tsx scripts/perpl-factory-gate.ts on
```

The helper checks chain `10143`, the configured factory, its runtime code hash,
the administrator, and all five gates. `on` prints a transaction hash and
finalized block, or `alreadySet` if enrollment was open. It reads the key from
the ignored local operator file; never paste a private key into a command.
The verified factory is
`0xCF0fd3c3FEd28d40bd739FcE26FD7CC7d923b80e`. Check the mobile venue
response before enrollment:

```powershell
$venues = Invoke-RestMethod http://127.0.0.1:3102/api/mobile/perp/venues
$venues.venues | Select-Object venueId, enabled, reason
```

`perpl-direct-testnet-v1` should be enabled. The API transport may still be
blocked by Perpl's Origin whitelist; it is not used here.

## 4. Approve a fresh run in the emulator

Start `Moeazi_API_36` and run `npm run android:preview` in a second PowerShell
terminal at the repository root. Sign into the app with the existing offline
KeePassDX passkey. The test vault password and Android PIN are in
[AGENTS.md](../AGENTS.md); no Google sign-in is required.

Navigate **Agent → Perpl · live Testnet venue → View Perpl markets → Review
Perpl AUSD enrollment**. Enter `100` AUSD and a duration long enough to finish
the script and settlement (for example `60` minutes). Tap **Prepare exact Perpl
review**. Confirm chain `10143`, `Direct onchain`, AUSD amount, vault receiver,
operator address, leverage/exposure caps, markets, and the displayed maximum
network fee. Tap **Unlock Mera and sign exact setup**. One passkey unlock signs
the funding transaction and mandate. The setup deadline is short; if it
expires, prepare a fresh review instead of reusing a signature.

On **Perpl positions and history**, wait until the run says **active**, copy
its **Run ID**, and check the AUSD funding and activation transactions in
Activity. If the app says setup is uncertain, refresh this run before doing
anything else. Do not create a second run while the first is unresolved.

## 5. Run three explicit BTC cycles

Open `http://127.0.0.1:3104` on the host, use the local console admin secret
from `backend/.data/operator-console-admin.secret` if prompted, and select
**Perpl scenarios**. Enter the active Run ID. The policy worker can trade on
its own between scripts; check **Perpl positions and history** for **No open
position** first. Submit the script promptly. While a scenario is queued or
running, its actions take precedence over new rule decisions.

Paste this JSON into **Actions**. It has six actions: each close follows its
entry only after the previous order is reconciled. Set **Seconds between
actions** to `15` or more. Keep the generated scenario request key and click
**Start Perpl script** once.

```json
[
  {"kind":"market_entry","marketId":16,"side":"long","size":50,"leverage":2},
  {"kind":"close_position","marketId":16,"side":"long","size":50,"leverage":2},
  {"kind":"market_entry","marketId":16,"side":"short","size":50,"leverage":2},
  {"kind":"close_position","marketId":16,"side":"short","size":50,"leverage":2},
  {"kind":"market_entry","marketId":16,"side":"long","size":50,"leverage":2},
  {"kind":"close_position","marketId":16,"side":"long","size":50,"leverage":2}
]
```

Click **Refresh status** until the scenario shows `completed · 6/6`. Follow
each order in **Perpl positions and history** and **Activity**. Confirm a
transaction hash, finalized receipt, Exchange fill, and changed position for
each entry and close. A submitted hash alone is not a fill. If the console
shows `blocked` or `uncertain`, leave the same request key in place and inspect
the current scenario and run before retrying. Never submit a fresh duplicate
script to resolve an uncertain response. If the rule opened another position
before the script, do not force this six-action script through it; reconcile or
close that position under the current run first.

The prior run had a PUMP long before the BTC script. Its completed operator
script first closed that position with the then-current exact size, then ran
the same six BTC actions. Do not reuse that old PUMP size on a new position.

## 6. Stop and verify returned AUSD

After the sixth action is finalized, return to **Perpl positions and history**.
Tap **Prepare Perpl stop review**, inspect the vault and network fee, then
**Sign stop with Mera**. This owner stop needs a fresh passkey signature. The
worker disables new entries, cancels pending orders, closes any remaining
position when executable, revokes operator access, and returns free AUSD. Keep
all five gates on until status is **completed** and settlement is finalized.
If closure fails, status is **incomplete settlement** and the app retains owner
recovery controls; do not claim that collateral returned before a finalized
settlement receipt.

Record the starting AUSD, returned AUSD, realized PnL, Perpl fees, operator
MON gas, order IDs, and each transaction hash from **Perpl history** and
**Activity**. The prior run returned `99.732661` of `100` AUSD; the next
result can differ. The [report](PERPL_TESTNET_REPORT.html) shows the prior
receipt timeline and how to distinguish predicted from observed outcomes.

## 7. Close the gates

From `backend/`, close factory enrollment first:

```powershell
node --env-file=.env.local --import tsx scripts/perpl-factory-gate.ts off
node --env-file=.env.local --import tsx scripts/perpl-factory-gate.ts status
```

Then set the same five `MONAD_TESTNET_*` values in `backend/.env.local` to
`false` and restart Hono:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-monad-api.ps1
$venues = Invoke-RestMethod http://127.0.0.1:3102/api/mobile/perp/venues
$venues.venues | Select-Object venueId, enabled, reason
```

The direct venue should report `enabled: false` and
`perpl_direct_execution_disabled`. Keep the gates open if settlement is still
pending or incomplete so the worker can close exposure; use the app's recovery
path if it cannot. Do not turn off the funded gates while a position, order
lock, or unsettled collateral remains.
