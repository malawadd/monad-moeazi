# Agent System, Models, and Credits

Feature 22 is deterministic fixture evaluation, not an LLM legal or eligibility decision. Agents receive no authority, external source access, or product permission from its result.

Feature 37 is likewise a local deterministic calibration/abstention fixture. It never
routes a model, changes authority, creates a proposal, or receives a wallet, signer,
venue, provider, or execution capability.

Feature 38 only audits frozen synthetic path identity and correlated error. Different
gateways never become separate families, and its result cannot choose a model, change
quorum, route work, create a proposal, or authorize execution.

## Customer modes versus development controls

Feature 29 source-value attribution is not a customer mode or runtime gate. Its local
Test Center evaluator consumes synthetic fixtures only and cannot call a provider or
change specialist, quorum, proposal, or execution behavior.

| Concept | Meaning |
| --- | --- |
| Shadow | Automatic analysis, proposal, fresh quote, simulated fill; no signing |
| Approval | Automatic analysis and expiring proposal; user approval starts requote/preflight |
| Autopilot | Automatic analysis and immediate execution workflow within policy ceilings |
| Manual Guard | Development-only block on cadence/event dispatch |

Feature 20 Test Center ceremony is synthetic and deterministic; it does not send a
packet, nonce, signature, credential, or execution capability to a model.
| Lite Mode | Development-only cap on calls, markets, tokens, retries, cadence, and spend |

Legacy authority value `insights` normalizes to Shadow. Venue setup uses `approval`
while the agent authority enum uses `approval_required`; do not silently interchange
them at persistence boundaries.

Feature 18's local authority-mode/cadence/approval bindings are comparison-only typed
fixture inputs. They cannot mutate an agent profile or authorize customer mode changes.

## Teams and deployments per strategy account

`agentProfiles` contains multiple customer teams per strategy account. Each links
name, tier, legacy profile defaults, cadence, lifecycle, pause and schedule revision.
`agentTeamVersions` preserves saved configuration; `agentMarketDeployments` binds a
team/version to a market, venue and customer mode. Account-index queries must not
choose the first profile as an authoritative controller. `agentMarketSubscriptions`
provides watched-market rows used by scheduling and discovery. The master evolution
plan adds explicit managed-mobile assignments without replacing customer teams.

A normal private run is:

1. A manual request or Temporal schedule creates one idempotent `analysisJobs` row.
2. The job is claimed and credits/provider budget are reserved.
3. The worker reloads the exact active model-configuration version.
4. Bounded sanitized evidence is loaded from Timescale.
5. Specialists return validated `SignalReport` objects.
   Model-selected citation IDs are resolved to supplied canonical references;
   invented IDs neutralize the report and remain in structured audit evidence.
   Exact-ID resolution does not prove that a source supports the claim.
6. Synthesis returns `MarketSynthesis`; quorum and critical-role rules are enforced.
7. Timescale stores the complete run and trace.
8. Convex patches the current snapshot, settles validated output costs, and may create
   a typed `TradeProposal`.
9. Proposal routing follows Shadow, Approval, or Autopilot semantics.

Workflow IDs are intentionally deterministic (`analysis-{jobId}`,
`execution-{proposalId}`) to make retries idempotent.

## Roles and tiers

The canonical role order is in `roles.py` and `lib/modelProviders.ts`.

- Focus: 6 roles and synthesis.
- Pro: 12 roles, four critical roles duplicated across providers, critic, synthesis.
- Max: 20 roles, ten directional/risk roles duplicated, primary/challenger
  syntheses, arbiter.
- Lite: technical trend and liquidity only, deterministic synthesis, at most two
  provider calls.

Focus needs at least four valid specialists. Pro needs at least eight valid reports,
Max at least fourteen. Pro/Max also require every critical role and two validated
canonical model families unless a deliberate degraded/single-provider development
setting applies.

## Provider and route model

Providers are `openai`, `deepseek`, and `openrouter`.

An activated, versioned routing document selects a route per role/stage:

```text
slot, provider, model, credentialSource, connectionId,
maxOutputTokens, reasoningEffort, price snapshot, OpenRouter preferences
```

Slots include `specialist_default`, `role:{role}`, `synthesis`, `critic`,
`synthesis_primary`, `synthesis_challenger`, `arbiter`, and `policy_draft`.
Legacy `openai_synthesis` and `deepseek_synthesis` names normalize when old routing
documents load. Never silently substitute a different model.

Platform routes use environment credentials. BYOK routes use a verified encrypted
connection and lower infrastructure credits because the provider bills the user.

## OpenRouter rules

OpenRouter supports customer BYOK and Moeazi-owned local development credentials:

- The authenticated catalog is fetched remotely and cached for five minutes in Redis.
- Convex stores only connection summaries and successfully probed models, never the
  entire catalog.
- Search supports author/name/ID and exact IDs.
- A model must pass a strict JSON Schema probe before assignment to an agent role.
- “Available but no eligible host supports strict structured output” means ordinary
  chat works, but no allowed upstream host can guarantee the typed agent contract.
- The chosen model is fixed. `allowFallbacks` means same-model upstream-host fallback,
  not cross-model fallback.
- Safe defaults are price-first, parameter support required, data collection denied,
  and zero-data-retention required.
- Relaxing data collection/ZDR requires explicit confirmation.
- Maximum endpoint price is pinned from the probe; a higher price fails safely.

