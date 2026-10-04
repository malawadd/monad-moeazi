# Agentic dashboard implementation map

This is the integration ledger for the customer dashboard. A rendered card is not
proof that a research fixture is connected to product runtime or trading authority.
Update status and acceptance evidence as each integration lands. The signed-in
dashboard owns team configuration; Trade owns market selection and Viz remains a
separate future redesign.

| Capability | Customer location | Existing source / integration target | Status and next proof |
| --- | --- | --- | --- |
| Dashboard layout | Settings → Dashboard layout | `dashboardPreferences`, team pages | Implemented. Chrome changed preference twice; refresh preserved Agent workbench. Team workspaces uses team tabs; workbench keeps the team rail while each section leads with its own task. The decision workflow appears only for a selected run. Terminal/Viz routes are unchanged. |
| Portal visual theme | Settings → Visual theme | Per-user `dashboardTheme`, portal shell and theme-aware agent styles | Implemented on development `outgoing-spider-101`. Bold remains the default; Studio changes the signed-in shell, shared panels, account pages, and agent controls independently of layout. Signed-in Chrome verified persistence, all four layout/theme selections, account and team pages, 390px Configure/Research, and Terminal/Viz isolation. Public pages and demos remain outside the theme scope. |
| Teams and versions | My Teams → Create → Configure | `agentProfiles`, `agentTeamVersions`, `agentTeamMutations`, `agentTeamArchive` | Implemented for non-trading setup. Two-column mode-coloured cards and a dedicated preset/review route lead to paused v1. Advanced draft/version saves do not select a deployment version. Recoverable deletion preserves history; restore rechecks fresh capital. Previously funded deployments remain blocked from deletion until position and obligation reconciliation exists. Funded allocation admission remains gated. |
| Models, keys, and future-team defaults | Models & Keys → Configure | `modelProviderConnections`, `agentTeamModelDefaults`, immutable team-version routing | Implemented. Shared verified connections stay account-scoped; new future-team defaults are isolated from the older active account route and all existing versions. Configure changes provider-wide billing source only in the draft and explains affected stages. Stage/model pickers preserve a source change's model IDs, expose compatibility/rate issues, and separate Moeazi credits from direct BYOK spend. Unknown/untested routes remain reviewable but customer Research preview rejects them with the stage, model, and payer. Compatibility probes remain explicit and may be billable; no probe was run for this change. |
| Market deployments | Trade rail and team Overview | `agentMarketDeployments`, `agentRuntime`, Temporal schedule manager | Configuration and explicit pause implemented, activation pending. Chrome stored two distinct BTC Shadow deployments and verified the URL-selected team/version in the terminal rail; both stayed paused. Schedule admission, job and proposal identity, snapshot selection, and trace metadata carry team/version/deployment IDs. Start remains gated pending full reservation and execution checks. |
| Allocation and effective limits | Account Overview, Configure, Decisions | Wallet asset projections, policy, proposal and execution checks | Partial. Save validates fresh reconciled capital and account-wide team allocations; reduction is blocked while deployments are active or funded. Open position, pending-obligation, uncertain-execution, and per-action spending checks still need integration. |
| Specialist composition | Configure, Decisions | Canonical `roles.py`, `orchestrator.py`, model routing and prompt bundles | Worker integration implemented for saved participation, instructions, horizons, model routes and existing quorum when a team-version job runs. Three focused role tests pass. New deployments remain paused until activation checks are complete. |
| Monitoring and cost | Monitoring, Decisions, Performance | `tracing.py`, `monitoring_api.py`, Convex jobs and credit ledger | Implemented team/version/deployment/market attribution for new runs and usage, with account totals retained and Legacy/unattributed remainder. Current team Performance separates Shadow from funded results and compares saved versions. Historical detail remains unattributed. |
| Customer experiments | Research | Evaluation Lab v2 planner, Temporal queue, Timescale scorecards | Customer-scoped read-only quote and preview/start/list/detail/cancel routes implemented. Quote reuses the planner without persisting a preview or reserving budget. Frozen owner/team/account binding and stage-specific route prices are rechecked at Start. Convex credit settlement counts validated platform/BYOK calls; Redis reserves the provider-work safety cap. Signed-in Chrome completed a local deterministic replay with zero provider spend. Live provider evaluation was not probed. |
| Agent agreement and diversity (28, 38) | Research capability / Decisions | Claim disagreement and analytical diversity fixture evaluators | Research preview — integration required. Establish product evidence identity, report provenance, and chronological validation before using runtime conclusions. |
| Evidence quality (29, 30) | Research capability / Decisions | Source-value and evidence-integrity fixtures | Research preview — integration required. Correct live citation provenance and validate on frozen replay/Shadow history before gating. |
| Portfolio sizing and venue quality (31, 32) | Research capability / Configure | Portfolio sizing and execution-quality fixtures | Research preview — integration required. Revalidate actual positions, quotes, venue eligibility, exact units and deterministic routing. |
| Calibrated Shadow and costs (33) | Research capability / Performance | Shadow/TCA fixture | Research preview — integration required. Join real simulated lifecycle and transaction-cost observations without treating synthetic fills as product results. |
| Evidence-change scheduling (34) | Research capability / Configure | Deterministic run-planning fixture | Research preview — integration required. Add durable event admission, freshness and budget checks before Temporal scheduling. |
| Decision memory (35) | Research capability / Decisions | Outcome-linked memory fixture | Research preview — integration required. Verify real outcome ownership, immutable lineage and retrieval isolation; never auto-change authority. |
| Candidate promotion evidence (36) | Research capability / Research results | Promotion/demotion fixture and Evaluation Lab scorecards | Research preview — integration required. Require outcome maturity and explicit user activation; a scorecard never promotes itself. |
| Calibration and abstention (37) | Research capability / Decisions | Selective-prediction fixture | Research preview — integration required. Calibrate on qualified chronological outcomes before any proposal gate consumes it. |

