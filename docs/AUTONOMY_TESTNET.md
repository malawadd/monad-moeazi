# Controlled autonomous trading on Monad Testnet

This test path is separate from manual wallet and USDC/WMON trading. It uses
three fixed-supply mock tokens, each in a Moeazi USDC pool. MON pays operator
gas only. The operator's funded swaps change real pool reserves; there is no
display-only price setter or simulated fill.

## User authorization and custody

A user chooses only a Circle testnet USDC amount (0.1–10 USDC) and a duration
(10–120 minutes). One Mera passkey session signs two exact EIP-712 payloads:

1. Circle `ReceiveWithAuthorization`, moving only that amount to the predicted
   per-enrollment vault during a five-minute setup window.
2. A strategy mandate fixing Monad Testnet chain 10143, the owner and vault,
   the three tokens and pools, amount, duration, three-cycle cap, slippage bounds,
   setup deadline, and nonce.

The operator submits an atomic vault creation, funding, and authorization
transaction and pays its gas. A failed start leaves the user's USDC in the
wallet. The vault permits only one open position and at most three sequential
buy/sell cycles. Each buy is capped by the original amount; profits remain in
USDC for the next cycle. The operator cannot withdraw assets to itself.

At the third sale, the vault returns remaining USDC to the Mera owner. At
expiry, new buys stop and the worker attempts to sell and return USDC even if
the result is a loss. If the pool cannot execute a safe sale, the vault returns
USDC and any unsold mock token with an incomplete-settlement result. The owner
can recover an active vault in an emergency. No routine second passkey prompt
is needed after enrollment.

## Decision and execution boundary

The first decision provider samples finalized executable pool prices every
15 seconds. It selects the strongest eligible pair after a 3% rise over one
minute. It sells an open position after a 2% decline from its post-buy peak,
after a one-minute flat window within 0.5%, or when the mandate expires. Only
one position is open at a time. The operator console can run individual funded
price moves or repeatable rising, flat, and falling scenarios.

The worker records the observation block, rule version, decision and rejection
reasons, quote, unique order ID, signed operator transaction, receipt, and
settlement. A missing quote or liquidity blocks the order. A broadcast with an
uncertain response is reconciled by its existing transaction hash; it does not
create a replacement trade. The decision-provider boundary can later accept
ML or JEV output without giving a model a key or direct execution authority.

## Local gates and verification

`MONAD_TESTNET_AUTONOMY_ENABLED` is a separate, default-off local gate. Running
orders also requires the existing Monad action, broadcast, and operator-trade
gates, a receipt-verified autonomy deployment manifest, live contract code
matching that manifest, and an enabled onchain factory. Manual Guard, Lite
Mode, and the existing live-agent execution gate remain unchanged.

Use Foundry's project-local v1.8.4 binary in Monad mode for contract tests.
The Android test uses the offline KeePassDX passkey documented in
`docs/ANDROID_BUILDS.md`. Record testnet transaction hashes, finalized blocks,
starting and returned USDC, unsold tokens, and operator gas for every live
scenario. Profit is measured from actual returned USDC minus the funded USDC;
fees and price impact can produce a loss. The operator supplies the market
movement, so a profitable controlled scenario does not predict live-market
performance.

The corrected, receipt-verified deployment is recorded in
[`manifest.autonomy.testnet.json`](../backend/contracts/monad-testnet/deployments/manifest.autonomy.testnet.json),
separate from the existing USDC/WMON vault manifest. Factory
`0x75C18E5c80814ed117d26bD0cA223f11737852Fb` was deployed in
transaction `0x87fac2be175f0cb2727b7eb9eeb5e60215da976fd34893b8ed7117823bc51054`.
All 16 deployment and seed transactions succeeded and finalized; the seven
runtime code hashes match the manifest. Each pool started with 6 USDC and
6,000 mock tokens. The pools have no operator liquidity-withdrawal entry
point. The earlier gate-off deployment and its three seed-recovery receipts
are preserved in
[`manifest.autonomy.superseded.json`](../backend/contracts/monad-testnet/deployments/manifest.autonomy.superseded.json).
The [manual repeat guide](REPEAT_CONTROLLED_AUTONOMY.md) walks through local
gates, one Mera approval, operator price moves, receipt checks, and shutdown.
The [acceptance record](AUTONOMY_TESTNET_ACCEPTANCE.md) contains the finalized
three-cycle run and measured wallet outcome. The corrected factory enrollment
switch was turned off again after acceptance, along with the local autonomy
and operator-trade gates. Reopening enrollment requires an explicit local gate
change and an administrator transaction on the factory.
