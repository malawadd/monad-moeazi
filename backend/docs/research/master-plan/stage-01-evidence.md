# Stage 1 implementation and qualification evidence

Status: **in progress — not accepted**. Q1 is not yet passed.

## Baseline checks

- `npm test`: baseline passed 245 tests, 0 failures (117.9 seconds), before implementation writes.
- `npx tsc --noEmit`: baseline passed before implementation writes.
- Supervisor local configuration: Astra High; all three workers explicitly Sol High.
- Python baseline: `agent-service/.venv/Scripts/python.exe -m pytest
  agent-service/tests/test_authority.py agent-service/tests/test_team_roles.py
  agent-service/tests/test_model_routing.py -q`: 12 passed.
- The blueprint and kickoff ledger were published before implementation began.
- Docker was initially unavailable; Docker Desktop started locally. Existing analysis
  and evaluation workers were stopped before infrastructure restoration to prevent
  unintended background provider activity. Unrelated containers were not altered.
- An attempted Python baseline named nonexistent `test_proposal_routing.py`; pytest
  collected no tests. This is a command-selection error, not an application failure.

## Implementation decisions

Shared ControllerRef v1 agreed: schemaVersion, environment, strategyAccountId,
controllerKind, controllerId, controllerVersionId, contentHash (camelCase wire).
Customer controller/version identify deployment/team version; managed identify
assignment/program version. Managed dispatch remains unavailable in Stage 1.
Hash: SHA-256 of UTF-8 `moeazi-controller-v1\n` plus compact recursively key-sorted
JSON manifest; immutable configJson is hashed as its stored string. Python and TS
must pass shared golden vectors. Preserve existing aliases with equality checks.

## Acceptance evidence

First independent checkpoint: 7 TypeScript helper/Convex-handler tests and 12 Python
contract tests passed. This covers owner-scoped creation, immutable draft/freeze
behavior, separate same-market controllers, mobile ambiguity, canonical hashes,
strict schema parsing and explicit legacy binding. The initial Python boolean-schema
failure was repaired; a test assignment fixture was corrected to contain provenance.

Still required: mode traces through schedule/job/proposal/approval, deployed migration
dry-run, mobile start/stop behavior, full relevant regression, deployment and rebuilt
runtime verification. Helper/handler evidence alone does not pass Q1.

Expanded independent checks now cover actual dispatch/completion functions with inert
external IO: all customer modes retain refs/modes; bearish -0.72 remains signed and
agreement is +0.72; Approval requests its extra safety check; changed authority blocks
before projection/settlement. Mobile and scheduled-job/context handler tests passed.

Broader Python run: **793 passed, 7 skipped, 5 failed** (128.07 seconds). Failures are
the evidence provider-call inventory (three tests), an evaluation-row test double
missing `customer_account_id`, and a provider-gate source count (expected 3, found 4).
All five failures reproduced unchanged at clean `dddd22e` in a managed baseline
worktree, with the imported Python package path verified. They are pre-existing.
Two unregistered outbound callsites were source-reviewed: authenticated internal
mobile reconciliation carries an operation ID; native withdrawal reconciliation uses
read-only RPC methods. Inventory repair records those boundaries, not live capability
or finality certification. The stale row and source-count tests are being repaired.
`analysis_completion.py` received a mixed legacy-payload repair after this broad run
started; its affected scoped suite passed separately and will be recorded explicitly.

The first broader TypeScript run passed **260/260** tests (20.74 seconds); root
`npx tsc --noEmit` also passed. A subsequent paused-assignment ownership repair and
account-wide withdrawal pause check require their affected tests before acceptance.

Supervisor review requested fixes for mode changes between analysis and proposal
recording/execution, frozen configuration content rather than mutable IDs alone,
contradictory identity aliases, paused-assignment truthfulness, and complete relational
ownership checks. Independent review must verify repairs before acceptance.

The final independent handler checks now also exercise real proposal persistence and
approval with valid inert lifecycle/safety receipts: owner, expiry, changed mode,
payload identity, and conflicting retries. Paused assignment reads check ownership;
withdrawal pause readiness aggregates all account teams and active assignments.
This pause check is not yet a reconciled withdrawable-balance calculation (Stage 2).