Infrastructure fixture work such as secret custody, recovery, operator qualification,
and certification must remain outside customer controls. Shadow, Approval, and
Autopilot are customer authority modes; Manual Guard and Lite Mode remain development
safeguards. Private signing and live execution remain certification-gated.

## Verification evidence

- 2026-09-30 visual theme: `npx convex dev --once` applied the optional per-user
  theme field and owner-scoped mutation on `outgoing-spider-101`; no data migration
  was needed. Three preference tests, `npx tsc --noEmit`, `git diff --check`,
  and the full production build passed. Signed-in Chrome persisted Studio after
  refresh, then exercised Bold and Studio with both dashboard layouts. An unsaved
  Settings value survived theme and layout switches. Studio My Teams, Configure,
  Research, Models & Keys, and Account Overview were inspected. The 390px
  Configure/Research viewport had no page-wide horizontal overflow; the mobile
  utility header was adjusted to keep the breadcrumb and wallet controls legible.
  Terminal and Viz did not mount the themed portal shell. Team workspaces and
  Studio were restored for review. Paid probes and trading were not run.

- Baseline Chrome inspection: signed-in `/trade/BTC` shows current Shadow rail;
  `/agents/monitoring` returned HTTP 500 and falsely displayed zero usage. API logs
  identified `date >= integer` in `TraceRepository.usage_summary`.
- Development Convex deployment approved: `outgoing-spider-101`; cost unknown.
  `npx convex dev --once` succeeded. Migration first run examined 1, migrated 1,
  finished; second run examined 1, migrated 0. No work was dispatched.
- Models & Keys update: `npx convex dev --once` completed against `outgoing-spider-101`.
  Future-team-default migration examined 2 accounts and seeded 2 records; its second
  run examined 2 and seeded 0. It did not modify active routes or team versions.
  Focused model/cost TypeScript tests passed (11), `npx tsc --noEmit` passed,
  and `npm run build` completed. Customer Research Python route tests passed
  (12, with one local-database test skipped for missing test DSN). The local
  Python API and evaluation-worker images were rebuilt; API `/health` returned 200.
  Signed-in Chrome showed compact provider cards, aligned stage rows, searchable
  keyboard model selection, and Enter/Space disclosure behavior. Configure updated
  its quote immediately when an unpriced platform model was replaced and when a
  draft switched to a mixed BYOK route; neither change called a provider or saved
  a deployment. Agent workbench preference survived refresh, then was restored to
  Team workspaces. Terminal and Viz kept their separate layouts. The connected
  Chrome viewport override reported success but did not change `innerWidth`, so a
  fresh mobile visual pass remains unverified; responsive CSS was inspected.
- Local Python API image rebuilt and restarted with previous worker URL, secret,
  Manual Guard ON, Lite Mode ON, live execution OFF unchanged. Database regression:
  3 tests passed inside the API container; direct usage query returned an empty
  result without the prior date/integer PostgreSQL error.
- Signed-in Chrome: Settings stored Agent workbench and survived refresh; My Teams
  created a Focus team, inspected all 20 role cards, saved a draft and v2, and
  Research preview returned grounded cost and global-capacity errors. Terminal BTC
  showed v2 selected in a paused Shadow deployment and linked back to its Configure
  page. The manual chart, order book, ticket, and balances remained present.
- Chrome duplicated the team into a second identity. Trying to save a $10 allocation
  without fresh account capital returned a styled error, retained the form value,
  and exposed diagnostics. The legacy `/agents/create` entry now leads to My Teams.
