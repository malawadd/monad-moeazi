# Validation and Promotion

## Baselines and datasets

Compare the proposed receipt with the current nullable scalar/proxy path. Build a
versioned corpus of official examples, recorded native responses and locally
constructed account states for each certified venue × market type × margin mode.
Cases cover normal, tier boundary, cross/isolated margin, funding/fee changes, stale
and missing components, sequence gaps, disagreement and protocol revision.

No funded or live submission is part of this plan. Begin with fixtures, replay, local
calculation and Shadow dual runs.

## Required experiments

1. **Native parity:** compare every calculated component and liquidation result with
   certified venue fixtures at an exact snapshot.
2. **Semantic mutation:** change formula revision, direction, min/max use, decimals,
   market/account identity and margin tier; every unsafe mutation must block.
3. **Freshness/adversarial:** inject stale, missing, disputed, out-of-order, gapped and
   divergent observations plus cross-venue substitution attempts.
4. **Safe close:** prove the operation matrix permits certified risk reduction when
   increases are blocked, without permitting a disguised increase.
5. **Shadow dual run:** compare current eligibility with receipt-backed eligibility
   and classify every disagreement before estimating benefit.
6. **Recovery:** simulate endpoint outage, config drift and restart; verify immutable
   prior receipts and deterministic refresh/reconciliation.

## Acceptance thresholds

- 100% of exposure-increasing preflights bind certified semantics, a complete fresh
  observation set and an account-bound liquidation receipt.
- 100% exact parity on certified native fixtures within the venue's documented
  integer/rounding rules.
- Zero proxy, midpoint, external or cross-venue substitutions pass as native margin.
- Zero wrong-account, wrong-market, stale, gapped or expired-certification mutations
  pass.
- 100% of blocked increases retain the correct certified close/reconcile behavior.
- Added p95 latency stays within the declared budgets or promotion is narrowed.

## Benefit measurement

Primary benefit is the invariant coverage above. Secondary benefit is relative
reduction in independently adjudicated false-eligibility defects attributable to
semantic mismatch. Report the denominator and confidence interval. Test the 50–90%
hypothesis only after at least 30 such baseline defects or a pre-registered power
analysis; otherwise report `insufficient evidence`.

## Promotion, demotion and kill criteria

Promote per exact venue/market/margin cell after fixture parity, adversarial coverage
and Shadow thresholds pass. Demote immediately on unexplained native disagreement,
semantic/config drift, observation gaps, unsafe-close classification or latency/SLO
breach. Kill or redesign if required native inputs cannot be obtained without
guessing, or if the receipt cannot distinguish venue domains and account snapshots.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
