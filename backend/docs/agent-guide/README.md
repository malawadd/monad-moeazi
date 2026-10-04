# Moeazi Project Guide

This guide gives future coding agents the context needed to work safely without
reverse-engineering the repository on every task. It describes the current
implementation, not just the intended end state.

## Product in one paragraph

Moeazi is an Arbitrum-first trading product with a public market terminal and a
signed-in management portal. A user signs through Particle or Magic and controls a
Universal Account. A strategy account can own multiple named specialist-agent teams,
with saved versions and market deployments. Teams analyze markets in Shadow,
Approval, or Autopilot mode. Convex is the
application-facing source of truth, Python and Temporal run durable analysis, Redis
holds hot coordination and safety state, Timescale stores detailed history, and
isolated execution services own venue interaction. Live signing is still
certification-gated.

## Read the implementation in layers

Use these status labels when reasoning about a feature:

- **Active:** used by the normal local stack and product UI.
- **Gated:** implemented or scaffolded, but blocked by an environment or certification
  gate.
- **Legacy:** retained for migration or compatibility; not part of normal operation.
- **Planned:** described in architecture but not complete in code.

Do not infer “production-ready” from the presence of an interface, table, page, or
adapter. Check [known gaps and traps](known-gaps.md).

## Guide map

- [System architecture](architecture.md): service boundaries, data flow, repository map.
- [Runtime and operations](runtime.md): environment precedence, start/stop, logs, gates.
- [Mobile Autopilot and local operator controls](mobile-runtime.md): signed-in journey, state owners, console controls, and Android build boundary.
- [Agent system](agent-system.md): modes, tiers, models, costs, credits, monitoring.
- [Data and caching](data-and-caching.md): Convex, Timescale, Redis, TTLs, IO rules.
- [Financial authority](financial-authority.md): Stage 2 scoped PostgreSQL journal, native observations, capacity, proof limits, and current projection.
- [Simulation runtime](simulation-runtime.md): Stage 3 work in progress, dedicated worker boundaries, replay contracts and qualification limits.
- [Wallets and execution](wallets-and-execution.md): owner model, EIP-7702, venues.
- [Uniswap v4 hook experiment](../uniswap-v4-hook-experiment.md): isolated hook-pool comparison.
- [Product UI](product-ui.md): terminal versus portal, routes, style and interaction.
- [Testing and debugging](testing-and-debugging.md): checks and incident workflow.
- [Test Center access](test-center-access.md): local enablement, subject allowlisting, startup, and troubleshooting.
- [Known gaps and traps](known-gaps.md): incomplete paths, legacy code, recurring bugs.
- [Dependency safety](dependency-safety.md): scoped receipts, operation matrix, incidents, rollout.
- [Recovery continuity](recovery-continuity.md): isolated cross-owner proof and read-only ceilings.
- [Evidence lifecycle](evidence-lifecycle.md): pre-sink minimization, retention, copy receipts and restore quarantine.
- [Operational secret custody](operational-secret-custody.md): local fake-vault access, lifecycle and legacy quarantine.
- [Execution artifact certification](execution-artifact-certification.md): local fixture-only artifact identity registry and Test Center boundary.
- [Temporal integrity](temporal-integrity.md): local fixture-only uncertainty, causality, and nonce-lease envelope.
- [Instrument lifecycle](instrument-lifecycle.md): local fixture-only exact identity, version, alias and lifecycle gate.
- [Asset conservation journal](asset-conservation-journal.md): local fixture-only exact-unit append-only conservation proof.
- [Intent–execution equivalence](intent-execution-equivalence.md): local fixture-only exact inert-artifact parity proof.
- [Venue price/liquidation safety](venue-price-liquidation-safety.md): local fixture-only exact price and liquidation receipt proof.
- [Capability delegation](capability-delegation-lifecycle.md): local fixture-only grant ancestry, observation and revocation-truth ledger.
- [Risk reconciliation](risk-reconciliation.md): local fixture-only authoritative snapshot and reconciliation receipt proof.
- [Verified strategy termination](verified-strategy-termination.md): local fixture-only latch, inventory, residual and completion proof.
- [Incident communication outbox](incident-communication-outbox.md): local fixture-only in-app communication and acknowledgement replay.
- [Safety change quorum](safety-change-quorum.md): local fixture-only quorum and break-glass replay; Feature 17 qualification remains unknown.
- [Operator qualification](operator-qualification.md): local fixture-only drill readiness ledger; product qualification remains unknown.
- [Mandate-to-policy semantic fidelity](mandate-policy-semantic-fidelity.md): local typed mandate/compiler/consent fixture; product policy remains unavailable.
- [Effective authority decision](effective-authority-decision.md): local-only non-authorizing fixture explanation; product authority remains unavailable.
- [Risk-tiered approval consent](risk-tiered-approval-consent.md): local-only tier, packet, synthetic consent, and post-approval comparison fixture.
- [External usage rights](external-usage-rights.md): local fixture-only exact operation rulepack evaluation; product permission remains unavailable.
- [External product eligibility](external-product-eligibility.md): local fixture-only rulepack evaluation; product eligibility remains unavailable.
- [Customer contestation](customer-contestation.md): local fixture-only case, correction and non-executing remedy proof; product workflow remains unavailable.
- [Customer account portability](customer-account-portability.md): local fixture-only deterministic export graph; product export and downloads remain unavailable.
- [Evidence Event Fabric](evidence-event-fabric.md): local fixture-only canonical event/replay proof; product ingestion and dispatch remain unavailable.
- [Schedule Sync Outbox](schedule-sync-outbox.md): local fixture-only desired-state and fake reconciliation proof; product scheduling remains unavailable.
- [System Safety Assurance Corpus](system-safety-assurance-corpus.md): local claim-to-oracle/mutation evidence; not safety certification or product authority.
- [Claim disagreement ledger](claim-disagreement-ledger.md): local typed-claim conflict and hypothetical escalation proof; product routing remains unavailable.
- [Specialist source-value attribution](specialist-source-value-attribution.md): local synthetic citation and paired-ablation research; product evidence gating remains unavailable.
- [Evidence integrity](evidence-integrity.md): local synthetic identity, clustering and quarantine research; product evidence gating remains unavailable.
- [Portfolio-aware sizing](portfolio-aware-sizing.md): local synthetic sizing and inert construction only; product proposal sizing remains unavailable.
- [Multi-venue execution-quality routing](multi-venue-execution-quality-routing.md): local exact-integer route comparison only; product routing and execution remain unavailable.
- [Calibrated Shadow/TCA](calibrated-shadow-execution-tca.md): local synthetic lifecycle and cost research only; product Shadow remains unavailable.
- [Deterministic run planning](deterministic-run-planning.md): local evidence-delta triage and inert full-tier planning only; product scheduling remains unavailable.
- [Outcome-linked decision memory](outcome-linked-decision-memory.md): local immutable synthetic episode/outcome research only; product memory remains unavailable.
- [Outcome-calibrated promotion](outcome-calibrated-promotion.md): local synthetic promotion/demotion receipts only; activation, rollback, and product mutation remain unavailable.
- [Calibrated selective prediction](calibrated-selective-prediction.md): local synthetic calibration/abstention replay only; product calibration and proposal routing remain unavailable.
- [Analytical diversity audit](analytical-diversity-audit.md): local correlated-error fixture only; product policy and authority remain unavailable.

