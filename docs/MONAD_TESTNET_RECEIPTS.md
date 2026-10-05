# Monad Testnet live receipt matrix

All linked transactions were executed on chain `10143` on 2026-10-05 UTC.
They returned receipt status `0x1`. The finalized checkpoint exceeded every
receipt block at the final check. The owner is the Android KeePassDX Mera wallet
`0xbb66e7bc26d8a81c36a2f900d141a1fa786a98d8`.

## Wallet operations

| Operation | Receipt |
| --- | --- |
| Wrap 0.1 MON | [Wrap](https://testnet.monadexplorer.com/tx/0xa1227cb2585b174fa4801dfa7fade4f24d9d118b32a64c04be1e702712581b72) |
| Unwrap 0.01 WMON | [Unwrap](https://testnet.monadexplorer.com/tx/0xff8640e1a3e38e68ab85ff3fdea9178c68647130070df8fdda68417fb95bd9b7) |
| v4: 0.1 USDC → WMON | [Buy](https://testnet.monadexplorer.com/tx/0xbb8c4f3e854b81be1a5cc3eae925bf578a64bb3e430ea3c7808d417591e18b71) |
| v4: 0.005 WMON → USDC | [Sell](https://testnet.monadexplorer.com/tx/0xea70ac0b9623248a918882ee94fc781eee514c224de7b0779a1300e1d55be981) |
| Moeazi test AMM: 0.1 USDC → WMON | [Buy](https://testnet.monadexplorer.com/tx/0x8f6edcbdf81040e08f6c974c35d7bc64ac2f32a120f89b740e73641859c7c428) |
| Moeazi test AMM: 0.005 WMON → USDC | [Sell](https://testnet.monadexplorer.com/tx/0x3dd00e30b7982028b6cb26d89134dae3e42f0554aff3127b3303a0549ee48811) |

Each wallet trade followed a limited allowance for only the selected adapter
and amount: [v4 USDC](https://testnet.monadexplorer.com/tx/0x9d2224487832a3a17655c5d521611948ea9d543b62e6e2c4048e446bd96114fe),
[v4 WMON](https://testnet.monadexplorer.com/tx/0xe4c0f202fc99a1b1d40d17de5aa71d588f6c5eb1e06d6947716d102dfef46856),
[AMM USDC](https://testnet.monadexplorer.com/tx/0x554cdff77b68537851b97d110b51c1ae3cd7039f88998ccab7cf45f0b7bac199),
and [AMM WMON](https://testnet.monadexplorer.com/tx/0xd155cd381931e5d30fbf7027dba9aeea8e82c7bf79d493d946dab79d03e8b495).

## Owner-controlled vault

The Mera owner signed a USDC-input EIP-712 mandate, then separately authorized
it onchain. A limited allowance enabled a 1 USDC deposit. The operator bought
WMON on each venue. The owner revoked that mandate, signed and authorized a
new WMON-input mandate, and the operator sold 0.002 WMON on each venue. The
reverse mandate capped every order at 0.0025 WMON. The owner then stopped
trading and returned both assets. The final vault token balances were zero.

| Control or custody operation | Receipt |
| --- | --- |
| First mandate authorization | [Authorize](https://testnet.monadexplorer.com/tx/0x4c2eac3ce38e6aa73b988ef9dbf9125a6c2dcc658506df24610f7015c283872d) |
| Limited 1 USDC vault allowance | [Approval](https://testnet.monadexplorer.com/tx/0x6b52814f65a8e9ecf057467aa7e8cc50cd25850aad10714d0c434f6a36c12591) |
| Deposit 1 USDC | [Deposit](https://testnet.monadexplorer.com/tx/0x9fb4a1579469dd7f3415f1c01776eb41c1c00bd7c70d6deb77b889fbb4727789) |
| Revoke first mandate | [Revoke](https://testnet.monadexplorer.com/tx/0xb00347383ef4ff18dca58c1abc1eb28ff6ad9f459d770c0c834c3ae6efecd3bf) |
| Reverse mandate authorization | [Authorize](https://testnet.monadexplorer.com/tx/0x285083f7ca73e781ec2606f1bcf103067ae853469d2808adfcfba8612ca9f469) |
| Stop trading | [Stop](https://testnet.monadexplorer.com/tx/0x53d648bda5fea06f5dc0cb4a4540f03d862039ad9566fe995f5caa30f803ea10) |
| Return 0.842704 USDC | [Return](https://testnet.monadexplorer.com/tx/0xc665d0b8bb7a0316c7b9a6ec77ff54a8605ff1d6e73b2b848e75d963ef993f21) |
| Return 0.014993144613882601 WMON | [Return](https://testnet.monadexplorer.com/tx/0x85f308174c01467091d1c2befaebdedba41d5023b0198b922aa07854bc4eef90) |

| Operator-only swap | Receipt |
| --- | --- |
| Moeazi test AMM: 0.1 USDC → WMON | [Buy](https://testnet.monadexplorer.com/tx/0xc8e0e2c49782170907bcf88a89903fe57dd6e449e18b730e7ba192501fb52b29) |
| v4: 0.1 USDC → WMON | [Buy](https://testnet.monadexplorer.com/tx/0xa71de83812111083f00cc3b8be68d3cb0d6cb4029a91a0df6eee5c740507e117) |
| Moeazi test AMM: 0.002 WMON → USDC | [Sell](https://testnet.monadexplorer.com/tx/0x12003ac14797e8990eb2c7914a07a25125b4e5ff242dbd4022b8a0cd99a6ef6a) |
| v4: 0.002 WMON → USDC | [Sell](https://testnet.monadexplorer.com/tx/0x343dde5a91f34b631f08f63f0710567f86a64a07da13d24a93e8edb2fe105be3) |

The operator route verified the exact active mandate, pair, venue, quote,
caps, vault balance, operator signer, and unique order ID. Its finalized state
also required `executedOrder(orderId)` onchain. A post-stop quote returned
HTTP 409 `mandate_inactive`. The separate operator trade gate was reset to
`false` after testing. Manual Guard, Lite Mode, and live agent execution stayed
unchanged.

## Verification limits

- The focused Monad backend tests, 20 mobile Jest suites, seven Foundry tests
  in `--network monad` mode, and the live seeded-pool fork tests pass.
- Contract tests cover ownership, caps, expiry, revocation, slippage, replay,
  failed swaps, and both swap directions. API tests cover exact signed
  transactions, wrong chain, and operator-only vault preparation.
- The Android association URL returned 200. The Apple association URL returned
  503 because an Apple Team ID has not been supplied. iOS validation requires
  that ID, macOS, and Xcode.
- The full copied backend suite has unrelated baseline failures, led by the
  missing `backend/docs/agentic-system-research/FEATURE-REGISTRY.json`.
