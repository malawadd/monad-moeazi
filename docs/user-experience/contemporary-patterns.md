# Contemporary UX patterns and evidence

**Evidence checked:** 11 October 2026. This brief uses publisher-authored
product notes, official support/documentation and platform guidance. It does
not claim direct access to Coinbase, Phantom, Kraken or Revolut apps. Dates in
the source ledger separate dated 2026 product releases from 2025 platform
research and undated pages checked on the date above.

## Evidence → lesson → Moeazi application

| Evidence and lesson | Moeazi application | Tradeoff | Test |
|---|---|---|---|
| Coinbase Design's Aug 2026 Earn Center case study says customers read “Earning balance” in opposite ways. Discovery and monitoring were distinct jobs; the new hub also needed useful detail pages behind it. | Name each balance by what it means (wallet available, strategy allocation, verified result). Keep asset charts scoped to a selected asset, period and data source. Give detail screens enough information to complete the next action. | A clearer label and context use space; not every asset needs a dashboard chart. | Ask users to explain what each balance means, what the chart measures, and which screen completes the action. |
| Apple's Charts HIG says chart titles, axes, units and summaries give context before people interpret marks; density should reflect the chart's surrounding task, and color alone must not carry essential distinctions. This is 2022 guidance, not a new trend. | Keep Markets discovery attached to a selected market/category. A chart states its asset, pair/type, interval, units, source and last update. Put optional news or technical information under named sections. | More chart labels compete with plotted space; show the smallest sufficient frame of reference and a useful summary. | On a selected BTC-PERP detail, ask which asset/market, time span, units and data freshness the chart represents. Observe whether users find Spot and Perpl paths. |
| Phantom's May 2026 Perps update describes category filters, volume/gainer lists, news signals and a weekly trader leaderboard. Its Explore help says content sections can be reordered dynamically. These are official product descriptions, not inspected screens. | Name market-discovery sections and keep charts attached to a selected asset/category. Do not place fixture-wide “Price movement” above an unrelated watchlist without a scope or reason. | More discovery choices can compete with the trade decision; only show sections the current product supports. | Ask which asset/market, time span and data freshness the chart represents, then ask what action the user wants to take. |
| Kraken's Jul 2026 recurring-order help puts fees on final confirmation and documents view, edit, pause, resume, cancel, notifications and failure reasons. A recurring schedule is a distinct authorization from an open leveraged position. | Make a run's existing owner controls easy to find. Label stop requested, order/position reconciliation, settlement and verified returned balance as separate states. Explain uncertainty and the next check. | Accurate state copy takes more room and may feel less reassuring during a delay. | After selecting Stop in a simulated active run, ask whether the position is closed and funds are spendable. Do not use “pause” unless the service actually implements pause. |
| Kraken's Oct 2026 platform guide distinguishes a beginner-oriented Kraken app from Kraken Pro analytics and order tools, and its Aug 2026 navigation help separates Home, Portfolio, Explore and Activity. The guide documents product intent, not tap paths observed in an APK. | Keep the User Mode entry task-focused; expose diagnostic/market-operator detail on a purposeful detail page or Developer Mode. Preserve one account and history across the presentation choice. | Users who want all diagnostics immediately need one additional navigation step. | Ask novice and experienced participants to find Activity, a market detail and Developer Mode without coaching. |
| Revolut US Robo-Advisor help describes an investment-specific application, suitability questionnaire and terms review, with separate account eligibility requirements. This is regional and product-specific. | Keep autonomy consent separate from manual trading; show the asset, amount, duration, operator permissions, network fees, and recovery expectations in the action-specific review. Distinguish allocated from available funds. | A fuller review takes longer, but protects against treating an allocation as spendable wallet balance. | Ask a participant to describe what the operator can do, what remains unavailable, and when they expect funds back. |
| Revolut's Apr 2026 AIR announcement describes conversational finance tasks and says customers stay in control, but does not document onchain spend permissions or signing scope. This is a dated assistant product announcement, not evidence of delegated wallet authority. | Treat assistant suggestions and navigation as separate from a wallet operation. Show the exact prepared operation and permission review before calling the existing signer; chat intent alone must not imply authorization. | Separate review adds a step when a user begins in conversation, but makes the signing boundary visible. | Ask users to distinguish a suggestion, a prepared operation and an authorized transaction; test cancel and return behavior at each boundary. |
| Coinbase CDP spend-permission docs scope a permission by network, spender, token, allowance, reset period, start and end. Safe's AI-agent guide demonstrates one-time or periodic per-token allowance. Coinbase Agentic Wallet docs state its user-set per-call and per-session limits cannot be changed by an agent; agents cannot initiate funding. These are technical examples, not Moeazi capabilities. | Put the actual service-derived authority in plain language: who may act, on what network and asset, allowed actions/limits, duration or expiry, withdrawal scope, fee source, stop/revoke path and current run state. If an actual permission field is absent or unknown, do not imply a cap exists. | The review is denser. Use a summary first and exact mandate/operation data on demand; never hide an authority boundary. | Ask the user to identify the maximum amount, duration, venue/operator scope, withdrawal rights and stop/recovery path before any simulated confirmation. |
| Google's May 2025 Material 3 Expressive research reports studies of color, shape, size, motion and containment. Its guidance connects these treatments to hierarchy and grouping, while advising teams to prioritize function and check accessibility. This is a 2025 platform foundation, not a new 2026 trend. Apple's slider HIG describes value/range labeling and supplemental text entry for precision; it does not require a slider for a bounded duration. | Keep Moeazi's cream, ink borders, accents and display type; use a short row of service-valid duration presets plus a custom numeric minutes field. For current 10–720 minute bounds, test 10 min, 30 min, 2 hr and 12 hr as initial presets. Validate custom input inline against live bounds. Do not carry the V1 native-looking blue slider forward. | Presets make common values faster but need a deliberate choice of which durations to surface. Numeric entry needs unit labels and a clear invalid-range message. | Compare preset selection and custom minutes entry on small screens and with the keyboard open. Ask participants to state the exact duration; check 9, 10, 720 and 721 minute values, clear/empty entry, large text and TalkBack. |
| Nielsen Norman Group's Jan 2024 recognition/recall article explains that visible choices and context make it easier to recognize an option than to generate its name/details from memory. This is general UX guidance, not crypto-product research or a 2026 release. | Make the required Perpl base, optional module role, creator/attribution and availability easy to scan. Keep the one-line benefit visible and put methodology/fee detail on the module detail screen. Show currently unavailable optional controls as disabled with a plain reason. | Disabled options and status labels use space; keep the benefit short and avoid implying that discovery enables execution. | Ask a participant which strategy is always included, which optional module is available now, and whether a coming-soon module can act. |
| Apple's current Entering Data HIG discusses reducing unnecessary entry and using sensible prefills; the page requires JavaScript in this text review, so treat this as platform guidance, not a specific 2026 release. | Offer common, valid duration presets first, preserve the user's valid custom value, and keep the numeric keyboard available for a deliberate adjustment. Never silently replace a typed value with a preset. | Helpful defaults can become coercive if they obscure the current value or are hard to change. | Start from each preset, enter a custom value, navigate away/back, and confirm the selected value and unit remain explicit. |
| GOV.UK's Warning text component says to use its warning treatment for important consequences such as legal consequences of an action or inaction. Applying that threshold to routine app status is a design inference, not GOV.UK guidance about financial apps. | Keep routine funding, availability and next-step copy neutral. Reserve strong warning styling for consequential loss, required consent or a failure that needs action. | Quieter routine states draw less attention; critical consequences still need a timely, perceivable treatment. | Ask users to distinguish a normal next step from a consequential risk or actionable failure without relying on color alone. |
| Apple's Jun 2026 design principles emphasize agency, responsibility, clear feedback and recovery. Apple's feedback guidance says interruptions should match the importance of information and alerts should be critical/actionable. Android's predictive-back guidance previews a destination before a back gesture commits. | Keep reversible in-flow guidance near the control. Reserve blocking alerts for meaningful irreversible risk or a required decision. Back returns to the previous screen with inputs/context preserved; never discard a prepared or uncertain operation silently. | More quiet inline messaging means less visual emphasis; critical consent and uncertainty still need a strong, timely signal. | Test system Back and in-app Back during search, keyboard, setup, review, external faucet return and uncertain submission. Ask what will happen before committing a stop or signing action. |
| Android's official onboarding guidance recommends contextual explanations at the moment they are needed, saved progress and accessible recovery; its passkey page recommends familiar language, a benefit explanation and confirmation. The passkey page was last updated Oct 14, 2024; this is platform guidance, not evidence about Moeazi's signer. | Use short help beside funding, authorization and trading terms. Explain the familiar screen-lock interaction before the existing Mera passkey flow and state when review was prepared, signed, submitted or confirmed. Keep account sign-in and transaction authorization concepts distinct. | Contextual teaching still adds copy; place it beside the relevant step and allow deeper detail on demand. | Ask users what will happen before the system prompt and what result they saw after dismissing/canceling it. Check the existing signer-specific screens; do not substitute Credential Manager for Moeazi's WebAuthn PRF flow. |
| Apple's Apple Pay HIG recommends only essential payment-sheet information, short legible line items, and a concise plain-language agreement that does not repeat terms already shown elsewhere; added or future costs must be clear. MetaMask's transaction simulation help describes showing estimated balance changes before confirmation, while its spending-cap guide presents the exact token allowance for user review. These are wallet/payment precedents, not an equivalent flow to Mera or Moeazi's delegated mandate. | Keep the first signing viewport to the transfer/permission summary, selected duration, the consequential risk, and the primary review/authorize action. Put exact mandate, limits and cost details behind a labeled native disclosure, but keep essential authority and costs visible or clearly summarized before authorization. For a transfer, state asset/amount and From → To; for a mandate, state actor, allowed action, asset, duration, withdrawal ability and stop path. Do not imply a simulated preview is an execution guarantee. | Too little summary hides authority; too much duplicated machine detail buries the choice. Progressive disclosure must retain essential decision facts up front and expose the exact source values before the signing boundary. | At 320/393 px and 200% text, ask participants who receives the funds, what permission they grant, duration, important costs/risks and how to cancel. Expand details, use Back, and confirm the state/input is preserved. |

