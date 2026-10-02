import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .evaluation_v2_contracts import EvaluationAssetDraft, EvaluationExperimentV2


class EvaluationV2Repository:
    def __init__(self, dsn_or_engine: str | AsyncEngine):
        self.engine = (
            create_async_engine(dsn_or_engine, pool_pre_ping=True)
            if isinstance(dsn_or_engine, str) else dsn_or_engine
        )

    async def save_preview(
        self, owner: str, spec: EvaluationExperimentV2, preview: dict, items: list[dict],
        customer_team_id: str | None = None, customer_account_id: str | None = None,
    ) -> None:
        public = {key: value for key, value in preview.items() if not key.startswith("_")}
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO evaluation_previews
                  (preview_hash, owner_subject, spec, preview, plan_items, expires_at,
                   customer_team_id, customer_account_id)
                VALUES (:hash, :owner, CAST(:spec AS jsonb), CAST(:preview AS jsonb),
                        CAST(:items AS jsonb), :expires, :team, :account)
                ON CONFLICT (preview_hash) DO UPDATE SET
                  preview = EXCLUDED.preview, plan_items = EXCLUDED.plan_items,
                  expires_at = EXCLUDED.expires_at,
                  customer_team_id = EXCLUDED.customer_team_id,
                  customer_account_id = EXCLUDED.customer_account_id
            """), {
                "hash": preview["previewHash"], "owner": owner,
                "spec": spec.model_dump_json(by_alias=True),
                "preview": json.dumps(public, default=str),
                "items": json.dumps(items, default=str),
                "expires": datetime.now(timezone.utc) + timedelta(minutes=10),
                "team": customer_team_id, "account": customer_account_id,
            })

    async def preview(self, owner: str, digest: str) -> dict | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT spec, preview, plan_items, customer_team_id, customer_account_id
                FROM evaluation_previews
                WHERE preview_hash = :hash AND owner_subject = :owner
                  AND expires_at > now()
            """), {"hash": digest, "owner": owner})).first()
            return dict(row._mapping) if row else None

    async def create_experiment(
        self, experiment_id: str, owner: str, spec: EvaluationExperimentV2,
        preview: dict, items: list[dict],
        customer_team_id: str | None = None, customer_account_id: str | None = None,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO evaluation_experiments
                  (experiment_id, owner_subject, name, status, mode, spec,
                   market_universe, projected_cost_microusd, expected_cost_microusd,
                   schema_version, preview_hash, work_plan,
                   customer_team_id, customer_account_id)
                VALUES (:id, :owner, :name, 'running', :mode, CAST(:spec AS jsonb),
                  CAST(:markets AS jsonb), :maximum, :expected, 2, :hash,
                  CAST(:plan AS jsonb), :team, :account)
            """), {
                "id": experiment_id, "owner": owner, "name": spec.name, "mode": spec.mode,
                "spec": spec.model_dump_json(by_alias=True),
                "maximum": preview["maximumCostMicrousd"],
                "expected": preview["expectedCostMicrousd"],
                "markets": json.dumps(preview.get("marketUniverse", []), default=str),
                "hash": preview["previewHash"], "plan": json.dumps(preview, default=str),
                "team": customer_team_id, "account": customer_account_id,
            })
            for item in items:
                await conn.execute(text("""
                    INSERT INTO evaluation_plan_items
                      (plan_item_id, experiment_id, kind, case_id, market,
                       repetition, scheduled_at)
                    VALUES (:item, :experiment, :kind, :case, :market,
                            :repetition, :scheduled)
                """), {
                    "item": f"{experiment_id}:{item['planItemId']}",
                    "experiment": experiment_id, "kind": item["kind"],
                    "case": item.get("caseId"), "market": item.get("market", ""),
                    "repetition": item["repetition"],
                    "scheduled": datetime.fromisoformat(item["scheduledAt"])
                    if isinstance(item["scheduledAt"], str) else item["scheduledAt"],
                })

    async def customer_experiments(self, owner: str, team: str, limit: int = 50) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT experiment_id, name, status, mode, expected_cost_microusd,
                       projected_cost_microusd, actual_cost_microusd, created_at,
                       completed_at, preview_hash
                FROM evaluation_experiments
                WHERE owner_subject = :owner AND customer_team_id = :team
                ORDER BY created_at DESC LIMIT :limit
            """), {"owner": owner, "team": team, "limit": max(1, min(100, limit))})
            return [dict(row._mapping) for row in rows]

    async def customer_experiment(self, owner: str, team: str, experiment_id: str) -> dict | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT experiment_id, customer_account_id, status, preview_hash, work_plan
                FROM evaluation_experiments
                WHERE experiment_id = :id AND owner_subject = :owner
                  AND customer_team_id = :team
            """), {"id": experiment_id, "owner": owner, "team": team})).first()
            return dict(row._mapping) if row else None

    async def customer_identity(self, experiment_id: str) -> dict | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT customer_team_id, customer_account_id, work_plan
                FROM evaluation_experiments
                WHERE experiment_id = :id AND customer_team_id IS NOT NULL
            """), {"id": experiment_id})).first()
            return dict(row._mapping) if row else None

    async def validated_research_credits(self, experiment_id: str) -> int:
        from .evaluation_customer_cost import validated_customer_credits
        async with self.engine.connect() as conn:
            plan = (await conn.execute(text("""
                SELECT work_plan FROM evaluation_experiments WHERE experiment_id = :id
            """), {"id": experiment_id})).first()
            if not plan:
                return 0
            rows = await conn.execute(text("""
                SELECT subject_id, status, output FROM evaluation_runs
                WHERE experiment_id = :id AND status = 'completed'
            """), {"id": experiment_id})
            return validated_customer_credits(plan.work_plan,
                                              [dict(row._mapping) for row in rows])

    async def plan(self, experiment_id: str) -> tuple[dict, list[dict]] | None:
        async with self.engine.connect() as conn:
            experiment = (await conn.execute(text("""
                SELECT spec, work_plan, owner_subject FROM evaluation_experiments
                WHERE experiment_id = :id AND schema_version = 2
            """), {"id": experiment_id})).first()
            if not experiment:
                return None
            rows = await conn.execute(text("""
                SELECT plan_item_id, kind, case_id, market, repetition,
                       scheduled_at, status
                FROM evaluation_plan_items WHERE experiment_id = :id
                ORDER BY scheduled_at, plan_item_id
            """), {"id": experiment_id})
            return dict(experiment._mapping), [dict(row._mapping) for row in rows]

    async def set_plan_item(
        self, plan_item_id: str, status: str, error: str | None = None,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                UPDATE evaluation_plan_items SET status = :status, error = :error,
                  started_at = COALESCE(started_at,
                    CASE WHEN :status = 'running' THEN now() END),
                  completed_at = CASE WHEN :status IN ('completed','failed','canceled')
                    THEN now() ELSE completed_at END
                WHERE plan_item_id = :id
            """), {"id": plan_item_id, "status": status, "error": error})

    async def save_allocations(
        self, experiment_id: str, daily: dict[str, int],
    ) -> None:
        async with self.engine.begin() as conn:
            for day, amount in daily.items():
                await conn.execute(text("""
                    INSERT INTO evaluation_budget_allocations
                      (allocation_id, experiment_id, budget_day, reserved_microusd)
                    VALUES (:allocation, :experiment, :day, :amount)
                    ON CONFLICT (experiment_id, budget_day) DO NOTHING
                """), {
                    "allocation": str(uuid4()), "experiment": experiment_id,
                    "day": date.fromisoformat(day) if isinstance(day, str) else day,
                    "amount": amount,
                })

    async def actual_cost_by_day(self, experiment_id: str) -> dict[str, int]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT created_at::date::text AS day,
                       COALESCE(SUM(provider_cost_microusd), 0)::bigint AS cost
                FROM evaluation_runs WHERE experiment_id = :id
                GROUP BY created_at::date
            """), {"id": experiment_id})
            return {row.day: int(row.cost) for row in rows}

    async def settle_allocations(
        self, experiment_id: str, actual: dict[str, int], released: bool = False,
    ) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                UPDATE evaluation_budget_allocations
                SET settled_microusd = 0, released_microusd = reserved_microusd,
                    status = :status, updated_at = now()
                WHERE experiment_id = :id
            """), {
                "id": experiment_id,
                "status": "released" if released else "settled",
            })
            if not actual:
                return
            await conn.execute(text("""
                UPDATE evaluation_budget_allocations
                SET settled_microusd = :settled,
                    released_microusd = GREATEST(0, reserved_microusd - :settled),
                    status = :status, updated_at = now()
                WHERE experiment_id = :id AND budget_day = :day
            """), [
                {
                    "id": experiment_id,
                    "day": date.fromisoformat(day) if isinstance(day, str) else day,
                    "settled": amount,
                    "status": "released" if released else "settled",
                }
                for day, amount in actual.items()
            ])

    async def list_assets(self, owner: str, asset_type: str | None = None) -> list[dict]:
        query = """
            SELECT asset_id, asset_type, name, description, version, status,
                   payload, sha256, created_at, updated_at
            FROM evaluation_assets WHERE owner_subject = :owner
        """
        if asset_type:
            query += " AND asset_type = :type"
        query += " ORDER BY updated_at DESC LIMIT 200"
        async with self.engine.connect() as conn:
            rows = await conn.execute(text(query), {"owner": owner, "type": asset_type})
            return [dict(row._mapping) for row in rows]

    async def asset(self, asset_id: str, owner: str | None = None) -> dict | None:
        query = "SELECT * FROM evaluation_assets WHERE asset_id = :id"
        if owner:
            query += " AND owner_subject = :owner"
        async with self.engine.connect() as conn:
            row = (await conn.execute(
                text(query), {"id": asset_id, "owner": owner},
            )).first()
            return dict(row._mapping) if row else None

    async def create_asset(
        self, owner: str, asset_type: str, draft: EvaluationAssetDraft,
    ) -> dict:
        serialized = json.dumps(draft.payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(serialized.encode()).hexdigest()
        asset_id = str(uuid4())
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""
                INSERT INTO evaluation_assets
                  (asset_id, owner_subject, asset_type, name, description,
                   payload, sha256)
                VALUES (:id, :owner, :type, :name, :description,
                        CAST(:payload AS jsonb), :sha)
                RETURNING *
            """), {
                "id": asset_id, "owner": owner, "type": asset_type,
                "name": draft.name, "description": draft.description,
                "payload": serialized, "sha": digest,
            })).first()
            return dict(row._mapping)

    async def update_asset(
        self, owner: str, asset_id: str, draft: EvaluationAssetDraft,
    ) -> dict | None:
        serialized = json.dumps(draft.payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(serialized.encode()).hexdigest()
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""
                UPDATE evaluation_assets SET name = :name, description = :description,
                  payload = CAST(:payload AS jsonb), sha256 = :sha, updated_at = now()
                WHERE asset_id = :id AND owner_subject = :owner AND status = 'draft'
                RETURNING *
            """), {
                "id": asset_id, "owner": owner, "name": draft.name,
                "description": draft.description, "payload": serialized, "sha": digest,
            })).first()
            return dict(row._mapping) if row else None

    async def freeze_asset(self, owner: str, asset_id: str) -> dict | None:
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""
                UPDATE evaluation_assets SET status = 'frozen', updated_at = now()
                WHERE asset_id = :id AND owner_subject = :owner
                RETURNING *
            """), {"id": asset_id, "owner": owner})).first()
            return dict(row._mapping) if row else None
