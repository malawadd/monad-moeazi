# Emulator evidence manifest

Capture date: 11 October 2026, approximately 17:45–17:48 Riyadh time.

| Detail | Recorded value |
|---|---|
| Android package | `com.moeazi.monad.mobile` |
| App version | `1.8` · version code `9` |
| Emulator | `Moeazi_API_36` · Android API 36 |
| Image geometry | 1080 × 2400 px · density 420 |
| Interaction | Read-only navigation and screenshots |
| Signing/funding/trading | None performed |

## Captures

| Image | What it records | Limit |
|---|---|---|
| [current-home.png](current-home.png) | Home balance list, observed block, primary/action list and tabs. | One state, not the empty/error/loading states. |
| [current-markets.png](current-markets.png) | Markets tab. | One captured viewport. |
| [current-strategies.png](current-strategies.png) | Strategies tab. | Mid-scroll; not full page coverage. |
| [current-strategy-detail.png](current-strategy-detail.png) | Strategy detail. | Mid-scroll; not full page coverage. |
| [current-perpl-setup.png](current-perpl-setup.png) | Perpl AUSD setup. | React Native debugger overlay is visible. No signing. |
| [current-activity.png](current-activity.png) | Activity tab. | One captured viewport; no event drill-down. |
| [current-account.png](current-account.png) | Account tab. | One captured viewport. |

Images were supplied from the supervisor’s emulator walkthrough and retained
as evidence. They are observations of the testnet UI, not results of user
testing, proof of a successful transaction, or complete screen-state coverage.

## Prototype and hub captures

Captured in Chrome on 11 October 2026. These images record local design artifacts
with simulated data, not the production app or participant sessions.

| Image | View | Evidence limit |
|---|---|---|
| [prototype-home.png](prototype-home.png) | Clickable prototype Home at 393 × 852 CSS px. | One simulated Home state; not a complete responsive or accessibility audit. |
| [hub-preview.png](hub-preview.png) | Research hub at 1263 × 896 CSS px. | One desktop browser view; not evidence of mobile layout. |

Prototype flow checks, smaller viewport samples and limitations are in the
[validation log](../reader.html?doc=validation.md). Values and transaction
states in the prototype are fixtures only.

## Competitor install attempt

Google Play package `com.android.vending` exists on the emulator, but the
official Coinbase `market://details?id=com.coinbase.android` intent returned
“unable to resolve Intent”; launcher resolution also returned no activity.
No competitor apps were installed (the emulator app list contained KeePassDX
and two Moeazi apps). Consequently competitor patterns in
[research-notes.md](../research-notes.md) are labeled documented from official
help pages. No competitor version, authentication flow, tap count, latency or
regional availability is claimed.

Phantom distribution check: Chrome opened the official
[Phantom download page](https://phantom.com/download). Its Android action showed
a QR modal instructing visitors to search Phantom in Google Play; no direct APK
was offered. This is distribution evidence, not an in-app UX observation.
Open the [research note](../reader.html?doc=research-notes.md) for the source
ledger and competitor distinctions.