## Interaction details to carry into a redesign

### Bounded autonomy and authorization

Present the permissions as a finite envelope, not a generic “AI can trade”
switch. The exact fields below must come from the live service/mandate before a
screen treats them as available: test asset and quantity; duration and service
bounds; venue/operator scope; actions allowed; network and fee asset; withdrawal
ability; owner stop/recovery controls; and where to inspect each event. Show the
same scope in the final review. A stop tap begins a service operation; it does
not establish canceled orders, closed exposure, completed settlement or returned
funds. Preserve one operation/run identity through pending or uncertain states.

### Compact review and progressive disclosure

The 11 October 2026 user review captures show the asset names wrapping letter by
letter in Markets and dense, wall-like detail in both strategy review and the
provider request. Reduce visual density by removing list sparklines and putting
the full asset identity on its own row with a separate 48 px watch control; show
the short quote and daily fixture change on the next row. In authorization
surfaces, lead with a compact Wallet → Strategy Vault summary, fixed 100 test
AUSD and the selected duration. Keep the consequential loss/risk statement and
primary action in view. Move exact technical terms into native `details`, but do
not hide the amount, recipient/actor, duration, material costs or permission
scope required to make the decision. Apple Pay guidance is about payment sheets;
MetaMask describes token approvals and simulations. Neither is a direct analogue
for Moeazi's existing signer or mandate, and a displayed simulation is not a
guarantee of chain execution.

