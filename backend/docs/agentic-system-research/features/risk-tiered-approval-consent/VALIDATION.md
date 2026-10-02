# Validation — Risk-Tiered Approval Quality and Consent Receipts

## Adversarial and concurrency fixtures

- Wrong user/account/owner, Particle-versus-Magic mismatch, chain/domain/verifier
  mismatch, expired/replayed nonce, double click, concurrent devices, and stolen session.
- Quote/route/venue, policy/profile/mode, risk/reservation/exposure, uncertainty,
  evidence, fee/funding/gas, size/leverage and expiry changes after acceptance.
- Favorable price inside bounds, exact boundary, one-unit unfavorable breach, route
  change, stale quote, emergency stop, uncertain submission, and cross-store retry.
- Shadow, Approval, and Autopilot separation; no prompt or signature in Shadow.

## Safety thresholds

| Gate | Threshold |
| --- | ---: |
| Dispatch without valid packet, consent, fresh preflight, and execution checks | 0 |
| Material-delta invalidation | 100% |
| Replay/cross-user/wrong-chain/wrong-signer/double-consume success | 0 |
| Packet field/hash coverage or blocked | 100% |
| Post-approval comparisons retained | 100% |
| Secret, credential, CoT, or raw signature leakage to model/customer trace | 0 |

Property tests must prove that a higher authoritative risk input cannot lower ceremony,
a tier cannot increase authority, and packet acceptance cannot bypass policy,
preflight, reconciliation, or owner signing.

## UX experiment

Pre-register representative low, elevated, and high-risk tasks. Measure task completion,
critical-field recall, warning adherence, false reassurance, decline/expiry/abandonment,
time-to-decision, invalidation/reissue, support errors, and prompts per completed or
blocked action. Acceptance rate alone is not success.

The duplicate-prompt hypothesis passes only if its confidence interval lower bound is
above zero and critical-field task success does not worsen. Stale unsafe submission
must remain zero. No EIP-712-based comprehension claim is allowed.

## Promotion and kill rules

1. Shadow: generate/render/expire packets without prompting or signing.
2. Approval dry-run: collect decisions but block dispatch.
3. Certified Approval: enable only after risk/EAD/route receipts and signer matrix pass.
4. Autopilot remains unchanged.

Kill any variant that permits future/blanket approval, reuses quote-bound protocol
signatures, silently autoresubmits, treats consent as authority, skips fresh preflight,
adds a fallback owner key, weakens risk based on a model, or cannot prevent replay.

No live/funded verification, deployment, or wallet action is authorized here.

The checked-in local corpus covers threshold edges, source-chain faults, synthetic
receipt expiry/replay/provider mismatch, material deltas, and privacy projections.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
