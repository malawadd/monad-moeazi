# Moeazi Monad Mobile

Moeazi's independent Monad mobile app. The current release uses Mera passkeys
for sign-in and provides a simple account screen; funding and trading wait for
the separate Monad migration.

This is a standalone bare React Native repository. Its copied backend lives in
`backend/`; it does not import or symlink source from the Arbitrum repositories.

## Implemented experience

- Mera passkey creation and sign-in with WebAuthn PRF-based wallet derivation
- One-time signed challenge, backend-issued per-device mobile sessions, and secure refresh storage
- Account screen showing the Mera-derived address and local sign-out
- Funding, trading, activation, notification registration, and legacy mobile chain routes paused during this auth-only phase

## Run the Android preview

This command is for the **x86_64 emulator only**. Its debug APK needs Metro and
cannot be installed on a normal ARM phone. For a standalone, phone-compatible
internal APK, use [Android phone builds](docs/ANDROID_BUILDS.md).

The Windows Android toolchain and a Pixel 6 emulator are installed on this machine. From this folder, run:

```powershell
npm install
npm run android:preview
```

The launcher starts the `Moeazi_API_36` emulator and Metro on port `8082`, establishes the ADB tunnel, and opens Moeazi Monad. It builds and installs only when no APK/app exists. UI edits use Fast Refresh, without rebuilding or reinstalling. After native dependency or build-configuration changes, run `npm run android:preview -- -Rebuild`. Close the emulator window when you are finished.

Passkey sign-in requires the API plus public HTTPS association files at
`moeazi-monad.kiyan.finance`. A passkey provider must support the WebAuthn PRF
extension, such as Google Password Manager or 1Password. See
[`LOCAL_STACK.md`](LOCAL_STACK.md) for the host and signing configuration.

Start the isolated stack from `backend/` with `npm run stack:start`; it serves
the copied Hono API on port `3102` and local Convex on ports `3310`/`3311`.
Android emulators call the API at `http://10.0.2.2:3102`. Physical phones need
a reachable HTTPS API URL in ignored `android/local.properties`.

For manual development, start Metro with `npm start`, run `C:\AndroidSdk\platform-tools\adb.exe reverse tcp:8082 tcp:8082`, then open Moeazi Monad. Debug builds use this local tunnel. Always use the current SDK ADB; the older `C:\adp\adb.exe` conflicts with it. Native changes can be installed with `npm run android -- --active-arch-only`.

Useful checks:

```sh
npm run typecheck
npm test
npm run lint
```

Installed local tooling includes Microsoft OpenJDK 17, Android SDK Platforms 30 and 36, Build Tools 35 and 36, NDK 27.1, CMake 3.22, platform-tools, the Android Emulator, and the API 36 Google APIs system image. `C:\AndroidSdk` is a no-space junction to the standard SDK location; it avoids a Windows CMake tool-name issue caused by the space in the Windows user profile path.

See [architecture](docs/ARCHITECTURE.md), [security and acceptance](docs/SECURITY_AND_ACCEPTANCE.md), and the [deferred Google Play Billing plan](docs/GOOGLE_PLAY_BILLING_RETURN.md).
The standalone stack, ports, and troubleshooting steps are documented in
[`LOCAL_STACK.md`](LOCAL_STACK.md) and [`backend/README.md`](backend/README.md).
