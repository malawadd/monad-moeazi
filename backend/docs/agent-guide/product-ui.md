# Product UI and UX

The Test Center renders Feature 22 only as a fixture-only, not-legal-advice result. Product-ready, compliance, KYC, sanctions, or eligibility status is intentionally unavailable.

## Two product surfaces

The public terminal and the signed-in portal have different jobs:

- `/trade/[coin]` and `/viz/[coin]` are streamlined market surfaces.
- The portal configures wallet, strategy, agent, models, policy, approvals, credits,
  venues, execution, and safety.

The Feature 20 Test Center panel is not a product approval UI: it displays only safe
fixture aggregates and always says product and dispatch are unavailable.

Do not move complex configuration into the terminal. The terminal’s agent status rail
summarizes the current team and links to the portal. Its drawer may show thesis,
scenarios, evidence summary, proposal reasoning, cost, history, freshness, confidence,
simulated P&L, pending approvals, exposure, health, and Pause.

The five visualization modes are Forces, Story, Scenarios, Agents, and Galaxy. They
must render human-readable agent data. Provider/model IDs belong only in technical
run details, not primary cards.

## Portal navigation

`components/StrategyShell.tsx` is the portal navigation source:

- Agent: My agent, Models & keys, Monitoring, Approvals, Agent activity,
  Guardrails, Credits.
- Account: Overview, Wallet, Deposits, Withdrawals, Settings.
- Trading: Terminal, Spot swap, Venues, Positions, Execution activity.
- Safety: Risk, Emergency stop.

Important routes:

| Route | Purpose |
| --- | --- |
| `/dashboard` | readiness and onboarding |
| `/agents/create` | four-step agent wizard |
| `/agents` | agent state, mode, next run, pause/resume |
| `/agents/models` | platform/BYOK routes and OpenRouter catalog |
| `/agents/monitoring` | usage and evidence-to-decision traces |
| `/agents/policy` | readable guardrails and policy activation |
| `/agents/approvals` | expiring proposal inbox |
| `/agents/activity` | analyses, simulations, trades, failures |
| `/credits` | available/reserved credits and estimates |
| `/venues` | one Arbitrum owner and six delegated connections |
| `/profile/wallet` | Particle/Magic signer and UA state |
| `/agent-lab` | development-only controls and routing lab |

Agent Lab is never a customer mode. Hide it unless development controls are enabled.

## Onboarding semantics

The intended sequence is:

```text
Sign in -> Enable/sync Arbitrum account -> Fund UA -> Connect venues
-> Create/configure agent -> Credits -> Activate
```

Shadow does not require trading authority. Approval requires fresh signatures.
Autopilot requires bounded persistent authority and explicit confirmation. Missing
readiness links directly to the relevant setup step; never tell users to “set up a
venue” without an actionable flow.

## Visual language

Preserve Moeazi’s established system:

- paper/ink surfaces, thick black borders, offset shadows;
- Syne headings, Plus Jakarta Sans body, IBM Plex Mono technical labels;
- sky for Shadow, yellow for Approval, mint for Autopilot, red for blocked/danger;
- color is always accompanied by text/status;
- compact categorical cards rather than generic SaaS glass/gradient styling.

Read `STYLEGUIDE.md` before material UI work. Prefer existing shell, panel, badge,
button, and CSS-module patterns over new component systems.

## Interaction requirements

- Responsive desktop/mobile layouts.
- Keyboard-operable dialogs, drawers, toggles, and model pickers.
- Focus is trapped/restored for modal surfaces.
- Loading, empty, stale, unavailable, partial, and error states are explicit.
- Dangerous actions explain impact and require appropriate confirmation.
- Turning off Manual Guard or Lite Mode requires the cost-impact phrase.
- Autopilot activation uses explicit confirmation and must display effective limits.
- Approval always explains expiry and that execution will requote/recheck.

## Human-readable model and trace UX

Display `OpenRouter -> Anthropic · Claude …` or the equivalent upstream identity,
not OpenRouter as if it were the model company. Primary agent cards should say what
was analyzed and concluded, not repeat raw provider/model strings.

Monitoring exposes concise structured inputs/outputs, evidence, usage, and decision
summaries. Never label hidden chain-of-thought as available.

## Authentication and proxies

Particle session cookies back the current authenticated Next.js proxies. Provider and
monitoring proxies verify the session, enforce path allowlists, attach the subject,
and add the service secret. Mutations reject cross-origin provider requests.

`middleware.ts` currently protects only an explicit prefix list; it does not include
every portal-looking route. Convex functions and server proxies must still enforce
viewer ownership. Do not assume page routing alone is authorization.

The generic agent backend proxy uses a separate allowlist. When adding a Python
endpoint, update the intended proxy deliberately and preserve query strings. Never
turn it into an unrestricted service tunnel.

## Error handling

FastAPI commonly returns `{ "detail": ... }`; Next.js proxy errors often use
`{ "error": ... }`. Client formatters should handle string details, Pydantic detail
arrays, nested error messages, and a final status fallback. Never render an object
directly or show `[object Object]`.

The Test Center Feature 15 result renders only aggregate current/superseded/dead-letter,
display and acknowledgement counts plus abbreviated hashes. It must not reveal audience,
membership, full message, policy, diagnostics, or incident authority state.
# Mandate-policy fixture UI

The Test Center may display only aggregate coverage, diff, receipt state and zero-cost
fixture metadata. It never renders raw clauses, identity, draft, confirmation,
activation or rollback controls. The product policy page remains unchanged and legacy.

# Customer contestation fixture UI

Feature 23 renders only synthetic case state, finding/appeal/remedy categories,
aggregate evidence/action counts, stable reasons and fixture safety labels in Test
Center. It never renders allegation, evidence, identity, reviewer, account, deadline,
remedy instruction or external-delivery content. Product case access remains unavailable.

# Calibrated selective-prediction fixture UI

Feature 37 requires explicit Feature 30/31/36 selections and renders only safe sample,
coverage, set/interval, shift, abstention, and zero-attempt facts. It has no threshold,
activation, proposal, mode, wallet, venue, signing, or execution control.

# Outcome-calibrated promotion fixture UI

The Test Center renders only bounded hashes, versions, integer metric intervals,
decision precedence, and zero-attempt counters. It offers no activate, demote,
rollback, prompt, model, policy, route, or customer-mode mutation control.
# Feature 38 Test Center surface

The analytical-diversity renderer exposes safe aggregate fixture metrics and explicit
revalidation context only. It does not render raw claims, evidence, outcomes, prompts,
identities, thresholds, model controls, policy actions, wallets, venues, or execution.
