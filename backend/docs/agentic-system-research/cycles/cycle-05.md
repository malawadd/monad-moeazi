# Cycle 05 — Execution Fidelity, Error Dependence, and Approval Quality

## Research question

Which missing artifacts would make Shadow execution, multi-path analytical agreement,
and user approval more truthful without giving models execution or policy power?

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Calibrated Shadow Execution and TCA Fidelity | Approved for bounded Shadow/evaluation | 88 | Extend the existing execution-quality domain; a quote or book replay is never a certified fill |
| Analytical Diversity and Correlated-Error Audit | Approved for Evaluation-only dossier | 84 | Capture exact path lineage/outcomes; production cap/escalate/abstain policy remains held |
| Risk-Tiered Approval Quality and Consent Receipts | Approved with material-delta reframe | 89 | Bind one-time owner consent to visible bounds, then requote and rerun every deterministic gate |

## Repository gaps confirmed

- Current Shadow records one current quote from the first venue as a complete entry
  fill without venue lifecycle or total-cost calibration.
- Canonical model-family quorum is enforced within a run, but no mature path-level
  residual or common-mode error scorecard exists.
- Approval currently verifies owner/status/expiry and changes rows; the later workflow
  requotes, but the approval itself has no authoritative packet, nonce, signer proof,
  material-delta envelope, or post-approval comparison.

## Evidence corrections

- An exact quote is exact only at capture time. It is not an exact fill. Even
  sequence-complete displayed-book replay can leave passive queue, hidden flow, own
  impact, MEV, and counterfactual reactions unknown.
- arXiv `1810.11454` supports uncertain-volume execution scheduling only, not queue or
  fill fidelity.
- The diversity paper is JMLR volume 24 (2023); negative-correlation learning concerns
  jointly trained neural networks, not post-hoc LLM trading-path auditing.
- EIP-712 supplies typed/domain-separated signing but explicitly not replay protection.
  Current NIST SP 800-63B-4 is an authentication analogy, not transaction consent.

## Corrected benefits

- TCA: 100% cost/assumption fields complete or `unscorable`; optimism and MAE ranges
  remain hypotheses requiring exact-cell certified receipt cohorts.
- Diversity: 100% lineage or unscorable; deterministic common-mode fixtures must be
  detected completely. Wrong-consensus reduction remains a low-confidence hypothesis.
- Approval: 100% valid packet + one-time consent + within-envelope fresh preflight, or
  block. Prompt and stale-confirmation reductions require product experiments.

## Stop-condition state

This cycle approved three dossiers, so the consecutive zero-approval count is **0**.
Research continues.
