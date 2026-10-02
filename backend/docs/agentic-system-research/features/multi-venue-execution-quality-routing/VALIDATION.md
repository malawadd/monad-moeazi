# Validation — Multi-Venue Execution-Quality Routing

## Baseline

Compare against the current Unimoazi all-in router, not a displayed-price or spread-only
strawman. Use time-aligned recorded exact books/quotes, account fixtures, and known
proxy inputs. No funded execution is needed.

## Contract and feed tests

- Correctly classify exact executable, exact public, indicative, and proxy data.
- Reject proxy/indicative inputs from executable selection.
- Validate contract units, side/size VWAP, fees/rebates, funding horizon, gas, margin,
  minimums, leverage, and deadlines per venue.
- Inject disconnects, sequence gaps, duplicate/reordered updates, stale funding,
  malformed/empty/crossed books, and snapshot recovery.
- Add venue-native checksum/precision fixtures, partial adapter outage and unsupported
  messages; require typed outcomes, zero silent drops and zero synthetic/proxy books
  in executable selection.

## Routing and lifecycle tests

- Account readiness, policy, health, depth, slippage, and reconciliation exclusions.
- Stable deterministic tie-breaking and canonical hashing.
- Route change, quote expiry, position change, fee drift, and policy revision between
  plan and preflight.
- Partial fill, rejection, timeout before/after possible submission, reorg, and
  reconciliation mismatch.
- Prove no failover after uncertain submission until non-acceptance is authoritative.
- Attempt concurrent public/private fanout, stale capability use and false privacy
  claims; all must block. A channel change must create a fresh decision and preflight.

## Metrics

- eligible/excluded venues by reason and source class;
- stale, depth, readiness, quote/preflight mismatch, rejection, and unresolved counts
  reported separately;
- predicted and realized all-in component error where certified fills exist;
- selected-versus-runner-up modeled cost;
- route/preflight/reconciliation receipt coverage;
- book recovery time, router p50/p95 latency, connection/subscription count, Redis
  memory, API rate usage, and storage cost.

## Promotion thresholds

Shadow integration may advance when:

- zero executable plans select proxy or indicative data;
- zero stale, sequence-gapped, insufficient-depth, unready, or uncertified candidates
  are selected in the deterministic suite;
- 100% of dispatches bind a fresh certified submission-channel decision and zero
  unconsented privacy downgrades occur;
- 100% of route transitions have a receipt or explicit failed receipt;
- recorded cases reproduce the same selection from the same hashes;
- added p95 routing latency stays within the route-plan freshness budget;
- the extension is non-inferior to the current router on modeled all-in cost and
  strictly improves account-readiness/receipt coverage.

Approval/live review additionally requires exact account inputs, certified adapters,
and reconciled fill evidence. The 15–35% modeled-cost hypothesis is not an acceptance
claim; actual cost improvement requires paired certified fills.

## Kill criteria

- A second production ranking implementation appears.
- A proxy is described or consumed as executable.
- User preference bypasses a hard exclusion.
- Route changes without snapshot/receipt invalidation.
- Automatic venue failover after an uncertain submission.
- A simulation is described as guaranteed execution.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
