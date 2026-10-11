# Manual Perpl Testnet account

Manual Perpl uses the signed-in Mera wallet's **direct Perpl exchange account**.
The owner signs every account change and order. Deposited AUSD belongs to that
exchange account and is reused for later orders; it is not transferred to an
autonomous vault. The autonomous Perpl path keeps its separate vault, delegated
account, mandate, and operator execution.

## Direct-wallet setup

1. Open **Markets → Perpl market → Manual Perpl account**. The app checks
   Perpl's finalized `getAccountByAddr` state for the Mera address, including
   accounts opened outside Moeazi.
2. If no account exists, enter at least Perpl's live account-opening minimum
   in AUSD. Review and Mera-sign an **exact AUSD approval** to the verified
   Testnet Exchange. Wait for its finalized receipt.
3. Review and Mera-sign `Exchange.createAccount(amount)`. This opens the
   owner's account and deposits that amount in one transaction. Wait until the
   finalized exchange account state reflects it.
4. Later, use owner-signed `depositCollateral` and `withdrawCollateral` to move
   AUSD between the Mera wallet and the same exchange account. Orders draw on
   the **deposited** AUSD balance, not directly on wallet AUSD.

The app displays wallet AUSD separately from free and locked exchange AUSD.
The owner wallet also needs MON for gas. There is no manual operator, API key,
order forwarding, or new delegated account in this flow. Use current Perpl
context for account and transaction minimums. An approval alone neither opens
an account nor moves AUSD into it.

### If the wallet is funded but the account says “Not created”

Check **AUSD allowance to Perpl** separately from **AUSD in Perpl account**.
An allowance is only the first owner-signed transaction. Return to **Direct
account setup and collateral**, select the **same exact amount** as the
allowance, tap **Review account creation and initial deposit**, then tap
**Sign exact action with Mera** on the review page. Wait for a finalized
`createAccount` receipt and a nonzero Exchange account ID before trading.
The second signature is never requested automatically after approval.

If a prepared review expires before signing, prepare it again. An expired,
unsigned review has no transaction hash and has not moved funds. A different
deposit amount needs a new exact approval; an allowance of 500 AUSD does not
authorize Moeazi's reviewed 100 AUSD setup action. Keep the original operation
ID and check its status before retrying if a signed submission is uncertain.

## Gates and limits

The local global Manual Perpl gate is independent of autonomy gates. The
configured stack keeps it enabled in ignored
`backend/.data/manual-perpl-gate.json`; the action and broadcast gates still
govern preparation and submission. Manual Guard and Lite Mode remain on.

The default manual order notional cap is 10 AUSD
(`MONAD_TESTNET_MANUAL_PERPL_MAX_ORDER_AUSD_UNITS=10000000`), and leverage is
capped at 3× or Perpl's lower live limit. The backend checks fresh book data,
market limits, collateral including estimated opening fee, slippage, and
finalized account state. An unavailable or stale executable book blocks a
market order; a limit order may rest on Perpl's book and does not imply a fill.

### Choosing a position

The order screen uses live Perpl market configuration and the owner's finalized
direct account. Perpl expresses initial and maintenance margin as leverage
fractions in hundredths: for example, `1500` means a 15× base market maximum
and approximately 6.67% initial margin. The manual Testnet cap can be lower.
The size control is in AUSD notional; the app converts it to a base-asset lot
rounded down to the market's size precision. The usable maximum is constrained
by the configured order cap, free exchange AUSD after estimated entry fee, and
fresh executable depth for a market order. Deposited collateral and Mera wallet
AUSD are shown separately.

The screen shows the chosen base size, margin, opening and estimated closing
fees, spread and book impact, and a **pre-trade liquidation estimate** from
the market maintenance margin. The estimate assumes the shown entry price and
no future funding, fee-tier change, collateral adjustment, or mark movement.
Perpl's live liquidation point can change; the exact outcome is determined by
its exchange state and final receipts. A limit order may sit unfilled, so its
displayed liquidation estimate only applies if it fills at the reviewed price.
Every prepared transaction still obtains a fresh quote and exact Mera review.

