# Android builds and passkey testing

The `npm run android:preview` command builds the `x86_64` debug app for the
installed emulator. Debug builds expect Metro on port `8082`. For an internal
ARM phone APK, use `npm run android:phone`.

## Passkey host setup

Mera passkeys are bound to `moeazi-monad.kiyan.finance`. Before device testing,
forward that Cloudflare Tunnel hostname to `http://localhost:3102` and make
both HTTPS association paths public, with no redirect or access gate:

- `/.well-known/assetlinks.json`
- `/.well-known/apple-app-site-association`

Set `MERA_ANDROID_SHA256_CERT_FINGERPRINTS` in ignored `backend/.env.local` to
the comma-separated SHA-256 fingerprints for the signing certificates used by
your builds. For this checkout's debug key, run:

```powershell
powershell -File scripts/ensure-android-debug-keystore.ps1
keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android
```

Copy only the `SHA256` fingerprint to the ignored environment file. Add the
release signing fingerprint when one is available. Rerun local setup, restart
the Hono API, and confirm the HTTPS asset links response names package
`com.moeazi.monad.mobile` before opening the app. The debug keystore is private
local state and is ignored by Git.

Use `http://10.0.2.2:3102` as the emulator API base. For a physical device, set
`API_BASE_URL` in ignored `android/local.properties` to a reachable HTTPS API
URL. A passkey provider must support the WebAuthn PRF extension. Verify passkey
creation, sign-in with the same passkey, session restore after relaunch, and
sign-out. The API should reject challenge replay, altered signatures, expired
refresh credentials, and old Magic tokens.

## Moeazi_API_36 test credentials

For the local passkey flow, no Google account is required. KeePassDX uses an
offline test vault on the `Moeazi_API_36` emulator:

- KeePassDX vault password: `MoeaziTestVault2026`
- Android emulator screen-lock PIN: `648291`

These credentials are for this test emulator only. The KeePassDX vault and
passkey stay local; do not use these credentials in production.

## Build and install

1. Run `npm install` and `npm run android:phone` from the repository root.
2. Install `android/app/build/outputs/apk/release/app-release.apk` on a
   compatible `arm64-v8a` phone.
3. Confirm the package ID is `com.moeazi.monad.mobile` and exercise the Mera
   passkey flow against the local backend.

The phone build is an internal APK signed with this checkout's local debug
certificate. It is not a Play Store signing configuration. iOS passkey testing
requires macOS, Xcode, the Apple Team ID, and the configured
`webcredentials:moeazi-monad.kiyan.finance` association.
