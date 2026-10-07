# Repeat a controlled autonomous trading run

This is a **manual Monad Testnet walkthrough** for the deployed MZA, MZB, and
MZG pools. The Mera owner approves one amount and duration. The operator then
moves real testnet pool prices while the worker decides and trades without
another routine passkey prompt. Pool fees and price impact can cause a loss.
The [previous measured run](AUTONOMY_TESTNET_ACCEPTANCE.md) is an example, not
an expected result for the next run.

Use the independent `moeazi-mobile` checkout only. Do not run unscoped Docker
Compose commands. The operator key and `.env.local` remain in ignored local
files; never paste the private key into a terminal command or commit it.

## 1. Start and check the local stack

From this repository root in PowerShell:

```powershell
cd backend
npm run stack:start
Invoke-WebRequest http://127.0.0.1:3102/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3310/version -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3104/ -UseBasicParsing
```

If this stack is already running, skip `npm run stack:start` and check the
three URLs. They should return HTTP 200. The stack uses the scoped
`moeazi-monad` Compose project described in [LOCAL_STACK.md](../LOCAL_STACK.md).

Keep the Cloudflare Tunnel forwarding `moeazi-monad.kiyan.finance` to port
`3102` for Mera passkeys. Check that both public URLs return 200 directly:

```powershell
Invoke-WebRequest https://moeazi-monad.kiyan.finance/.well-known/assetlinks.json -UseBasicParsing -MaximumRedirection 0
Invoke-WebRequest https://moeazi-monad.kiyan.finance/.well-known/apple-app-site-association -UseBasicParsing -MaximumRedirection 0
```

## 2. Check funding and pool inventory

The Mera wallet needs at least the chosen amount of **Circle testnet USDC**.
The local operator needs testnet MON for gas and enough USDC/mock tokens for
the price moves. MON is not a trading pair in this test.

Open `http://127.0.0.1:3104`, enter the **local** admin secret from
`backend/.data/operator-console-admin.secret` if prompted, and select
**Autonomy testnet**. Click **Refresh pools**. The cards show finalized prices,
pool reserves, and operator USDC/token inventory. Keep the console on
`127.0.0.1`, the same hostname as the API. This login is local; KeePassDX on
the emulator needs no Google account.

If a pool lacks reserves or the operator lacks input inventory, stop and
restore the testnet funding before continuing. Pool replenishment is a
separate owner action, not a price move. A blocked move has no fill. The
deployed tokens have fixed supply, so this guide does not mint replacements.

## 3. Open the local execution and factory gates

Edit the ignored `backend/.env.local` so these four lines are `true`:

```text
MONAD_TESTNET_ACTIONS_ENABLED=true
MONAD_TESTNET_BROADCAST_ENABLED=true
MONAD_TESTNET_OPERATOR_TRADES_ENABLED=true
MONAD_TESTNET_AUTONOMY_ENABLED=true
```

Keep `LIVE_EXECUTION_ENABLED=false` and
`MAINNET_VENUE_SETUP_ENABLED=false`. Restart only this Hono process, then open
the verified factory with the local administrator key:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-monad-api.ps1
node --env-file=.env.local --import tsx scripts/autonomy-factory-gate.ts status
node --env-file=.env.local --import tsx scripts/autonomy-factory-gate.ts on
```

The `on` command requires all four local flags, checks chain `10143`, the
verified manifest, factory code, and the administrator address, then prints
its finalized transaction hash. It reads the key from ignored
`backend/.data/testnet-operator.json`; no key appears on the command line.
If it reports `alreadySet`, no second transaction was sent.

## 4. Approve one run on the emulator

Start the `Moeazi_API_36` emulator if needed. From the repository root in a
second PowerShell terminal, run `npm run android:preview`. The emulator calls
the API at `http://10.0.2.2:3102`; Metro uses port `8082`. Use the existing
offline KeePassDX passkey. Its local test credentials are in
[ANDROID_BUILDS.md](ANDROID_BUILDS.md).

In the app, open **Home → Autonomous trading · testnet → Set up a new
autonomous run**. For a three-cycle walkthrough, enter **1 USDC** and
**30 minutes**. A ten-minute run may expire during cycle three. Tap
**Prepare exact setup review** and check the owner, isolated vault, Circle
USDC amount, chain `10143`, three approved tokens/pools, slippage, expiry,
and three-cycle cap. Tap **Approve & start with one passkey**. KeePassDX opens
once; the app signs the USDC authorization and mandate in that session.