These presentation rules describe existing Moeazi contract facts in
`research-notes.md`; Coinbase/Safe sources do not authorize product or contract
changes. If current service data omits a limit, show it as unknown and keep the
action unavailable pending product review.

### Duration entry, keyboard and help

- Use duration bounds returned by current service terms; do not reuse the V1
  mock slider's range for live setup. Prefer a short set of useful presets and
  a custom numeric minutes field over a slider. The current 10–720 minute path
  can test 10 min, 30 min, 2 hr and 12 hr presets. Keep exact value and unit
  visible, validate the custom value inline, and explain the allowed range.
  Never use duration control for fixed 100 AUSD funding.
- Give presets clear selected, focus and disabled states with text as well as
  color. Apple HIG slider guidance supports text entry for precision across a
  wide range; here that supports the custom field rather than retaining a
  drag-only control. Keep its numeric keyboard, Next/Done and current value
  visible when the keyboard opens.
- Use numeric keyboards for amounts and durations, a search keyboard for
  market search and a normal text keyboard for names. Provide clear Next/Done
  behavior. The focused field and primary action must remain visible above the
  system keyboard; system Back should dismiss the keyboard before leaving the
  page. Preserve typed input if the keyboard closes.
- Explain unfamiliar terms next to the relevant value or action, in one short
  sentence. Make deeper definitions expandable. Do not put an entire glossary
  between the Activity heading and the first event.

