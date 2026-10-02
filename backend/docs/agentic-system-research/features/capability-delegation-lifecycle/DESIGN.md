# Design — Capability and Delegation Lifecycle Ledger

## Contracts

`GrantSpec` binds grant ID/type (`eip7702_root`, smart/session module, venue delegate,
credential, ERC-20 allowance or Permit2), owner/account and Particle/Magic provider,
chain `42161`, venue domain, target/module/spender and certified code hash, selectors/
actions, markets/tokens/recipients, per-call/daily/cumulative limits, gas/sponsorship
cap, effective/expiry, nonce/replay domain, parent grants, credential fingerprint,
policy/certification revisions and revocation method.

`StateObservation` records native RPC/provider/venue state, block/finality/revision,
implementation/code, session/module permissions, allowance/expiry/nonce, observed/
expires times, `active | expired | revoked | drifted | unknown`, raw refs and hash.

`CapabilityDecision` binds one requested action/target/value/selector/market/token to
required grant and observation hashes and returns `allow | deny | unknown | stale |
close_or_reconcile_only`. It is not a bearer token; sidecar rechecks native state.

`RevocationPlan` freezes dependency order, local dispatch latch, expected native/provider
actions, gas/fees preview, owner checkpoints, idempotency and expected post-state.
`RevocationReceipt` tracks each action as `requested | prepared | submitted |
revocation_unknown | verified_revoked | failed` plus final observations and residual
authority.

## Lifecycle

`requested -> awaiting_user -> submitted | unknown -> active_verified -> expiring ->
pending_revocation -> revocation_unknown | verified_revoked`

- Pending, expired, unknown or drifted state blocks new dispatch and lowers EAD.
- Reconciliation and certified recovery remain available.
- Convex says “routing disabled; revocation pending” until verified post-state.
- Emergency stop blocks work but never changes the grant state.
- Renewal is always explicit; never silently or automatically renew.

Replacement creates/verifies the new bounded grant, then revokes/reconciles the old
under one plan and a frozen maximum overlap window. Unknown old authority prevents
Autopilot.

## Allowance and root-delegation policy

- No new production `MaxUint256` allowance after cutover.
- Prefer exact amount; otherwise use frozen bounded headroom and expiry.
- If a protocol requires unbounded approval, it is not Autopilot-certified.
- Inventory legacy approvals before user-confirmed migration/revocation.
- A root 7702 pointer requires current certified code plus explicit zero-target/upgrade
  recovery. All Moeazi-executable subordinate grants require scope, expiry and
  verifiable revocation.

## Ownership

- Convex: requested/current bounded state and routing latch.
- Timescale: immutable specs, observations, decisions and receipts.
- Temporal: setup, expiry, replacement, revoke and reconciliation workflows.
- Gateway/sidecar: encrypted credentials and immediate native enforcement.
- Redis: no durable capability authority.

## Cost, failure and rollback

Grant/revocation can require signatures, Arbitrum gas and provider latency; disclose
cost and obtain approval before any real action. Failure remains pending/unknown with
dispatch disabled and residual risk visible. Rollback cannot restore local Boolean
authority; it must follow the same grant/observation lifecycle.
