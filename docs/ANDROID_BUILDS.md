# Android builds for emulator and phone

The APK produced by `npm run android:preview` is an `x86_64` **debug** build for
the installed emulator. It cannot install on most ARM phones, and debug builds
expect Metro on port 8082. Do not share
`android/app/build/outputs/apk/debug/app-debug.apk` as a phone build.

For an internal physical-phone APK:

1. In ignored `android/local.properties`, set `moeazi.apiBaseUrl` to the HTTPS
   address that the phone can reach and `moeazi.magicPublishableKey` to the
   project's publishable Magic key. `10.0.2.2` works only inside the Android
   emulator. Make sure the backend and its HTTPS tunnel are running and that
   this address responds from the phone before testing sign-in. The `MOEAZI_...` environment equivalents work if those properties
   are absent; properties take precedence. Never place provider, wallet, or
   service secrets in the APK.
2. Run `npm install` and `npm run android:phone` from this repository root.
   The script temporarily maps a free drive letter to keep React Native's C++
   object paths below the Windows path limit and releases it after the build.
3. Use `android/app/build/outputs/apk/release/app-release.apk`. This release
   variant bundles the JavaScript and includes `arm64-v8a` native libraries,
   so Metro is not needed on a compatible phone.
4. Inspect the package with
   `C:\AndroidSdk\build-tools\36.0.0\aapt.exe dump badging android\app\build\outputs\apk\release\app-release.apk`.
   Look for `arm64-v8a` in `native-code` and an Android `sdkVersion` supported by
   the device. Connect a phone with USB debugging and use
   `C:\AndroidSdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\release\app-release.apk`.
   Then verify Magic sign-in and an authenticated Home read on that phone.

This build targets 64-bit ARM phones. A 32-bit-only phone needs a separate
`armeabi-v7a` build after its ABI is confirmed; this APK does not claim to
support every Android device.

This is an **internal** APK signed with a private debug key generated inside
this checkout. `scripts/ensure-android-debug-keystore.ps1` creates it when
needed, and Git ignores it. It is not a Play Store release or a production
signing setup. It can update this checkout's emulator debug build only when
package ID and signing certificate match. Other independent checkouts have
different keys, so Android may require uninstalling that copy before switching
signatures; this does not affect other app IDs or installations.

The app's Android minimum is API 24. A device below Android 7.0, an unsupported
CPU, or a mismatched signing certificate can still reject an APK. If installation
fails, capture the exact `adb install -r` error plus `adb shell getprop
ro.product.cpu.abilist` and `adb shell getprop ro.build.version.sdk`. Installation
success alone does not establish Magic signing or trading readiness; check the
authenticated mobile journey against the backend separately.
