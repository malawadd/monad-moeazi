# Known Gaps, Legacy Paths, and Traps

Mobile modular funding/sponsorship is locally implemented but not live-certified or
deployed. Provider credentials, verified asset mappings, trusted-IP ingress, public
return links, contract bytecode hashes, sponsorship policy and native interruption
checks are release prerequisites. Local MoonPay sandbox configuration is documented
in [local integration setup](../mobile-local-integrations.md); its catalog is
available, but real checkout settlement and sponsorship are not certified. Do not
enable production purchases or sponsorship without separate approval. See
[integration rollout](../mobile-modular-integrations.md).

Mobile fiat-to-USDC estimates are connector-backed and fixture-tested. Deployment
defaults remain disabled; local MoonPay `@2` sandbox quotes are now approved and
enabled, but the provider rejects Arbitrum USDC as unsupported in test mode.
Transak's production catalog and one quote verified canonical Arbitrum USDC,
but a hosted-session check returned HTTP 401; its `@3` production connector
remains unselected pending checkout authentication and bounded usage approval.
Existing `@1` purchases remain supported. Native visual
and TalkBack checkpoints are still manual. See [quote rollout](../mobile-funding-quotes.md).

Feature 32 is fixture-only. It does not replace or invoke `RoutingService`, establish
authoritative quote/book/account/fee/funding/gas/health/reconciliation/channel truth,
select a product route, prepare a payload, or enable venue, signer, wallet, gateway,
sidecar, network, broadcast, funding, or execution readiness. Feature 31 context is
always untrusted `requires_revalidation` research input.

Feature 33 is fixture-only. Its synthetic CLOB/AMM lifecycle and cost receipts are
not product Shadow fills and cannot calibrate, promote, route, sign, submit, cancel,
or mutate anything. Certified actual execution count remains zero.

Feature 22 does not provide qualified ownership, authoritative source currency, legal/KYC/sanctions conclusions, Convex projection, Temporal remediation, Redis invalidation, product/runtime enforcement, or any downstream consumer. A local fixture result is never product eligibility.

Feature 29 is fixture-only: it does not correct the current live citation overwrite,
establish source provenance or claim truth, measure causal importance, call providers,
remove a source, alter a specialist role or tier, or gate product authority. Its paired
estimates are conditional synthetic research and remain unpowered until separately
approved chronological replay and Shadow validation.

Feature 07 is fixture-only: metadata ownership, catalog projection, routing bindings,
independent continuity review and live activation are not implemented. A Test Center
result is not venue verification.

Feature 10 is fixture-only: its local exact-unit journal does not establish balances,
custody, external settlement, product reconciliation, source authority or execution
readiness. Feature 09 remains an untrusted prerequisite requiring revalidation.

Feature 11 is fixture-only: its inert byte parity result does not establish transaction
semantics, signing readiness, dispatch, execution, simulation, reconciliation, or authority.

Feature 12 is fixture-only: its synthetic price/liquidation receipts do not establish
native mark/index/oracle truth, margin, funding, liquidity, finality, venue
certification, liquidation behavior, product routing, signing or execution readiness.

Feature 14 is fixture-only: its local termination latch and residual workflow does not
stop product schedules, cancel native work, close positions, move assets, revoke owner
authority, or establish account deletion, erasure, recovery, signing, or execution readiness.

Feature 15 is fixture-only: it does not detect, resolve, contain, or mutate incidents;
does not establish customer awareness; and has no Convex inbox, Temporal retry worker,
external delivery channel, product authority, privacy approval, or cost authorization.

Feature 16 is fixture-only: it does not establish qualified operators, authoritative
identity, complete product mutation coverage, product enforcement, durable Temporal
lease expiry/revocation, signing, or execution readiness. Feature 17 qualification is
always `UNKNOWN`; synthetic qualification can affect only an isolated simulation.

Feature 17 is fixture-only: synthetic drills and identities do not establish workforce
identity, staffing independence, competence, incident readiness, product qualification,
Convex/Temporal ownership, consumer enforcement, signing, or execution readiness.

Feature 20 is fixture-only: its synthetic packet, nonce, and comparison graph does not
change product Approval, establish EIP-712 behavior, or permit dispatch or execution.

Read this before saying a feature is “done,” “connected,” “live,” or
“production-ready.”

Feature 34 is fixture-only: deterministic run-planning results do not schedule work,
refresh a product snapshot, reserve credits, dispatch providers, choose routes, or
change customer authority. Feature 25 and 29 context remains requires-revalidation.

Feature 35 is fixture-only: synthetic immutable decision memory does not own actual
outcomes, update prompts, learn online, schedule work, route, sign, submit, or alter
customer authority. Its Feature 25 context remains requires-revalidation.

## Current gated or incomplete areas

- Live autonomous submission defaults OFF.
- Dependency safety v2 is implemented with an observe-mode tracked product default.
  Isolated synthetic Test Center enforcement is not product promotion. Production
  enforce still requires independent replay/adversarial/UI/security acceptance and
  activation review.