- Chrome stored BTC Shadow deployments for both research teams. The terminal rail
  selected the team from its URL and showed only that team's version and status;
  a market without an explicit selection no longer merges teams' proposals or
  Shadow P&L. Pause targets the chosen deployment, records an audit event, and
  leaves positions and obligations intact. Chrome confirmed dialog focus moves
  to Close on open, wraps with Shift+Tab, and returns to Select team on Escape.
- At 390px Chrome viewport, both dashboard layouts rendered their team content.
  The workbench initially exposed page-wide horizontal overflow from its rail;
  constraining the workbench grid item reduced body scroll width from 1181px to
  375px. The appearance preference was restored to Team workspaces and the
  viewport reset. Initial team pages now hold a bounded connection state while
  authenticated Convex access initializes instead of flashing a false not-found.
- Changed Python API, worker, and evaluation-worker images rebuilt locally. API
  restarted; the database regression and three saved-role tests passed together
  (4 passed). `npx tsc --noEmit`, targeted ESLint,
  and the full Next production build passed. A fresh signed-in Chrome tab then
  rendered My Teams and Overview from Convex with all three persisted teams and
  the revised team readiness state. The original Chrome tab lost its debugger
  connection during the rebuild; the fresh tab was kept open for review.
- Final idempotency check on `outgoing-spider-101` examined three profiles and
  migrated zero. The final production build passed with the new team and trade
  routes. After the local development server restarted, signed-in Chrome showed
  the three persisted teams at `/agents` without console errors. The verification
  screenshot is `docs/agentic-dashboard-chrome.png`.
- Full customer workflow acceptance is **not complete**. The funded market control,
  committed exposure/obligation checks, team cost filtering, local deterministic
  experiment execution/results, and remaining failure journeys are pending. Do not
  enable new teams for funded or automatic analysis until those paths enforce
  explicit deployment identities and limits end-to-end.

## Non-trading dashboard phase, 2026-09-29

- Agent workbench no longer repeats the five static workflow cards. Overview links to
  Decisions; Decisions renders the existing sanitized graph only for a selected
  owner-scoped run, with an empty explanation when no run exists. Configure,
  Research, and Performance lead with their own task content.
- Preset review now exposes all starting limits and participating specialists.
  Chrome created the paused `Dashboard QA Team` v1 with zero trading allocation
  and $1,000 separate Shadow virtual capital. No work was dispatched.
- Customer Research uses a separate `/v1/customer-research` API and Next proxy;
  operator-only Lab routes remain separate. Preview records are bound to owner,
  team and account. Older Lab rows remain unattributed. Experiment starts require
  a current preview and finite accepted limits. Outcomes cannot select a market
  version or increase authority.
- Timescale migration `054_customer_team_attribution.sql` ran twice locally with
  no second-run changes. `npx convex dev --once` applied additive Convex fields
  to `outgoing-spider-101`; `agentTeamMigration:run` examined 3 and migrated 0.
  The local Python API was rebuilt and restarted. Health reports Manual Guard ON,
  Lite Mode ON, and live execution OFF. No active evaluation experiments existed
  before restart.
- Focused Python tests: 20 passed, covering customer owner/team isolation,
  preview drift, database binding, legacy usage remainder, monitoring date query,
  Lab v2 planner and role composition. TypeScript and Next production build passed
  before the final small attribution edits; rerun after those edits.
- Signed-in Chrome: the preset review and v1 creation worked; Research preview
  showed 1 replay observation, 8 calls, expected $0.0379, maximum $0.0533,
  provider services, 28-credit ceiling, 0 available credits, and shared capacity.
  Start was blocked. Layout switched from Agent workbench to Team workspaces,
  survived refresh, and returned to the same team/Research section. Decisions
  showed the no-run state; Performance separated unavailable funded returns from
  Shadow and team usage. Monitoring loaded successfully without HTTP 500.
- The signed-in test account received its one-time 100 development credits after
  `AGENT_DEV_CONTROLS_ENABLED=true` was set on the approved development Convex
  deployment. This did not change Manual Guard, Lite Mode, or execution gates.
  The Research preview froze one fixture observation and seven calls with a
  $0.0421 saved-route ceiling, 25-credit reservation, and explicit local-test label.
- Chrome completed a local deterministic replay for `Dashboard QA Team`: six
  specialist reports, six valid citations, a scorecard, $0 actual provider cost,
  and 25 settled development credits. A second scheduled Shadow-observation
  experiment reserved 50 credits, completed one observation, then canceled;
  25 credits settled and 25 were released. Results are labelled local tests,
  not live team conclusions. The account-scoped archive read now returns the
  validated run and specialist summaries. No external model call was made.
