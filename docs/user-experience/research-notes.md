# Research notes and evidence ledger

Research date: 11 October 2026. Use this file to trace a design decision to
either app evidence, a published source, or an untested hypothesis.

## Evidence labels

- **Observed in Moeazi:** repository source and/or dated emulator screenshot.
- **Documented competitor pattern:** official help page reviewed on the date
  above. No claim is made about an installed app version or direct UI inspection.
- **Hypothesis:** proposed transfer to Moeazi. Needs novice testing.
- **Pending:** work that has not been performed.

## Moeazi baseline

The route inventory and UI descriptions are source-based. Seven screenshots in
`evidence/` cover Home, Markets, Strategies, Strategy Detail, Perpl Setup,
Activity and Account. Strategy and detail captures are mid-scroll; Perpl Setup
has a React Native debugger overlay. This is not full screen or flow coverage.
The [evidence manifest](evidence/README.md) captures device, timing and limits.

Current app tokens define paper `#FFFDF5`, ink `#111111`, bright yellow/pink/sky/
mint accents, Syne display type, Plus Jakarta Sans body type, 5 px strong borders,
solid shadows, and 120/180/220 ms motion values. The tab bar supports a 48 px
minimum item, expands for large font scaling, exposes tab role/selected state,
and uses haptic selection. These are valuable identity and accessibility assets
to preserve. See `src/theme/tokens.ts` and `src/navigation/TypographicTabBar.tsx`.

## Competitor documentation review

Competitor Android installation was attempted through the emulator’s Google
Play package, but the Coinbase market link could not resolve and no competitor
apps were installed. Therefore, all rows below are **documented** patterns from
official help pages, not observed APK behavior. App versions are not known.

| ID | Official source | Documented pattern | Moeazi question |
|---|---|---|---|
| C1 | [Coinbase: Coinbase vs. Coinbase Advanced](https://help.coinbase.com/en/getting-started/other/coinbase-vs-coinbase-advanced) | Simple and Advanced experiences are distinct while sharing balances and history. | Can User/Developer Mode retain one wallet/history and keep switching predictable? |
| C2 | [Phantom: swap help](https://help.phantom.com/articles/swap-crypto-in-phantom-5985106844435) and [Perps](https://help.phantom.com/articles/trade-perps-in-phantom-42292249388307) | Compact pay/receive framing, optional swap settings and fee review; check submitted state before retry. Perps is explained separately. | Can Moeazi show From → To and a safe uncertain-submission recovery? |
| C3 | [Kraken: recurring buys](https://support.kraken.com/articles/6906240918804-recurring-buys-on-the-kraken-app) | A recurring purchase schedule has documented management actions to pause or cancel. | Which controls can a Moeazi run actually support? A recurring schedule pause is not evidence that an open position can pause instantly. |
| C4 | [Revolut: robo-advisor setup](https://help.revolut.com/en-US/help/wealth/robo-advisor/how-do-i-get-started/) | Managed investing has a dedicated setup/funding path; reviewed documentation separates robo-advisor and trading balances. | Can Home distinguish wallet available, strategy allocation and manual Perpl collateral? |

These help pages were reopened/reviewed for this research on 11 Oct 2026. Their
current page content can change. Direct in-app behavior, regional availability,
authentication gates, APK versions, tap count, keyboard handling, transition
timings and error details remain unobserved. Do not infer them from a help page.

## Other references

| ID | Source | Relevance |
|---|---|---|
| R1 | [Apple Human Interface Guidelines: Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) | Learn by doing and introduce help in the product context. |
| R2 | [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Show essential information first and reveal advanced detail when useful. |
| A1 | [Android Accessibility Help](https://support.google.com/accessibility/android/answer/7101858) | Validate readable text, accessible controls and assistive-technology use. |
| A2 | [WCAG 2.2: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Minimum contrast ratio is 4.5:1 for normal text and 3:1 for large text. |
| A3 | [WCAG 2.2: Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) | Text must resize to 200% without loss of content or function. |

## Research-to-design cautions

1. A test token amount is not a USD portfolio value. Keep AUSD and MON units and
   testnet labels explicit; avoid a combined “total” until a reliable conversion
   and meaning are approved.
2. A visit to an external faucet does not prove receipt. AUSD request status
   should be based on the existing prepared operation and verified transfer log;
   MON arrival needs a fresh wallet balance check.
3. Strategy availability, limits, fees and quote freshness must come from
   current service data. Unknown is not zero, success, or availability.
4. The current Perpl direct deterministic optimizer has fixed 100 AUSD funding;
   the service supplies duration/venue bounds. Do not make the 100 AUSD run look
   like flexible amount input. The strategy’s planned-loss amount is a target,
   not a guaranteed maximum-loss cap.
5. A visible stop request does not mean orders are cancelled, positions closed,
   settlement is complete, or funds are back in the wallet.

## Distribution check (browser observed)

On 11 Oct 2026, the official [Phantom download page](https://phantom.com/download)
was opened in Chrome. Its Android action displayed a QR modal directing the
viewer to search Phantom in Google Play; it did not offer a direct APK. This is
a publisher-site distribution observation, not app UX evidence, and no app
version was observed.

## Pending evidence

- Full emulator capture/walkthrough of the app beyond seven selected screens.
- Direct competitor APK walkthroughs; current emulator could not install/resolve
  Coinbase and has no competitor apps installed.
- Novice interviews or moderated tests. No participants, outcomes or timings are
  recorded in this work.
- Product/legal review of trading-risk and test-token copy.