On **Run status & history**, wait for the atomic funding transaction to have
a finalized block and for the run to become **Active**. Check that the vault
shows the selected USDC and zero cycles. Do not start operator moves while
funding is still pending. If a response is uncertain, check status/history
before preparing another run; the old signed transaction may still finalize.

## 5. Establish a price baseline

Keep the status screen open or return to it periodically. The worker samples
finalized executable quotes about every 15 seconds. Wait roughly **75–90
seconds** after activation with no operator moves. Refresh the console pools.
This gives the one-minute buy rule a stable baseline. Before each later
cycle, wait for the preceding sale to finalize and avoid moving another pair
at the same time. The strongest qualifying signal among all three wins.

## 6. Drive the first cycle: rise, buy, then flat exit

In the console's **Price move** form, choose **MZG**, **Rise · spend USDC**,
and `200000` base units (**0.2 USDC**). Review and submit. Wait for the
console to show a finalized swap hash, block, and new pool price. On the app,
wait for a **buy** receipt and an open MZG position. The rise must reach 3%
over the worker's one-minute window; `200000` is an example, not a guaranteed
threshold at every reserve level. If no buy appears, inspect **Latest
finalized price decision** and the pool inventory before another move.

After the buy is finalized, make a separate MZG **Rise** move, for example
`500000` base units (**0.5 USDC**), if the console shows enough inventory.
Then leave that pool untouched for more than a minute. A flat one-minute
window can trigger the worker's sell. Wait for the **sell receipt** and
**1 of 3** cycles. The returned USDC may be above or below 1 USDC.

## 7. Drive two more cycles

Wait for a fresh quiet one-minute baseline after each completed sale.

1. For **MZA**, submit a **Rise** move such as `200000` USDC base units.
   Wait for the MZA buy receipt. Then submit **Fall · sell token** with, for
   example, `100000000000000000000` raw units (**100 MZA**) if the operator
   holds that amount. A 2% drawdown from the post-buy peak should trigger
   the sell; check the actual decision and receipt. Wait for **2 of 3**.
2. For **MZB**, submit another funded **Rise** move and wait for its buy.
   Let the price remain flat for an exit, or make a reviewed downward move.
   At the third completed sale the vault should return remaining USDC
   immediately. If duration expires first, the worker attempts a final sale
   and settlement. Wait for **Completed**, **3 of 3**, or inspect an explicit
   **Incomplete settlement** if a safe sale was unavailable.

Each price move changes real reserves and costs operator inventory and MON.
The numbers above are small example inputs; check the console's current
reserves and inventory first. A buy/sell can be blocked by a stale quote,
missing liquidity, slippage, or insufficient inventory. Do not record a
blocked action as a fill.

For repeated market patterns, the same console also offers **Rising**,
**Flat**, and **Falling** scenarios with 15–120 second intervals. Run one
scenario at a time and wait for its listed finalized receipts before adding
another; simultaneous scenarios can change which pair wins the buy signal.

## 8. Verify and close the test

Record the run ID, vault, atomic funding hash, each operator move hash, each
vault buy/sell hash, finalized blocks, starting and final wallet USDC,
returned mock tokens, and operator-paid MON gas. The app shows realized USDC
profit/loss separately from gas. Check the wallet balance after settlement:
`final wallet USDC − wallet USDC before enrollment` is the measured result
if the wallet had no other USDC transfers during the run. A loss is valid.

If a console response says **uncertain**, use its **Retry same idempotent
move/scenario** control or the saved status. Do not submit a fresh move with
a new key until the previous hash is reconciled. If a run stalls or returns
unsold tokens, the owner can use **Emergency recovery** in the app; that is
an owner-signed transaction and may require MON in the owner wallet.

Wait until the run is terminal before closing the local autonomy worker gate.
From `backend/`, close the factory first:

```powershell
node --env-file=.env.local --import tsx scripts/autonomy-factory-gate.ts off
node --env-file=.env.local --import tsx scripts/autonomy-factory-gate.ts status
```

Then set `MONAD_TESTNET_AUTONOMY_ENABLED=false` and
`MONAD_TESTNET_OPERATOR_TRADES_ENABLED=false` in the ignored `.env.local`,
and run `powershell -NoProfile -ExecutionPolicy Bypass -File
scripts/restart-monad-api.ps1`. Leave the action and broadcast gates at their
prior values for reviewed manual wallet operations. A new run needs a new
Mera approval and these gate steps again.