## Core invariants

1. The user-controlled Universal Account is the ownership root.
2. Analysis can propose; only deterministic execution code may sign or submit.
3. Effective authority is the minimum of deployment, user mode, active policy,
   credits, evidence/quorum, venue health, reconciliation, and credential state.
4. Automatic work belongs to Temporal schedules and workflows, not Convex polling.
5. Convex retains current product state; detailed history belongs in Timescale.
6. Provider failures and malformed outputs are not billed as successful user work.
7. BYOK secrets never enter Convex, Redis, Temporal payloads, traces, or browser data.
8. Missing development control state fails safe to Manual Guard and Lite Mode.
9. Mainnet-only does not mean live-by-default. Setup and submission have separate gates.
10. Product copy must distinguish simulation, readiness, setup, and real execution.

## Sources of truth

When documentation and code disagree, inspect these first:

| Concern | Source |
| --- | --- |
| Product tables and indexes | `convex/schema.ts`, `convex/agentSchema.ts` |
| Agent contracts and settings | `agent-service/src/moeazi_agent/contracts.py`, `config.py` |
| Durable workflows | `temporal_app.py`, `execution_workflow.py`, `venue_setup_workflow.py` |
| Runtime composition | `docker-compose.agents.yml`, `scripts/*.ps1` |
| Customer model routing | `convex/helpers/modelRouting.ts`, `model_routing.py` |
| Wallet capabilities | `lib/ownerSigner.ts`, `lib/eip7702.ts`, `convex/accountWallets.ts` |
| Venue readiness/setup | `convex/venueIntegrations.ts`, `venue_setup_*` |
| Actual private execution status | `venues.py`, `execution-sidecar/src/server.ts` |
| Dependency safety authority reduction | `dependency_safety_matrix.py`, `dependencySafety.ts` |
| Local recovery proof | `recovery_registry.py`, `recovery_evaluator.py`, `recovery_storage.py` |
| Product navigation | `components/StrategyShell.tsx`, `components/trade/TradeShell.tsx` |
| Mobile journey | `app/api/mobile/*`, `../../../src/services/apiClient.ts` |
| Local operator controls | `operator-console-lite/*`, `app/api/operator-*`, `convex/operator*` |

Architecture documents explain intent and “why”; executable code decides current
behavior.
