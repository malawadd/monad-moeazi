# Agora AUSD faucet in Moeazi

Funding shows the Mera wallet's observed Monad Testnet AUSD balance and a
**Request Agora test AUSD** button. The button prepares a reviewed call to
Agora's Monad Testnet faucet. The wallet signs the exact transaction with Mera;
the wallet pays MON gas. The app then waits for a finalized receipt and checks
the AUSD `Transfer` log before reporting the amount in Activity. The button
does not require a browser or Agora account.

- Chain: Monad Testnet (`10143`)
- AUSD: `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`
- Faucet: `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`
- Call: `requestFunds(address)` with the authenticated Mera wallet as recipient
- [Agora Testnet token guide](https://docs.agora.finance/instant-settlement/guides/getting-testnet-tokens)

## x86_64 emulator acceptance, 2026-10-10

On `Moeazi_API_36`, the `x86_64` debug build displayed the observed AUSD
balance, prepared the fixed faucet call, and used the offline KeePassDX passkey
to sign. KeePassDX's local vault had to be unlocked first. The transaction was
`0x48585644a27786d57b7164fd64259267bf60c2010e3f733715c012558f852dae`.

The finalized receipt succeeded in block `69878396`. Its AUSD token log
transferred `10,000 AUSD` from the Agora faucet to the Mera wallet. The app's
Activity showed a finalized claim with that measured amount and hash; Home
changed from `9,999.869917` to `19,999.869917 AUSD`. The receipt recorded
`130,471` gas at `102 gwei`, or `0.013308042 MON` paid by the wallet. Monad
charged the transaction gas limit, so the review screen's maximum network fee
remains useful.

To repeat on the emulator: start the API, Convex and Metro as in
[`LOCAL_STACK.md`](../LOCAL_STACK.md), run `npm run android:preview`, unlock
KeePassDX's offline vault, open **Funding**, tap **Request Agora test AUSD**,
review, and tap **Sign and broadcast**. Enter the emulator PIN when KeePassDX
requests user verification. Confirm the final transfer in Activity and the new
balance on Home. The local test credentials are in [`AGENTS.md`](../AGENTS.md).

## Phone build after emulator acceptance

The signed `v1.2` release APK is
`android/app/build/outputs/apk/release/moeazi-monad-v1.2-arm.apk` (SHA-256
`7C863A1F2B70A62519B7228FC9B5405C8BA7C00E54BAB342A0FF0656352A25AB`).
It contains `arm64-v8a` and `armeabi-v7a`, uses the existing local signing
certificate, and points at `https://moeazi-monad.kiyan.finance`. The public
Android association endpoint returned 200 and listed that certificate at build
verification time. The phone flow itself remains to be checked after install.
