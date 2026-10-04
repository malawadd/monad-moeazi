# Agentic Trading Backend

## Boundary

Convex is the product source of truth. It owns authenticated profiles, versioned policies,
analysis jobs and latest snapshots, proposals and approvals, credit balances/reservations,
and user-facing queries. Python owns ingestion, durable Temporal workflows, provider calls,
history in Timescale, hot state and coordination in Redis, and deterministic preflight.

LLMs can produce evidence, signals, syntheses, and proposals. They cannot receive wallet
credentials or call a venue adapter. The execution gateway obtains a new quote and reruns
policy, balance, health, freshness, quorum, and reconciliation checks before it can ask a
signing adapter to submit.

## Processes

- `api`: health, internal workflow dispatch, policy checks, and push evidence ingestion.
- `worker`: Temporal worker that runs bounded concurrent specialist and synthesis calls.
- `api`: synchronizes Temporal schedules and exposes development runtime controls.
- `worker`: executes cadence/event workflows, reserves/settles credits, and patches snapshots.
- The old dispatcher and Convex-scanning scheduler are compatibility modules and are not started
  by the default stack.
- `ingestors`: normalizes direct venue/news feeds and stores sanitized evidence.
- `execution-gateway`: quote plus deterministic preflight and credential isolation.
- `execution-sidecar`: official GMX TypeScript SDK boundary and future Uniswap broadcast path.

Focus uses six specialists and one synthesis. Pro uses 12 roles, dual-runs four critical
roles, then critic and synthesis. Max uses 20 roles, dual-runs ten directional/risk roles,
per-provider syntheses, and an arbiter. Model names come from environment variables and are
recorded in every provider-call entry.

## Model routing and bring your own key

Signed-in users configure models at `/agents/models`. A versioned routing document selects a
provider, model, credential source, output cap, and optional reasoning effort for every role or
synthesis stage. The workflow loads that exact activated version before dispatch and never
silently substitutes another model. Pro and Max require two distinct canonical model families,
including when calls are routed through OpenRouter.

OpenRouter is BYOK-only. Its remote catalog is cached briefly in Redis rather than copied into
Convex; only models that pass strict typed-output validation are stored with expected and maximum
price snapshots. Routes default to ZDR, deny data collection, require every request parameter, and
permit only same-model upstream-host fallback. Provider-reported cost and routing metadata are
retained with the call trace.

Provider secrets are sent only to the authenticated Python provider endpoint. Convex stores the
connection status, fingerprint, last four characters, verified models, and vault reference; the
encrypted secret lives in Postgres. Production requires AWS KMS. Local AES-GCM wrapping is accepted
only in development. Decrypted keys exist only in the scoped provider client and are never placed in
Convex, Redis, Temporal payloads, traces, or browser responses.

Platform-key calls use the normal credit rate card. BYOK calls use the lower infrastructure-only
rate card, while estimated and actual provider charges are shown separately because the provider
bills the user directly. Reservations use the active route, and settlement charges only validated
successful outputs. A per-account daily BYOK provider-cost ceiling is enforced in Redis.

## Monitoring and decision traces

`/agents/monitoring` shows runs, tokens, cached tokens, calls, latency, provider cost, and platform
credits. A run detail page renders a React Flow graph from evidence references through specialist
reports, synthesis, deterministic checks, proposals, and execution outcomes. It exposes concise
decision summaries and validated structured inputs/outputs—not private model chain-of-thought.

Detailed trace events are tenant-scoped, sanitized, and retained for seven days in Timescale;
daily usage aggregates remain available for longer-range reporting. Redis publishes live updates
only while a monitoring client is subscribed, so monitoring creates no idle polling traffic.

## Local start

1. Run `npm ci` and `npm run stack:start` from `backend/`.
2. The isolated launcher generates ignored local secrets, starts self-hosted
   Convex, then deploys Convex functions and starts the copied services.
3. Open Temporal UI on `http://127.0.0.1:18233`, API health on
   `http://127.0.0.1:9100/health`, and execution health on
   `http://127.0.0.1:9200/health`.

Use only the `moeazi-monad` Compose project and `.env.agents.monad` file. The
default stack has no provider credentials and keeps live execution disabled.
Never commit generated local environment files.

## Production

Build the same `agent-service` and `execution-sidecar` images. Point them to Temporal Cloud,
managed Postgres/Timescale and Redis, and an OTLP collector. Replace `LocalMasterKeyWrapper`
with a cloud-KMS `KeyWrapper`; no plaintext private key is stored or logged. Autoscale worker
replicas on Temporal task-queue latency and provider capacity, not only CPU.

Alerts should cover queue dispatch p95 over five seconds, provider failure/quorum rate,
lease retries, credit-reservation age, public snapshot age, execution rejection reason,
venue health, reconciliation drift, and any duplicate idempotency key. Structured logs carry
job, account, market, provider, analysis, and venue fields when available.

## Release gates

`LIVE_EXECUTION_ENABLED` defaults to false. A venue additionally must appear in
`CERTIFIED_VENUES`. Hyperliquid, Lighter, Orderly, GMX, Ostium, and Uniswap must each pass the
venue contract suite on sandbox/testnet and a deliberately small funded mainnet canary before
being added. Adapters without certified private signing flows remain behind a hard gate. Public reads
and dry-run simulations do not count as certification; this is a release blocker, not a soft warning.

Run verification:

```text
cd agent-service
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -e ".[test]"
.venv\Scripts\python -m pytest -q

cd ..\execution-sidecar
npm install
npm run typecheck

cd ..
npx convex codegen
npx tsc --noEmit -p convex/tsconfig.json
npm test
docker compose -f docker-compose.agents.yml config --quiet
```

The load profile is `agent-service/loadtest/k6.js`. It drives 1,000 active readers and 200
simultaneous workflow dispatches with the 300 ms public-read and five-second dispatch p95
thresholds. Run it against an isolated environment with provider capacity limits configured.
