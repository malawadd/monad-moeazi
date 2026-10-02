import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .contracts import EvidenceRef, MarketSynthesis, SignalReport
from .evidence_lifecycle_contracts import PersistenceDecision, RetentionSchedule
from .evidence_lifecycle_locking import lock_lifecycle_artifacts


class AnalysisRepository:
    def __init__(self, dsn: str):
        self.engine: AsyncEngine = create_async_engine(dsn, pool_pre_ping=True)

    async def save_evidence(self, item) -> None:
        raise RuntimeError(
            "Raw evidence persistence is disabled; use persist_ingested_evidence."
        )

    async def recent_evidence(self, market: str, limit: int = 100) -> list[tuple[EvidenceRef, str]]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT evidence_id, source, reference, observed_at, event_at, quality_score,
                       content_hash, sanitized_content FROM evidence
                WHERE provenance->>'market' = :market
                  AND observed_at > now() - interval '30 minutes'
                  AND lifecycle_state = 'governed'
                  AND sanitized_content IS NOT NULL
                  AND (body_expires_at IS NULL OR body_expires_at > now())
                ORDER BY observed_at DESC LIMIT :limit
            """), {"market": market, "limit": max(1, min(500, limit))})
            return [(
                EvidenceRef(
                    id=row.evidence_id, source=row.source, uri=row.reference,
                    observed_at=row.observed_at, event_at=row.event_at,
                    quality_score=row.quality_score, content_hash=row.content_hash,
                ),
                row.sanitized_content,
            ) for row in rows]

    async def save_run(
        self,
        synthesis: MarketSynthesis,
        reports: list[SignalReport],
        provider_calls: list[dict[str, Any]],
        scope: str,
        account_id: str | None,
        model_configuration_version: int | None = None,
        lifecycle_decision: PersistenceDecision | None = None,
        lifecycle_schedule: RetentionSchedule | None = None,
        admitted_archive: dict[str, Any] | None = None,
        team_id: str | None = None,
        team_version_id: str | None = None,
        deployment_id: str | None = None,
    ) -> None:
        synthesis_body = (admitted_archive or {}).get(
            "synthesis", synthesis.model_dump(mode="json"))
        report_bodies = (admitted_archive or {}).get(
            "reports", [item.model_dump(mode="json") for item in reports])
        provider_calls = (admitted_archive or {}).get("calls", provider_calls)
        scope_key = f"account:{account_id}" if account_id else "public"
        if not lifecycle_decision or not lifecycle_schedule:
            raise RuntimeError("Analysis lifecycle authority is required")
        self._validate_lifecycle_authority(
            synthesis.analysis_id, scope_key, lifecycle_decision, lifecycle_schedule)
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, scope_key, [synthesis.analysis_id])
            await self._verify_persisted_lifecycle_authority(
                conn, synthesis.analysis_id, scope_key,
                lifecycle_decision, lifecycle_schedule)
            await conn.execute(text("""
                INSERT INTO analysis_runs
                  (scope_key, analysis_id, market, tier, scope, account_id, consensus, confidence,
                   disagreement, freshness_ms, synthesis, created_at, valid_until,
                   model_configuration_version, billing_route, team_id, team_version_id,
                   deployment_id, lifecycle_decision_hash,
                   body_expires_at)
                VALUES (:scope_key, :id, :market, :tier, :scope, :account, :consensus, :confidence,
                        :disagreement, :freshness, CAST(:synthesis AS jsonb), :created, :valid,
                        :config_version, CAST(:billing_route AS jsonb), :team_id,
                        :team_version_id, :deployment_id, :lifecycle, :body_expires)
                ON CONFLICT (scope_key, analysis_id, created_at) DO NOTHING
            """), {
                "scope_key": scope_key, "id": synthesis.analysis_id,
                "market": synthesis.market, "tier": synthesis.tier,
                "scope": scope, "account": account_id, "consensus": synthesis.consensus,
                "confidence": synthesis.confidence, "disagreement": synthesis.disagreement,
                "freshness": synthesis.freshness_ms,
                "synthesis": json.dumps(synthesis_body, sort_keys=True, default=str),
                "created": synthesis.created_at, "valid": synthesis.valid_until,
                "config_version": model_configuration_version,
                "team_id": team_id, "team_version_id": team_version_id,
                "deployment_id": deployment_id,
                "lifecycle": lifecycle_decision.decision_hash,
                "body_expires": lifecycle_schedule.body_expires_at,
                "billing_route": json.dumps({
                    "credentialSources": sorted(set(item.get("credential_source", "platform") for item in provider_calls)),
                    "platformCredits": sum(int(item.get("platform_credits", 0)) for item in provider_calls if item.get("status") == "completed"),
                    "providerCostMicrousd": sum(int(item.get("provider_cost_microusd", 0)) for item in provider_calls),
                }),
            })
            for report, report_body in zip(reports, report_bodies, strict=True):
                await conn.execute(text("""
                    INSERT INTO signal_reports
                      (analysis_id, account_id, role, provider, model, score, confidence, report, expires_at,
                       lifecycle_decision_hash)
                    VALUES (:analysis, :account, :role, :provider, :model, :score, :confidence,
                            CAST(:report AS jsonb), :expires, :lifecycle)
                """), {
                    "analysis": synthesis.analysis_id, "role": report.role, "provider": report.provider,
                    "account": account_id,
                    "model": report.model, "score": report.score, "confidence": report.confidence,
                    "report": json.dumps(report_body, sort_keys=True, default=str),
                    "expires": report.expires_at,
                    "lifecycle": lifecycle_decision.decision_hash,
                })
            for call in provider_calls:
                await conn.execute(text("""
                    INSERT INTO provider_calls
                      (analysis_id, account_id, role, provider, model, status, latency_ms, error, metadata,
                       credential_source, input_tokens, cached_input_tokens, output_tokens,
                       provider_cost_microusd, platform_credits, team_id,
                       team_version_id, deployment_id, lifecycle_decision_hash)
                    VALUES (:analysis, :account, :role, :provider, :model, :status, :latency, :error,
                            CAST(:metadata AS jsonb), :source, :input, :cached, :output, :cost,
                            :credits, :team_id, :team_version_id, :deployment_id,
                            :lifecycle)
                """), {
                    "analysis": synthesis.analysis_id, "role": call["role"], "provider": call["provider"],
                    "account": account_id,
                    "model": call.get("model", "unknown"), "status": call["status"],
                    "latency": call.get("latency_ms", 0), "error": call.get("error"),
                    "metadata": json.dumps(call.get("metadata", {})),
                    "source": call.get("credential_source", "platform"),
                    "input": call.get("input_tokens", 0), "cached": call.get("cached_input_tokens", 0),
                    "output": call.get("output_tokens", 0), "cost": call.get("provider_cost_microusd", 0),
                    "credits": call.get("platform_credits", 0),
                    "team_id": team_id, "team_version_id": team_version_id,
                    "deployment_id": deployment_id,
                    "lifecycle": lifecycle_decision.decision_hash,
                })

    @staticmethod
    def _validate_lifecycle_authority(artifact_id: str, scope_key: str,
            decision: PersistenceDecision, schedule: RetentionSchedule) -> None:
        if decision.outcome not in {"allow", "transformed"} \
                or decision.scope.key != scope_key \
                or decision.retention_schedule_hash != schedule.schedule_hash \
                or decision.policy_hash != schedule.policy_hash \
                or schedule.scope_key != scope_key \
                or schedule.artifact_id != artifact_id:
            raise RuntimeError("Analysis lifecycle authority binding is invalid")

    async def _verify_persisted_lifecycle_authority(self, conn, artifact_id: str,
            scope_key: str, decision: PersistenceDecision,
            schedule: RetentionSchedule) -> None:
        result = await conn.execute(text("""
            SELECT d.payload AS decision_payload,d.decision_hash,d.scope_key AS decision_scope,
                   d.policy_hash AS decision_policy,d.outcome,
                   s.payload AS schedule_payload,s.schedule_hash,s.artifact_id,
                   s.scope_key AS schedule_scope,s.policy_hash AS schedule_policy,
                   s.body_expires_at
            FROM evidence_lifecycle_decisions d JOIN evidence_retention_schedules s
              ON s.schedule_hash=d.payload->>'retention_schedule_hash'
            WHERE d.decision_hash=:decision AND d.scope_key=:scope
              AND s.schedule_hash=:schedule AND s.scope_key=:scope
              AND s.artifact_id=:artifact
            LIMIT 2 FOR UPDATE OF d,s
        """), {"decision": decision.decision_hash, "schedule": schedule.schedule_hash,
            "scope": scope_key, "artifact": artifact_id})
        rows = list(result.all())
        if len(rows) != 1:
            raise RuntimeError("Analysis lifecycle authority is ambiguous or unavailable")
        row = rows[0]
        persisted_decision = PersistenceDecision.model_validate(row.decision_payload)
        persisted_schedule = RetentionSchedule.model_validate(row.schedule_payload)
        if persisted_decision != decision or persisted_schedule != schedule \
                or row.decision_hash != decision.decision_hash \
                or row.decision_scope != scope_key \
                or row.decision_policy != decision.policy_hash \
                or row.outcome != decision.outcome \
                or row.schedule_hash != schedule.schedule_hash \
                or row.artifact_id != artifact_id or row.schedule_scope != scope_key \
                or row.schedule_policy != schedule.policy_hash \
                or row.body_expires_at != schedule.body_expires_at:
            raise RuntimeError("Persisted analysis lifecycle authority is invalid")
