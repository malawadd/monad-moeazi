# Moeazi Mobile architecture

This repository has its own dependencies, native Android project, assets, tests,
documentation, and Git history. Runtime imports and symlinks to the web application
are prohibited.

## Boundaries

- The app renders server-owned readiness and limits. It does not calculate trading safety locally.
- Magic owns authentication and owner signing. Private keys never enter app storage or Moeazi services.
- The API prepares an exact Universal Account operation. The phone verifies the displayed intent, gates the action with device security, and returns signatures only.
- Convex remains the source for current user, strategy, wallet, credits, and product state.
- Live execution remains behind server-side safety and certification gates.
- Billing and external push providers are unconfigured adapters. They cannot grant credits or send notifications.

## Navigation

The five persistent tabs are Home, Markets, Agent, Activity, and Account. Welcome, Funding, Credits, market detail, trade review, agent settings, activity detail, Autopilot confirmation, and Safety are stack flows.

The bottom bar is deliberately typography-only. Child screens retain an explicit `BACK` control, modal sheets use `CLOSE`, and Android system/predictive Back remains supported. Edge-to-edge insets are owned by the screen and tab-bar shells.

## Interaction layer

- Hero panels use the strong 5dp border and hard shadow; static information uses quiet 2dp rules.
- Motion is short and reduced-motion aware. No business state depends on animation.
- The native haptic bridge wraps Android action-oriented feedback and becomes a no-op when unavailable.
- Routine feedback is rendered inline. Platform dialogs remain reserved for device security and OS-owned flows.
- `latestAiUpdate` is optional, server-owned, and links to authenticated Activity when a matching ID is available.

## Configuration

Android exposes build-time public configuration through the native `MoeaziConfig` module. Set values in ignored `android/local.properties` (copy `android/local.properties.example`) or the matching environment variables:

- `API_BASE_URL`
- `MAGIC_PUBLISHABLE_KEY`
- `ARBITRUM_RPC_URL`

The Magic key is publishable. Secrets, service credentials, owner keys, venue credentials, and private RPC credentials must never be embedded in the app.

The Android property names are `moeazi.apiBaseUrl`, `moeazi.magicPublishableKey`, and `moeazi.arbitrumRpcUrl`; their environment equivalents are prefixed with `MOEAZI_`. The emulator API default is `http://10.0.2.2:3102`, which reaches this copy's isolated local backend.

## Shared account and signing

- Magic email login recovers the owner address; `magic:<lowercase-owner-address>` is canonical on both clients.
- Web and Android sessions are separate and revocable, while Convex product state is shared.
- Android bootstraps missing account records without accepting wallet addresses from the client or creating a fallback key.
- Development signing proof covers purpose-bound EIP-712 and root-hash signatures and cannot broadcast.
- The typed EIP-7702 activation client is present, but all activation endpoints are certification-gated. Only Magic on the phone may broadcast the future one-time Type-4 activation.

## Funding projection

- Canonical Arbitrum USDC is the only v1 direct-wallet trading asset. Native ETH is shown separately for network fees and never clears the Home funding requirement.
- Funding loads the last Convex projection immediately, requests a fresh authenticated RPC observation on entry and foreground, and polls for no more than two minutes while waiting for USDC.
- The backend selects the saved Magic address and canonical token contract. Mobile cannot request a different address or asset.
- Exact decimal strings remain intact through the API. An RPC outage preserves a valid cached observation with a visible stale state and never invalidates the Magic session.
- Money stays in the Magic wallet. Starting the AI later confirms a bounded managed amount; funding itself does not approve, delegate, swap, or move assets.
- Before revealing or copying a deposit address, Funding presents a native safety sheet with an accessible left-to-right confirmation gesture. The acknowledgement is versioned, keyed to the lowercase Magic owner, and stored only on that device.
- Funding keeps the common path compact: balance hero, three-stage deposit journey, network-fee row, and collapsed Sending Guide and Technical Details disclosures.
