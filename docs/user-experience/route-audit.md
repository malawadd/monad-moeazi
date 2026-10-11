# Current routes and page disposition

The audit reads `src/navigation/RootNavigator.tsx`, `routes.ts`, `linking.ts`,
the registered screen components, and navigation calls in those components.
It is a source-level reachability audit, checked against the Android captures
listed in [the evidence manifest](evidence/README.md).

## Counts and navigation model

- 28 authenticated stack destinations are declared beside `Main` in the root stack.
- `Main` is an additional authenticated root stack declaration for the tabs.
- `Main` contains five tabs: Home, Markets, Strategies, Activity and Account.
- `Welcome` is the signed-out route. There is also a loading state before routing.
- That gives 35 route bindings including Main, five nested tabs and Welcome.
- There are 32 unique screen component files among those bindings. `Agent` and
  `AgentStatus` point to `AgentScreen`; `PerplMarkets` aliases `MarketsScreen`.
- `src/navigation/routes.ts` also exports the existing five-tab names.

The full route-by-route mapping (including the Main shell), current behavior, User Mode disposition and
Developer Mode retention is rendered in the **Every current destination** table
on the [hub](index.html#audit). The source-of-truth detail lives in [audit-data.js](audit-data.js).

## User Mode / Developer Mode rule

User Mode is a proposed presentation layer. It is not implemented in
`RootNavigator`. It should make the four-tab proposal (Home, Markets, Strategies,
Activity) and account/settings entry easy to learn. Developer Mode restores the
current five-tab and stack presentation. Both shells share the authenticated
Mera account, API clients, balances, histories, transaction preparation,
validation and consent. A mode toggle does not activate an API gate or sign a
transaction. See [implementation backlog](implementation-backlog.md).

## Unregistered screen files

The following `*Screen.tsx` files are not registered by `RootNavigator` at the
time of the audit. They may represent legacy, future, or intentionally unused
code; “unregistered” means the current root navigation graph does not expose a
route to them. Do not delete them as part of the research stage.

| File | Audit note |
|---|---|
| `AddMoneyScreen.tsx` | Older add-money candidate. |
| `AutopilotConfirmScreen.tsx` | Legacy AI trader confirmation/stop flow. |
| `BuyUsdcScreen.tsx` | Purchase flow; preserve only if provider and product are supported. |
| `CoveredFeesScreen.tsx` | Connector activation fee step. |
| `CoveredReviewScreen.tsx` | Connector activation signature review. |
| `CreditsScreen.tsx` | Unregistered; stale `credits` deep link is configured. |
| `FundingGuideScreen.tsx` | Older USDC transfer instructions. |
| `FundingScreen.tsx` | Older generic funding flow. |
| `HomeScreen.tsx` | Older AI Home, distinct from `MonadHomeScreen`. |
| `ManagedAutopilotSetupScreen.tsx` | Legacy managed autopilot setup. |
| `PurchaseStatusScreen.tsx` | Unregistered; purchase-status deep link is configured. |
| `SafetyScreen.tsx` | Unregistered; `safety` is allowed/configured as a deep link. |
| `WithdrawalReviewScreen.tsx` | Legacy withdrawal review. |
| `WithdrawScreen.tsx` | Unregistered; config declares it but URL allowlist rejects `withdraw`. |

`AutonomyRecoveryControl`, `ManagedSpotMandateCard`,
`ManagedVaultReleaseControl` and `PerplRecoveryPanel` are supporting components,
not root screen routes.

## Deep-link review

`safeMobileDeepLink` accepts a limited `moeazi-monad://` URL set. The configured
screen map includes `Safety`, `Credits`, `PurchaseStatus` and `Withdraw`, but the
first three have no registered root screen and `withdraw` is not accepted by
the URL allowlist. Mode-aware routing must preserve valid user destinations,
provide a safe unavailable/recovery destination for legacy push links, and
prevent diagnostic pages from becoming accidental User Mode entry points.

Current valid families include home, markets (optionally venue/market and
summary), strategies, agent/status, activity/detail, account, safety, funding,
purchase status and credits. The route mismatch is visible in the [hub audit
table](index.html#audit). Treat Agent links as automation status in User Mode;
keep diagnostic details in Developer Mode.

### Proposed mode-aware destination mapping

These are presentation-layer examples for the later implementation, not
currently registered routes. `UserHome` and `legacyHome` are names proposed to
make the mode split explicit; auth, link allowlisting and the shared account
remain unchanged.

| Deep link | User Mode destination | Developer Mode destination | Guard |
|---|---|---|---|
| `home` | `UserHome` balance and next step. | `legacyHome` alias to the current `Main > Home` tab. | Preserve supported return/context parameters; do not change modes. |
| `markets` | Markets with supported search/market context. | Current Markets tab and its advanced details. | Validate IDs against available market data. |
| `markets/:venueId/:marketId` | Simple market detail; retain a validated market context. | Existing `MarketDetail` with valid venue/market IDs and diagnostics. | Preserve IDs and params only after allowlist, availability and auth checks. |
| `agent/status` | `run` summary when a run exists; otherwise a safe strategy/status destination. | Existing Agent/AgentStatus diagnostics. | Do not claim a run exists or change mode to reach diagnostics. |
| `account` | Settings entry. | Current Account tab. | Keep account and sign-in state shared. |
| Diagnostic or unregistered target | Safe settings notice explaining Developer Mode or route availability. | Open the diagnostic only after explicit Developer Mode opt-in and only if registered/authorized. | Never auto-enable Developer Mode; preserve IDs for a safe return and keep existing auth gates. |

Deep links select a destination within the user's current presentation; they
never toggle the presentation preference. Existing authorization, transaction
validation, consent, and backend gates stay in force for both shells.

## Current source anchors

Source paths are `src/navigation/RootNavigator.tsx`, `src/navigation/routes.ts`,
`src/navigation/linking.ts`, `src/navigation/TypographicTabBar.tsx`, and
`src/theme/tokens.ts`. These files are outside the docs-only static preview root;
use the repository checkout to inspect them.
