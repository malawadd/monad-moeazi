# Monad Testnet acceptance record

This record tracks **chain ID 10143** checks for the Mera-owned mobile account.
Testnet assets have no cash value. A UI state or successful API response is not a
substitute for an onchain receipt.

## Network and assets

| Item | Address or value |
| --- | --- |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadexplorer.com` |
| Circle testnet USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| WMON | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |
| Community Uniswap v4 PoolManager | `0x451D64ab3b650040d2aE1886602b97ed6eDc643d` |
| Community Uniswap v4 StateView | `0xB639209539c61BaF67AC04876315786F8D0b153c` |

The v4 addresses are from Monad's [pinned community deployment](https://github.com/monad-developers/uniswap-v4-hooks-example/blob/c3cc78a88f10e5ba141cd6fb632f31db83c0daf8/shared-infrastructure.json).

## Verified faucet funding

The KeePassDX emulator's Mera address is
`0xbb66e7bc26d8a81c36a2f900d141a1fa786a98d8`. On 2026-10-05 UTC, the
official faucets funded it without a Google or social sign-in:

| Asset | Amount | Successful, finalized transaction |
| --- | ---: | --- |
| MON | 5 | [Monad faucet receipt](https://testnet.monadexplorer.com/tx/0x620db426522eed065ee6052f1b161b3d58338837bc7dd8353971b4b9fdbe60a7) |
| USDC | 20 | [Circle faucet receipt](https://testnet.monadexplorer.com/tx/0x2178b5a67945f4b55992afd498da76a9eaa1b6834ae39725c8ae2d9054477e91) |

The public RPC returned receipt status `0x1` for each transaction. Its finalized
block was beyond both receipt blocks when checked. The account balance then read
5 MON and 20 USDC.

## Verified wallet transfer

The Android app signed a reviewed 2 MON transfer from the Mera wallet to the
separate local testnet operator address
`0x3d6eBd40FC8Ed6fbdA3268785fcc047Dda05b801`. The API prepared chain
`10143`, showed the exact recipient and a `24150` gas limit with a maximum fee
of `0.0048783 MON`, verified the Mera signature, and broadcast the signed
transaction. [Receipt](https://testnet.monadexplorer.com/tx/0xca08a49a427901b38f7d33aebc3e33adccf913f5a0712c60135fa94cb7e8008d)
returned status `0x1`; the operator balance read exactly 2 MON afterward.

The same Android review flow sent 10 USDC to that operator. The prepared
transaction called Circle USDC at
`0x534b2f3A21130d7a60830c2Df862319e593943A3` with an encoded transfer
of `10000000` units to the exact operator address. The
[receipt](https://testnet.monadexplorer.com/tx/0x3a79526405b4abf24b30c3ac007f94c6dd364fe04a59f70111ebae16ee27a0a9)
returned status `0x1`, and its onchain `balanceOf` read 10 USDC for the operator.

The Mera wallet later sent another 2 MON to cover Monad's gas-limit charges:
[successful receipt](https://testnet.monadexplorer.com/tx/0xce4da97453da0ac90796ceb22e75d4b16c32ce976576fc31920fd3f034eef038).
The operator wrapped 1 MON into WMON with a
[successful receipt](https://testnet.monadexplorer.com/tx/0xb16b8c3faf896494a546c27c4b6829bcccd8fa1c26e167935bd5d9116ca14046).
The official faucets subsequently sent another
[5 MON](https://testnet.monadexplorer.com/tx/0x6c685adc84a7a733157191e6518dba182163abd215c486a6a7d9948b88134142)
and [20 USDC](https://testnet.monadexplorer.com/tx/0x9e448e14cdf0f8c73c894cb1fed47f4b70992c4b36890f4b06d668290fa1be9b)
directly to the separate operator. Both faucet receipts returned status `0x1`.

## Verified contracts and liquidity

The [verified testnet manifest](../backend/contracts/monad-testnet/deployments/manifest.testnet.json)
records chain `10143`, owner/executor, four deployed addresses, their onchain code
hashes, source hash, and all four successful deployment transaction hashes. A
separate RPC check required each receipt to be canonical and no higher than the
finalized block before the manifest was marked verified.

The operator seeded the Moeazi test AMM with 4 USDC and 0.4 WMON:
[USDC approval](https://testnet.monadexplorer.com/tx/0xe758b76c0167bb40264bbbcd60a8d5889971d5cf410445f5306eeec69ce4c985),
[WMON approval](https://testnet.monadexplorer.com/tx/0x3880972803c67c038152ce62680d079e0da14f655a961bf48a86537c9019bd28),
and [liquidity receipt](https://testnet.monadexplorer.com/tx/0xec2786672627f6df4b66e6e54120902cbe17874fbab5105750e37351393f781c).
Onchain reserves read exactly `4000000` USDC units and
`400000000000000000` WMON units.

The operator initialized and seeded the community no-hook Uniswap v4 pool with
an explicit initial price of 0.1 WMON per USDC, 4 USDC, and 0.4 WMON:
[USDC approval](https://testnet.monadexplorer.com/tx/0x6a9c11599f470d48bbbf64c9a902cc29f9e833ed17d4024fd373fd185f7a986c),
[WMON approval](https://testnet.monadexplorer.com/tx/0x7eafb6e139dd4137f2851c56f270edfc7293c5628d53602a11a8f66a5c1e2f0f),
and [pool initialization/liquidity receipt](https://testnet.monadexplorer.com/tx/0x298a08bc1b05e26ee2b24c57744c28ed2c885696983743d67065946bef63b465).
All six seed receipts returned status `0x1`; StateView returned nonzero
`sqrtPriceX96` and active liquidity. Direct onchain adapter quote calls returned
`available=true` and nonzero outputs for 0.1 USDC buy and 0.01 WMON sell on
**each** venue. The seeded-pool fork tests passed 2/2.

## Live transaction acceptance

The [live receipt matrix](MONAD_TESTNET_RECEIPTS.md) records Android Mera wallet
sends, wrap and unwrap, limited approvals, wallet buy and sell swaps on both
venues, two signed vault mandates, operator-only buy and sell trades on both
venues, owner stop, and return of both vault assets. Every listed receipt had
status `0x1` and was below the RPC finalized block when checked. Direct token
reads showed the vault ended with **0 USDC and 0 WMON**.

The Android Digital Asset Links URL returned HTTP 200 over the Cloudflare
hostname. The Apple association URL returned HTTP 503 because the local
environment has no Apple Team ID; iOS device validation also needs macOS and
Xcode. The full copied backend suite still fails in unrelated legacy tests,
chiefly because `backend/docs/agentic-system-research/FEATURE-REGISTRY.json`
is absent. The focused Monad tests, mobile suite, and Monad Foundry tests pass.

Foundry 1.8.4 is hash-verified in the ignored local tool directory
`backend/.data/foundry-v1.8.4/bin`; use its `forge.exe` with Monad execution mode
for contract tests. The system `forge` may still resolve to the older 1.7.1.
