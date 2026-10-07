# Mock Perp autonomy: Monad Testnet acceptance

Recorded 7 October 2026 on chain `10143`. These are actual finalized Monad
Testnet transactions against the mock clearinghouse, Circle testnet USDC, and
funded MZA/MZB/MZG reference pools. No Perpl account or order was used.

## Deployment and enrollment

The verified deployment manifest is
[`manifest.perp.testnet.json`](../backend/contracts/monad-testnet/deployments/manifest.perp.testnet.json).
Factory `0x960B3F45386903C830f65EBC2784992D40E72802` was deployed in
[`0xd2d2c8…b597a5`](https://testnet.monadexplorer.com/tx/0xd2d2c8388de9fc0892484cc23b3446e3b22aaaf02a8697a95fd0475248b597a5),
and clearinghouse `0xf4733b06e5359b324af00f27bA3066657A8684F8` in
[`0xa25695…b69`](https://testnet.monadexplorer.com/tx/0xa2569531f691faa3970139fb475a223933e6d7a6e162aa8df9da61d0c1d6fb69).
The operator initially deposited 1 USDC as reserve.

On the `Moeazi_API_36` emulator, KeePassDX supplied the Mera passkey in one
session for Circle's exact transfer authorization and the version 1 Perp
mandate. Run `a3962ea7-4118-4a03-804d-1e061f76f117` funded its isolated
vault `0xCeCc108b4c20AC869535CC8863EFFC8E557e0e8b` with **0.100000 USDC**
in finalized [atomic funding transaction](https://testnet.monadexplorer.com/tx/0x4a2d7326031b7a8e1281412d1f489cab65b3061c2e19176de33425a8be45e169).
The owner's wallet decreased from 9.831147 to 9.731147 USDC. No mock token
was delivered to the wallet. The first preparation expired during a local
executor repair; its [reverted transaction](https://testnet.monadexplorer.com/tx/0x039c9571b1c93a978d14d5f9dc60457243a01ffa8f9a8c7a0f7fadbef5b4b3fd)
had receipt status 0 and moved no user USDC. A fresh Mera approval funded the
successful run.

## Finalized scenario matrix

Every linked transaction below has a status-1 finalized receipt. Funded price
moves were actual pool swaps, not injected prices. Multiple open/close cycles
occurred under the same mandate, without another user prompt.

| Check | Actual result | Representative hashes |
| --- | --- | --- |
| Profitable MZA long | 2× on 0.020000 USDC margin; +0.001319 USDC | [entry](https://testnet.monadexplorer.com/tx/0xc357b87a2334c12c873b6a2422084280cd1dc12048e5488e41da961182d4d538), [close](https://testnet.monadexplorer.com/tx/0x1fba4b71d761463ba32077c57e036f440524135bdba2bcad06879df3e56bef0c), [pool move](https://testnet.monadexplorer.com/tx/0x16791976f8ab157ec4c7b985c5356cf8e9ed2be61d90ab3e735a288621b9bd0f) |
| Profitable MZB short | 2× on 0.020000 margin; +0.001298 USDC | [entry](https://testnet.monadexplorer.com/tx/0x1b092ac3a7462969c12d147197ab57a0173b44a42e64f72e314810b76c43d50e), [close](https://testnet.monadexplorer.com/tx/0xc4f6c25d879d1ae892d72abc61c078d1958cace5a5e94e84d302768faee07b1a), [pool move](https://testnet.monadexplorer.com/tx/0xa3fe254570f2c0e5723cebba214b811bed139cdfff62c77e551454453eb42b40) |
| Flat hold, margin and size | Increased size, added and removed isolated margin, partially closed, held four ticks, accrued funding, closed flat; net 0 USDC | [increase](https://testnet.monadexplorer.com/tx/0x02f5af04215da4df7475dc63e683eccd01161f48b3f422fb7b106945dac73ef0), [partial close](https://testnet.monadexplorer.com/tx/0x47ed99dc65d0d0fed927d9782cc9e201624e6b11993851a60c6bb738b265950d), [funding](https://testnet.monadexplorer.com/tx/0x32562d1ca0855a695ddcce14f6eeba4df7b739957e3758243fbd216e5da5299d) |
| Limit amend and cancel | Pending limit, amended price, cancelled; no position fill | [place](https://testnet.monadexplorer.com/tx/0x86bc9b4b0f54797def5834e7e3b9e90fc91d39fb7e469d9204d5e36963671e8c), [amend](https://testnet.monadexplorer.com/tx/0xafc1c7075a162b90b09f450c544085ac667c016ebac435aa4482d718a7a29f03), [cancel](https://testnet.monadexplorer.com/tx/0x4d390d8982b4942f9d5720360d3d5a74eefcaecf887de6151e1b6c441d60583f) |
| Limit fill | Funded price move brought MZA through the limit, then a funded reversal and close produced +0.001320 USDC | [place](https://testnet.monadexplorer.com/tx/0x009e263cdc17061a74764b7916df492a466ed59acc9f26e52c9eec547acaeaad), [fill](https://testnet.monadexplorer.com/tx/0xa1091c54880c611e62e2c4d9dea2b1a20c67b3d6655f101f9c1fe6f03679b2b5), [close](https://testnet.monadexplorer.com/tx/0xf9e9c9e1cfb4f920886536c39deae8f8396603b992b7cdf7ec16f61fa4a49ff7) |
| Adverse stop | MZB long hit linked stop after a funded fall; −0.001277 USDC | [triggers](https://testnet.monadexplorer.com/tx/0x519762a49c14e9a533d39aadf65dd3c34f3ea1b1d664706e8a3c4d3c3b255a74), [stop execution](https://testnet.monadexplorer.com/tx/0x2d2d614c696b48e12fe2d8bafea280e1b93d258dc7f062125678b51c4784ea56) |
| Liquidation | 10× MZB long on 0.010000 margin. Raw mark loss was 0.011734, but user loss was capped at posted 0.010000 USDC | [entry](https://testnet.monadexplorer.com/tx/0x4b9c50aa378c2080606cb78b788d0654fe350a5c0df35740760364be71b28df2), [liquidation](https://testnet.monadexplorer.com/tx/0xef92a93940f254bd44bc05a4728a5a98b1e978969d547197d3363f1723855d29) |
| Insufficient reserve | Entry blocked with `operator_reserve_insufficient`; **no order hash and no fill** | Operator temporarily withdrew only uncommitted reserve in [withdrawal](https://testnet.monadexplorer.com/tx/0x185d057ab16fc57742da1396d59eaa3457d7d903907e4d591e08bf6ca960f2d5) and restored it in [deposit](https://testnet.monadexplorer.com/tx/0xe9c086a0a899c84b81c40ec685b23e24de3443d4811902d9270edf2169ff2ddd) |
| Unscripted rule and owner stop | Finalized MZG rise triggered an unattended 2× long and trigger settings; owner later signed a fresh Mera stop and funds returned | [funded move](https://testnet.monadexplorer.com/tx/0xfed35f9072ed70b9a4da09fa2c2a1a07568f2222d76de3a5b4255cf0b86f852a), [entry](https://testnet.monadexplorer.com/tx/0x2621b62ea868a0be92dfb5a48a9746d957fa1a60da7ebf05db10ad2855b79bd5), [stop](https://testnet.monadexplorer.com/tx/0xdcbd602072e5a6f79834b8077c5b76d56d9c74e3d724f9070bb1bf2e0284d389) |
| Flat duration expiry | A second 0.100000 USDC run held without a position for 10 minutes, then returned all 0.100000 USDC; realized PnL 0 | [atomic funding](https://testnet.monadexplorer.com/tx/0x471f3307d069246421a0f3c977158785f8f0ab0c58146d7117fe01b668143791), [expiry settlement](https://testnet.monadexplorer.com/tx/0xa2649b71362b88c5cf4b0da34848e7642ecc3f269c28550c7f2f8f31e61f7b9c) |

An earlier MZB pool swap returned an uncertain RPC response after broadcast.
Its original [hash](https://testnet.monadexplorer.com/tx/0xaba5a60845deaae605d5217ea8360a659d2f2816813c80f20180d58507f1bd0e)
was reconciled to a status-1 finalized receipt without another swap. The
scenario was marked blocked during that transient response and was not
reported as a completed trade. The executor now retries persisted price moves
by their existing hash.

## Funds, reserve, and gas

The first vault returned **0.092660 USDC** to the Mera wallet at owner stop.
The wallet ended at **9.823807 USDC**, compared with **9.831147 USDC** before
enrollment: a realized user loss of **0.007340 USDC** across all scenarios.
The raw `PositionClosed` mark loss on liquidation exceeds the user's posted
margin, so run PnL is computed from finalized returned collateral. The
clearinghouse operator reserve ended at **1.007340 USDC**, with **0 committed**;
it began at 1.000000 USDC. The operator's receipt-verified vault gas was
**1.326258672 MON**. Funded pool move approvals and swaps added
**0.266194194 MON**. Reserve management and deployment gas are separate and
are not counted as user trading PnL. The user paid no MON gas.

The Android Perp status and Activity pages showed submitted, executed, and
finalized orders, holds, position changes, stop, hashes, and returned funds.
The KeePassDX passkey was needed for enrollment and owner stop, not routine
orders. Android test credentials remain only in local `AGENTS.md` for this
test emulator.

The second run `9ed90e82-8b8b-49db-825f-7d00a0156f1a` used vault
`0xE3E7729a3342E932EE599620536A345344c826b5`. Its local stack and worker
were restarted while the run was active. The same persisted run resumed with
0.100000 USDC available, no position, and no duplicate funding. The expiry
transaction first had an uncertain RPC response, then reconciled by its
original hash to a status-1 finalized receipt. The vault now holds 0 USDC;
the owner wallet is back at **9.823807 USDC**. Operator-paid vault gas for
this second run was **0.494436126 MON**. Perp history on Android shows
`Expired`, `Returned to Mera: 0.1 USDC`, and the gas separately.

## Verification

- Foundry v1.8.4 `forge test --network monad --match-path 'test/perp/*'`:
  **23 passed**. Covers atomic funding, replay, isolation, payout and reserve
  caps, long/short PnL, repeated cycles, limit orders, triggers, margin,
  funding, liquidation, expiry, stop, and stale quotes.
- Backend focused Perp tests: **17 passed**. Covers decisions, restart and
  duplicate-tick recovery, stale quotes, finalized failures, gates, scenario
  progression, and economic PnL.
- Backend TypeScript build passed. Mobile TypeScript passed; **93 Jest tests
  passed** across 22 suites.
- A Magic-shaped bearer token received HTTP 401 from both the Perp current
  and prepare routes. Wrong-chain mandates are rejected in Foundry and the
  API requires chain `10143` on preparation, enrollment, and stop.

The local full backend suite includes unrelated pre-existing failures in
`stage1Runtime` from a missing `backend/docs/agentic-system-research/FEATURE-REGISTRY.json`;
the focused Perp suite and build passed. The local iOS passkey path remains
unvalidated without an Apple Team ID and macOS device build.

After both runs settled, onchain enrollment was disabled in finalized
[gate transaction](https://testnet.monadexplorer.com/tx/0x8829846bb861dc912b44546059b78b398ef655559f74569414bcbe80624b2546).
The ignored local action, broadcast, operator-trade, and Perp-autonomy gates
were reset to `false` and the scoped stack was restarted. Live status then
reported all four gates off and no reserve committed. A bridge request to
create another scenario returned HTTP 503 `testnet_actions_disabled`.
