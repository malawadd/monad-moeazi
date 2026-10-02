# Cycle 03 — Evidence Quality and Efficient Orchestration

## Research question

How can Unimoazi improve evidence freshness, replayability, role-specific data value,
and operating cost without polling Convex or weakening tier guarantees?

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Event-driven evidence program | Approved and split | 92 | Build separate Evidence Event Fabric and Schedule Sync Outbox rollout dossiers |
| Specialist source-value attribution/gating | Approved, evaluation first | 87 | Fix citation identity and provenance before measuring source contribution |
| Adaptive orchestration | Approved, constrained | 86 | Deterministic skip/no-change is production-shaped; reduced-slot tier plans remain evaluation-only |

## Split rationale

Market evidence events start idempotent analysis workflows. Customer profile and
subscription revisions reconcile desired Temporal schedules. Combining them would
couple unrelated state owners and obscure recovery. The Evidence Event Fabric also
needs its own durable trigger-dispatch record; writing Timescale and then only Redis or
Temporal would create another dual-write gap.

## Evidence boundaries

- W3C PROV supports lineage vocabulary, not truth.
- SRE/outbox/log documentation supports freshness, ordering, and idempotent delivery,
  not trading alpha or end-to-end exactly-once claims.
- Data Shapley motivates marginal contribution but is not causal source attribution.
- FrugalGPT and RouteLLM show general cost/quality tradeoffs under looser routing
  assumptions than Unimoazi permits.

## Corrected hypotheses

- Evidence fabric: 100% manifest coverage after cutover is a defensible invariant;
  historical source completeness is reported separately. Quiet-market savings remain
  a hypothesis because a maximum-staleness cadence remains.
- Source value: cost and freshness-citation ranges are unproven and not measurable
  until supplied, cited, and supporting evidence are distinct.
- Run planning: skipped work reports time-to-no-change, missed-event rate, and snapshot
  age. Full action-eligible runs retain the complete tier contract and maximum budget.

Cycle 04 examines calibration/abstention, evidence manipulation resistance, and a
customer-readable effective-authority decision record.
