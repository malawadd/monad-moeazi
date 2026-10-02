# Separate mobile model releases from trading authority

Status: model-only release selection is implemented in the development backend and
loopback console, with a mobile readout. Vault and mandate contracts are unchanged.
This is not a fresh-provider or funded-trade qualification. Broader strategy and
venue modularity remains future work.

## Product rule

The customer chooses capital and duration, authorizes bounded trading once, and
retains Stop and withdrawal controls. Moeazi operates the research and agent system
inside those bounds. Replacing a deprecated model, changing provider keys, or
releasing a qualified agent configuration must not require an app binary update,
another vault, or a new customer signature. Expanding the customer's trading
authority is a separate event and cannot be disguised as an AI configuration update.

Sign-in authenticates the customer; the Start mandate and venue-specific permissions
define what the system may do with funds. Broad product consent does not itself
create on-chain or venue authority.

## Legacy coupling and the implemented correction

`convex/internalSpotProgramBootstrap.ts` hashes `modelConfigurationHash` into the
frozen `tradingProgramVersions.contentHash`. `convex/managedSpotMandates.ts` records
that hash and version in each mandate. `ManagedSpotVault.sol` stores the resulting
`programVersionHash` as an immutable value. `convex/managedProgramRuntime.ts` and
the finance/activation paths require exact assignment, mandate, version, and hash
matches. The analysis path now pins a separate `agentReleaseVersionId` on each new
managed job and takes routing from that compatible frozen release. An old job without
this field uses its original assigned version. Finance and execution still verify
the signed authority hash. The original combined hash remains for legacy vaults;
model changes no longer require changing it.

The vault itself does not select or run an LLM. Its on-chain limits include owner,
executor, assets, fixed swap route, committed capital, per-buy cap, expiry, Stop,
and owner withdrawal. Its immutable program hash is an identity commitment; the
backend makes that commitment depend on the model. That dependency is a Moeazi
design choice, not a Magic, EIP-7702, or OpenRouter requirement.

## Target boundaries

| Boundary | Owner and change rule |
| --- | --- |
| Customer mandate | Customer-owned capital, duration, allowed asset/venue scope, risk ceilings, executor powers, and exit rights. New or wider powers need appropriate customer authorization. |
| Agent release | Moeazi-owned version of provider routes, exact model IDs, prompts, agent roles, and qualified fallback order. May change inside the existing mandate. |
| Strategy release | Moeazi-owned approved decision logic; may change only when compatible with the customer's granted instrument/venue/risk envelope and any promised strategy scope. |
| Deterministic risk and accounting | Account-wide financial truth, atomic reservations, loss/exposure checks, and release compatibility. No LLM can waive these. |
| Venue adapter | Owns protocol-specific quote, permissions, submit, cancel, close, and reconciliation. Disabled venues admit no new entry; closure and reconciliation continue for existing exposure. |
| Vault or venue credential | One scoped custody/execution mechanism, not the agent runtime. Existing spot vault remains owner-controlled; other venues may use different restricted mechanisms. |

The execution boundary checks the original mandate and current account/venue risk
state. It does not treat a model release as additional authority. Tighter safety
settings may reduce operations immediately; a release may never raise the grant's
capital, duration, asset, leverage, or withdrawal scope.

## Per-run behavior and continuity

1. The operator console saves credentials locally and prepares an immutable agent
   release with model IDs, prices, output contracts, data handling, and fallback
   policy. Saving a key changes no customer's mandate.
2. Qualification checks structured-output support, bounded cost, grounding,
   abstention, and compatibility with the managed program. A release is explicit
   and reversible; failed candidates never replace the active release.
3. At dispatch, Temporal resolves one active agent release for that account and
   freezes its ID/hash into the job. A running job cannot switch models mid-run.
   Its trace records requested and served model, provider, cost, evidence, and
   decision. The result is still only a proposal.
4. Deterministic risk, reservation, venue authority, execution, and reconciliation
   use the customer mandate and current financial state. They do not gain powers
   from the agent release. Position supervision runs even if research providers
   are down.
5. A retired model selects a prequalified, in-policy replacement for a **new**
   analysis run. If none is healthy, new entries abstain; Stop, close, recovery,
   and withdrawal remain independently available. No silent model substitution
   inside a frozen run.

## Migration for already funded spot accounts

Preserve the existing assignment, mandate, and deployed vault hash. Introduce an
`agentReleaseId`/hash (name provisional) that is independently selected and recorded
for new analysis jobs. The old program version remains the authority identity and
its frozen model document remains historical; the UI must show the **current agent
release** separately so it never claims the vault's old model is still serving.
Update the managed-runtime, scheduling, credit/cost, trace, and proposal admission
paths to resolve this release without changing the original mandate or weakening
any version/hash verification at the finance and execution boundaries.

For new mandates, define an authority hash that excludes operational model routing.
Do not redeploy or mutate a funded vault solely to change the model. If a current
vault cannot support a *different trading authority* or venue, use an explicit
position-aware migration with customer authorization; do not reinterpret its
immutable hash or strand open exposure.

The console release pointer selects models for new analysis jobs, including funded
accounts, after checking compatibility with the original authority. It does not
change `MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID`, which separately chooses
the authority version for new allowlisted mobile enrollments. Local tests cover
job pinning, rollback, and changed-policy rejection. A live analysis using the
new release on the existing funded account is still outstanding.

## Acceptance and failure cases

- Replace a deprecated model while the account retains the same mandate and vault;
  the next run records the new agent release and no extra customer signature.
- An in-flight run retains its original model; retry/replay keeps that identity.
- Missing key, provider outage, unpriced or incompatible model, or exhausted budget
  yields a qualified fallback or abstention without new orders.
- A release cannot widen venues, assets, capital, order/loss/leverage ceilings,
  expiry, executor scope, or withdrawal destination.
- A paused or stopped account never resumes because an agent release changes.
- Open-position close, uncertain-order recovery, and withdrawal work during a
  research-provider outage and after agent-release rollback.
- Console and mobile identify the authority version and agent release separately;
  audit history attributes each proposal and actual fill to both.

This direction does not certify strategy quality, new venues, or live execution.
It is an implementation correction to the current exact-version prototype.
