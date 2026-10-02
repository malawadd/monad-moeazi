# Validation — Capability and Delegation Lifecycle Ledger

## Local/fork/recorded fixture matrix

- EIP-7702 chain zero/wrong chain, wrong nonce, tuple ordering, outer-call revert
  persistence, zero-target reset, code-hash drift, reorg and RPC disagreement.
- Permit2/ERC-20 bounded amount, expiration, nonce invalidation, lockdown, underlying
  allowance, zero-first tokens and partial consumption.
- Smart/session module action/value/time limits and missing parent root.
- Venue delegate/key expiry, false provider success, timeout, rotation and partial
  multi-grant revocation.
- Concurrent execute/renew/revoke, duplicate/reordered Temporal delivery, crash/retry,
  replacement overlap, tenant/account isolation and residual authority.

## Acceptance thresholds

| Gate | Threshold |
| --- | ---: |
| Action matrix coverage across target/action/token/market/value/time/nonce | 100% |
| Executable action without fresh exact grant and observation | 0 |
| Chain-0/wrong-chain/stale/expired/over-limit/replayed/cross-tenant acceptance | 0 |
| New unbounded production allowance | 0 |
| `verified_revoked` without post-state evidence | 0 |
| Model/Redis/local flag acting as capability authority | 0 |
| Signing, funded action or provider probe in early validation | 0 |

Every executable subordinate grant must have enforceable scope, expiry and revocation.
Every root pointer must have current certified code and an explicit recovery path.

## Benefit evaluation

Inventory current effective approvals/grants from recorded or local state. Compare
authority at risk before/after using `min(allowance, balance, module/venue limit)`, plus
time-to-detect drift, time-to-verified-revoke, unknown duration, user prompts, gas and
failure rate. Never relabel authority-at-risk reduction as expected-loss reduction.

## Kill criteria

Kill a capability type until exact provider/venue state and verified revocation exist.
Kill the feature if bare EIP-7702 is treated as scoped dispatch, local rows claim
revocation, renewals are automatic, root/fallback keys or credentials enter models,
chain zero is accepted, `MaxUint256` migrates, or recovery/reconciliation is blocked.

No live signing, wallet action, provider probe, deployment or onchain test is authorized.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