- The integrated run exposed and fixed three previously unexercised storage
  defects: JSON-frozen timestamps were passed as strings to timestamp/date
  columns, six-role archives exceeded the generic lifecycle shape bound, and
  customer archives were written under account scope but read under operator
  tenant scope. Evaluation archives now have a finite larger shape bound while
  secret screening, expiry and exact-scope checks remain in force. Failed starts
  released credits and Redis capacity; the page retains the form and shows a
  short recovery message with diagnostics collapsed.
- After the user restored the development Convex limit, the idempotent migration
  check examined 4 profiles and migrated 0. Signed-in Chrome confirmed that Agent
  workbench was saved after refresh, the four-team directory and QA team Overview
  loaded, and Research retained the completed and canceled local tests with
  25 settled and 25 released credits on cancellation. Decisions showed an optional
  explanation instead of the five-card stack. At 390px viewport, the workbench
  had no page-wide overflow (375px document width); Tab focused the All teams
  link. The viewport override was reset. The separate BTC terminal retained the
  market selector, chart, order book, manual ticket and balances; Viz remained
  its own route. No browser console errors from Moeazi were observed.
- Monitoring loaded with HTTP 200 usage, run and safety queries, team and
  Legacy/unattributed filters, and no misleading zero for missing call metrics.
  Credits showed 50 available, 0 reserved, and the QA team's exact reserve,
  settle and release entries. This account has no private analysis trace, so
  Chrome confirmed Decisions' empty state and explanation; a selected real-run
  graph still needs a future non-trading private run for visual verification.
- Final focused Python suite: 35 passed, covering ownership, preview drift,
  reservation/settlement cleanup, cancellation, attribution, legacy rows,
  monitoring date arithmetic, role composition and archive disclosure. TypeScript
  checking and the Next production build passed after the integration changes;
  a final copy-only Research label/availability change also passed TypeScript.
  Features 28–38 stay **Research preview — integration required**. Agent starts,
  funded control, signing, and live execution stay gated for the later phase.

## Visual hierarchy and live quote phase, 2026-09-30

- My Teams now has two-column Shadow/Approval/Autopilot cards with separate deployment modes, saved/running/draft versions, relevant capital, daily research ceiling, and next actions. The long preset form moved to `/agents/create`; its review lists all specialists and effective starting limits before saving paused v1. Team workspaces and Agent workbench keep the same backend data.
- Configure now has sky mandate, orange limits, lilac specialist studio, and a persistent lilac review. The review recomputes runtime-equivalent specialist/synthesis call counts and route-aware credits and BYOK estimates as fields change. It distinguishes expected/maximum credits, direct BYOK dollars, available credits, and cadence versus daily ceilings. Saved versions remain independent of selected market versions.
- Research now places experiment inputs beside a persistent lilac quote. The authenticated quote endpoint is owner/team scoped and uses Evaluation Lab v2 planning with `persist=False`; browser edits changed a two-version maximum from 64 to 32 credits and 16 to 8 calls. Timescale preview count stayed at 22 through read-only quote changes. Review created the frozen preview separately; Start rechecked it. Optional forecast/strategy/grounding routes now require known prices. Frozen saved versions carry enabled specialist instructions and horizons into evaluation prompts. Research quotes reflect the selected evaluation stages; Configure's per-run estimate reflects the team's runtime tier.
- A paused test team was created, archived through exact-name dialog confirmation, opened as read-only history, and restored paused in signed-in Chrome. Active selectors and allocation sums omit archived teams. The archive blocker checks deployments, jobs, proposals, approvals, open Shadow positions, and credit reservations. Teams with past funded deployments remain conservatively blocked until full position/obligation reconciliation is available.
- Convex dev target `outgoing-spider-101` accepted the additive schema/functions via `npx convex dev --once`; the final idempotent team migration examined 5 and migrated 0. Local API and evaluation-worker images were rebuilt with deterministic customer Research enabled; live execution remained off. Database-backed focused Python suite: 30 passed. Targeted TypeScript tests: 8 passed. Type checking and the production build passed.
- Signed-in Chrome verified both layout preference and return to the same team/section. A fresh deterministic replay for the test team completed seven calls with six specialist reports, 25 settled credits, and $0 actual provider spend; results remained labelled local test data. Research and Configure showed no Moeazi browser console errors. At a 390px viewport, Research body width was 375px with no page-wide overflow; the viewport was reset.
- After the final local service rebuild, Chrome loaded the redesigned My Teams and Configure pages and returned a 200 quote in Research. My Teams also fit a 390px viewport without page-wide overflow. The Chrome connection dropped while switching to the other mobile layout; that final mobile pass could not be repeated. The archived `Visual QA archive check` fixture remains recoverable in the development account, and its deterministic run settled 25 development credits.
