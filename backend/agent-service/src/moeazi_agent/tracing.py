import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .evidence_lifecycle_contracts import LifecycleScope
from .evidence_lifecycle_evaluator import evaluate_persistence
from .evidence_lifecycle_storage import EvidenceLifecycleRepository
from .evidence_lifecycle_locking import lock_lifecycle_artifacts
from .evidence_lifecycle_trace_disclosure import load_disclosable_trace_events

SECRET_PATTERN = re.compile(r"(?i)(sk-[a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]+|api[_-]?key\s*[:=]\s*\S+)")

def sanitize(value: Any) -> Any:
    if isinstance(value, str):
        return SECRET_PATTERN.sub("[REDACTED]", value)[:4_000]
    if isinstance(value, list):
        return [sanitize(item) for item in value[:30]]
    if isinstance(value, dict):
        return {
            str(key)[:80]: "[REDACTED]" if any(token in str(key).lower() for token in ("secret", "api_key", "authorization")) else sanitize(item)
            for key, item in list(value.items())[:60]
        }
    return value
class TraceRepository:
    def __init__(self, engine: AsyncEngine, redis: Redis | None = None):
        self.engine = engine
        self.redis = redis

    async def record_analysis(self, synthesis, reports, calls, evidence_items,
                              account_id: str | None,
                              lifecycle_decision_hash: str | None = None,
                              team_id: str | None = None,
                              team_version_id: str | None = None,
                              deployment_id: str | None = None) -> None:
        root_id = f"{synthesis.analysis_id}:run"
        await self.append({
            "event_id": root_id, "analysis_id": synthesis.analysis_id, "account_id": account_id,
            "event_type": "analysis", "status": "completed",
            "input_summary": {"market": synthesis.market, "tier": synthesis.tier,
                "lifecycleDecisionHash": lifecycle_decision_hash,
                "teamId": team_id, "teamVersionId": team_version_id,
                "deploymentId": deployment_id},
            "output_summary": {
                "consensus": synthesis.consensus, "confidence": synthesis.confidence,
                "disagreement": synthesis.disagreement, "conflicts": synthesis.conflicts,
            },
            "decision_summary": _synthesis_summary(synthesis),
            "created_at": synthesis.created_at, "completed_at": synthesis.created_at,
        })
        for item in evidence_items:
            ref, content = item if isinstance(item, tuple) else (item, "")
            await self.append({
                "event_id": f"{synthesis.analysis_id}:evidence:{ref.id}",
                "analysis_id": synthesis.analysis_id, "account_id": account_id,
                "parent_event_id": root_id, "event_type": "evidence", "status": "completed",
                "input_summary": {}, "output_summary": {
                    "evidenceId": ref.id, "source": ref.source, "reference": str(ref.uri),
                    "observedAt": ref.observed_at.isoformat(), "quality": ref.quality_score,
                    "contentHash": ref.content_hash, "excerpt": sanitize(content[:1_000]),
                },
                "decision_summary": f"Evidence from {ref.source}", "created_at": synthesis.created_at,
            })
        report_map = {(item.role, item.provider): item for item in reports}
        specialist_ids: list[str] = []
        for index, call in enumerate(calls):
            event_id = f"{synthesis.analysis_id}:call:{index}"
            report = report_map.get((call.get("role"), call.get("provider")))
            kind = "synthesis" if call.get("kind") == "synthesis" else "model_call"
            output = report.model_dump(mode="json") if report else (
                {"consensus": synthesis.consensus, "confidence": synthesis.confidence}
                if kind == "synthesis" else {}
            )
            if call.get("metadata"):
                output = {**output, "routing": call["metadata"]}
            await self.append({
                "event_id": event_id, "analysis_id": synthesis.analysis_id,
                "account_id": account_id, "parent_event_id": root_id,
                "event_type": kind, "role": call.get("role"), "provider": call.get("provider"),
                "model": call.get("model"), "credential_source": call.get("credential_source", "platform"),
                "served_model": call.get("served_model"),
                "upstream_provider": call.get("upstream_provider"),
                "model_family": call.get("model_family"),
                "routing_strategy": call.get("routing_strategy"),
                "fallback_attempts": call.get("fallback_attempts", 0),
                "generation_id": call.get("generation_id"),
                "cost_source": call.get("cost_source", "rate_estimate"),
                "status": call.get("status", "failed"),
                "input_summary": {"evidenceIds": call.get("evidence_ids", []), "promptVersion": "agent-v2",
                    "marketId": synthesis.market,
                    "teamId": team_id, "teamVersionId": team_version_id,
                    "deploymentId": deployment_id},
                "output_summary": output,
                "decision_summary": call.get("decision_summary") or _report_summary(report),
                "input_tokens": call.get("input_tokens", 0),
                "cached_input_tokens": call.get("cached_input_tokens", 0),
                "output_tokens": call.get("output_tokens", 0),
                "provider_cost_microusd": call.get("provider_cost_microusd", 0),
                "platform_credits": call.get("platform_credits", 0) if call.get("status") == "completed" else 0,
                "latency_ms": call.get("latency_ms", 0), "error": call.get("error"),
                "created_at": synthesis.created_at, "completed_at": synthesis.created_at,
            })
            if kind == "model_call": specialist_ids.append(event_id)

    async def append(self, event: dict) -> None:
        observed_at = event.get("created_at") or datetime.now(timezone.utc)
        scope = LifecycleScope(kind="account", key=f"account:{event['account_id']}",
            strategy_account_id=event["account_id"]) if event.get("account_id") else LifecycleScope(
            kind="public", key="public")
        raw = json.dumps(event, sort_keys=True, separators=(",", ":"), default=str)
        lifecycle = EvidenceLifecycleRepository(self.engine)
        decision, transformed, receipts, schedule = evaluate_persistence(
            producer="trace_event", purpose="monitoring", sink="timescale.agent_trace",
            scope=scope, payload={"event_id": event["event_id"], "content": raw},
            artifact_id=event["analysis_id"], idempotency_key=f"trace:{event['event_id']}:timescale",
            observed_at=observed_at)
        await lifecycle.save_decision_bundle(decision, receipts, schedule)
        if decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError(f"Evidence lifecycle blocks trace: {decision.reasons[0]}")
        if schedule is None:
            raise RuntimeError("Evidence lifecycle trace schedule is unavailable")
        values = _event_values(json.loads(transformed["content"]))
        values["lifecycle_decision_hash"] = decision.decision_hash
        values["lifecycle_admitted_body"] = str(transformed["content"])
        values["scope_key"] = scope.key
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, scope.key, [event["analysis_id"]])
            # lifecycle-sink:trace-timescale
            inserted = await conn.execute(text("""
                INSERT INTO agent_trace_events
                  (scope_key, event_id, analysis_id, account_id, parent_event_id, event_type, role, provider,
                   model, credential_source, served_model, upstream_provider, model_family,
                   routing_strategy, fallback_attempts, generation_id, cost_source,
                   status, input_summary, output_summary, decision_summary,
                   input_tokens, cached_input_tokens, output_tokens, provider_cost_microusd,
                   platform_credits, latency_ms, retry_number, error, created_at, completed_at,
                   team_id, team_version_id, deployment_id,
                   lifecycle_decision_hash, lifecycle_admitted_body)
                VALUES (:scope_key, :event_id, :analysis_id, :account_id, :parent_event_id, :event_type, :role,
                  :provider, :model, :credential_source, :served_model, :upstream_provider,
                  :model_family, :routing_strategy, :fallback_attempts, :generation_id, :cost_source,
                  :status, CAST(:input_summary AS jsonb),
                  CAST(:output_summary AS jsonb), :decision_summary, :input_tokens,
                  :cached_input_tokens, :output_tokens, :provider_cost_microusd, :platform_credits,
                  :latency_ms, :retry_number, :error, :created_at, :completed_at,
                  :team_id, :team_version_id, :deployment_id,
                  :lifecycle_decision_hash, :lifecycle_admitted_body)
                ON CONFLICT (scope_key, event_id, created_at) DO NOTHING
            """), values)
            if inserted.rowcount == 1 and event.get("account_id") and event.get("provider"):
                await conn.execute(text("""
                    INSERT INTO agent_usage_daily
                      (day, account_id, provider, model, credential_source, calls, successful_calls,
                       input_tokens, cached_input_tokens, output_tokens, provider_cost_microusd,
                       platform_credits, latency_ms)
                    VALUES (CURRENT_DATE, :account_id, :provider, :model, :credential_source, 1,
                      :successful, :input_tokens, :cached_input_tokens, :output_tokens,
                      :provider_cost_microusd, :platform_credits, :latency_ms)
                    ON CONFLICT (day, account_id, provider, model, credential_source) DO UPDATE SET
                      calls = agent_usage_daily.calls + 1,
                      successful_calls = agent_usage_daily.successful_calls + EXCLUDED.successful_calls,
                      input_tokens = agent_usage_daily.input_tokens + EXCLUDED.input_tokens,
                      cached_input_tokens = agent_usage_daily.cached_input_tokens + EXCLUDED.cached_input_tokens,
                      output_tokens = agent_usage_daily.output_tokens + EXCLUDED.output_tokens,
                      provider_cost_microusd = agent_usage_daily.provider_cost_microusd + EXCLUDED.provider_cost_microusd,
                      platform_credits = agent_usage_daily.platform_credits + EXCLUDED.platform_credits,
                      latency_ms = agent_usage_daily.latency_ms + EXCLUDED.latency_ms
                """), {**values, "successful": 1 if event.get("status") == "completed" else 0})
                if values["team_id"] and values["team_version_id"]:
                    await conn.execute(text("""
                        INSERT INTO agent_usage_daily_team
                          (day, account_id, team_id, team_version_id, deployment_id, market_id,
                           provider, model, credential_source, calls, successful_calls,
                           input_tokens, cached_input_tokens, output_tokens,
                           provider_cost_microusd, platform_credits, latency_ms)
                        VALUES (CURRENT_DATE, :account_id, :team_id, :team_version_id,
                          COALESCE(:deployment_id, ''), :market_id, :provider, :model,
                          :credential_source, 1, :successful, :input_tokens,
                          :cached_input_tokens, :output_tokens, :provider_cost_microusd,
                          :platform_credits, :latency_ms)
                        ON CONFLICT (day, account_id, team_id, team_version_id,
                          deployment_id, market_id, provider, model, credential_source) DO UPDATE SET
                          calls = agent_usage_daily_team.calls + 1,
                          successful_calls = agent_usage_daily_team.successful_calls + EXCLUDED.successful_calls,
                          input_tokens = agent_usage_daily_team.input_tokens + EXCLUDED.input_tokens,
                          cached_input_tokens = agent_usage_daily_team.cached_input_tokens + EXCLUDED.cached_input_tokens,
                          output_tokens = agent_usage_daily_team.output_tokens + EXCLUDED.output_tokens,
                          provider_cost_microusd = agent_usage_daily_team.provider_cost_microusd + EXCLUDED.provider_cost_microusd,
                          platform_credits = agent_usage_daily_team.platform_credits + EXCLUDED.platform_credits,
                          latency_ms = agent_usage_daily_team.latency_ms + EXCLUDED.latency_ms
                    """), {**values, "successful": 1 if event.get("status") == "completed" else 0})
        if self.redis and event.get("account_id"):
            redis_decision, redis_payload, redis_receipts, redis_schedule = evaluate_persistence(
                producer="trace_event", purpose="monitoring", sink="redis.trace_notification",
                scope=scope, payload={"event_id": event["event_id"], "content": raw},
                artifact_id=event["analysis_id"], idempotency_key=f"trace:{event['event_id']}:redis",
                observed_at=observed_at)
            await lifecycle.save_decision_bundle(redis_decision, redis_receipts, redis_schedule)
            if redis_decision.outcome not in {"allow", "transformed"}:
                raise RuntimeError("Evidence lifecycle blocks trace notification")
            # lifecycle-sink:trace-redis
            admitted_event = json.loads(str(redis_payload["content"]))
            notification = {
                "schema_version": 1, "account_id": event["account_id"],
                "analysis_id": admitted_event["analysis_id"],
                "event_id": admitted_event["event_id"],
                "created_at": admitted_event["created_at"],
                "lifecycle_decision_hash": decision.decision_hash,
            }
            await self.redis.publish(f"agent-trace:{event['account_id']}",
                json.dumps(notification, sort_keys=True, separators=(",", ":"), default=str))

    async def list_runs(self, account_id: str, filters: dict,
            viewer_subject: str = "internal_worker") -> list[dict]:
        days = max(1, min(7, int(filters.get("days", 7))))
        observed_at = datetime.now(timezone.utc)
        scope_key = f"account:{account_id}"
        async with self.engine.begin() as conn:
            candidates = await conn.execute(text("""
                SELECT analysis_id FROM analysis_runs
                WHERE scope_key=:scope AND account_id=:account
                  AND (:team_id='' OR (:team_id='legacy' AND team_id IS NULL)
                       OR team_id=:team_id)
                  AND (:team_version_id='' OR team_version_id=:team_version_id)
                  AND (:deployment_id='' OR deployment_id=:deployment_id)
                  AND created_at>=:since AND (:market='' OR market=:market)
                ORDER BY created_at DESC LIMIT :limit
            """), {"scope": scope_key, "account": account_id,
                "since": observed_at - timedelta(days=days),
                "market": str(filters.get("market", "")).upper(),
                "team_id": str(filters.get("team_id", "")),
                "team_version_id": str(filters.get("team_version_id", "")),
                "deployment_id": str(filters.get("deployment_id", "")),
                "limit": max(1, min(200, int(filters.get("limit", 50))))})
            artifact_ids = [str(row.analysis_id) for row in candidates]
            if not artifact_ids:
                return []
            await lock_lifecycle_artifacts(conn, scope_key, artifact_ids)
            rows = await conn.execute(text("""
                SELECT analysis_id, market, tier, consensus, confidence, disagreement,
                       synthesis, billing_route, team_id, team_version_id,
                       deployment_id, created_at, valid_until
                FROM analysis_runs WHERE scope_key=:scope AND account_id=:account
                  AND analysis_id=ANY(CAST(:artifacts AS text[]))
                  AND lifecycle_decision_hash IS NOT NULL
                  AND lifecycle_deleted_at IS NULL AND body_expires_at > :observed
                ORDER BY created_at DESC LIMIT :limit
            """), {
                "scope": scope_key, "account": account_id, "artifacts": artifact_ids,
                "observed": observed_at,
                "limit": max(1, min(200, int(filters.get("limit", 50)))),
            })
            output = [dict(row._mapping) for row in rows]
            if len(output) != len(artifact_ids):
                raise RuntimeError("Monitoring collection changed during disclosure")
            lifecycle = EvidenceLifecycleRepository(self.engine)
            for artifact_id in sorted(set(artifact_ids)):
                await lifecycle._assert_single_artifact(
                    conn, artifact_id, scope_key, observed_at)
            return output

    async def get_trace(self, account_id: str, analysis_id: str,
            viewer_subject: str = "internal_worker") -> dict | None:
        observed_at = datetime.now(timezone.utc)
        scope_key = f"account:{account_id}"
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, scope_key, [analysis_id])
            await EvidenceLifecycleRepository(self.engine)._assert_single_artifact(
                conn, analysis_id, scope_key, observed_at)
            runs = list((await conn.execute(text("""
                SELECT analysis_id, market, tier, synthesis, billing_route,
                       team_id, team_version_id, deployment_id, created_at
                FROM analysis_runs WHERE scope_key=:scope AND account_id=:account
                  AND analysis_id = :analysis
                  AND lifecycle_decision_hash IS NOT NULL
                  AND lifecycle_deleted_at IS NULL AND body_expires_at > :observed
                ORDER BY created_at DESC LIMIT 2 FOR UPDATE OF analysis_runs
            """), {"scope": scope_key, "account": account_id,
                "analysis": analysis_id,
                "observed": observed_at})).all())
            if len(runs) != 1:
                raise RuntimeError("Run trace identity is ambiguous or unavailable")
            events, bindings = await load_disclosable_trace_events(
                conn, analysis_id, scope_key, observed_at, acquire_lock=False)
            return {"run": dict(runs[0]._mapping), "events": events,
                "_lifecycle_bindings": bindings}

    async def usage_summary(self, account_id: str, days: int = 7,
            viewer_subject: str = "internal_worker") -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT day, provider, model, credential_source, calls, successful_calls,
                       input_tokens, cached_input_tokens, output_tokens, provider_cost_microusd,
                       platform_credits, latency_ms
                FROM agent_usage_daily WHERE account_id = :account
                  AND day >= CAST(:since AS date)
                ORDER BY day DESC, provider, model
            """), {"account": account_id,
                   "since": (datetime.now(timezone.utc).date()
                             - timedelta(days=max(0, min(6, days - 1))))})
            return [dict(row._mapping) for row in rows]

    async def team_usage_summary(self, account_id: str, days: int = 7,
            team_id: str = "", team_version_id: str = "",
            deployment_id: str = "", market_id: str = "") -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT day, team_id, team_version_id, deployment_id, market_id,
                       provider, model,
                       credential_source, calls, successful_calls, input_tokens,
                       cached_input_tokens, output_tokens, provider_cost_microusd,
                       platform_credits, latency_ms
                FROM agent_usage_daily_team WHERE account_id=:account
                  AND day >= CAST(:since AS date)
                  AND (:team_id='' OR team_id=:team_id)
                  AND (:team_version_id='' OR team_version_id=:team_version_id)
                  AND (:deployment_id='' OR deployment_id=:deployment_id)
                  AND (:market_id='' OR market_id=:market_id)
                ORDER BY day DESC, team_id, provider, model
            """), {"account": account_id, "team_id": team_id,
                "team_version_id": team_version_id,
                "deployment_id": deployment_id, "market_id": market_id,
                "since": datetime.now(timezone.utc).date()
                  - timedelta(days=max(0, min(6, days - 1)))})
            return [dict(row._mapping) for row in rows]


