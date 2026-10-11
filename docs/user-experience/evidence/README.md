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

## V1 prototype feedback captures

These four images were supplied by the user as review feedback for prototype
version 1 and added to this repository on 11 October 2026. Their original
capture date, viewport, device and interaction state are unknown. They show
prototype fixtures, not production UI or participant sessions.

| Image | What the review shows | Limit |
|---|---|---|
| [v1-feedback-markets.png](v1-feedback-markets.png) | A “Price movement” fixture chart above a watchlist, without the chart's asset, period, unit, source or freshness in view. | Static image; no market selection, timeframe interaction or chart accessibility test. |
| [v1-feedback-duration.png](v1-feedback-duration.png) | A blue duration slider with a selected 12 hr value, a 10 min to 12 hr range and 10 min / 2 hour presets. | Static image; no drag, keyboard, screen-reader, range-step or service-limit evidence. |
| [v1-feedback-status-words.png](v1-feedback-status-words.png) | A four-row glossary for Requested, Submitted, Confirmed and Filled. | Wording is visible; comprehension and task completion were not measured. |
| [v1-feedback-activity.png](v1-feedback-activity.png) | Activity shows a gray “Auto run” demo-fixture card, followed by a large status glossary. | Static simulated card; no event-detail subpage, signing, stop or recovery path shown. |

The V1 critique and required journey coverage are documented in
[interaction-coverage.md](../reader.html?doc=interaction-coverage.md). These
captures supersede the broad V1 completeness wording in the earlier validation
summary. They do not provide a V2 visual pass.

## V2 prototype feedback captures

Three additional user-supplied review images were received on 11 October 2026.
The original viewport, device, browser zoom/text setting and capture time are
unknown. They are feedback evidence about the V2 prototype, not production UI or
a usability study. These captures supersede the prior V2 claim that the market
row and review/provider density were adequately resolved; automated checks do
not establish visual success.

| Image | What the review shows | Design response | Limit |
|---|---|---|---|
| [v2-feedback-market-wrap.png](v2-feedback-market-wrap.png) | Market rows are too narrow for asset names; characters wrap separately. | Remove list sparklines, give identity a full row, reserve 48 px for watch, and put the short quote/change below. Keep selected-asset chart on detail. | Static image; no verified viewport, 200% text mode or browser rendering check. |
| [v2-feedback-review-density.png](v2-feedback-review-density.png) | Strategy authorization review is still too dense. | Lead with Wallet → Strategy Vault, fixed 100 test AUSD, selected duration, concise terms, risk and primary action; expose exact terms/costs in an explicit disclosure. | Static image; comprehension and interaction state were not tested. |
| [v2-feedback-provider-density.png](v2-feedback-provider-density.png) | Provider authorization panel still presents a wall of request detail. | Summarize Fund 100 AUSD → Allow Perpl trades for the selected duration; keep exact request details behind disclosure and preserve the essential authority boundary. | Static image; provider/native signing flow was not invoked. |

The focused decision and official payment/wallet precedents are recorded in
[contemporary patterns](../reader.html?doc=contemporary-patterns.md#compact-review-and-progressive-disclosure).

## V3 prototype feedback captures

Four additional user-supplied review images were received on 11 October 2026.
The original capture date, viewport, device and interaction state are unknown.
They record feedback on a later prototype revision and are not production UI
or usability-study evidence.

| Image | What the review shows | Limit |
|---|---|---|
| [v3-feedback-alarm-copy.png](v3-feedback-alarm-copy.png) | Routine alarm language is too prominent/alarming for a normal state. | Static image; emotional response and task impact were not measured. |
| [v3-feedback-funded-home.png](v3-feedback-funded-home.png) | A funded Home state hides the relevant funding next step. | One fixture state; actual service eligibility and balances were not exercised. |
| [v3-feedback-funding-action-below-fold.png](v3-feedback-funding-action-below-fold.png) | A funding action sits below the visible content. | Viewport dimensions and scroll position are unknown. |
| [v3-feedback-manual-deposit-empty.png](v3-feedback-manual-deposit-empty.png) | Manual Perpl setup asks for a typed deposit amount while the shown AUSD balance is zero. | Static image; no deposit, manual order, account creation or signing was performed. |

These observations inform the [marketplace revision note](../reader.html?doc=marketplace-revision.md)
and the [implementation backlog](../reader.html?doc=implementation-backlog.md).
They do not establish that the changes are visually successful; the latest
revision still needs browser/native review and human validation.

## V4 prototype feedback captures

Four more user-supplied captures were received on 11 October 2026. The original
capture date, viewport, device and interaction state are unknown. They clarify
that Home top-up is for the initial prerequisite only, move repeat top-ups to
Settings beside Receive/Send, and reject the prior marketplace cart. They are
feedback inputs, not usability-study results.

| Image | What the review shows | Design response | Limit |
|---|---|---|---|
| [v4-feedback-home-topup.png](v4-feedback-home-topup.png) | Funded Home shows 250 AUSD and still presents “Add test tokens.” | Keep Home top-up only while it is an initial prerequisite; hide it after funding. | Static fixture; service eligibility, state transition and viewport are unknown. |
| [v4-feedback-settings-topup.png](v4-feedback-settings-topup.png) | Settings repeats top-up in a prominent card near the top. | Move repeat MON/AUSD top-up actions to the bottom beside Receive and Send. | Static image; no scroll/task completion evidence. |
| [v4-feedback-settings-actions.png](v4-feedback-settings-actions.png) | Receive and Send are shown as paired wallet actions at the bottom of Settings. | Place repeat top-ups alongside this action group. | The crop omits surrounding settings content and any top-up action. |
| [v4-feedback-marketplace-cart.png](v4-feedback-marketplace-cart.png) | A workflow draft banner and Review button overlap the strategy title; the first card also offers Add to workflow. | Remove the cart/draft. Show Perpl deterministic as Included · required; optional Agentic/community controls remain disabled until available. | Static image; no interaction or resulting screen was observed. |

These captures supersede the V3 placement interpretation. The revised source
and Node checks pass, but the current Home/Settings/Strategies screens have not
received a browser/native visual pass.

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
