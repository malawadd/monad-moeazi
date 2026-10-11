# Preview validation log

Updated 11 October 2026. The Historical V1 section preserves earlier
prototype/browser samples; they do not validate the current revision. Four V1
feedback screenshots expose a context-free fixture chart, off-brand duration
slider, glossary-heavy Activity and missing detail/signing coverage. Three V2
images expose market-name wrapping and dense review/provider screens. Four V3
images add alarm-copy and funding/manual-entry concerns. Four V4 images
supersede the earlier top-up-everywhere and strategy-cart decisions: initial
top-up only on Home while needed, repeat top-ups at the bottom of Settings by
Receive/Send, and no marketplace cart.

All 11 current Node checks pass, including reducer/view/journey/guard fixtures,
controller, consent, layout assertions, the updated funding/required-base
marketplace suite, theme checks and hub structure. They exercise local sources
and simulated state; they do not establish visual quality, native behavior,
accessibility conformance or novice comprehension. No production funding,
signing or trading occurred.

**No visual pass is recorded for the current revision.** Browser access to the
local preview was blocked by the CUA URL policy, so there is no browser or
native screenshot/interaction result for the latest Home, Settings and Strategies
changes. Explicitly pending: visual checks at 320, 393 and 430 px; actual native
radio keyboard behavior; Android rendering, text scaling, reduced-motion and
TalkBack checks; human usability; and native wallet/provider handoff. Fixture
outcomes are simulated and do not represent production transactions.

## Current source and simulated-state checks

| Check | Result | Scope and limitation |
|---|---|---|
| `prototype-test.mjs` | Pass · 9 reducer fixtures | Local state transitions and guards; no service calls. |
| `verify-prototype-views.mjs` | Pass · 16 view checks | Route output and app handlers; source rendering, not visual QA. |
| `verify-v2-journeys.mjs` | Pass · 11 journey checks | Auth, market, Spot, duration, Activity, settlement, recovery and registered controls. Actual browser/native history events were not exercised. |
| `verify-v2-guards.mjs` | Pass · 7 guard checks | Confirmation and balance-change guards for uncertain/rejected states. |
| `verify-v2-controller.mjs` | Pass | Node stubs exercised clicks, timers, auth, logout, input focus and Settings routes. |
| `prototype-consent-test.mjs` | Pass | Strategy consent review and provider handoff checks. |
| `verify-v2-layout-consent.mjs` | Pass | Compact-market and consent HTML/CSS source assertions; not browser or pixel QA. |
| `verify-v3-funding-workflow.mjs` | Pass | Initial Home and repeat Settings entrypoints, receipt progress/idempotency, required non-toggleable base and disabled optional modules; reducer/render checks only. |
| `verify-theme.mjs` | Pass | Theme storage/bootstrap, native-radio markup, state isolation, SVG token hooks, hardcoded-paint scan and phone-only palette scoping; no actual browser/native interaction. |
| `verify-theme-contrast.mjs` | Pass · 5 palettes | 40 actual-use text pairs at 4.5:1; seven graphic pairs, five accent-boundary alternatives and two layered-focus contexts at 3:1. Static token checks, not rendered/composited pixel measurements. |
| `verify-hub.mjs` | Pass · 61 text files ≤300 lines | 35 routes, local links/assets/imports/fonts and no live service/network hooks. Structural only. |


## Historical V1 build and browser checks

| Check | Result | Evidence |
|---|---|---|
| MIME-aware local server | Pass | Windows Python server returned 200; JavaScript modules used `application/javascript`, `Cache-Control: no-store` even with `If-Modified-Since`, Markdown `text/plain`, and local Syne `font/woff2`. Tested on port 8766; README launch remains port 8765. |
| Local API health | Pass · read-only | Supervisor `GET :3102/health` identified `moeazi-mobile-api` with Hono runtime. The prototype made no API calls; this health check was the only API request. |
| Hub and reader | Pass · Chrome | Four audit tables, eight patterns, eight decisions and all 35 route bindings rendered. Wrapped list lines stay in one item; internal Markdown heading links scroll to the matching section. |
| Automated checks | Pass | `prototype-test.mjs`: 8 reducer guard tests. `verify-prototype-views.mjs`: 15 reachability/handler checks. `verify-hub.mjs`: 30 text files ≤300 lines, 35 routes, imports/links/assets/fonts and static no-network guard pass. |
| 320 × 740 layout | Pass · sampled | Normal text: document width/scroll width 305 px; Home primary action fully visible with 12 px spare. All Home buttons and links sampled at ≥48 px. No horizontal overflow observed. |
| 320 × 740 at 200% text | Pass · sampled | Root text 32 px; document width/scroll width 305 px; app width/scroll width 295 px. No horizontal overflow observed. |
| Reduced motion | Pass · sampled | Motion duration resolves to `0.00001s`; scrolling uses `auto`. This records the prototype setting, not native Android animation timing. |
| Web keyboard focus | Partial | Tab navigation reaches the summary with a visible solid focus indicator. Full keyboard-only coverage and TalkBack were not tested. |
| Contrast | Partial | Sampled ink on paper: 18.54:1; muted text on paper: 7.38:1. This is not a full component/state contrast audit. |
| Android prototype launch | Blocked | ADB launch was rejected by automatic approval review without a further reason. No workaround was attempted. |

