# Controlled autonomy acceptance on Monad Testnet

Network: Monad Testnet, chain ID `10143`. All amounts below are test assets.
The deployment inventory and all 16 receipt hashes are in
[`manifest.autonomy.testnet.json`](../backend/contracts/monad-testnet/deployments/manifest.autonomy.testnet.json).

## Deployment and custody

- Corrected factory: `0x75C18E5c80814ed117d26bD0cA223f11737852Fb`.
- Factory deployment: `0x87fac2be175f0cb2727b7eb9eeb5e60215da976fd34893b8ed7117823bc51054`.
- All 16 corrected deployment/seed receipts finalized successfully. Seven runtime
  code hashes matched the manifest. Initial reserves in each pool were 6 USDC
  and 6,000 of its mock token.
- The corrected pools rejected both `removeLiquidity(uint256,uint256)` and
  `withdraw(address,uint256)` read-only calls from the operator. Foundry Monad
  mode passed 24/24 tests, including owner withdrawal rejection and the
  three-cycle/expiry/atomic-funding cases.
- The earlier, unused pools and factory are preserved in
  [`manifest.autonomy.superseded.json`](../backend/contracts/monad-testnet/deployments/manifest.autonomy.superseded.json).
  Their factory was never opened. Their 18 USDC seed was recovered in three
  finalized transactions; all three old pool reserves are now zero.

## Local integration checks

- Android debug APK built and launched on the `Moeazi_API_36` emulator with
  KeePassDX. Existing Mera session displayed the account and testnet balances.
- Mobile autonomy status/history loaded from Hono and local Convex. The setup
  screen exposes only USDC amount and duration.
- Read-only operator pool API returned all three symbols and finalized block
  data. Private pool calls without the bridge, worker calls without the secret,
  and Magic-shaped bearer credentials returned `401`.
- Gate-off price moves and scenarios returned `503 autonomy_disabled`.
- Mobile typecheck passed; 21 Jest suites and 88 tests passed. Hono TypeScript
  build and 14 focused autonomy backend tests passed. The local Convex schema
  and actions deployed successfully.

## Live run measurements

One KeePassDX passkey session approved a Circle transfer authorization and
strategy mandate for **1 USDC**, **10 minutes**, and all three eligible pairs.
Run `3c97a842-5f06-4f1b-ab5b-ad4bc4b0c647` created the isolated vault
`0xC2AcF4aCcf9403F72366F1203f76410e14b5f8A8`. Atomic funding finalized
in block `68803788`, transaction
`0x439ef944f1dceb6496199e42fee066c737a35d1b188a04d9f55b05a41eb7d4f4`.
The wallet held 9.750085 USDC before enrollment and 8.750085 after funding.

| Cycle | Funded scenario move | Vault buy | Vault sale | Realized USDC |
| --- | --- | --- | --- | ---: |
| 1, MZG, rise then flat exit | `0x5ecf374412aae3991bd55f7e158810a15a1c9a3eb4759128c8e0231b577a0ef5`; post-buy rise `0x3a381a46d9681eaea0f785c6ea2fa15b7ff192d6c71e3fdd6c1d88e6fff177cb` | `0x9e3372d12fe7dda41d6756bbd6dddb3b56fc47ae9288fd6b888aee097d8378a3` | `0xd90257e0d00bef21668f81d63d061939fab015e2ee4188924c2605e29b4d12c3` | +0.126804 |
| 2, MZA, drawdown exit | `0x840bdd107777310085b72b6f301565ad8d7fd74d9ecaf00f73e9d07b8c227a9e`; post-buy fall `0x918f6792842b1e7eea2692a18de1562e21bc34e295056962ef5da2f37b64f2cb` | `0xee6ea8cb47ade08332bb01be8c3c5db5eb4bd5dc68bb9569c8cf7f03a050bf2b` | `0x24c843c6fb4ab2e0ba24de536c5bc283c67d19bee8066d9168da696b38d8cd04` | −0.040590 |
| 3, MZB, expiry sale | `0x6041c9748b343902fc8f195f8907b5646e8fe48f1d6b7cbe32ff450fc10ce6df` | `0x061ab60734e40d46497de697538ccbc0bcb8a469fe76abfa44196cdfbd8c1432` | `0xa3b47a2530162566d0fb9b7950c5dbc642bf8399fe8f161a7b515578d4c46709` | −0.005152 |

The third sale and settlement occurred in the same finalized transaction,
block `68805928`. The vault emitted `AssetReturned` for 1.081062 USDC and
`Settled` with three cycles and no unsold tokens. Its USDC balance is zero,
and a read-only post-settlement buy call reverted. The wallet ended at
**9.831147 USDC**, a measured **+0.081062 USDC** over its pre-run balance.
The user spent zero MON; the seven vault transactions consumed
**0.601574478 MON** from the operator, reported separately from USDC profit.
Android history now shows `Completed`, `3 of 3`, and `+0.081062 USDC`.

The first mobile preparation failed a backend gas-limit check before any
funding broadcast. A fresh approval completed after the atomic-funding gas
ceiling was corrected. Its old prepared row remains in local history with
no funds moved. The final sale was initially stored as an uncertain order;
terminal receipt reconciliation repaired the local summary from +0.086214 to
+0.081062 USDC using the finalized receipt. No second sale was broadcast.

An operator move requesting 10 USDC when operator inventory was 3.236852 USDC
returned `409 operator_inventory_insufficient` before order creation and had
**no transaction hash or fill**. A separate live zero-liquidity pool was not
created; failed-liquidity behavior is covered by the Foundry contract tests.

After acceptance, the operator disabled factory enrollment onchain in finalized
transaction `0xeaf09ee68393fc2d465d087f8202f47565b8d67ad1637d52402dbe0951892bae`
(block `68807825`). The local autonomy and operator-trade gates were set back to
`false`; a price-move request then returned `503 autonomy_disabled`. The local
action and broadcast gates remain enabled for reviewed manual testnet wallet
operations. Repeating terminal receipt reconciliation returned the same
1.081062 USDC and +0.081062 USDC values without another broadcast; a request
without the private worker secret returned `401`.

The broad copied-backend suite remains red outside this feature: legacy agent
tests expect `backend/docs/agentic-system-research/FEATURE-REGISTRY.json`, which
is absent from this independent workspace, and an older stage-one runtime
assertion also fails. The focused autonomy tests, mobile suite, TypeScript
checks, and Monad-mode Foundry suite pass.