Development deployment succeeded at 12:38 UTC with additive tables/indexes. The
explicitly authorized deployed qualification ran 12:39:25–12:41:02 UTC: 34 checks
passed using two synthetic unfunded identities, paused same-market deployments,
frozen program/experiment identities, role denials, and mobile start refusal/stop.
All three temporary role allowlists were restored. Detailed ignored artifact:
`.data/q1-1790771965785-deployed-evidence.json`. CLI-supplied admin test identities
exercise deployed functions, not end-user wallet authentication or live trading.

Migration pagination completed over four accounts. All had no active assignment;
four team rows lacked active deployment mappings. They remain explicit unresolved
rows; no automatic assignment/backfill occurred. Paused configured deployments do
not count as active in that report. Full account identifiers remain in local evidence.

Additional inventory review found pre-existing TypeScript manifest drift (recorded
61 mutation-dispatch calls/185 writes versus baseline 71/260). Stage 1 discovers
71/262 before its final metadata-only experiment repair. The scanner counts
`runMutation` calls, not public mutation declarations; authenticated entrypoint tests
provide separate coverage. Arbitrary experiment JSON was identified as unsuitable
for product-state storage and is being restricted to non-executable identity metadata.
Executable experiment detail remains a Stage 4 Timescale responsibility.

## Supervisor acceptance — 2026-09-30 12:51 UTC

Q1 **passes within identity/authority scope**, following independent Sol review.
Final experiment writes accept only canonical non-executable metadata (version,
enumerated purpose, optional dataset hash); arbitrary bodies and execution are
rejected. Final deployment at 12:45 UTC and repeated 34-check qualification passed:
`.data/q1-1790772362589-deployed-evidence.json`, finished 12:47:42 UTC. Role allowlists
were restored and complete migration inventory retained unresolved rows.

Final local verification:

- `npm test`: **270 passed**, 0 failed (23.98 seconds).
- Python full suite: **798 passed, 7 skipped**, 0 failed (161.08 seconds). Skips
  remain conditional baseline tests; this is not evidence that their gates passed.
- `npx tsc --noEmit` and `npm run build` passed. Final Convex-only metadata repair
  passed separate typecheck and deployment compilation after the frontend build.
- Evidence sink, schedule-sync boundary, evidence-event boundary and feature-registry
  checks passed. Reviewed stale inventory groups were repaired; scanner limitations
  remain explicit. `git diff --check` passed; new files remain within 300 lines.
- Mobile sibling: typecheck and 13 focused Home tests passed; changes are additive
  optional assignment/controller types only.

API, gateway, Test Center, analysis-worker and evaluation-worker images were rebuilt
locally. API/gateway/Test Center were recreated. Nine changed Python source hashes
match the running API image; a real authenticated local HTTP request for unbound
private analysis returned the required 409 before workflow dispatch. Health shows
Manual Guard/Lite ON, scheduled analysis OFF, live execution OFF, all venue submission
gates closed. Analysis/evaluation workers remain stopped; no resumed paid workflow
or funded action is part of this evidence. API image digest:
`sha256:8b9e7507294c8cda489eaf20a7e87a1ee373b5bc331b456a9d4ee5b40d9cc155`.

Dependency observation: the existing ranged build changed FastAPI 0.142.1→0.142.2
and charset-normalizer 3.5.1→3.5.2. Package snapshots are retained locally in
`.data/stage1-image-packages-{before,after}.txt`; rebuilt API health/guard checks
passed. Dependency locking/reproducible-image qualification remains operational work.

Still unavailable: managed activation, reconciled financial authorization, complete
position lifecycle, strategy qualification and native funded execution. Stage 2 is
the next permitted implementation stage. None of these future gates is implied by Q1.

## OpenRouter smoke

One authenticated BYOK compatibility call passed on 2026-09-30 using
`deepseek/deepseek-v4-flash`, 128 maximum output tokens, one concurrent request,
and no automatic paid retry. The app returned HTTP 200 and displayed typed-output
validation passed. The temporary connection remains separate from team defaults.
Expected cost from catalog ceilings and conservative input allowance: below $0.001;
$0.15 was reserved before dispatch. No key is present in reports or agent tasks.

Evidence limitation: the existing probe UI discards its response body; the API saves
compatibility metadata but not output/usage. No replayable response was retained.
Read-only billing reconciliation at 12:12:29 UTC through the existing local encrypted
vault and [OpenRouter key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
returned cumulative usage **$0.00000972**, remaining **$0.99999028**, and expiry
**2026-10-01 11:41 UTC**. The early reservation is settled against that conservative
whole-key usage. No token counts were retained; do not call this replay evidence.
Local screenshot: `.data/architecture-provider-smoke.png` (ignored artifact).