- Authoritative risk, reconciliation-clearance, and owner-signer readiness owners are
  not implemented; their receipts are `UNKNOWN`, so the envelope does not claim live
  preflight or submit readiness.
- V1 dependency-safety history is legacy/read-only for v2 enforcement.
- Global dependency incidents are merged into account projections. Tenant-wide merge
  still needs an authoritative tenant identifier on account safety scopes; do not
  treat a tenant receipt as visible/enforceable for an account lacking that binding.
- The v2 `render_previous` evaluator/helper is strict and fixture-covered, but the
  product has no single canonical previous-snapshot render entry point to wire yet.
- Safety-decision idempotency conflicts are durable. Certified live venue submission
  still needs its later authoritative execution journal before duplicate broadcast
  protection can be claimed; live submission remains closed.
- Cross-State-Owner Recovery and Continuity is locally implemented with deterministic
  fixtures and an isolated Test Center. Production native backups, independent restore
  infrastructure, Temporal recovery, external execution reconciliation and Secret
  Custody remain unvalidated; `recovery_continuity` stays `UNKNOWN`, normal resume is
  blocked, and the dossier is incomplete/activation-gated.
- Evidence Lifecycle Boundary is locally implemented for the active evidence push,
  governed Evaluation cases, analysis/proposal projection contracts, payload-bound
  monitoring output and durable local owner commands/receipts. Historical audit findings
  are deferred to the roadmap audit goal. Feature 03 is unavailable to product runtime;
  only synthetic observe and isolated Test Center enforcement are exposed after local
  implementation verification. Provider,
  Dependency-safety SSE now treats Redis as identity-only transport and reloads both
  durable owners before governed disclosure, using the canonical safety verifier before
  stream-specific authority checks. Safety SSE reconstructs bounded status/dependency
  display enums and never copies durable reason strings. Inventory loaders reject
  duplicate JSON keys and enforce exact global multipart identity closure. Provider,
  backup and Temporal
  history deletion stay explicitly `unverifiable`; production KMS evidence,
  legal/privacy decisions and native restore verification are not established. Do not
  claim compliance, anonymization or guaranteed erasure.
- Non-Owner Operational Secret Custody is a local fake-vault proof only. Product
  availability remains unavailable. No real envelope has moved; production KMS/HSM,
  row migration, native recovery, upstream revoke verification, workflow registration,
  owner-material exclusion review and certified execution integration remain gated.
  Legacy `walletSecrets` owner-equivalent shapes remain quarantined evidence, not an
  approved owner or fallback path.
- Execution Artifact Certification Registry is local fixture-only evidence. It does
  not certify live provenance, governance, review quality, signing, routing, venue
  readiness, or execution. Product availability remains unavailable; drift clearing
  requires explicit local requalification metadata and is never automatic.
- Mainnet venue setup defaults OFF.
- `CERTIFIED_VENUES` should remain empty in ordinary development.
- Python venue interfaces exist, but several private signing/place/cancel/close paths
  deliberately throw certification/not-implemented errors.
- Hyperliquid public quote/balance/positions exist; signing is still gated.
- Sidecar Uniswap preparation and simulation exist; broadcast returns `501` without
  a KMS-backed signer.
- The v4 hook lane is an isolated USDC/WETH quote/simulation experiment. It has
  contract unit tests and deployment checks, but no seeded production pool,
  audited deployment, direct-route Permit2 flow, or receipt reconciliation.
- Generic sidecar execution returns blocked/not-implemented until certification.
- GMX public SDK reads exist; full signed submission/reconciliation is not certified.
- Orderly, GMX, and Ostium routing may use labeled proxy data rather than exact
  executable unsigned preparation.
- Durable venue setup state exists, but every protocol-specific credential
  registration/verifier is not complete.
- Material-event Redis consumption and transactional schedule-sync outbox remain
  future architecture improvements.
- Payments/checkout for credits are deferred; beta/operator grants use the ledger.
- Lite Mode limits the run to two specialist assignments, but activated model routing
  can currently override their default DeepSeek provider/model. Do not promise
  “DeepSeek Flash only” until routing is hard-clamped at the workflow boundary.
- Lite daily budget reservation currently uses a conservative default estimate at
  dispatch; complete reconciliation against route/provider usage is still an
  improvement area.
- Evaluation replay initially freezes and repeats captured routing/evidence snapshots.
  Markets without replay-grade history are labeled live-shadow-only or unscorable;
  a live quote must not be described as historical regime coverage.
- Evaluation semantic grounding is a sampled, separately costed diagnostic. It is not
  ground truth and never replaces deterministic citation checks or operator review.
- Evaluation v1 records remain readable but use legacy incremental-budget and
  hard-coded-scope semantics. New experiments use v2 finite work plans.
- V2 expected cost is an auditable estimate, not exact future token usage. The
  separately displayed maximum is the finish-safe reservation boundary; exact
  settled cost appears only after provider usage is available.

This project is mainnet-only in chain selection, but uses recorded responses, local
forks, simulations, and tightly capped canaries for validation. Do not add testnet
product paths, and do not confuse “mainnet-only” with authorization to move funds.