def _event_values(event: dict) -> dict:
    input_summary = event.get("input_summary") or {}
    defaults = {
        "parent_event_id": None, "role": None, "provider": None, "model": None,
        "credential_source": None, "input_summary": {}, "output_summary": {},
        "served_model": None, "upstream_provider": None, "model_family": None,
        "routing_strategy": None, "fallback_attempts": 0, "generation_id": None,
        "cost_source": "rate_estimate",
        "decision_summary": None, "input_tokens": 0, "cached_input_tokens": 0,
        "output_tokens": 0, "provider_cost_microusd": 0, "platform_credits": 0,
        "latency_ms": 0, "retry_number": 0, "error": None,
        "created_at": datetime.now(timezone.utc), "completed_at": None,
        "team_id": input_summary.get("teamId"),
        "team_version_id": input_summary.get("teamVersionId"),
        "deployment_id": input_summary.get("deploymentId"),
        "market_id": input_summary.get("marketId", ""),
    }
    values = {**defaults, **event}
    for field in ("created_at", "completed_at"):
        value = values[field]
        if value is None or isinstance(value, datetime):
            continue
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise RuntimeError("Trace admitted timestamp is malformed") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise RuntimeError("Trace admitted timestamp must be timezone-aware")
        values[field] = parsed
    values["input_summary"] = json.dumps(sanitize(values["input_summary"]), default=str)
    values["output_summary"] = json.dumps(sanitize(values["output_summary"]), default=str)
    values["error"] = sanitize(values["error"]) if values["error"] else None
    return values


def _report_summary(report) -> str:
    if not report:
        return "Model call did not produce a validated report."
    return report.decision_summary or f"{report.role.replace('_', ' ').title()} was {report.stance.replace('_', ' ')} at {report.confidence:.0%} confidence."


def _synthesis_summary(synthesis) -> str:
    direction = "bullish" if synthesis.consensus > 0.15 else "bearish" if synthesis.consensus < -0.15 else "mixed"
    return f"The validated team synthesis was {direction} at {synthesis.confidence:.0%} confidence."
