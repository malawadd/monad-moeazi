import asyncio
from datetime import datetime, timedelta, timezone

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from redis.asyncio import Redis

    from moeazi_agent.config import get_settings
    from moeazi_agent.convex import ConvexWorkerClient
    from moeazi_agent.evaluation_cases_v2 import frozen_inputs
    from moeazi_agent.evaluation_contracts import ExperimentSpec
    from moeazi_agent.evaluation_engine import snapshot_hash
    from moeazi_agent.evaluation_pipeline_v2 import run_v2_observation
    from moeazi_agent.evaluation_reservations import (
        plan_is_reserved, release_complete_plan,
    )
    from moeazi_agent.evaluation_settlement import settle_evaluation_activity
    from moeazi_agent.evaluation_storage import EvaluationRepository
    from moeazi_agent.evaluation_lifecycle import EvaluationLifecycleGate
    from moeazi_agent.evaluation_v2_contracts import EvaluationExperimentV2
    from moeazi_agent.evaluation_v2_storage import EvaluationV2Repository
    from moeazi_agent.storage import AnalysisRepository


HORIZON_SECONDS = {"5m": 300, "1h": 3_600, "4h": 14_400, "24h": 86_400}


@activity.defn
async def prepare_v2_activity(experiment_id: str) -> dict:
    result = await EvaluationV2Repository(get_settings().postgres_dsn).plan(experiment_id)
    if not result:
        raise RuntimeError("Evaluation v2 experiment not found")
    experiment, items = result
    return {
        "experimentId": experiment_id, "spec": experiment["spec"],
        "workPlan": experiment["work_plan"], "items": items,
        "ownerSubject": experiment["owner_subject"],
    }


@activity.defn
async def run_v2_plan_item_activity(payload: dict) -> dict:
    settings = get_settings()
    v2_repository = EvaluationV2Repository(settings.postgres_dsn)
    analysis_repository = AnalysisRepository(settings.postgres_dsn)
    repository = EvaluationRepository(analysis_repository.engine)
    redis = Redis.from_url(settings.redis_url)
    item = payload["item"]
    experiment_id = payload["experimentId"]
    observed_at = datetime.fromisoformat(str(payload["observedAt"]).replace("Z", "+00:00"))
    try:
        if not await plan_is_reserved(redis, experiment_id):
            raise RuntimeError("Finish-safe evaluation reservation is missing")
        await v2_repository.set_plan_item(item["plan_item_id"], "running")
        spec = EvaluationExperimentV2.model_validate(payload["spec"])
        market, market_snapshot, evidence = await frozen_inputs(
            v2_repository, analysis_repository, redis, settings, spec, item,
        )
        frozen = [
            {"ref": ref.model_dump(mode="json"), "content": content}
            for ref, content in evidence
        ]
        digest = snapshot_hash(market_snapshot, frozen)
        case_id = item["plan_item_id"]
        case = {
            "case_id": case_id, "experiment_id": experiment_id, "market": market,
            "case_kind": item["kind"], "repetition": item["repetition"],
            "market_snapshot": market_snapshot, "evidence_snapshot": frozen,
            "snapshot_hash": digest,
            "observed_at": observed_at.isoformat(), "status": "running",
        }
        lifecycle = EvaluationLifecycleGate(analysis_repository.engine, experiment_id,
            market, observed_at=observed_at, operator_subject=payload["ownerSubject"])
        case_decision, admitted_case = await lifecycle.govern_case(case)
        await repository.save_case(admitted_case, case_decision.decision_hash)
        await run_v2_observation(
            analysis_repository, redis, settings, spec, experiment_id,
            case_id, market, market_snapshot, evidence, observed_at,
        )
        await v2_repository.set_plan_item(item["plan_item_id"], "completed")
        return {"planItemId": item["plan_item_id"], "snapshotHash": digest}
    except Exception as exc:
        await v2_repository.set_plan_item(
            item["plan_item_id"], "failed", str(exc)[:1_000],
        )
        raise
    finally:
        await redis.aclose()


