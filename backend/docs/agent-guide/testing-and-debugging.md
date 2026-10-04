# Testing and Debugging

Stage 2 financial-authority tests and their disposable PostgreSQL boundary are
described in [financial authority](financial-authority.md). They do not certify
live venue balances or execution.

Feature 22 verification is local-only: strict fixtures, pure evaluator checks, registry closure, and an opt-in disposable PostgreSQL migration/repository harness. Do not substitute a provider, signer, or live source probe.

Feature 07 uses checked-in identities and a disposable local Timescale schema. Do
not use a venue, RPC, provider, signer, or funded account to test this registry.

Feature 20 uses the same local-only constraint. Its migration upgrade script is for an
explicit disposable database only; never run providers, signer SDKs, or funded checks.

Feature 38 is local fixture-only. Run `pytest agent-service/tests/test_analytical_diversity_fixture.py -q`
and `npm run analytical-diversity:check`; no model, network, workflow, wallet, venue,
signer, credit, or execution probe is a valid substitute.

## Baseline checks

From the repository root:

```powershell
npm test
npx tsc --noEmit
npm run build
npx convex dev --once
```

Python:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e "./agent-service[test]"
python -m pytest agent-service/tests
```

Sidecar:

```powershell
npm --prefix execution-sidecar install
npm --prefix execution-sidecar run typecheck
```

Other useful checks:

```powershell
docker compose -f docker-compose.agents.yml config --quiet
git diff --check
# Against a disposable/local Postgres after migrations:
psql -v ON_ERROR_STOP=1 -f agent-service/tests/sql/008_test_center_idempotency_upgrade.sql
psql -v ON_ERROR_STOP=1 -f agent-service/tests/sql/009_cross_state_recovery_upgrade.sql
```

Use the smallest relevant test first, then expand in proportion to the risk.

## Change-to-test map

| Change | Minimum focused verification |
| --- | --- |
| Convex schema/mutation/query | `npx tsc --noEmit`, relevant TypeScript tests, `convex dev --once` |
| Python contract/provider | matching `agent-service/tests/test_*.py` |
| Temporal workflow | workflow/unit tests plus deterministic ID/retry review |
| OpenRouter | contract fixtures for catalog, strict output, metadata, pricing, failures |
| Credits/costs | reservation, settlement, release, malformed-output cases |
| Runtime controls | fail-safe Redis tests, cap/retry/concurrency assertions |
| Wallet/EIP-7702 | Particle and Magic capability/chain/session tests |
| Venue routing | recorded public responses, stale/depth/fee/readiness cases |
| Execution | fork/simulation/contract suites; never casual funded submission |
| Dependency safety | matrix/scope/status fixtures, canonical hashes, recovery, boundary ordering, Risk/Monitoring render |
| Dependency Test Center | auth/origin/path isolation, registry drift, CAS/Redis-loss, sanitizer, frozen-run/SSE and no-authority-import tests |
| Recovery continuity | domain registry/hash, per-domain cutoffs, restore/reconciliation fixtures, feature-scoped controls, migration 009 and normal-resume prohibition |
| Evidence lifecycle | classifier/transform matrix, seeded prohibited corpus, retention/holds/copy receipts, restore quarantine, migration 010 and Test Center fixtures |
| Operational secret custody | class/workload registry, fake-vault access/rotation/recovery, receipt ordering, metadata-only legacy classifier, migration 014 and Test Center corpus |
| Execution artifact certification | strict graph/identity fixtures, topology and lane separation, migration 015 in a disposable schema, Test Center closure, and no-authority-import checks |
| Asset conservation journal | exact integer/unit equations, frozen source/finality scenarios, retry/conflict fixtures, migration 022 in a disposable schema, Test Center closure, and no-authority-import checks |
| Intent–execution equivalence | inert exact-input/Permit2 fixture decode, three-stage parity, zero-tolerance mutations, pinned context/delta closure, migration 023, Test Center closure, and no-authority-import checks |
| Venue price/liquidation safety | exact units/time/finality/divergence fixtures, safe-lane closure, migration 024, Test Center closure, and no-authority-import checks |
| Incident communication outbox | in-app-only templates/audience/redaction, independent display/ack receipts, dead letters, migration 027, Test Center privacy and no-authority-import checks |
| Safety change quorum | exact scope/hash and synthetic-untrusted quorum fixtures, restrictive lane, break-glass nonce/expiry/revoke failures, migration 028, and isolated Test Center product-unavailable projection |
| Portal/terminal UI | typecheck/build and keyboard/mobile Playwright where available |
| Evaluation Lab | grounding/scoring fixtures, budget atomicity, Temporal replay and signal tests, and explicit no-execution import checks |

Evaluation Lab v2 cost tests retain the full-universe diagnostic fixture: 362
markets, 10,128 live observations/day, 730 replay/adversarial observations,
$0.013191 maximum per observation, $133.598448 live-day maximum, and $9.629430
replay maximum. These values are regression evidence, not recommended defaults.

## Debugging sequence

1. Reproduce once and record the exact UI action, endpoint, status, and response body.
2. Identify the boundary: browser, Next proxy, Convex, Agent API, Temporal activity,
   provider, gateway, sidecar, or venue.
3. Inspect only the relevant logs and workflow; avoid broad retries.
4. Confirm the running image contains the edited source.
5. Confirm Convex functions were deployed after Convex edits.
6. Check environment precedence and matching `WORKER_SHARED_SECRET`.
7. Fix the root contract and add a regression test.
8. Verify a safe success path and a readable failure path.

Do not repeatedly click a model probe while diagnosing. A probe may create a provider
charge even when a later Convex save fails.

## Common service symptoms

| Symptom | First checks |
| --- | --- |
| UI change missing | Next dev process and frontend logs |
| Python fix missing | rebuild/start agent stack; inspect API container timestamp |
| Convex validator still old | `npx convex dev --once`, backend error log |
| Provider 401/402/429 | key/balance/rate limit; preserve provider-specific message |
| Provider generic 500 | API traceback, then Next error parsing |
| Workflow not starting | Manual Guard, schedule pause, task queue, profile revision |
| Huge idle Convex IO | legacy dispatcher/container, frontend interval, schedule count |
| Snapshot missing after model success | Convex completion/update, schema patch behavior |
| Route has no candidates | adapter logs, Redis, stale/depth/leverage/readiness exclusions |
| Live call blocked | expected gates/certification; do not bypass |

## Resource-safe verification

- Keep Manual Guard and Lite Mode ON.
- Prefer fixtures, recorded responses, unit tests, and local simulations.
- Test Center runs only checked-in synthetic IDs; never add caller paths, URLs,
  commands, TTLs, environment overrides, provider probes or external network fallbacks.
- Do not start the continuous-ingestion or legacy-polling profiles.
- Do not automatically test every accessible model.
- Catalog lookup and endpoint capability checks are cheaper than inference probes.
- Do not run paid provider calls unless required for the requested fix.
- Do not perform mainnet transfers, approvals, setup, or canaries without explicit
  authorization and a tightly capped plan.
- Proving-ground verification uses live public reads and simulated fills only. Never
  open execution gates to test evaluation behavior.
- Use one diagnostic Convex mutation only when it materially proves a persistence fix.

## Acceptance invariants

Relevant changes should preserve:

- zero agent Convex calls while idle;
- no duplicate execution under retry/concurrent approval;
- at most one active analysis per account/market;
- one current snapshot per logical scope;
- Lite Mode’s two-call/no-retry and daily ceilings;
- tenant isolation for provider connections and monitoring;
- no owner/provider/venue secret exposure;
- human-readable errors and agent output;
- live execution closed unless every gate is intentionally satisfied.
- no covered authority increase without a fresh receipt-bound decision;
- no reconciliation block caused only by a submit-lane outage.
- Feature 14 tests use checked-in synthetic observations only. Test its monotonic
  post-latch deny set, residual precedence, canonical hashes, append-only migration,
  and isolated UI projection; never use a signer, venue, provider, or product route.
- Feature 17 tests use only checked-in synthetic drills and identities. Verify strict
  canonical artifacts, independent-person review, rational calibration threshold,
  expiry/revocation folding, immutable receipts, and product status remaining unknown.
- Feature 26 tests use only synthetic desired schedules and a deterministic fake owner.
  Verify material-change suppression, append-only history and no Temporal/Convex/network
  interaction; do not connect a Test Center run to actual scheduling infrastructure.
- Feature 27 tests use only checked-in claims, deterministic oracles and semantic
  mutations. A supported fixture verdict is not safety certification or product
  authority; missing/stale evidence and critical survivors remain blocked.
- Feature 29 tests use only checked-in citation IDs and paired observations. Verify
  citation-set separation, conservative role status, finite ablation ceilings and zero
  provider/external attempts; a local estimate is conditional research, not a source
  removal or product gate.
# Mandate-policy semantic fidelity

Run the focused `test_mandate_policy_*` tests and checked-in corpus locally. A pass
proves only deterministic fixture coverage and nonce semantics; it does not prove
prose comprehension, legal consent, product enforcement or execution readiness.

# Customer contestation fixture checks

Run `test_customer_contestation.py` for the 96 checked-in cases, 10,000 seeded
evaluator corpus, mutation/scope isolation assertions, and strict lifecycle failures.
The disposable repository harness applies migration 035 to a local fixture database;
it never connects to customer state or performs a remedy.

# Calibrated selective-prediction fixture checks

Run `test_selective_prediction_fixture.py`, `npm run selective-prediction:check`, the
registry check, and the Feature 37 TypeScript Test Center contract test. They prove only
the synthetic local boundary, not product calibration or execution readiness.

# Outcome-calibrated promotion fixture checks

Run `test_promotion_fixture.py`, the promotion boundary checker, registry check, and
local TypeScript check. A pass proves deterministic synthetic receipts only; it does
not establish product promotion, demotion, rollback, or calibration benefit.
