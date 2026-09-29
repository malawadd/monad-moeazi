# Moeazi Monad Mobile

Beginner-first Android client for Moeazi: sign in, add funds, obtain credits, start the AI trader, and watch or stop it.

This is a standalone bare React Native repository. Its copied backend lives in
`backend/`; it does not import or symlink source from the Arbitrum repositories.

## Implemented experience

- Five tabs: Home, Markets, Agent, Activity, Account
- Welcome/Magic sign-in, Funding, credit packs, market detail, manual trade review, settings, activity detail, Autopilot confirmation, and Safety flows
- Compact USDC withdrawal entry, permissionless Android QR scanning, full transaction review, device-security confirmation, Magic broadcast, and reconciled status
- Minimal server-projected Home states
- Calm-tactile hierarchy with typography-only tabs, reduced-motion-aware transitions, and platform haptics
- Explicit loading, stale, empty, success, retry, and interrupted-confirmation states
- Magic wallet and Universal Account adapter boundaries
- Encrypted refresh-token storage and a local biometric/device-credential gate
- Unconfigured billing and push abstractions that cannot grant credits or send externally
- Local preview mode clearly isolated from real state
- Modular total-budget fiat-to-USDC estimates with collapsed fees, explicit sandbox labels, and checkout-only fallback; live quote calls are server-gated

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

The preview uses local fixtures, so it works without connecting Magic, a backend, funds, or any paid service. Choose **Explore the preview** on the welcome screen. Real sign-in and live account data require the three runtime values described in `docs/ARCHITECTURE.md`.

Start the isolated stack from `backend/` with `npm run stack:start`; it serves the copied Hono mobile API on port `3102` and local Convex on ports `3310`/`3311`. The setup script writes the emulator API URL and reused Magic publishable key to ignored `android/local.properties`. Android reaches the Windows host through `10.0.2.2`. A physical phone needs a reachable HTTPS URL configured in its ignored local properties.

In a development build, Account includes **Verify Magic signer**. It performs a biometric-gated, non-broadcast EIP-712 and root-hash proof. It never requests EIP-7702 authorization, submits a trade, or moves funds.

Home may display one optional server-owned AI update. Preview mode labels this line as preview data; authenticated mode never derives or invents it on the phone.

For manual development, start Metro with `npm start`, run `C:\AndroidSdk\platform-tools\adb.exe reverse tcp:8082 tcp:8082`, then open Moeazi Monad. Debug builds use this local tunnel. Always use the current SDK ADB; the older `C:\adp\adb.exe` conflicts with it. Native changes can be installed with `npm run android -- --active-arch-only`.

The withdrawal scanner uses Google Play services and requests no app-level camera permission. Adding the native scanner requires one Android rebuild; TypeScript and styling changes after that use Metro Fast Refresh. Preview mode uses a fake withdrawal preparation and never opens Magic or broadcasts. Mainnet withdrawal preparation can be rolled back server-side with `MOBILE_WALLET_WITHDRAWALS_ENABLED=false` in the Convex environment.

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