Sources: [Perpl API types](https://raw.githubusercontent.com/PerplFoundation/api-docs/main/types.md),
[margin](https://github.com/PerplFoundation/perpl-docs/blob/main/docs/exchange/margin.md),
and [liquidation](https://github.com/PerplFoundation/perpl-docs/blob/main/docs/exchange/liquidation/README.md).

Mobile 1.7 adds touch controls for AUSD notional and leverage, quick size
choices, and limit-price ticks. Its preview shows the live Perpl maximum beside
the lower Moeazi cap, current free collateral, spread, depth or impact,
estimated entry and exit fees, break-even, and an estimated liquidation price.
The exact prepared Mera review can differ if the market moves before signing.
On the offline KeePassDX emulator, ETH market data and the new controls loaded;
that emulator's direct Perpl account held zero free AUSD, so no manual order was
submitted during this UI check.
The ARM phone build is `android/app/build/outputs/apk/release/moeazi-monad-v1.7-arm.apk`
(SHA-256 `3299490F7BD88C08678B5041CF4EEE05D1BE21A40A36C7F48ABC107999061BEC`).
It includes `arm64-v8a` and `armeabi-v7a`, uses the HTTPS Moeazi API, and
packages the public asset-link statement.

## Signing and reconciliation

Each approval, account action, entry, limit action, reduction, or close gets a
fresh exact EIP-1559 review and Mera signature. The prepared operation binds
owner, chain `10143`, mode, Exchange or token target, amount, calldata, nonce,
gas cap, and expiry. The backend checks the signed transaction against that
record before broadcast. A new operation cannot reuse a signed payload.

The operation ID is the recovery handle. `GET
/api/mobile/manual/perpl/operations/:operationId` reconciles the original
transaction hash and receipt, chain finality, and resulting Perpl state. When
submission is uncertain, check that same operation before any new order. A
submitted transaction or Perpl admission is not a fill. Activity and position
summaries use finalized exchange evidence; fees, funding, and realized PnL
remain unknown where finalized evidence does not establish them.

## Existing delegated manual accounts

An earlier Moeazi build created a separate, owner-controlled delegated manual
account. The app labels it **Legacy delegated account** and keeps its balances,
positions, orders, and history visible to that owner. It is never silently
migrated into the direct wallet account. Its recovery actions remain
owner-signed: cancel, reduce or close, withdraw collateral to the delegated
account, then rescue any AUSD token balance to the Mera wallet. Check its
exchange and token balances after each finalized step. Autonomous accounts
are separate and are not exposed in this recovery view.

## Testnet acceptance

The current acceptance task calls for a capped direct-wallet approval,
account opening, trade entry, close, and withdrawal on Monad Testnet. Record
finalized hashes, account IDs, starting and returned AUSD, and any blocked
steps below once observed. A fork test proves contract behavior but is not
evidence of a Testnet fill.

| Step | Finalized transaction / observed result |
| --- | --- |
| Exact AUSD approval | Finalized: `0x28474d8fff3e50a038c4bfe4d9f844364ce3307444f0d75d1e5c58e224a69cd5`; allowance 100 AUSD to Exchange |
| Direct account opening and initial deposit | Finalized: `0x7f4b72316f532d95d36901c85c5328e8c859d1c9dc7210e5ccacf9e913839cf8`; owner `0xbb66e7bc26d8a81c36a2f900d141a1fa786a98d8`, account ID `1076`, 100 AUSD transferred to Exchange |
| Manual entry | Finalized: `0xd9084c2f256e67a4c847cdc9993a5b29c9854f4c7bddfac2a785654dc3282d1e`; BTC long, 0.0001 BTC at 82,975 AUSD, opening fee 0.002863 AUSD. Account 1076 held the position. |
| Complete close | Finalized: `0x219891b9a25c318d7321dd0c18ce7445d43261341a51b563d14d69b118073cf1`; full 0.0001 BTC closed at 82,926.3 AUSD, closing fee 0.002861 AUSD. Finalized account state had no position or pending order and 99.989406 AUSD free. |
| AUSD withdrawal | Finalized: `0xd51c78fe9ad3cd61aa370cbb488954bc57cbae1a954018e16054731db78014b0`; the full 99.989406 AUSD returned to the Mera wallet, the exchange balance is zero, and wallet AUSD is 19,999.859323. |

The account began this capped cycle at 100 AUSD and ended flat with 99.989406
AUSD. The measured net result was **−0.010594 AUSD**, inclusive of the
0.005724 AUSD opening and closing fees; MON gas was paid separately by the
owner wallet. All three account operations used the wallet directly, and
Perpl order forwarding remained disabled. The onchain account state and
receipts were checked again after withdrawal. A summary repair matched the
finalized entry and close to consecutive wallet nonces and the exact Perpl
account balance delta, then recorded `−10594` AUSD base units as verified net
PnL. Future direct-wallet cycles record this net value on closing finality.

On the offline KeePassDX x86 emulator, the autonomous Perpl card opened the
AUSD-and-duration setup, while Home's Perpl markets button still opened Markets.
The direct manual account and BTC position were visible after app restart;
Activity contains distinct prepared, submitted, and finalized records for the
entry, close, and withdrawal. The global Manual Perpl gate remained enabled
in the ignored local gate file after API restart. A slow Metro/KeePassDX debug
session delayed UI acknowledgement after signing, so each original operation
was reconciled from its saved transaction hash before another action.

The Android ARM internal APK is
`android/app/build/outputs/apk/release/moeazi-monad-v1.5-arm.apk` (SHA-256
`9F3415D36E57637AB3EB062022442CD82C7A62C9AB8B5CBBF53D567D12EB338A`).
It contains both `arm64-v8a` and `armeabi-v7a`, uses the HTTPS Moeazi API, and
packages the asset-link statement. The public association endpoint returned
HTTP 200 and lists the APK's signing certificate fingerprint
`93:05:40:B4:E8:73:29:85:D0:1A:B5:A0:FF:4F:3D:D9:77:DB:7C:E3:6A:7A:7A:B7:98:88:2C:AB:BA:6B:E5:99`.

Verification: the Monad fork test exercised direct approval, account creation,
deposit, an EOA long entry and close, withdrawal, and rejection of a different
address. Backend direct-wallet, gate, and ledger-PnL tests passed (13 checks);
focused mobile navigation, account, trading, and validation tests passed (20
checks). Mobile, backend, and Convex typechecks passed; the ARM release build
succeeded. The bounded submit/status UI change was typechecked and covered by
the existing mobile suite, but no additional funded transaction was made solely
to exercise that timeout path.

## 2026-10-11 account-setup diagnosis

For a second Mera owner (`0xcED2CE…96e848`), the finalized wallet snapshot
showed 9,999.99845 AUSD and a 500 AUSD allowance to Perpl, but no direct
exchange account. Local Convex recorded the 500 AUSD approval as finalized;
its next `open_account` operation was only prepared, with no signed transaction
or transaction hash, and expired. The wallet's onchain nonce was still 7,
matching the prepared creation transaction. A read-only `createAccount(500
AUSD)` simulation succeeded, so collateral and MON gas were sufficient. No
Perpl account deposit or manual trade occurred for this owner.

Mobile 1.6 makes the approval and account-creation signatures explicit, fills
the amount from a finalized usable allowance, and explains exact-allowance
mismatches. The backend now reports both the selected amount and finalized
allowance when they differ. The x86 emulator build launched, the focused
account-flow suite passed 11/11, mobile and backend typechecks passed, and the
ARM build succeeded. The new phone APK is
`android/app/build/outputs/apk/release/moeazi-monad-v1.6-arm.apk` (SHA-256
`CD64A1173F5DB02EF6B3DDF179F757F7DE99C1D02F16CDE8D67AE80D967A2472`).
The owner still needs to review and Mera-sign a fresh `createAccount(500
AUSD)` on the phone; that transaction cannot be completed by a backend fix.
