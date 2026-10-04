# Runtime and Operations

Feature 22 defaults off. Its local Test Center fixture path may be enabled only through existing isolated controls and an explicit Feature 21 selection; it does not fetch sources, call providers, or perform an operation. Product/runtime enforcement remains unavailable.

Feature 07 is disabled by default. Its `enforce` layer exists only for isolated
synthetic Test Center runs and cannot enable catalog routing, metadata access,
signing, venue activity, or product authority.

## Supported local lifecycle

Run from the repository root:

```powershell
npm run stack:start
npm run stack:stop
```

`stack:start` starts the copied Next.js app on `3102`, its self-hosted local Convex
deployment, the `moeazi-monad` Docker agent stack, and the lightweight console on
`3104`. Normal starts rebuild images, apply SQL migrations, and address only that
Compose project. It is safe to rerun alongside the Arbitrum stack.

Partial starts:

```powershell
npm run dev:frontend
npm run dev:backend
powershell -File scripts/start-agent-stack.ps1
powershell -File scripts/start-agent-stack.ps1 -InfrastructureOnly
```

Python source is copied into the image; there is no development bind mount. Rebuild
after backend changes. The isolated launcher deploys Convex to its self-hosted local
backend. Do not set `CONVEX_DEPLOYMENT`; it selects a different CLI-managed target.

Run `npm ci` once in `backend/` before first use. `stack:start` deploys the Convex
functions to the persistent local self-hosted backend and starts its dashboard.
The app's private JWT key and CLI admin key stay in ignored local environment files.

## Local addresses

For mobile provider env/source changes, use `scripts/reload-mobile-integrations.ps1`
(add `-Build` for sidecar source changes). It reloads only execution-sidecar and does
not start AI workers or make provider calls. See [local integration setup](../mobile-local-integrations.md).

| Surface | Address |
| --- | --- |
| Product | `http://127.0.0.1:3102` |
| Lightweight operator console | `http://127.0.0.1:3104` (loopback only) |
| Convex query API / site actions | `http://127.0.0.1:3310` / `http://127.0.0.1:3311` |
| Convex dashboard | `http://127.0.0.1:6891` |
| Agent health | `http://127.0.0.1:9100/health` |
| Gateway health | `http://127.0.0.1:9200/health` |
| Sidecar health | `http://127.0.0.1:9300/health` |
| Temporal UI / gRPC | `http://127.0.0.1:18233` / `127.0.0.1:17233` |
| Postgres | `127.0.0.1:15432` |
| Redis | `127.0.0.1:16379` |

For the authenticated Android journey, account owners, provider routing,
test-credit controls, and the phone-build boundary, see
[Mobile Autopilot and local operator controls](mobile-runtime.md).

## Environment precedence

`scripts/setup-monad-local.ps1` creates ignored `.env.local`, `.env.agents.monad`,
and `.env.convex.monad` files with independent generated secrets. The launcher uses
only `.env.agents.monad` for the explicit `moeazi-monad` Compose project.

Use `docker compose -p moeazi-monad --env-file .env.agents.monad -f
docker-compose.agents.yml ...` when inspecting the stack. Never issue unscoped
`compose down` commands from this copy.

The same `WORKER_SHARED_SECRET` must exist in Next.js, Python, and Convex. The Python
worker URL is the Convex HTTP action URL ending in `/worker`, not the Convex query
URL. Host Next uses `127.0.0.1:3311`; containers use the internal `convex:3211`.

Never commit `.env*` files containing real secrets. Web customer OpenRouter BYOK
connections use `/agents/models`. Moeazi-owned mobile credentials are separate:
the loopback operator console can save provider credentials in ignored
`.env.agents.monad` and reload analysis workers. Key presence alone does not select a mobile model or
prove a successful provider call.

## Development safety defaults

Keep these effective during ordinary development:

```text
AGENT_DEV_CONTROLS_ENABLED=true
AGENT_MANUAL_GUARD_DEFAULT=true
AGENT_LITE_MODE_DEFAULT=true
MAINNET_VENUE_SETUP_ENABLED=false
LIVE_EXECUTION_ENABLED=false
DEPENDENCY_SAFETY_MODE=observe
CERTIFIED_VENUES=
```

`observe` is the tracked default. Use `enforce` only for local fixture/shadow
acceptance. Startup fails if live execution is enabled while dependency safety is
observe-only.

Manual Guard pauses Temporal schedules, blocks automatic dispatch, and permits
explicit manual runs. Lite Mode clamps work to one market, two specialist calls,
250 output tokens per specialist, three short evidence items, no retries, one
concurrent provider call, minimum 15-minute cadence, four account runs/day, eight
global runs/day, and the configured provider daily budget (default `$0.10`). The
default Lite assignments use DeepSeek, but activated customer routing can currently
override their provider/model; see the known-gaps guide.

Missing Redis runtime-control state resolves to both safeguards ON. Use `/agent-lab`
to inspect effective state and restore safe defaults.

Dependency Test Center is a separate local-only process and defaults unavailable. It is
not mounted in the main API; start the `test-center` Compose profile and its host port is
published only as `127.0.0.1:9110`:

