# Phone test preflight observations — 2026-10-10

The entries below were moved intact from the live log when it approached the workspace line limit.

## Append-only observations

### Preflight — 2026-10-10 15:06 UTC

- Local Hono health: HTTP 200; public HTTPS Hono and Android association paths:
  HTTP 200. Cloudflared service: running, automatic startup.
- Local Convex deployed the cross-owner direct-run inventory and indexes. The
  first snapshot returned two older completed v2 runs, zero active phone runs.
  One completed run had two finalized profitable cycles and a finalized AUSD
  return; it is historical evidence, not a result of this phone test.
- Seven Testnet gates: enabled. Three enrollment factories: open, with finalized
  switch receipts: Perpl `0xebdbebedd052fd20c3cb08e50bf2b6b827352514c8c9c173b532855b699cae42`,
  mock Spot `0x91eb26b0840ee9212611b0a9387ea52aaf3ee2ef901b80817624fb704f7565b2`,
  mock Perp `0x89577695a38d790d14b617edab2fc6a32742eb0d20878620d26d12dbc5818506`.
- Mainnet and live-agent execution: off. Manual Guard and Lite Mode: retained.
- Phone test window and owner labels: pending installation and enrollment.

### Monitor query repair — 2026-10-10 15:25 UTC

- The compact snapshot now separates persisted five-minute scanner events from
  one-minute optimizer decision events. The prior report could hide real scans
  behind frequent hold or exit decisions. A dedicated local Convex index and
  query were deployed; read-only verification returned the three actual
  historical scan phases (`no_proposal`, `proposed`, `no_proposal`) for the
  completed v2 run. No trade state or phone run was changed.

### Android APK preflight — 2026-10-10 15:27 UTC

- Internal release APK: `android/app/build/outputs/apk/release/app-release.apk`,
  40,592,222 bytes, SHA-256
  `F6A1F953D5190F963D6798BD13CFBF922704D73900C3A90AF74EEEFEC836A690`.
- Package `com.moeazi.monad.mobile`; contains `arm64-v8a` and `armeabi-v7a`;
  embeds the public HTTPS API URL and v3 duration-soak review. The APK signing
  fingerprint matches the public Android asset links response.
- A non-streaming `adb install -r` succeeded on the local x86_64 emulator, but
  launch selected x86_64 and could not load `libreactnative.so` from this
  ARM-only APK. This emulator cannot validate the phone build. Physical ARM
  installation and Mera enrollment have not yet been observed.
- The matching x86_64 debug APK was restored with `adb install --no-streaming
  -r` and launched successfully. No emulator app or KeePassDX data was cleared.

### Physical phone passkey creation repair — 2026-10-10 15:39 UTC

- The first ARM APK reached the Mera **Create passkey** step on a new Android
  phone using Google Password Manager, then reported an app-association failure.
  The phone's model and Android version were not supplied. No phone enrollment
  or two-hour trading run has been confirmed.
- The public Android `assetlinks.json` returned HTTP 200 and
  `application/json` with the package and signing fingerprint above. Google's
  Digital Asset Links statement lookup also returned the credential-sharing
  relation. APK inspection found a missing `asset_statements` manifest entry;
  an initial resource build further showed that Android had removed unescaped
  JSON quotes, producing invalid embedded JSON.
- Rebuilt the internal ARM APK as versionCode `2`, versionName `1.1`, with the
  manifest entry and a compiled, parseable JSON `asset_statements` resource.
  The new APK remains signed by the same local certificate and contains both
  `arm64-v8a` and `armeabi-v7a`. It also reports the provider's native failure
  reason instead of treating every passkey failure as an association error.
- Replacement artifact: `android/app/build/outputs/apk/release/app-release.apk`,
  40,594,170 bytes, SHA-256
  `D181F8D7A405FCEAD90173927AFB616338A6615CE1AE59C793436E1DD939B161`.
  Physical Google Password Manager creation and sign-in remain **pending a retry
  with this version**. The offline KeePassDX emulator setup was not changed.
- The local x86_64 emulator still has KeePassDX installed and launches the
  existing Moeazi debug app. The ARM phone APK was not installed over its debug
  build; no Google account or provider was added to the emulator.

### Android RP ID validation follow-up — 2026-10-10 15:52 UTC

- The user retried **Create passkey** on the new phone with the only release
  artifact they had, `app-release.apk`, and Google Password Manager reported
  “RP ID cannot be validated.” The phone model and Android version remain
  unknown. The versioned v1.1 APK is byte-identical to that release artifact
  (SHA-256 `D181F8D7A405FCEAD90173927AFB616338A6615CE1AE59C793436E1DD939B161`).
- The native request uses `rp.id = moeazi-monad.kiyan.finance` and Android
  Credential Manager. Google's native FIDO2 association guide says to publish
  both `delegate_permission/common.handle_all_urls` and
  `delegate_permission/common.get_login_creds` while its validation logic is
  migrating. The live route previously returned only `get_login_creds`; it now
  returns both, with the existing app package and release signing fingerprint.
- Before restarting Hono, a read-only optimizer snapshot showed two completed
  historical runs, no pending Perpl orders, and no active positions. Only the
  managed Hono API was restarted; Convex, Compose, the KeePassDX emulator, and
  trading state were not changed.
- After restart, local and public `assetlinks.json` return HTTP 200. The public
  response is `application/json` and directly contains both relations and the
  v1.1 signing fingerprint. Google's DAL check currently confirms
  `get_login_creds`, but the new `handle_all_urls` check and statement lookup
  still return no relation with `maxAge: 3600s`, consistent with a stale
  negative Google lookup cache. Google-side propagation remains pending.
- A focused association route test passed (2 tests). No APK was rebuilt or
  replaced, and physical passkey creation has not been confirmed. The phone
  build script now preserves versioned APK copies and refuses to replace a
  versioned filename with different bytes; the existing v1.1 copy remains
  unchanged.

### Android association target follow-up — 2026-10-10 15:56 UTC

- A second review found the website statement list also needs a `web` target
  for `https://moeazi-monad.kiyan.finance`, alongside the Android app target.
  The Hono route now publishes both targets, each with
  `delegate_permission/common.handle_all_urls` and
  `delegate_permission/common.get_login_creds`. The app package and release
  certificate fingerprint are unchanged.
- The pre-restart read-only snapshot at 15:55 UTC showed two completed
  historical runs, zero active runs, zero pending orders, and zero active
  positions. Only the managed Hono API was restarted.
- The focused association test passed (2 tests). After restart, both local and
  public files return HTTP 200; the public content type is `application/json`
  and its two statements match the expected targets and relations. Google DAL's
  web-to-web checks still omit `linked`; the cached statement list still shows
  only the earlier app `get_login_creds` statement, with `maxAge: 1233s`. The
  direct public file is current, while Google's lookup cache has not yet
  refreshed.
- No APK was rebuilt. Physical passkey creation remains unconfirmed, and the
  offline KeePassDX emulator was not changed.

### Physical phone passkey creation confirmed — 2026-10-10 15:57 UTC

- The user reported that **Create passkey worked** on the phone after the Hono
  association response was updated to include both Google link relations and
  the canonical HTTPS web target. The phone used the existing v1.1 ARM APK;
  this association correction did not require another APK build.
- This confirms the creation step by user report. Sign-in with the same passkey,
  session restore, Perpl enrollment, and the two-hour trading window are not
  yet confirmed by this report. The emulator's offline KeePassDX setup remains
  unchanged.
