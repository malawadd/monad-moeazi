from __future__ import annotations

from datetime import datetime

import orjson

from .evidence_lifecycle_contracts import LifecycleScope, PersistenceDecision
from .evidence_lifecycle_evaluator import evaluate_persistence
from .evidence_lifecycle_storage import EvidenceLifecycleRepository
from .evidence_lifecycle_registry import policy_for
from .evidence_lifecycle_identity import evidence_cache_key


def evidence_payload(item, market: str) -> dict:
    return {"evidence_id": item.ref.id, "source": item.ref.source,
        "reference": str(item.ref.uri), "observed_at": item.ref.observed_at.isoformat(),
        "content_hash": item.ref.content_hash, "content": item.content,
        "market": market.upper()}


def preflight_ingested_evidence(item, market: str) -> PersistenceDecision:
    decision, _, _, _ = evaluate_persistence(
        producer="push_evidence", purpose="evidence_ingest", sink="timescale.evidence_body",
        scope=LifecycleScope(kind="public", key="public"),
        payload=evidence_payload(item, market), artifact_id=item.ref.id,
        idempotency_key=f"evidence:{item.ref.id}:timescale", observed_at=item.ref.observed_at)
    if decision.outcome not in {"allow", "transformed"}:
        raise RuntimeError(f"Evidence lifecycle blocks ingestion: {decision.reasons[0]}")
    return decision


async def persist_ingested_evidence(*, repository, redis, temporal, task_queue: str,
        item, market: str) -> PersistenceDecision:
    # lifecycle-sink:push-api-timescale-redis
    # lifecycle-sink:continuous-timescale-redis
    lifecycle = EvidenceLifecycleRepository(repository.engine)
    scope = LifecycleScope(kind="public", key="public")
    payload = evidence_payload(item, market)
    primary, sanitized, receipts, schedule = evaluate_persistence(
        producer="push_evidence", purpose="evidence_ingest", sink="timescale.evidence_body",
        scope=scope, payload=payload, artifact_id=item.ref.id,
        idempotency_key=f"evidence:{item.ref.id}:timescale", observed_at=item.ref.observed_at)
    if primary.outcome not in {"allow", "transformed"} or schedule is None:
        await lifecycle.save_decision_bundle(primary, receipts, schedule)
        raise RuntimeError(f"Evidence lifecycle blocks ingestion: {primary.reasons[0]}")
    cache, cache_payload, cache_receipts, cache_schedule = evaluate_persistence(
        producer="push_evidence", purpose="evidence_ingest", sink="redis.evidence_cache",
        scope=scope, payload=payload, artifact_id=item.ref.id,
        idempotency_key=f"evidence:{item.ref.id}:redis", observed_at=item.ref.observed_at)
    if cache.outcome not in {"allow", "transformed"}:
        await lifecycle.save_decision_bundle(cache, cache_receipts, cache_schedule)
        raise RuntimeError(f"Evidence lifecycle blocks cache: {cache.reasons[0]}")
    await lifecycle.save_governed_evidence(item, sanitized, primary, receipts, schedule)
    await lifecycle.save_decision_bundle(cache, cache_receipts, cache_schedule)
    cache_policy = policy_for("push_evidence", "evidence_ingest", "redis.evidence_cache")
    await redis.setex(evidence_cache_key(market, item.ref.id),
        min(300, cache_policy.retention_seconds), orjson.dumps({
            "ref": item.ref.model_copy(update={"uri": cache_payload.get("reference", "dropped")})
                .model_dump(mode="json"),
            "content": cache_payload.get("content"),
            "lifecycleDecisionHash": cache.decision_hash,
        }))
    return primary


def _projection(decision: PersistenceDecision, artifact_id: str,
        strategy_account_id: str | None, decision_body_json: str) -> dict:
    return {"strategyAccountId": strategy_account_id, "artifactId": artifact_id,
        "producer": decision.producer, "purpose": decision.purpose, "sink": decision.sink,
        "scopeKind": decision.scope.kind, "scopeKey": decision.scope.key,
        "outcome": decision.outcome, "reasons": decision.reasons,
        "policyHash": decision.policy_hash, "inventoryHash": decision.inventory_hash,
        "decisionHash": decision.decision_hash,
        "decisionBodyJson": decision_body_json,
        "sanitizedPayloadHash": decision.sanitized_payload_hash,
        "retentionScheduleHash": decision.retention_schedule_hash,
        "evaluatedAt": int(decision.evaluated_at.timestamp() * 1000),
        "expiresAt": int(decision.expires_at.timestamp() * 1000)}


def _canonical_decision_body(decision: PersistenceDecision) -> dict:
    body = decision.model_dump(mode="json", exclude={"decision_id", "decision_hash"})
    # Pydantic writes UTC as Z, but the evaluator hashes datetime.isoformat().
    body["evaluated_at"] = decision.evaluated_at.isoformat()
    body["expires_at"] = decision.expires_at.isoformat()
    return body


async def govern_projection(*, repository, convex, artifact_id: str,
        strategy_account_id: str | None, purpose: str, sink: str, payload: dict,
        observed_at: datetime, producer: str = "product_projection") -> tuple[PersistenceDecision, dict]:
    scope = LifecycleScope(kind="account", key=f"account:{strategy_account_id}",
        strategy_account_id=strategy_account_id) if strategy_account_id else LifecycleScope(
            kind="public", key="public")
    decision, sanitized, receipts, schedule = evaluate_persistence(
        producer=producer, purpose=purpose, sink=sink, scope=scope, payload=payload,
        artifact_id=artifact_id, idempotency_key=f"projection:{artifact_id}:{sink}",
        observed_at=observed_at)
    lifecycle = EvidenceLifecycleRepository(repository.engine)
    await lifecycle.save_decision_bundle(decision, receipts, schedule)
    if decision.outcome not in {"allow", "transformed"}:
        raise RuntimeError(f"Evidence lifecycle blocks projection: {decision.reasons[0]}")
    try:
        body = _canonical_decision_body(decision)
        await convex.command("projectEvidenceLifecycleDecision",
            **_projection(decision, artifact_id, strategy_account_id,
                orjson.dumps(body).decode()))
    except Exception as exc:
        raise RuntimeError("Evidence lifecycle projection failed closed") from exc
    return decision, sanitized
