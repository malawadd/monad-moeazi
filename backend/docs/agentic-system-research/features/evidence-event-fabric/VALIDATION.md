# Validation — Evidence Event Fabric

## Deterministic fixtures

- exact duplicates by event ID, sequence, and content hash;
- same identity with correction, supersession, and tombstone;
- late/reordered events, clock skew, sequence gaps, reconnect snapshots, and backfill;
- parser/schema/market-mapping version changes;
- stale, incomplete, unauthenticated, wrong-market, and injected content;
- quiet market, gradual drift, boundary churn, event storm, and high-risk-position
  override.

## Failure injection

- Timescale fails before/after transaction commit.
- Notification is lost.
- Dispatcher crashes before/after Temporal start and before acknowledgement.
- Redis is flushed or unavailable.
- Temporal is unavailable, slow, or returns an existing deterministic workflow.
- Provider/runtime budgets, Manual Guard, and Lite Mode block work.

## Replay tests

- Every post-cutover analysis reproduces the exact ordered manifest and cutoff.
- Corrected data does not alter an older manifest.
- `observed_at <= cutoff` prevents future leakage.
- Missing or non-retainable source content is explicit rather than silently omitted.
- Replaying the same trigger/configuration yields the same manifest hash and workflow
  identity.

## Metrics and promotion thresholds

| Metric | Threshold |
| --- | --- |
| Post-cutover analyses with manifest | 100% |
| Accepted events lost in deterministic failure suite | 0 |
| Duplicate workflows for one trigger identity | 0 |
| Corrections discarded as duplicates | 0 |
| Material triggers meeting source-specific healthy-feed workflow-start SLO | At least 99% |
| High-priority risk/execution events dropped under load | 0 |
| Redis loss causing durable evidence/trigger loss | 0 |

Measure redundant quiet-market analyses/provider calls against the current cadence for
at least one complete frozen observation window. The 50–80% range is a hypothesis;
savings do not justify missed events or excess snapshot age.

## Kill criteria

- Convex polling is introduced.
- Redis becomes the only record of evidence or an undelivered trigger.
- A correction overwrites history.
- A source-wide global freshness value replaces role/horizon policies.
- Trigger storms can exceed reserved daily/provider budgets.
- An analysis can start without a reproducible manifest.

## Folded adapter-manifest cases

- Malicious redirects, SSRF/private IP/DNS rebinding, arbitrary URI, oversized or
  compressed payload, pagination loop, slow response, MIME/schema drift and injection.
- Duplicate/reordered pages, cursor gap, correction, revoked credentials, cross-tenant
  config/source access, cache poisoning, cost overrun, Timescale failure and retry.
- Require 100% external evidence to bind activated manifest/query/parser/sanitizer
  hashes; zero model tool calls, credential exposure, arbitrary-URI fetches or raw
  unquarantined results; identical fixture/version yields identical event hash.
- Any request above fixed byte/item/page/deadline/cost envelope is blocked and audited.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