The loopback operator console can write a Moeazi-owned key into the ignored
`.env.agents.monad` file and restart analysis workers. Its mobile program editor freezes
model routes as candidate versions; release changes future enrollment selection only.
Existing mobile mandates remain pinned until the customer completes a compatible
version-aware reauthorization. Platform OpenRouter candidates use endpoint metadata
  to inspect strict structured-output support and maximum listed prices without a
  paid generation. Releasing an OpenRouter candidate runs one explicit paid typed
  compatibility call per distinct model after a listed-price estimate check; a
  failed probe prevents the release. Metadata alone is not a successful call or
  balance check.

Quorum counts canonical analytical families, not gateways. Direct OpenAI and an
OpenRouter-hosted OpenAI model count as one family. Missing OpenRouter routing metadata
cannot provide the second family.

## Secret handling

For customer BYOK, the browser sends provider keys only through the authenticated
provider proxy. Python verifies the key, encrypts it into the provider vault, and stores only
`secretRef`, fingerprint, last four characters, status, and capabilities in Convex.

For Moeazi-owned local keys, the browser sends the key to the loopback console.
The console verifies backend operator authority, writes only the fixed provider env
entry in `.env.agents.monad`, and restarts the API and analysis workers. The key is never
sent to Convex or exposed in console status responses.

Local development uses `MASTER_KEY` AES-GCM wrapping. Production must use KMS. A
decrypted secret exists only for the scoped provider call and must be zeroed after
use. Never log it, return it, store it in Redis, or put it in a Temporal input.

Feature 04 does not replace this live path. It proves the intended access and receipt
contract only with checked-in fake-vault fixtures; product custody and real migration
remain unavailable. Model and orchestration workloads are explicitly denied consumers.

## Cost and credit accounting

Before activation and manual dispatch, the UI shows expected provider spend,
worst-case spend, calls/run, daily ceiling impact, infrastructure credits, and runs
remaining.

For private work:

1. Reserve integer Moeazi credits before dispatch.
2. Reserve the configured provider-cost ceiling in Redis for BYOK and platform
   OpenRouter routes.
3. Settle credits only for validated successful outputs.
4. Release unused credits after failure/partial completion.
5. Settle the provider-cost reservation against reported actual cost where available.

OpenRouter `usage.cost` is authoritative; generation lookup or a conservative stored
estimate is the fallback. Invalid output and platform retries are operational cost,
not successful billable output. Public shared analysis is platform-funded.

## Monitoring

`/agents/monitoring` shows tenant-scoped runs and usage. Run detail renders a React
Flow graph from evidence through specialists, synthesis, deterministic checks,
proposal, and execution outcome. It includes requested/served model, upstream host,
fallback attempts, token usage, cost source, actual cost, latency, concise inputs and
outputs, and human-readable decision summaries.

Never expose hidden chain-of-thought. “Reasoning” in UI means evidence, factors,
uncertainty, structured output, and deterministic decisions.

Monitoring also shows the current dependency-safety matrix and incidents. These are
deterministic authority reductions, never model reasoning or model-visible tools.
Safety changes arrive on the authenticated SSE connection without polling.

## Model and strategy proving ground

`/agent-lab/evaluations` is an internal, operator-allowlisted, development-only
surface. It snapshots the current routing market catalog, prompt/model route,
evidence, price inputs, strategy specification, and budget before starting an
immutable experiment.

Evaluation work runs on the `moeazi-evaluations` Temporal queue. Replay subjects
receive byte-identical frozen inputs; live-shadow subjects use the same point-in-time
snapshot. The evaluation worker may call analytical providers and public routing
reads, but it has no proposal, signing, broadcast, or execution workflow imports.
Each replay also runs six automatically budgeted adversarial cases covering missing
and stale evidence, contradictions, prompt injection, wrong-market leakage, and
confidence inflation.

Scorecards keep grounding, validation, forecast, usage, and simulated-strategy
metrics separate. They do not expose hidden chain-of-thought or collapse safety and
performance into one composite score.

Versioned routes also drive three evaluation-only structured stages: multi-horizon
forecasting, sampled semantic grounding, and model-directed trade intent. Each call
has its own prompt, token usage, provider cost, and validation trace. The strategy
intent remains simulation input; deterministic limits clamp its risk and it has no
execution capability.

Evaluation Lab v2 starts with no implicit scope. Operators explicitly select frozen
cases, markets, subjects, roles, routes, prompt bundles, stages, horizons, safety
cases, cadence, and a finite duration. Previewing makes no provider calls. It
materializes an immutable work plan and separates realistic expected cost from the
fully funded maximum by phase, subject, stage, and UTC day.

Built-in presets are opt-in templates, never defaults. They include Top-5 smoke,
ETH adversarial, BTC/ETH disagreement, and a 30-day ETH-only proving run. The
ETH proving preset freezes a $5 total hard cap into the experiment spec: pricing
or scope changes that exceed it make preflight infeasible instead of weakening the
test or silently increasing the ceiling.

Start is disabled until the complete maximum fits the computed per-observation,
peak-day, total, and shared global capacity. The preview hash prevents route, price,
catalog, or prompt drift. Production-compatible prompts may be cloned into
owner-scoped lab drafts and frozen as immutable evaluation-only versions; they never
activate customer model configuration.

### Customer contestation fixture plane

Feature 23 is an isolated Test Center case graph, not a customer-support or remedy
agent. It accepts only checked-in synthetic cases, requires Feature 20's same-
operator context, and projects safe aggregate status. It never exposes an LLM to
customer identifiers, legal determinations, remedy authority, signing, or delivery.

### Outcome-calibrated promotion

Feature 36 consumes no model output and never changes a model route, prompt, role,
policy, customer mode, or authority. Feature 33 and 35 selected runs are untrusted
lineage marked `requires_revalidation`, not authoritative outcome evidence.
