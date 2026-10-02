# Modular funding and fees

The app consumes a server-owned provider catalog. It contains no Transak, MoonPay,
Banxa or Pimlico SDK, sponsor secret, provider-name switch or checkout-specific
native code. One Custom Tabs launcher opens validated HTTPS checkout links.
Android stays independent from the web repository; types are versioned local copies.

Add money offers Buy USDC and guided Transfer USDC. Hosted providers handle payment,
identity checks, eligibility and purchase support. Direct transfer remains available.
Buying does not start AI. Pending purchases reload authenticated status after browser
return; return URLs never assert payment success.

Buy USDC treats the input as a total fiat budget and requests only the selected
connector after a 750ms pause. Indicative card pricing shows net USDC and total
payment, with fees collapsed and unknown fees labelled. Inputs/account changes
invalidate the estimate; hidden/background screens stop requests. Checkout-only
fallback is explicit, while known invalid/minimum/maximum inputs stay blocked.
Local fixtures and sandbox estimates are labelled and never imply funds arrived.
Live quotes default OFF server-side and require separate metered-usage approval.
Quote-capable provider versions and rollout are in the backend's
`docs/mobile-funding-quotes.md`. No Android rebuild is required for this feature.

New withdrawals use covered fees or an explicit unavailable/setup state, never a
silent ETH charge. Magic signs locally; the backend submits a reviewed user operation.
Covered-fee setup does not grant AI authority. Legacy direct withdrawal status and
reconciliation are retained. Device security fails closed on unsupported Android.

Local preview purchases never open Magic/browser or write to a real ledger. Real
activation and sponsored withdrawals remain disabled until backend configuration,
artifact/provider certification and specific cost approval. No real purchase or gas
spend has been tested. See the backend's `docs/mobile-modular-integrations.md` for
configuration, ownership, endpoint versions, retirement and release checkpoints.

Native changes require one install of the x86_64 debug APK. Screen/style changes
afterward use Metro Fast Refresh. Local build command from `android`:
`gradlew.bat assembleDebug -PreactNativeArchitectures=x86_64`.

Android Metro bundle validation also passed. A UTF-8 polyfill is loaded before viem
for Hermes; Metro's `@noble/hashes/crypto.js` export fallback is a nonfatal dependency
warning. Browser-return, biometric, Magic and interrupted-action native checks still
require an approved device checkpoint; they were not inferred from Jest.

The production dependency audit reports three moderate advisories in the existing
React Navigation/query-string/decode-uri-component chain. Incoming links are bounded
and allowlisted before navigation (no query strings or percent-encoded content).
Upgrade and recheck that dependency chain before public rollout; no unrelated
automatic dependency upgrade was applied during this integration pass.
