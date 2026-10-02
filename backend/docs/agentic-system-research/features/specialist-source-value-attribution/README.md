# Specialist Source-Value Attribution and Evidence Gating

## Decision

**Approved for evaluation — 87/100. Production source/role gating is held.**

Current specialists receive essentially the same bounded evidence block, and stored
report evidence is replaced with the full supplied reference list. That makes it
impossible to distinguish evidence supplied to a model from evidence it actually
cited. Honest citation identity, provenance, and replay manifests must come before
source-value claims.

## Target user and problem

Operators need to know which source families help each role, market, regime, and
horizon—and when stale or missing evidence makes a specialist ineligible—without
trusting model introspection or deleting rare safety-critical data.

## Why implement it

- Aligns each role with explicit evidence freshness and quality requirements.
- Measures marginal source-family value on paired frozen cases.
- Identifies expensive optional bundles that add no held-out value.
- Makes missing critical evidence cause a typed degrade/block/abstain outcome.
- Separates supplied, cited, and deterministically supporting evidence.

## Why the mechanism should work

Controlled ablation can isolate the conditional value of a source family while holding
route, prompt, role, and case fixed. Grouped coalition analysis can estimate redundancy
when sources overlap. Runtime gating then applies only pre-approved, versioned evidence
contracts; the attribution model never becomes authority.

## Proposed benefit

| Hypothesis | Test target | Confidence |
| --- | --- | --- |
| Runtime provider/token cost | 10–30% reduction from removing/degrading consistently non-positive optional bundles within quality margins | Medium-low |
| Freshness-misaligned citations | 30–60% reduction after honest citation baseline exists | Low-medium |
| Action-eligible critical roles with missing required evidence | Zero | High |

Offline attribution may cost more than runtime savings and must be reported separately.
No PnL improvement or causal source-importance claim is made.

## Prerequisites

- [Evidence Event Fabric](../evidence-event-fabric/README.md).
- Honest model-returned evidence IDs and deterministic resolution.
- Sufficient mature frozen cases per role, market, regime, and horizon.
- Existing critical-role and canonical model-family quorum remains unchanged.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