See [Test Center access](test-center-access.md) for the exact signed-in subject
allowlisting flow, correct product URL, startup verification, and failure messages.

```text
AGENT_TEST_CENTER_ENABLED=false
TEST_CENTER_OPERATOR_SUBJECTS=
TEST_CENTER_BIND_HOST=127.0.0.1
TEST_CENTER_EXTERNAL_NETWORK_ENABLED=false
TEST_CENTER_REPOSITORY_SHA=<reviewed 40-character SHA when explicitly enabled>
```

Enabling it requires an explicit local/development/test environment, a non-empty
Particle-subject allowlist, a frozen repository SHA, loopback configuration, closed
live/setup gates, empty certified venues, and external networking disabled. Controls
are per operator-session Redis CAS leases capped at two hours; Redis loss returns off.
The legacy `/agent-lab` root is intentionally page-level disabled; it is not a fallback
transport for internal endpoints.
The Compose service does not inherit the shared agent environment or env file. It joins
only the internal `test-center-runtime` network with Timescale and Redis, so it has no
provider, Convex, Temporal, RPC, venue, execution, sidecar, or external DNS path.

Test Center leases are feature-scoped. Feature 02 recovery defaults off; observe
requires Feature 01 through project, and isolated enforce requires Feature 01 through
enforce. A passing recovery fixture grants inspection only and never changes product
recovery readiness, which remains `UNKNOWN` until separately approved native drills.
Feature 03 lifecycle controls also default off and require Feature 01 through the same
layers. They are available only after implementation verification; deferred audit
findings are displayed and frozen into each run but never enable product activation.
Feature 04 custody controls default off and require Features 01, 02 and 03 through
project for observe and through isolated enforce for enforce. The closure is one
sorted atomic lease snapshot. Only the checked-in fake-vault corpus is available;
product custody, cloud KMS, real migration and workflow registration remain off.
Feature 05 artifact certification is also Test Center-only. It freezes the Feature
01–04 prerequisite closure, evaluates checked-in local fixture identities, and
persists local history. Its lease defaults off; no setting enables product use,
signing, RPC, or automatic requalification.
Feature 08 capability delegation defaults off and requires Feature 05 and 06 through
project for observe and through isolated enforce for enforce. Its grants and
revocation records are synthetic fixtures only and cannot enable product authority.
Feature 12 venue price/liquidation safety defaults off and requires Feature 07 through
project for observe and isolated enforce. Its price, margin and liquidation inputs are
checked-in synthetic fixtures only; no control enables a venue, price feed, signer or
product execution.

Evaluation Lab adds an independent fail-closed budget and operator boundary:

```text
EVALUATION_TASK_QUEUE=moeazi-evaluations
EVALUATION_TRACE_RETENTION_DAYS=90
EVALUATION_GLOBAL_BUDGET_USD=0.10
EVALUATION_OPERATOR_SUBJECTS=<comma-separated Particle subjects>
```

The operator list may be empty only in local/development/test environments. Every
experiment also requires per-observation, daily, and total cost ceilings. Budget
exhaustion pauses the durable workflow; it never enables customer schedules or live
execution.

V2 computes the required ceilings from the selected finite work plan instead of
prefilling arbitrary values. The configured global budget is read-only in the UI.
Creation atomically reserves every planned UTC-day maximum before Temporal starts;
infeasible previews stay blocked and expose explicit scope alternatives.

## Logs and diagnostics

```powershell
docker compose -f docker-compose.agents.yml ps
docker compose -f docker-compose.agents.yml logs --since 10m api worker
docker compose -f docker-compose.agents.yml logs --since 10m execution-gateway execution-sidecar
Get-Content .data\website-frontend.err.log -Tail 100
Get-Content .data\website-backend.err.log -Tail 100
```

Use Temporal UI for workflow state, not as product truth. Cross-check the job in
Convex and detailed calls in Timescale/monitoring.

## Active versus disabled processes

The default Compose stack starts `api`, two `worker` replicas,
the isolated `evaluation-worker`, `execution-gateway`, `execution-sidecar`, Temporal,
Timescale, Redis, and migrations.

These files/services exist but are not normally active:

- `dispatcher.py` and Compose profile `legacy-polling`
- `scheduler.py` compatibility logic
- `ingestor.py` and profile `continuous-ingestion`

Do not reactivate polling to “fix” missing jobs. Fix Temporal schedule synchronization
or explicit dispatch instead.

Feature 15 incident communication outbox defaults off with no prerequisites. Its Test
Center simulation never contacts an external channel or changes incident authority.

Feature 16 safety change quorum defaults off with no prerequisites. Its only Redis
state is the existing two-hour feature-scoped Test Center control lease; Feature 17
qualification is `UNKNOWN` and no product or Temporal enforcement is enabled.

Feature 17 operator qualification also defaults off with no prerequisites. Its local
synthetic drill result is never product qualification and cannot enable authority.

Feature 27 System Safety Assurance Corpus is default-off and accepts only checked-in
Test Center pack IDs. It never certifies safety, changes product authority, or starts
runtime work; missing/stale local evidence remains blocked.
