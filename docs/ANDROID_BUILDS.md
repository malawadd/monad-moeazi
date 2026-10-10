# Android builds and passkey testing

The `npm run android:preview` command builds the `x86_64` debug app for the
installed emulator. Debug builds expect Metro on port `8082`. For an internal
ARM phone APK, use `npm run android:phone`.

## Passkey host setup

Mera passkeys are bound to `moeazi-monad.kiyan.finance`. For Android passkey
testing, forward that Cloudflare Tunnel hostname to `http://localhost:3102` and
make this HTTPS association path public, with no redirect or access gate:

- `/.well-known/assetlinks.json`

iOS passkey testing also requires the Apple association path:

- `/.well-known/apple-app-site-association`

The Android manifest declares Credential Manager's `asset_statements` resource,
which includes the HTTPS `assetlinks.json` URL above. The Android association
file is required for Android passkey testing; the Apple association file is an
iOS-only requirement and does not block Android APK testing.

The Android `assetlinks.json` must declare two targets: the same HTTPS site
(`https://moeazi-monad.kiyan.finance`) and the Android app. Each target must
include both
`delegate_permission/common.handle_all_urls` and
`delegate_permission/common.get_login_creds` for Google Password Manager's
passkey association checks. Google's [FIDO2 Android guide](https://developers.google.com/identity/fido/android/native-apps)
shows both targets and says to keep both relations while its validation logic
is migrating. Google's [credential-sharing
codelab](https://codelabs.developers.google.com/seamless-credential-sharing)
also says Google Password Manager app-to-web credential sharing requires an app
published on Google Play. Native passkey creation with this locally signed APK
still needs physical-device confirmation; this setup does not establish
cross-surface credential sharing.

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

Use `http://10.0.2.2:3102` as the emulator API base. The phone build uses
`https://moeazi-monad.kiyan.finance` and passes it to Gradle as a project
property, so the emulator's ignored `android/local.properties` stays unchanged.
To use a different phone-reachable HTTPS API, run
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android-phone.ps1 -ApiBaseUrl https://your-host.example`.
A passkey provider must support the WebAuthn PRF extension. Verify passkey
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

`npm run android:phone` builds the release APK for `arm64-v8a` and
`armeabi-v7a`. It embeds the JavaScript bundle, so a phone does not need Metro
running. The script signs with this checkout's existing ignored
`android/app/debug.keystore`; keeping that file preserves the stable local
certificate used by the Android asset link.

The build keeps Gradle's `app-release.apk` output and also writes a versioned
copy named `moeazi-monad-v<versionName>-arm.apk`. It preserves existing versioned
files and stops if a rebuild would change bytes under an existing version name;
bump `versionName` in `android/app/build.gradle` for a new artifact. The current
v1.2 APK is `android/app/build/outputs/apk/release/moeazi-monad-v1.2-arm.apk`.

Install the versioned APK with:

```powershell
adb install -r android/app/build/outputs/apk/release/moeazi-monad-v1.2-arm.apk
```

For later builds, use the versioned filename printed by the build script.
Confirm the package ID is `com.moeazi.monad.mobile` and exercise the Mera
passkey flow against the public HTTPS API.

The phone build is an internal APK signed with this checkout's local debug
certificate. It is not a Play Store signing configuration. iOS passkey testing
requires macOS, Xcode, the Apple Team ID, and the configured
`webcredentials:moeazi-monad.kiyan.finance` association.
