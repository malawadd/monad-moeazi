# Route audit snapshots and current native bindings

The tables in [audit-data.js](audit-data.js) are the 11 October 2026 research
baseline. They record the pre-migration five-tab route graph, linked screens,
and design recommendations; later migration work does not rewrite that evidence.
The current data-driven native route graph is inventoried separately in
[migration-inventory.js](migration-inventory.js) and source-checked by
[`verify-hub.mjs`](verify-hub.mjs). That inventory covers 34 stack bindings,
five mode-aware tabs, User-only branch screens, and every current screen file.

## Historical baseline counts and navigation model

- 28 authenticated stack destinations were declared beside `Main` in the baseline root stack.
- `Main` is an additional authenticated root stack declaration for the tabs.
- `Main` contains five tabs: Home, Markets, Strategies, Activity and Account.
- `Welcome` is the signed-out route. There is also a loading state before routing.
- That gives 35 route bindings including Main, five nested tabs and Welcome.
- There are 32 unique screen component files among those bindings. `Agent` and
  `AgentStatus` point to `AgentScreen`; `PerplMarkets` aliases `MarketsScreen`.
- `src/navigation/routes.ts` also exports the existing five-tab names.

The full baseline route-by-route mapping (including the Main shell), then-current
behavior, proposed User Mode disposition and Developer Mode retention is rendered
in the route table on the [hub](index.html#audit). The source-of-truth detail
lives in [audit-data.js](audit-data.js). Current executable User/Developer
bindings live in the separate migration inventory described above.

## User Mode / Developer Mode research rule

At the time of this research baseline, User Mode was a proposed presentation
layer, not an implemented RootNavigator branch. The implemented migration now
uses a four-tab User shell (Home, Markets, Strategies, Activity) and an account
settings destination; Developer Mode retains the five-tab shell. Both share
authentication and underlying service/transaction boundaries. This source audit
does not prove native appearance or behavior; see the current migration inventory
and native verification records before treating a route as accepted.

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

## Baseline deep-link review

The baseline `safeMobileDeepLink` review found stale targets for `Safety`,
`Credits`, `PurchaseStatus` and `Withdraw`. Current allowlisting and mode-aware
redirects are maintained in `src/navigation/linking.ts` and
`src/navigation/presentationRoutes.ts`; unsupported targets now have an
`UnavailableDestination` route. The verifier checks that destinations are
registered and inventoried, but native behavior still requires separate testing.

At baseline, valid families included home, markets (optionally venue/market and
summary), strategies, agent/status, activity/detail, account, safety, funding,
purchase status and credits. The route mismatch is visible in the [hub audit
table](index.html#audit). An earlier proposal treated Agent links as a User
Mode status view. Current native destinations are listed below; the historical
route table and proposed mappings later in this file are research snapshots,
not the current registration contract.

### Current mode-specific legacy and diagnostic routes

`migration-inventory.js` records the live route access and component binding.
`Wrap`, `ManagedVault`, `AutonomyChoice`, `AutonomySetup`, `AutonomyStatus`,
`PerpSetup`, `PerpStatus`, `PerpHistory`, `AgentStatus`, and `AgentSettings`
are Developer-only routes. Their original component families remain registered
in Developer Mode. In particular, `AutonomyStatus` remains
`AutonomyStatusScreen`, `PerpStatus` remains `PerpStatusScreen`, and
`AgentStatus` remains the read-only `AgentScreen`; none is aliased to the
unrelated direct Perpl `PerplStatusScreen` in User Mode.

User deep links for `agent/status` and `autonomy/status` safely redirect to
Strategies without inventing a run or changing the presentation mode. The
direct `perpl/status` destination remains its separate User-capable route and
retains its direct-Perpl run identity. See `src/navigation/presentationRoutes.ts`
and `src/navigation/RootNavigator.tsx` for the executable behavior.

### Baseline proposed mode-aware destination mapping

These examples record the earlier proposal, not the current registration map.
The current route and component bindings are listed in
[`migration-inventory.js`](migration-inventory.js).

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
