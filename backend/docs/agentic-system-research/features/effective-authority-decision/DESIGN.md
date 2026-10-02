# Design — Effective Authority Decision Projection

**Implemented scope:** an append-only local fixture ledger and sanitized Test Center
projection only. No Convex row, Temporal trigger, gateway/sidecar hook, signer,
provider, venue, or network integration exists.

## Non-authorizing rule

The artifact is a read model. It is never a bearer token, preflight substitute, policy
input, or dispatch prerequisite. Actual owners rerun their checks at each boundary.
Execution may store the decision ID for audit but cannot trust its state.

### Implemented boundary correction

The prose below describes the future product design. The current implementation is
strictly narrower: it has no Convex projection, Temporal recompute hook, gateway or
sidecar consumer, signer/venue integration, or runtime owner. Timescale migration 031
and the current-fixture view hold only isolated Test Center fixture history. The
projector always imposes `PREFLIGHT_ONLY`, product `unavailable`, authority effect
`none`, zero external attempts, and zero provider cost.

## Canonical gate registry

Maintain one versioned registry with gate ID, category, owner service, applicable
boundaries, required receipt type, freshness, safe reason/remediation codes, and
redaction class. Categories are:

- deployment/live/certification;
- customer Shadow/Approval/Autopilot authority;
- development Manual Guard/Lite safeguards;
- profile/configuration/approval state;
- policy, credits, and budget reservation;
- evidence, quorum, integrity, calibration/eligibility;
- portfolio risk, sizing, and atomic reservation;
- venue readiness/health, quote, route, and preflight;
- wallet owner, delegation, credential/permission state;
- idempotency, submission uncertainty, and reconciliation.

## `GateResult`

- gate ID/version, category, owner/service;
- account/strategy/analysis/proposal/workflow and boundary identity;
- `pass | fail | unknown | stale | not_applicable`;
- maximum capability allowed by this result;
- stable reason/remediation code and allowlisted safe display message;
- observed/expires times, input/output hashes, receipt/evidence IDs;
- policy/configuration/certification/reconciliation revisions;
- redaction class and immutable result hash.

Owners emit results from their real checks. The reducer does not calculate exposure,
credits, quorum, venue health, approval, delegation, or reconciliation.

## `EffectiveAuthorityDecision`

- decision ID/hash, account/proposal/requested action/boundary;
- phase state and maximum effective capability;
- ordered blocking and warning reason codes;
- complete GateResult IDs/hashes and prerequisite graph;
- reducer/registry version, created/expires time;
- analysis/proposal/approval/idempotency bindings;
- explicit `non_authorizing=true`.

## State rules

First reduce the maximum capability ordinal:

`ANALYZE_ONLY < SHADOW_SIMULATE < PREFLIGHT_ONLY < SUBMISSION_ELIGIBLE`.

Then project the lifecycle overlay:

- `ANALYZE_ONLY`: analysis is allowed but evidence/mode/deployment does not permit a
  proposal simulation.
- `SHADOW_SIMULATE`: customer mode or an upper gate caps work at simulation.
- `AWAITING_USER_APPROVAL`: Approval mode has a valid unexpired proposal but no fresh
  approval; capability remains below preflight.
- `PREFLIGHT_ONLY`: approval/autopilot permits fresh quote/simulation/checks, but
  signing/submission prerequisites are incomplete, gated, or uncertified.
- `EXECUTION_BLOCKED`: the requested execution boundary has a failed/unknown/stale/
  conflicting required gate. Preserve the lower capability and all blockers.
- `SUBMISSION_ELIGIBLE`: every registered required owner result is fresh/pass for the
  instant immediately before signing/dispatch. This is not a promise of submission or
  fill.

Missing required gate coverage fails closed. Until authoritative risk/reconciliation
receipts exist, the maximum execution state is `EXECUTION_BLOCKED`/`PREFLIGHT_ONLY`.

## Recompute boundaries

Create a new projection at:

1. analysis completion;
2. proposal creation;
3. user approval or expiry;
4. route/quote and preflight;
5. immediately before signing/dispatch;
6. submission accepted/rejected/unknown;
7. confirmation/partial fill/reconciliation;
8. any relevant policy, profile, emergency, credential, certification, or receipt
   revision.

Each projection binds current hashes. Old decisions remain audit history and never
grant future authority.

## Storage and presentation

- Timescale stores full immutable GateResults, projections, and receipt links.
- Convex stores the bounded current customer-safe projection and audit reference.
- Redis is ephemeral coordination only.
- Temporal recomputes at durable workflow boundaries; event/outbox updates replace
  polling.

UI shows effective capability, lifecycle phase, every current blocker, safe remediation,
freshness, and last checked time. It distinguishes selected mode from effective
authority and simulation/readiness/preparation/submission/fill/reconciliation.

## Failure behavior

- Missing/stale/conflicting/wrong-subject result: lower capability and block requested
  execution.
- Reducer/registry version mismatch: block and emit operator-visible coverage failure.
- Safe-copy mapping missing: show stable code, never raw internal data or LLM summary.
- Owner unavailable: result becomes unknown/stale; never reuse beyond expiry.
- Projection persistence failure: execution continues using actual gates, but product
  status fails closed to unknown and incident telemetry records the gap.

## Later implementation sequence

1. Inventory canonical gates/owners and freeze the registry.
2. Add GateResult emission without changing enforcement.
3. Add reducer/property tests and Timescale storage.
4. Project analysis/Shadow states into Convex/UI.
5. Integrate authoritative risk, route, wallet, submission, and reconciliation receipts.
6. Enable preflight/submission states only after parity tests pass.

Rollback removes the current projection UI but retains immutable gate history; actual
enforcement remains unchanged throughout.

## Folded owner-boundary projection

Gate, sizing, policy, and calibration owners may emit typed `GateBoundary`,
`SizingBoundary`, `PolicyBoundary`, and `CalibrationBoundary` fragments with exact
owner/decision hash, freshness, observed-value class, current boundary/result, and a
stable safe-remediation code. This projection composes them into a strict
`BoundaryExplanation` marked `non_authorizing=true`.

It never recomputes a decision, searches arbitrary counterfactual inputs, suggests
raising a cap/lowering quorum/changing mode, or claims a market change would be
profitable. Missing, stale, conflicting, or non-monotonic fragments render
`partial/unknown`.