## Simulated flows exercised in Chrome

| Flow | Observed fixture path |
|---|---|
| Funding | Opening and returning from the faucet without a receipt leaves MON at 0. Explicitly confirming demo arrival enables the AUSD request; submitted → confirmed credits exactly 100 demo AUSD once. |
| Autonomous strategy | Start → active → stop → settling → Home → check → settled → review → pending → confirmed; the fixture then shows 100 AUSD returned. |
| Spot swap | 25 USDC → review for 100 WMON minimum 99.5; disclosed demo fees are 0.075 USDC + 0.001 MON → submitted → filled. |
| Manual Perpl | Approval → finalized → 50 AUSD test account → 10 AUSD order at 2× → submitted → filled → close → closed. |
| Mode preference | Four-tab User Mode → five-tab Developer Mode; preference survives reload and explicit return restores four tabs. |
| Recovery and route guards | Settled recovery review, pending recovery reconciliation, incomplete settlement, unavailable strategies, invalid amounts and uncertain order states were checked by the view/reducer suites. |

Nine error fixtures rendered. Rejected passkey says **“Nothing sent”**; expired
quote says **“Nothing submitted”**; uncertain operation instructs the user to
check the same operation. Offline and stale views label the amount as **LAST
KNOWN**. Manual live quote and liquidation data remain unavailable placeholders;
these checks do not validate live market or risk calculations.

No production signing, funding or trading occurred. Faucet receipts, positions,
fees and returns above are simulated. `verify-hub.mjs` checks prototype source
for live service/network hooks; runtime network capture was not performed. The
supervisor's health GET is separately recorded above. Baseline Android captures
are in the [evidence manifest](evidence/README.md).

## Competitor evidence metadata

Competitor interaction patterns are **documented from official publisher
sources**, not directly observed in installed apps. Pages were reviewed on
11 October 2026. Competitor app versions were **not observed**.

| Product / publisher | Official source | Evidence type | App version |
|---|---|---|---|
| Coinbase | [Coinbase Design · Earn Center](https://www.coinbase.com/blog/designing-the-earn-center-one-home-for-everything-your-crypto-can-earn) (20 Aug 2026); [CDP spend permissions](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-smart-accounts/create-a-spend-permission) | Product design case study and technical API schema reviewed; not direct app evidence. | Not observed |
| Phantom | [More Perps updates](https://phantom.com/learn/blog/more-perps-updates-have-arrived) (28 May 2026); [Explore help](https://help.phantom.com/articles/41523165147667) (publisher listing 13 Apr 2026) | Product announcement and support documentation reviewed; no current screen walkthrough. | Not observed |
| Kraken | [Platform comparison](https://support.kraken.com/in/articles/14984895395092-which-kraken-platform-is-best-for-me-) (updated 1 Oct 2026); [Recurring Orders](https://support.kraken.com/articles/6906240918804-recurring-buys-on-the-kraken-app) (updated 30 Jul 2026) | Official product/support documentation reviewed; no APK walkthrough. Recurring schedules are not active leveraged-run controls. | Not observed |
| Revolut | [AIR assistant announcement](https://www.revolut.com/news/revolut_enters_new_era_of_money_intelligence_with_launch_of_ai_assistant/) (9 Apr 2026); [US Robo-Advisor help](https://help.revolut.com/en-US/help/wealth/robo-advisor/how-do-i-get-started/) (date not shown) | First-party announcement and regional help page reviewed; neither establishes wallet-delegation scope or direct app UI. | Not observed |

No competitor apps were installed. Do not infer their tap counts, keyboard,
motion, authentication or recovery from help pages; see the
[research ledger](reader.html?doc=research-notes.md).

## Microinteraction record and remaining limits

| Field | Current result |
|---|---|
| Tap path/count, first action, wrong turns | Primary fixture paths exercised; exact tap counts and novice wrong turns not recorded. |
| Scroll and keyboard | Responsive scroll widths recorded above; browser Tab focus observed. Native keyboard types/dismissal and full web keyboard coverage not tested. |
| Back behavior and system handoff | Not fully tested. Native passkey/provider/system screens are outside the prototype and remain unobserved. |
| Loading/pending and copy feedback | Submitted/pending states rendered; real response timing and copy-address feedback not measured. |
| Touch targets, labels and assistive tech | Home controls sampled at ≥48 px; full-screen target audit, screen-reader labels and TalkBack remain pending. |
| Motion and contrast | Static role-pair thresholds pass for five theme palettes; no rendered contrast or current-revision motion behavior was visually inspected. |
| Errors and recovery | Nine fixtures rendered; the copy for rejection, expiry, uncertain, offline and stale states is recorded above. Real network failure behavior is untested. |
| Participant outcomes | No novice sessions, completion rates, confidence scores, quotes or task timings. |

Also pending: actual backend integration, real network latency, live Perpl
quotes/liquidation values, native keyboard and passkey/system handoffs, broader
large-text/assistive-technology coverage and the five-person novice study in
the [moderator plan](reader.html?doc=study-plan.md).
