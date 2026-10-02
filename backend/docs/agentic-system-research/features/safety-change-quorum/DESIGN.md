# Future Design

## Contracts

- `SafetyChangeClass`: exact path/schema, safety direction, qualified roles, quorum,
  apply owner, expiry/tests/rollback and break-glass eligibility.
- `ChangeRequest`: environment/scope, canonical before/after hashes and typed diff,
  requester, rationale/evidence/tests, rollback target, policy version and expiry.
- `HumanApprovalAttestation`: request hash, workforce identity, qualification revision,
  independent-principal proof, decision, authentication and time.
- `ChangeQuorumDecision` and `AppliedChangeReceipt`: current-state recheck, exact
  approval set, apply/partial/rollback result and durable link.
- `BreakGlassLease` and `BreakGlassUseReceipt`: incident, recovery-only capabilities,
  subject, approvals, one-time nonce, short nonrenewable expiry and state delta.

## Quorum and monotonicity rules

At least two distinct qualified humans who are not the requester approve the exact
before/after state, environment, scope, evidence and policy. Drift, expiry, role
revocation, concurrent change or mixed restrictive/relaxing diff invalidates approval.
The quorum set, thresholds, qualification policy and gate implementation are themselves
quorum-controlled. There is no one-person fallback.

One operator may enable emergency stop, pause, lower caps, remove routes/certification,
revoke access or isolate a dependency. Re-enable, cap increase, restoration or any
more-permissive rollback requires quorum.

## Break-glass and ownership

The lease may inspect, reconcile, disable, isolate, rotate service credentials or
restore one exact certified known-good config. It cannot trade, alter Particle/Magic,
expand delegation/risk/live execution, disable audit/privacy, change quorum or renew
itself. Expiry revokes automatically; failed revocation keeps the system paused.

Identity authenticates principals; Convex owns current requests/quorum state;
Timescale approvals/use history; Temporal expiry/auto-revoke/review; Redis notifications
only. Each domain owner applies its own change after verifying the receipt.

## Rollout, cost and latency

Inventory mutations and Shadow-classify historical/local changes first. Design can
proceed now; enforcement waits for two real independent qualified humans. No external
identity or CI service is enabled without cost approval. Normal trade latency remains
zero; local receipt verification target is under 10 ms. Tabletop goals are ten minutes
for ordinary critical change and two minutes for emergency containment, reported with
approver-unavailability rates.

Failure modes include unavailable independent approvers, stale qualification, receipt
mismatch and lease expiry; the relaxation remains blocked while restrictive shutdown
and recovery actions stay available. Rollback revokes the lease and preserves all
approval evidence.

## Local fixture implementation

The repository implements only a deterministic local replay of the enumerated fixture
inventory. It does not supply real identities, qualified staff, Convex state, Temporal
expiry/revocation, or domain-owner application. A synthetic success is never an
authority decision.
