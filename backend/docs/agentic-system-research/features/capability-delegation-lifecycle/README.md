# Capability and Delegation Lifecycle Ledger

## Local implementation status

Implemented for local fixture-only Test Center evaluation. The default is off; observe
and isolated enforce cannot authorize the product, signer, gateway, sidecar, provider,
RPC, broadcast or external mutation. Native delegation, revocation and activation
remain separately gated.

## Decision

**Approved as an execution-certification prerequisite — 97/100.**

Score: fit 14, evidence 12, safety 14, execution boundary 14, benefit 11,
evaluation 10, data 8, cost 7, latency 7.

## Target user and problem

Customers and operators need product state to match the authority that actually exists
onchain or at a venue/provider. Current records summarize EIP-7702 delegation and
venue permissions, but a revocation path can mark local rows revoked without executing
or verifying effective revocation. A legacy allowance helper also uses `MaxUint256` and
must never migrate into the active Arbitrum execution path.

## Why implement it

- Inventories every root and subordinate authority surface under Particle/Magic.
- Enforces exact chain, target, code, action, token/market, value, time and nonce scope.
- Distinguishes routing-disabled, revocation-pending, unknown and verified-revoked.
- Makes setup, use, expiry, replacement, revocation and recovery idempotent and
  evidence-backed.

## Why the mechanism should work

EIP-7702, Permit2, token allowances and venue delegates expose verifiable state and
revocation mechanisms. Binding each executable action to a fresh, exact grant plus
native state observation prevents local flags from inventing authority. It reduces the
maximum authority at risk but cannot neutralize a malicious root delegate after the
owner authorizes it or prevent Particle/Magic compromise.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Executable actions bound to exact fresh grants/observations | 100% | High |
| Chain-0/wrong-chain grants or new unbounded production allowances | Zero | High |
| Local state labeled revoked without verified post-state | Zero | High |
| Maximum subordinate authority at risk versus unlimited allowance | 80–99% reduction | Medium-high |

The percentage is calculated per grant as the change in `min(allowance, balance,
module/venue limits)`. It is not expected-loss reduction.

## Authority boundary

Particle and Magic remain the only owner signers; no fallback key is allowed. A root
EIP-7702 pointer may be intentionally non-expiring because the base protocol has no
expiry, but it cannot alone grant Unimoazi dispatch. Effective authority is the
intersection of the certified root and scoped, expiring, revocable subordinate grants.
Models receive no capability, credential, wallet or revocation tool.

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