### Back, status and motion

- Show a plain current state and the next check near an active run. Status must
  be text plus shape/icon, not color alone. Keep noncritical updates inline;
  interrupt only when an action needs a decision or an important failure needs
  attention.
- Use existing Moeazi 120/180/220 ms motion tokens for small feedback, page
  transitions and disclosure, with reduced motion respected. Motion may show
  how a detail screen relates to its selected market or return path, but must
  not delay a fee/permission update, operation status, or primary action.
- Android predictive Back previews the destination before the gesture commits.
  Keep the current screen and edit state intact during the preview; on cancel,
  return to the same state. In a setup/review flow, back returns to the prior
  form without silently signing, stopping or discarding an operation.

## Source ledger

Publication dates below come from the publisher page when shown. “Not shown”
means no date was visible in the page reviewed, not that the source is old. All
sources were checked 11 October 2026. Methods describe page review only; none of
the rows records direct competitor APK observation.

| Title | Publisher | Published/updated | Checked | URL | Method and relevant sections |
|---|---|---|---|---|---|
| Designing the Earn Center: one home for everything your crypto can earn | Coinbase Design | 20 Aug 2026 | 11 Oct 2026 | [Article](https://www.coinbase.com/blog/designing-the-earn-center-one-home-for-everything-your-crypto-can-earn) | First-party design case study read in browser; customer feedback, “What we built,” design principles, results. |
| More Perps updates have arrived | Phantom | 28 May 2026 | 11 Oct 2026 | [Article](https://phantom.com/learn/blog/more-perps-updates-have-arrived) | First-party product update read in browser; categories, Moments and Signals, leaderboard, Cash Balance. |
| Use the Explore tab in Phantom on mobile | Phantom Support | 13 Apr 2026 (publisher search listing; accessible text is dynamic) | 11 Oct 2026 | [Help article](https://help.phantom.com/articles/41523165147667) | Official mobile help text; variable section ordering, quick-access cards, categories, Follow. Page is not an app walkthrough. |
| Recurring Orders on the Kraken App | Kraken Support | Updated 30 Jul 2026 | 11 Oct 2026 | [Help article](https://support.kraken.com/articles/6906240918804-recurring-buys-on-the-kraken-app) | Official support article; final fee review, frequency, order management, notification and failure reasons. |
| Which Kraken platform is best for me? | Kraken Support | Updated 1 Oct 2026 | 11 Oct 2026 | [Help article](https://support.kraken.com/in/articles/14984895395092-which-kraken-platform-is-best-for-me-) | Official platform comparison; beginner Kraken vs Pro features, switching question. |
| Navigating the Kraken app | Kraken Support | Updated 3 Aug 2026 | 11 Oct 2026 | [Help article](https://support.kraken.com/articles/360059154531-navigating-the-kraken-app) | Official navigation help; Home, Portfolio, Explore and Activity; asset history and portfolio chart. |
| Open a Robo-Advisor account | Revolut Help, US | Not shown | 11 Oct 2026 | [Help article](https://help.revolut.com/en-US/help/wealth/robo-advisor/how-do-i-get-started/) | Official US-specific help; eligibility, Invest entry, suitability questionnaire, terms. Regional requirements are not generalized. |
| Show Wallet App | Coinbase Developer Documentation | Not shown; Agentic Wallet docs label Beta | 11 Oct 2026 | [Documentation](https://docs.cdp.coinbase.com/agentic-wallet/mcp/mcp-tools/show-wallet-app) | First-party developer documentation; per-call/per-session limits, agent cannot change limits or initiate funding. Technical example, not consumer UX. |
| Create a spend permission | Coinbase Developer Documentation | Not shown | 11 Oct 2026 | [API reference](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-smart-accounts/create-a-spend-permission) | API schema reviewed; network, spender, token, allowance, period, start and end. Not a Moeazi contract recommendation. |
| AI agent with a spending limit for a treasury | Safe Documentation | Not shown | 11 Oct 2026 | [Quickstart](https://docs.safe.global/home/ai-agent-quickstarts/agent-with-spending-limit) | First-party technical walkthrough; token allowance and reset interval, including daily allowance example. Not app UI evidence. |
| Expressive Design: Google's UX Research | Google Design | 21 May 2025 | 11 Oct 2026 | [Research article](https://design.google/library/expressive-material-design-google-research?pubDate=20250521) | First-party research account; studies, hierarchy, tap target, contrast and usability testing. Foundation is 2025, not 2026. |
| Design principles | Apple Human Interface Guidelines | 8 Jun 2026 | 11 Oct 2026 | [Guideline](https://developer.apple.com/design/human-interface-guidelines/design-principles) | Current HIG article; Purpose, Agency, Responsibility, Familiarity and recovery. |
| Feedback | Apple Human Interface Guidelines | Not shown | 11 Oct 2026 | [Guideline](https://developer.apple.com/design/human-interface-guidelines/feedback) | Current HIG page; state feedback, interruption level, alerts and completion confirmation. |
| Charts | Apple Human Interface Guidelines | New page 23 Sep 2022; page checked current | 11 Oct 2026 | [Guideline](https://developer.apple.com/design/human-interface-guidelines/charts) | Titles/summaries, axes, units, chart context/density, color meaning and VoiceOver labels. |
| Sliders | Apple Human Interface Guidelines | Changelog 21 Jun 2023; page checked current | 11 Oct 2026 | [Guideline](https://developer.apple.com/design/human-interface-guidelines/sliders) | HIG slider value, appearance, range labels and supplemental text entry; older foundation, still current page. |
| Handle keyboard input | Android Developers | Last updated 22 Sep 2026 | 11 Oct 2026 | [Guide](https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input) | Official Android guide; input-method type, Next/Done actions, keyboard visibility/layout, hardware input and keyboard navigation. |
| Predictive back design | Android Developers | Last updated 24 Oct 2024 | 11 Oct 2026 | [Guide](https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back) | Official Android design guide; destination preview, commit/cancel animation and gesture insets. Foundation guidance, not a 2026 release. |
| Authentication & Onboarding | Android Developers | Last updated 19 May 2026 | 11 Oct 2026 | [Guide](https://developer.android.com/design/ui/mobile/guides/patterns/onboarding) | Contextual teaching, in-app prompts, saved progress, clear permissions and recovery. |
| User authentication with passkeys | Android Developers | Last updated 14 Oct 2024 | 11 Oct 2026 | [Guide](https://developer.android.com/design/ui/mobile/guides/patterns/passkeys) | Plain-language passkey introduction, familiar screen-lock explanation and confirmation. Applies to sign-in/creation, not transaction scope. |
| Revolut enters new era of money intelligence with launch of AI assistant | Revolut | 9 Apr 2026 | 11 Oct 2026 | [Announcement](https://www.revolut.com/news/revolut_enters_new_era_of_money_intelligence_with_launch_of_ai_assistant/) | First-party UK rollout announcement; chat-based financial tasks, user control/privacy claims and entry point. Does not specify delegated wallet-spending permissions or signing authority. |
| Apple Pay | Apple Human Interface Guidelines | Not shown; current page checked | 11 Oct 2026 | [Guideline](https://developer.apple.com/design/human-interface-guidelines/apple-pay) | Official payment-sheet guidance; essential fields, short line items, recurring payment frequency, clear added/future costs, plain-language agreement without duplication. Page reviewed through publisher search excerpt because direct content requires JavaScript. No Apple Pay or Apple Wallet equivalence is claimed. |
| What are transaction simulations? | MetaMask Support | Not shown; current page checked | 11 Oct 2026 | [Help article](https://support.metamask.io/manage-crypto/transactions/simulations/) | Official support content; estimated balance changes/asset movement preview and limitations of off-chain simulation. Supports preview as comprehension aid, not execution guarantee. |
| How to customize token approvals with a spending cap | MetaMask Support | Not shown; current page checked | 11 Oct 2026 | [Help article](https://support.metamask.io/privacy-and-security/how-to-customize-token-approvals-with-a-spending-cap/) | Official help page; editable token allowance, chosen/custom cap and second review step. Not an implementation recommendation for Moeazi's mandate. |
| Memory: Recognition and Recall in User Interfaces | Nielsen Norman Group | 15 Jan 2024 | 11 Oct 2026 | [Article](https://www.nngroup.com/articles/recognition-and-recall/) | Publisher-authored UX guidance; visible menu/options and contextual cues; not crypto-specific evidence. |
| Entering data | Apple Human Interface Guidelines | Not shown; current page checked | 11 Oct 2026 | [Guideline](https://developer.apple.com/design/human-interface-guidelines/entering-data) | Official HIG link reviewed; page requires JavaScript in text extraction. Used only for the general guidance to reduce unnecessary entry and provide reasonable, adjustable prefills. |
| Warning text | GOV.UK Design System | Not shown; current page checked | 11 Oct 2026 | [Component guidance](https://design-system.service.gov.uk/components/warning-text/) | Official design-system guidance; use warning component for important consequences such as legal consequences. Applying a similar emphasis threshold to routine financial-app status is our design inference. |

## Evidence limits

- Publisher-written case studies and help pages describe reported product
  behavior. They do not prove the exact screens, availability, navigation,
  tap count, motion, locale or accessibility behavior of an installed app.
- Android Material 3 Expressive research is dated May 2025. Treat it as a
  platform foundation. Apple's principles page is dated June 2026; other HIG
  and official help pages without dates are documented as checked, not new.
- No competitor app was installed or directly observed. The four V1, three V2
  and four V3 plus four V4 feedback images in the local evidence manifest are Moeazi
  prototype review captures with unknown original viewport/capture date. V2
  documents unresolved market wrapping and dense review/provider screens; V3
  documents funding visibility, routine alarm copy and a zero-balance deposit
  prompt. The latest revision has not received a visual pass.
- All Moeazi recommendations remain hypotheses until the revised prototype is
  visually reviewed and novice sessions are recorded.
