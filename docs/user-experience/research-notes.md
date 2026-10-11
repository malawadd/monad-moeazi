# Moeazi UX research notes

Research and source review checked 11 October 2026. The expanded primary-source
ledger, exact source methods and application rationale are in
[contemporary-patterns.md](contemporary-patterns.md). End-to-end interaction
coverage and open questions are in [interaction-coverage.md](interaction-coverage.md).

## Evidence labels and scope

- **Observed in Moeazi:** repository source or an identified emulator capture.
- **User-supplied V1 feedback:** four screenshots of prototype version 1; their
  original capture date, device and viewport are unknown. Received 11 October
  2026. They record feedback, not production behavior or participant results.
- **Documented product pattern:** official publisher article/help page. This
  does not establish the installed app's actual UI or interaction.
- **Platform guidance:** first-party Android or Apple design guidance. The
  publication/change date is recorded separately where visible.
- **Hypothesis:** proposed transfer to Moeazi. It needs novice testing.
- **Pending:** interaction, visual state or participant outcome not checked.

## Moeazi baseline

The route inventory comes from repository source. Seven read-only Android
screenshots cover Home, Markets, Strategies, Strategy Detail, Perpl Setup,
Activity and Account. Strategy and detail are mid-scroll; Perpl Setup has a
debugger overlay. They do not show complete navigation, all nested pages,
signing, error/loading states or all keyboard and Back behavior. See the
[emulator evidence manifest](evidence/README.md).

Four V1 prototype feedback captures add targeted critique: a generic fixture
chart without visible asset/time context; a blue duration slider; an oversized
four-state glossary; and a gray demo-run Activity card above that glossary.
The review also raised incomplete subpage and final signing coverage. This
V1 feedback supersedes broader V1 completeness language in the historical
[validation log](reader.html?doc=validation.md). It does not claim a V2 result.

The current palette uses cream, ink, yellow/pink/sky/mint accents, Syne and
Plus Jakarta Sans, heavy borders/shadows and 120/180/220 ms motion tokens. The
tab bar has a 48 dp minimum item, supports larger text and uses haptics. Keep
these identity/accessibility assets while giving each screen a clear task and
status hierarchy. Sources: `src/theme/tokens.ts` and
`src/navigation/TypographicTabBar.tsx`.

## Contemporary primary-source review

Current 2026 references are specific and date-labeled:

- Coinbase Design's 20 Aug 2026 Earn Center case study describes customer
  confusion over one balance label and separates discovery from monitoring.
- Phantom's 28 May 2026 Perps update and its current Explore help describe
  category/news discovery; Explore sections can vary dynamically. These sources
  do not show a current app build.
- Kraken's 1 Oct 2026 platform comparison describes separate beginner and
  Pro experiences. Its Aug 2026 navigation page lists Home, Portfolio, Explore
  and Activity. Its Jul 2026 recurring-order page documents visible fees,
  management controls and failure reasons for a scheduled purchase.
- Revolut US Robo-Advisor help describes an application, suitability
  questionnaire and terms review. The document is regional and has no visible
  publication date; it is not a description of Moeazi's product or scope.
- Coinbase Developer and Safe docs give concrete technical examples of
  time-, token- and amount-scoped agent permissions. These are not consumer UX
  research and do not imply Moeazi has those capabilities.

Platform foundations are identified by their dates: Google Material 3
Expressive research is from May 2025; Apple's chart HIG page was introduced in
2022; Apple's design-principles page was updated June 2026. Current keyboard,
passkey, motion, chart and alert guidance is linked and dated or labeled “not
shown” in the [source ledger](contemporary-patterns.md#source-ledger). Do not
call every current-page update a 2026 design trend.

## Authorization and market display constraints

1. Test AUSD, fee MON, USDC and WMON are separate testnet assets. Do not convert
   them to fiat, combine them into an unverified portfolio total, or hide
   freshness. A test token amount is not a dollar value.
2. A faucet page opening or copied address does not prove receipt. The AUSD
   `requestFunds(address)` call has no amount input; report the credited amount
   only after the existing transfer/receipt or balance check verifies it.
3. The direct deterministic Perpl optimizer uses fixed 100 AUSD funding and
   service-bounded duration (current setup UI: 10–720 minutes). Do not make the
   amount look flexible. Its 0.15 AUSD planned-loss target is not a guaranteed
   cap; the current optimizer also sets up to 4× leverage, 30 AUSD notional and
   25 AUSD margin. The prepared service review stays authoritative.
4. The Perpl setup source says one Mera passkey session signs the exact funding
   transaction and Perpl mandate. Keep amount, duration, owner/venue scope,
   permissions, fees and risk visible before invoking that existing signer.
   The Android passkey page is guidance for sign-in/credential UX, not a
   replacement architecture for Mera's current WebAuthn PRF session.
5. Show only limits returned by current service/mandate data. Unknown is not
   zero, available, filled, success or a guaranteed loss ceiling.
6. A stop request is not proof of canceled orders, closed exposure, completed
   settlement or returned funds. Preserve the run/operation identity through
   uncertain states and offer reconciliation before a duplicate retry.
7. A chart in a discovery surface must identify the selected asset/market, pair
   type, interval, units, price source, freshness and whether the values are
   live or fixture data. Keep technical market fields available on demand.

## Source and validation limits

No Coinbase, Phantom, Kraken or Revolut app was installed or directly
observed. No app version, tap count, authentication details, regional app
availability or transition timing is inferred from help pages. The local
Android capture and V1 feedback screenshots are not novice sessions. V1
simulation checks do not establish visual completeness or native signing.
V2 visual review is pending; no V2 pass is claimed. No novice interviews have
been conducted. See the [moderator plan](reader.html?doc=study-plan.md) and
[V1/V2 validation status](reader.html?doc=validation.md).