@activity.defn
async def release_v2_budget_activity(payload: dict) -> None:
    settings = get_settings()
    repository = EvaluationV2Repository(settings.postgres_dsn)
    actual = await repository.actual_cost_by_day(payload["experimentId"])
    days = list(payload["dailyMaximums"])
    redis = Redis.from_url(settings.redis_url)
    try:
        await release_complete_plan(
            redis, payload["experimentId"], days, actual,
        )
        await repository.settle_allocations(payload["experimentId"], actual)
        customer = await repository.customer_identity(payload["experimentId"])
        if customer:
            credits = await repository.validated_research_credits(payload["experimentId"])
            await ConvexWorkerClient(settings).command(
                "settleResearchCredits", experimentId=payload["experimentId"],
                billableAmount=credits,
            )
    finally:
        await redis.aclose()


@activity.defn
async def set_v2_status_activity(payload: dict) -> None:
    await EvaluationRepository(get_settings().postgres_dsn).set_status(
        payload["experimentId"], payload["status"], payload.get("reason"),
    )


@workflow.defn
class EvaluationExperimentV2Workflow:
    def __init__(self):
        self.paused = False
        self.canceled = False

    @workflow.signal
    async def pause(self):
        self.paused = True

    @workflow.signal
    async def resume(self):
        self.paused = False

    @workflow.signal
    async def cancel(self):
        self.canceled = True

    @workflow.run
    async def run(self, experiment_id: str) -> dict:
        prepared = await workflow.execute_activity(
            prepare_v2_activity, experiment_id,
            start_to_close_timeout=timedelta(minutes=1),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        try:
            for item in prepared["items"]:
                if self.canceled:
                    break
                await workflow.wait_condition(lambda: not self.paused or self.canceled)
                scheduled = item["scheduled_at"]
                if isinstance(scheduled, str):
                    scheduled = datetime.fromisoformat(scheduled)
                delay = scheduled - workflow.now()
                if delay.total_seconds() > 0:
                    try:
                        await workflow.wait_condition(
                            lambda: self.canceled or self.paused, timeout=delay,
                        )
                    except asyncio.TimeoutError:
                        pass
                    if self.paused and not self.canceled:
                        await workflow.wait_condition(
                            lambda: not self.paused or self.canceled,
                        )
                    if self.canceled:
                        break
                await workflow.execute_activity(
                    run_v2_plan_item_activity,
                    {
                        "experimentId": experiment_id,
                        "spec": prepared["spec"], "item": item,
                        "ownerSubject": prepared["ownerSubject"],
                        "observedAt": workflow.now().isoformat(),
                    },
                    start_to_close_timeout=timedelta(minutes=30),
                    retry_policy=RetryPolicy(maximum_attempts=1),
                )
            await workflow.execute_activity(
                release_v2_budget_activity,
                {
                    "experimentId": experiment_id,
                    "dailyMaximums": prepared["workPlan"]["dailyMaximums"],
                },
                start_to_close_timeout=timedelta(minutes=1),
            )
            if not self.canceled:
                await self._settle_horizons(experiment_id, prepared["spec"])
            status = "canceled" if self.canceled else "completed"
            await workflow.execute_activity(
                set_v2_status_activity,
                {"experimentId": experiment_id, "status": status},
                start_to_close_timeout=timedelta(minutes=1),
            )
            return {"status": status}
        except Exception as exc:
            await workflow.execute_activity(
                release_v2_budget_activity,
                {
                    "experimentId": experiment_id,
                    "dailyMaximums": prepared["workPlan"]["dailyMaximums"],
                },
                start_to_close_timeout=timedelta(minutes=1),
            )
            await workflow.execute_activity(
                set_v2_status_activity,
                {
                    "experimentId": experiment_id, "status": "failed",
                    "reason": str(exc)[:1_000],
                },
                start_to_close_timeout=timedelta(minutes=1),
            )
            return {"status": "failed", "reason": str(exc)[:1_000]}

    async def _settle_horizons(self, experiment_id: str, raw_spec: dict):
        spec = EvaluationExperimentV2.model_validate(raw_spec)
        if not spec.horizons:
            return
        end = workflow.now() + timedelta(
            seconds=max(HORIZON_SECONDS[item] for item in spec.horizons),
        )
        while workflow.now() <= end and not self.canceled:
            await workflow.execute_activity(
                settle_evaluation_activity, experiment_id,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
            await workflow.sleep(timedelta(minutes=5))
