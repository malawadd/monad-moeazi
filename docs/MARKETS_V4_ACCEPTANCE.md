# Markets, v4 swaps, cache, and Manual Perpl: local acceptance

Checked 2026-10-11 on the Moeazi Monad local stack and `Moeazi_API_36` x86 emulator.
This is Testnet evidence; it is not a claim that another installation inherits local gates.

## Shipped behavior

- Markets always includes the verified `WMON_USDC` Uniswap v4 Pool ID
  `0x5e65fc6c6777578390f275a30690331f2f3bd3a51bf63fdaeaaea7087ed836b7`,
  even when its wallet route is unavailable. Other USDC/WMON pools are discovered
  from the Monad-maintained PoolManager's `Initialize` events and need operator
  verification to receive the verified badge. Hook pools remain read only.
- A pasted token address or Pool ID searches the indexed pools. While historical
  indexing is incomplete, a miss says that discovery is still catching up.
- No-hook wallet swaps bind the exact Pool ID and PoolKey, token pair, amount,
  minimum output, owner, chain `10143`, gas cap, and expiry. Unverified pools
  require an explicit warning at review. Each trade obtains a fresh quote.
- Charts expose price and time axes and a tap/drag candle readout. Missing spot
  history is labeled instead of synthesized.
- The owner-scoped query cache uses directory 30s, snapshot/book 10s, candles
  60s, account/history 15s. Concurrent identical reads are deduplicated;
  finalized operations invalidate affected owner data. Quotes for signing are
  outside this cache.
- The console controls one global Manual Perpl Testnet gate. Its persisted local
  state is enabled; the panel reports RPC, factory, exchange, and dependency
  readiness. It has no user selector or trading controls. Every user still
  prepares and signs manual account changes and orders with their own Mera key.

## Finalized onchain acceptance

Wallet `0xbb66e7bc26d8a81c36a2f900d141a1fa786a98d8` used offline KeePassDX
on the x86 emulator. All four receipts had status `0x1` and were thousands of
blocks behind the checked head `69948350`.

| Action | Transaction | Block | Measured result |
| --- | --- | ---: | --- |
| Approve exact 0.1 USDC | `0x3358f95de83b336fe6b5e875d9235fe88acf545185f5ff59129ed53b2c77b88d` | 69944780 | Exact adapter allowance; 100790 gas used |
| Buy WMON with 0.1 USDC | `0x5230136c8e11aa0689734d829f2f3dc102505f0461f85f824fae127c7d58cad9` | 69945436 | 0.009158620888991676 WMON delivered; 422814 gas used |
| Approve exact 0.005 WMON | `0xe4ae1cb1e599a7e91f7f041114cc8e559167560e6cd107eac3836429995504d0` | 69946082 | Exact adapter allowance; 60604 gas used |
| Sell 0.005 WMON | `0xff5f5853b8fc6ee609e281a0ab954624b2c49dcdd81600714221674c74895e4c` | 69946529 | 0.054856 USDC delivered; 421577 gas used |

The adapter deployment is recorded in
`backend/contracts/monad-testnet/deployments/manifest.v4-dynamic.testnet.json`.
The buy and sell were small functional checks, not a profitability test.

## Checks and limits

- Mobile TypeScript and backend TypeScript passed. Focused Jest suites passed
  18/18 chart, cache, market presentation, and swap validation cases. Backend
  v4 identity tests passed 2/2; Manual Perpl gate tests passed 3/3; console
  security tests passed 11/11. Foundry dynamic adapter tests passed 2/2 in
  Monad mode.
- Cache test count: opening and reopening the same market inside its 10-second
  snapshot window made **one** snapshot API call; opening for a different owner
  made a second call. Concurrent same-owner lookup requests made **one** call.
  These counts are from focused automated tests, not an Android network trace.
- The Manual Perpl status endpoint reported gate `effectiveEnabled: true`,
  chain `10143`, eight open Perpl markets, and no account/order preparation or
  broadcast blockers. The console was restarted and served its new panel.
- After the Metro connection recovered, the KeePassDX x86 emulator displayed
  the BTC market chart with visible time and price axes. Touching the chart
  changed the selected candle price. From that market, the same Mera owner
  reached a fresh manual-account creation review showing the exact predicted
  account, owner, chain, venue, operation ID, and expiry; no signing or account
  creation was performed for this UI check.
- The public Testnet RPC accepts only 100-block `eth_getLogs` ranges. The index
  is advancing in bounded concurrent batches and reports `indexing`; at the
  last check it had scanned through block `61906609` of `69949519`. Only the
  seeded pool was yet present, so an additional discovered no-hook pool could
  not be selected for a funded buy/sell. This acceptance check remains open.
- The emulator completed the KeePassDX buy/sell flow. A later debug reload
  briefly stalled on Metro's loading screen after its transform cache was
  reset, then recovered for the chart and manual-account checks above. The
  ARM release APK bundles JavaScript and does not use Metro.

The installable phone artifact is
`android/app/build/outputs/apk/release/moeazi-monad-v1.4-arm.apk`.
Its SHA-256 is
`86FB8273CD1CEBF1B4170E7AD759B69B0AB34B54825340EB60662AA138D946B4`.
It uses this checkout's local debug signing key for internal installation.
