import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .evaluation_contracts import EvaluationScorecard, ExperimentSpec
from .dependency_safety_contracts import canonical_payload_digest
from .evidence_lifecycle_identity import evaluation_owner_scope_key
from .evaluation_lifecycle_disclosure import admitted_archive_body, validate_archive_row


class EvaluationRepository:
    def __init__(self, dsn_or_engine: str | AsyncEngine):
        self.engine = (
            create_async_engine(dsn_or_engine, pool_pre_ping=True)
            if isinstance(dsn_or_engine, str) else dsn_or_engine
        )

    async def create_experiment(
        self, experiment_id: str, owner: str, spec: ExperimentSpec,
        markets: list[dict], projected_cost: int,
    ) -> dict:
        async with self.engine.begin() as conn:
            row = await conn.execute(text("""
                INSERT INTO evaluation_experiments
                  (experiment_id, owner_subject, name, status, mode, spec,
                   market_universe, projected_cost_microusd)
                VALUES (:id, :owner, :name, 'running', :mode, CAST(:spec AS jsonb),
                        CAST(:markets AS jsonb), :projected)
                RETURNING *
            """), {
                "id": experiment_id, "owner": owner, "name": spec.name, "mode": spec.mode,
                "spec": spec.model_dump_json(by_alias=True),
                "markets": json.dumps(markets, default=str), "projected": projected_cost,
            })
            return dict(row.first()._mapping)

    async def list_experiments(self, owner: str, limit: int = 50) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT experiment_id, name, status, mode, schema_version, work_plan,
                       expected_cost_microusd, market_universe,
                       projected_cost_microusd, actual_cost_microusd,
                       failure_reason, created_at, started_at, completed_at
                FROM evaluation_experiments WHERE owner_subject = :owner
                ORDER BY created_at DESC LIMIT :limit
            """), {"owner": owner, "limit": max(1, min(100, limit))})
            return [dict(row._mapping) for row in rows]

    async def get_experiment(self, owner: str, experiment_id: str,
            observed_at: datetime | None = None) -> dict | None:
        visible_at = observed_at or datetime.now(timezone.utc)
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT * FROM evaluation_experiments
                WHERE owner_subject = :owner AND experiment_id = :id
            """), {"owner": owner, "id": experiment_id})).first()
            if not row:
                return None
            scope_key = (f"account:{row.customer_account_id}" if row.customer_account_id
                         else evaluation_owner_scope_key(owner))
            runs = await conn.execute(text("""
                SELECT r.run_id, r.experiment_id, r.case_id, r.subject_id, r.analysis_id,
                       r.status, r.prompt_bundle, r.output, r.validation,
                       r.strategy_results, r.input_tokens, r.output_tokens,
                       r.provider_cost_microusd, r.latency_ms, r.error, r.created_at
                       ,r.lifecycle_decision_hash,r.lifecycle_deleted_at,
                       r.lifecycle_admitted_body,d.payload AS _lifecycle_decision,
                       s.payload AS _lifecycle_schedule
                FROM evaluation_runs r
                LEFT JOIN evidence_lifecycle_decisions d
                  ON d.decision_hash=r.lifecycle_decision_hash
                 AND d.scope_key=:scope
                LEFT JOIN evidence_retention_schedules s
                  ON s.schedule_hash=d.payload->>'retention_schedule_hash'
                 AND s.scope_key=:scope
                WHERE r.experiment_id = :id
                ORDER BY r.created_at DESC LIMIT 200
            """), {"id": experiment_id, "scope": scope_key})
            cases = await conn.execute(text("""
                SELECT case_id, market, case_kind, repetition,
                       CASE WHEN lifecycle_deleted_at IS NULL AND body_expires_at>:visible_at
                         THEN market_snapshot ELSE '{}'::jsonb END
                         AS market_snapshot,
                       CASE WHEN lifecycle_deleted_at IS NULL AND body_expires_at>:visible_at
                         THEN evidence_snapshot ELSE '[]'::jsonb END
                         AS evidence_snapshot,
                       snapshot_hash, observed_at, status, lifecycle_decision_hash,
                       body_expires_at, lifecycle_deleted_at
                FROM evaluation_cases WHERE scope_key = :scope AND experiment_id = :id
                ORDER BY observed_at DESC LIMIT 200
            """), {"scope": scope_key, "id": experiment_id,
                "visible_at": visible_at})
            scorecards = await conn.execute(text("""
                SELECT subject_id, scorecard, updated_at FROM evaluation_scorecards
                WHERE experiment_id = :id ORDER BY subject_id
            """), {"id": experiment_id})
            annotations = await conn.execute(text("""
                SELECT annotation_id, run_id, body, label, created_at
                FROM evaluation_annotations WHERE experiment_id = :id
                ORDER BY created_at DESC LIMIT 200
            """), {"id": experiment_id})
            result = dict(row._mapping)
            result["runs"] = [verified for item in runs
                if (verified := validate_archive_row(dict(item._mapping), owner, visible_at, scope_key))]
            result["cases"] = [dict(item._mapping) for item in cases]
            result["scorecards"] = [dict(item._mapping) for item in scorecards]
            result["annotations"] = [dict(item._mapping) for item in annotations]
            return result

    async def get_for_worker(self, experiment_id: str) -> dict | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT * FROM evaluation_experiments WHERE experiment_id = :id
            """), {"id": experiment_id})).first()
            return dict(row._mapping) if row else None

    async def set_status(
        self, experiment_id: str, status: str, failure_reason: str | None = None,
    ) -> None:
        completed = datetime.now(timezone.utc) if status in {"completed", "canceled", "failed"} else None
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                UPDATE evaluation_experiments SET status = :status, failure_reason = :reason,
                  started_at = COALESCE(started_at, CASE WHEN :status = 'running' THEN now() END),
                  completed_at = COALESCE(:completed, completed_at), updated_at = now()
                WHERE experiment_id = :id
            """), {
                "id": experiment_id, "status": status, "reason": failure_reason,
                "completed": completed,
            })

    async def save_case(self, case: dict, lifecycle_decision_hash: str | None = None) -> None:
        if not lifecycle_decision_hash:
            raise RuntimeError("Raw Evaluation case persistence is prohibited")
        payload_hash = canonical_payload_digest(case)
        case_observed_at = datetime.fromisoformat(
            str(case["observed_at"]).replace("Z", "+00:00"))
        async with self.engine.begin() as conn:
            decision = (await conn.execute(text("""
                SELECT d.producer,d.purpose,d.sink,d.scope_kind,d.scope_key,d.outcome,
                       d.expires_at,d.admitted_payload_hash,s.body_expires_at,
                       e.owner_subject
                FROM evidence_lifecycle_decisions d
                LEFT JOIN evidence_retention_schedules s
                  ON s.schedule_hash=d.payload->>'retention_schedule_hash'
                 AND s.scope_key=d.scope_key
                JOIN evaluation_experiments e ON e.experiment_id=:experiment
                WHERE d.decision_hash=:hash
            """), {"hash": lifecycle_decision_hash,
                "experiment": case["experiment_id"]})).first()
            if not decision:
                raise RuntimeError("Evaluation case lifecycle binding is invalid")
            scope_key = evaluation_owner_scope_key(decision.owner_subject)
            await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:case_lock))"),
                {"case_lock": f"evaluation-case:{scope_key}:{case['case_id']}"})
            if not decision or decision.producer != "evaluation_case" \
                    or decision.purpose != "evaluation" or decision.sink != "timescale.evaluation_case" \
                    or decision.scope_kind != "tenant" \
                    or decision.scope_key != scope_key \
                    or decision.outcome not in {"allow", "transformed"} \
                    or decision.expires_at <= case_observed_at \
                    or not decision.body_expires_at \
                    or decision.admitted_payload_hash != payload_hash:
                raise RuntimeError("Evaluation case lifecycle binding is invalid")
            replay = (await conn.execute(text("""
                SELECT request_hash,lifecycle_decision_hash FROM evaluation_case_idempotency
                WHERE scope_key=:scope AND case_id=:case_id FOR UPDATE
            """), {"scope": scope_key, "case_id": case["case_id"]})).first()
            if replay:
                if replay.request_hash != payload_hash \
                        or replay.lifecycle_decision_hash != lifecycle_decision_hash:
                    raise RuntimeError("Evaluation case idempotency conflict")
                return
            inserted = (await conn.execute(text("""
                INSERT INTO evaluation_case_idempotency
                  (scope_key,case_id,request_hash,lifecycle_decision_hash,body_expires_at)
                VALUES (:scope,:case_id,:request_hash,:decision,:expires)
                ON CONFLICT (scope_key,case_id) DO NOTHING RETURNING request_hash
            """), {"case_id": case["case_id"], "request_hash": payload_hash,
                "scope": scope_key,
                "decision": lifecycle_decision_hash,
                "expires": decision.body_expires_at})).first()
            if not inserted:
                replay = (await conn.execute(text("""
                    SELECT request_hash,lifecycle_decision_hash
                    FROM evaluation_case_idempotency
                    WHERE scope_key=:scope AND case_id=:case_id
                """), {"scope": scope_key, "case_id": case["case_id"]})).first()
                if not replay or replay.request_hash != payload_hash \
                        or replay.lifecycle_decision_hash != lifecycle_decision_hash:
                    raise RuntimeError("Evaluation case idempotency conflict")
                return
            await conn.execute(text("""
                INSERT INTO evaluation_cases
                  (scope_key, case_id, experiment_id, market, case_kind, repetition, market_snapshot,
                   evidence_snapshot, snapshot_hash, observed_at, status,
                   lifecycle_decision_hash, body_expires_at)
                VALUES (:scope_key, :case_id, :experiment_id, :market, :case_kind, :repetition,
                  CAST(:market_snapshot AS jsonb), CAST(:evidence_snapshot AS jsonb),
                  :snapshot_hash, :observed_at, :status, :lifecycle_decision_hash,
                  :body_expires_at)
            """), _json_fields({**case, "observed_at": case_observed_at,
                "scope_key": scope_key,
                "lifecycle_decision_hash": lifecycle_decision_hash,
                "body_expires_at": decision.body_expires_at},
                {"market_snapshot", "evidence_snapshot"}))

    async def save_run(self, run: dict) -> None:
        lifecycle_hash = str(run.get("lifecycle_decision_hash", ""))
        if len(lifecycle_hash) != 64:
            raise RuntimeError("Raw Evaluation run persistence is prohibited")
        admitted_body = admitted_archive_body(run)
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO evaluation_runs
                  (run_id, experiment_id, case_id, subject_id, analysis_id, status,
                   prompt_bundle, output, validation, strategy_results, input_tokens,
                   output_tokens, provider_cost_microusd, latency_ms, error,
                   lifecycle_decision_hash, lifecycle_admitted_body, completed_at)
                VALUES (:run_id, :experiment_id, :case_id, :subject_id, :analysis_id, :status,
                  CAST(:prompt_bundle AS jsonb), CAST(:output AS jsonb),
                  CAST(:validation AS jsonb), CAST(:strategy_results AS jsonb),
                  :input_tokens, :output_tokens, :provider_cost_microusd, :latency_ms,
                  :error, :lifecycle_decision_hash,CAST(:lifecycle_admitted_body AS jsonb), now())
                ON CONFLICT (run_id, created_at) DO NOTHING
            """), _json_fields({**run, "lifecycle_admitted_body": admitted_body}, {
                "prompt_bundle", "output", "validation", "strategy_results",
                "lifecycle_admitted_body",
            }))
            await conn.execute(text("""
                UPDATE evaluation_experiments SET
                  actual_cost_microusd = actual_cost_microusd + :cost, updated_at = now()
                WHERE experiment_id = :experiment_id
            """), {
                "experiment_id": run["experiment_id"],
                "cost": run.get("provider_cost_microusd", 0),
            })

    async def replace_scorecard(self, scorecard: EvaluationScorecard) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO evaluation_scorecards (experiment_id, subject_id, scorecard)
                VALUES (:experiment, :subject, CAST(:scorecard AS jsonb))
                ON CONFLICT (experiment_id, subject_id) DO UPDATE SET
                  scorecard = EXCLUDED.scorecard, updated_at = now()
            """), {
                "experiment": scorecard.experiment_id, "subject": scorecard.subject_id,
                "scorecard": scorecard.model_dump_json(),
            })

    async def get_scorecard(
        self, experiment_id: str, subject_id: str,
    ) -> EvaluationScorecard | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT scorecard FROM evaluation_scorecards
                WHERE experiment_id = :experiment AND subject_id = :subject
            """), {"experiment": experiment_id, "subject": subject_id})).first()
            return EvaluationScorecard.model_validate(row.scorecard) if row else None

    async def latest_subject_run(
        self, experiment_id: str, subject_id: str,
    ) -> dict | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT output FROM evaluation_runs
                WHERE experiment_id = :experiment AND subject_id = :subject
                  AND status = 'completed'
                ORDER BY created_at DESC LIMIT 1
            """), {"experiment": experiment_id, "subject": subject_id})).first()
            return dict(row._mapping) if row else None

    async def add_annotation(
        self, annotation_id: str, experiment_id: str, run_id: str | None,
        owner: str, body: str, label: str,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO evaluation_annotations
                  (annotation_id, experiment_id, run_id, owner_subject, body, label)
                VALUES (:id, :experiment, :run, :owner, :body, :label)
            """), {
                "id": annotation_id, "experiment": experiment_id, "run": run_id,
                "owner": owner, "body": body, "label": label,
            })


def _json_fields(values: dict[str, Any], names: set[str]) -> dict:
    return {
        key: json.dumps(value, default=str) if key in names else value
        for key, value in values.items()
    }