## Legacy or compatibility-only code

- `agent-service/dispatcher.py`
- `agent-service/scheduler.py`
- Compose profile `legacy-polling`
- Compose profile `continuous-ingestion` in default Lite development
- authority value `insights` (normalizes to Shadow)
- Optimism execution-wallet records (read/migration only)
- old model-stage names `openai_synthesis` and `deepseek_synthesis`

Do not delete migration compatibility casually, but do not use it as the pattern for
new work.

## Recurring implementation traps

### Docker source staleness

Python code is baked into the image. Restarting a container does not pick up source
changes; rebuild it.

### Convex deployment staleness

Editing `convex/*.ts` does not update the remote development deployment unless
`convex dev` is running or `npx convex dev --once` is executed.

### Partial patch deletion

Convex treats an explicit `undefined` patch property as removal. A partial provider
connection update once deleted required fingerprint fields. Construct conditional
patch objects and test required-field preservation.

### Identifier leakage into documents

Worker commands carry `subject` for authorization. Strip it before inserting product
documents. It is not part of table schemas.

### Function/local-name shadowing in Python

A probe once used `details` as both a helper function and a local variable, causing
every model test to crash before provider contact. Avoid local names that shadow
module helpers and add regression tests around route orchestration.

### Error shape loss

FastAPI errors use `detail`; proxies may use `error`; Pydantic uses arrays of issues.
Ignoring these creates generic `Provider service returned 500` or `[object Object]`.

### Query-string loss through catch-all proxies

Catalog search depends on `q`, `offset`, and `limit`. Preserve `request.nextUrl.search`
when proxying GET/HEAD requests.

### Capability is not execution readiness

An EIP-7702-capable owner is not necessarily delegated. A connected venue is not
necessarily funded/authorized. A quote is not a validated transaction. A simulation
is not broadcast. A transaction hash is not reconciliation.

### Gateway is not model family

OpenRouter is a gateway. Quorum uses canonical model family; multiple hosts or two
OpenRouter calls to the same family do not create analytical diversity.

### Strict output is a safety contract

Do not bypass structured-output probing to support an attractive/free model. A chat
response is not a validated `SignalReport` or `MarketSynthesis`.

### Public-demand history

`publicMarketDemand` and compatibility worker functions still exist, but the normal
UI no longer needs a one-second Convex job poller. Do not revive it.

### Auth assumptions

The middleware prefix list is not the complete authorization boundary. Always verify
viewer ownership in Convex and subjects in authenticated service proxies.

## How to describe status honestly

Use precise phrases:

- “Public quote adapter is active.”
- “Setup intent is stored; protocol verification is gated.”
- “Transaction preparation validates and simulates; broadcast is disabled.”
- “Shadow execution records a simulated fill.”
- “The interface exists, but private signing is not certified.”

Avoid:

- “Venue connected” when only a toggle exists.
- “Trade executed” for a simulation.
- “Autopilot ready” because a UI mode can be selected.
- “Funds secured by KMS” when running the local master-key backend.

## Documentation maintenance

When a material boundary changes:

1. Update the relevant guide file.
2. Update the deeper architecture/runbook if behavior or operational response changes.
3. Update `README.md` if local setup or commands change.
4. Keep `AGENTS.md` as an index; do not grow it into another monolith.
5. Mark gated work active only after executable verification, not after schema/UI work.
# Mandate-to-policy semantic fidelity

Feature 18's local fixture is not a product policy migration. Existing Convex policy
drafting and activation remain legacy/unmapped; no result authorizes policy or execution.

# Customer contestation

Feature 23 is a local synthetic Test Center proof only. Customer intake, identity,
policy/legal ownership, privacy/retention approval, qualified human review, independent
appeals, authoritative evidence/current state, delivery, remedy infrastructure and
product activation remain unavailable.

# System safety assurance corpus

Feature 27 is a local deterministic evidence harness, not a safety certification.
Authoritative claim owners, independent reviewers, current production evidence,
protected release infrastructure, held-out fault evidence and activation review remain
unavailable. Its result cannot authorize a product mode, policy, signer or execution.

# Outcome-calibrated promotion remains unavailable in product

Feature 36 has only local synthetic decisions. Feature 33/35 owners require
revalidation, and exact product configuration ownership, powered chronological
evidence, rollback proof, and separately approved product mutation remain blocked.

# Calibrated selective prediction remains unavailable in product

Feature 37 is fixture-only. Its calibrated sets, intervals, shift diagnostics and
proposal-eligibility labels cannot create a proposal, calibrate a live model, alter
customer mode, route, sign, submit, or execute. Features 30, 31 and 36 remain
requires-revalidation context; authoritative labels, evidence/claim/integrity, costs,
portfolio risk, powered chronological evidence and separate activation approval remain
required.
# Analytical diversity remains product-unavailable

Feature 38 is a deterministic local fixture. It has no authoritative mature path
outcomes, powered chronological validation, product DiversityPolicy, route consumer,
or activation approval. Do not describe its audit output as truth or execution safety.
