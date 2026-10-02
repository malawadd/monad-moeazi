import asyncio
import json
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from temporalio.client import Client

from .config import get_settings
from .convex import ConvexWorkerClient
from .evaluation_contracts import ExperimentSpec
from .evaluation_engine import estimate_experiment
from .evaluation_storage import EvaluationRepository
from .evaluation_outcomes import EvaluationOutcomeRepository
from .evaluation_temporal import EvaluationExperimentWorkflow
from .evaluation_scorecards import enrich_scorecards
from .model_routing import ModelRouting
from .routing_service import RoutingService


router = APIRouter(prefix="/internal/evaluations", tags=["evaluation lab"])
settings = get_settings()


def authorize(value: str | None, subject: str | None) -> str:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}" or not subject:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not settings.agent_dev_controls_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    allowed = settings.evaluation_operator_set
    if allowed and subject not in allowed:
        raise HTTPException(status_code=403, detail="Evaluation operator access is required")
    if settings.environment not in {"local", "development", "test"} and not allowed:
        raise HTTPException(status_code=503, detail="Evaluation operator allowlist is not configured")
    return subject


async def _context(spec: ExperimentSpec, subject: str) -> ExperimentSpec:
    owner = await ConvexWorkerClient(settings).command("getProviderOwnerContext", subject=subject)
    account_id = str(owner["strategyAccountId"]) if owner else None
    subjects = []
    for item in spec.subjects:
        routing = item.routing
        if item.configuration_version:
            if not account_id:
                raise HTTPException(status_code=409, detail="A strategy account is required")
            config = await ConvexWorkerClient(settings).command(
                "getEvaluationModelConfiguration", subject=subject,
                version=item.configuration_version,
            )
            if not config:
                raise HTTPException(
                    status_code=409,
                    detail=f"Model configuration {item.configuration_version} is unavailable",
                )
            routing = ModelRouting.model_validate(config["routes"])
        subjects.append(item.model_copy(update={
            "routing": routing, "account_id": account_id, "operator_subject": subject,
        }))
    return spec.model_copy(update={"subjects": subjects})


async def _universe(spec: ExperimentSpec) -> list[dict]:
    redis = Redis.from_url(settings.redis_url)
    try:
        listings = await RoutingService(redis, settings).markets()
    finally:
        await redis.aclose()
    requested = {item.upper() for item in spec.markets}
    if "ALL_SUPPORTED" not in requested:
        listings = [item for item in listings if item.market_id in requested]
    if not listings:
        raise HTTPException(status_code=409, detail="No requested markets are currently listed")
    ranked = sorted(
        listings, key=lambda item: float(item.volume_24h_usd or 0), reverse=True,
    )
    high = {item.market_id for item in ranked[:min(20, len(ranked))]}
    return [{
        "market": item.market_id,
        "status": (
            "replay_ready" if item.mark_price and spec.mode in {"replay", "replay_and_live_shadow"}
            else "live_shadow_ready" if item.mark_price
            else "temporarily_unscorable"
        ),
        "reason": (
            "Current venue snapshot can be frozen and replayed"
            if item.mark_price and spec.mode in {"replay", "replay_and_live_shadow"}
            else "Live venue mark is available"
            if item.mark_price else "No trustworthy mark price is currently available"
        ),
        "liquidity_tier": "high" if item.market_id in high else "standard",
        "cadence_minutes": 15 if item.market_id in high else 60,
        "mark_price": item.mark_price,
        "venues": [venue.value for venue in item.venues],
    } for item in listings]


@router.post("/preview")
async def preview(
    spec: ExperimentSpec, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    resolved = await _context(spec, subject)
    universe = await _universe(resolved)
    estimate = estimate_experiment(resolved, len(universe))
    estimate["marketUniverse"] = universe
    estimate["shadowOnly"] = True
    estimate["withinPerRunBudget"] = (
        estimate["maximumPerObservationMicrousd"] <= resolved.budget.maximum_per_run_microusd
    )
    return estimate


@router.get("/configurations")
async def configurations(
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    rows = await ConvexWorkerClient(settings).command(
        "listEvaluationModelConfigurations", subject=subject,
    )
    return {"configurations": rows or []}


@router.post("")
async def create(
    spec: ExperimentSpec, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    resolved = await _context(spec, subject)
    universe = await _universe(resolved)
    estimate = estimate_experiment(resolved, len(universe))
    if estimate["maximumPerObservationMicrousd"] > resolved.budget.maximum_per_run_microusd:
        raise HTTPException(status_code=409, detail="Per-run budget is below the cost ceiling")
    experiment_id = str(uuid4())
    repository = EvaluationRepository(settings.postgres_dsn)
    await repository.create_experiment(
        experiment_id, subject, resolved, universe,
        estimate["projectedReplayCostMicrousd"] + estimate["projectedDailyCostMicrousd"],
    )
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    await client.start_workflow(
        EvaluationExperimentWorkflow.run, experiment_id,
        id=f"evaluation-{experiment_id}", task_queue=settings.evaluation_task_queue,
    )
    await repository.set_status(experiment_id, "running")
    return {"experimentId": experiment_id, "status": "running", "estimate": estimate}


@router.get("")
async def list_experiments(
    limit: int = Query(default=50, ge=1, le=100),
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    return {"experiments": await EvaluationRepository(settings.postgres_dsn).list_experiments(subject, limit)}


@router.get("/{experiment_id}")
async def detail(
    experiment_id: str, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    row = await EvaluationRepository(settings.postgres_dsn).get_experiment(subject, experiment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation experiment not found")
    for item in row.get("spec", {}).get("subjects", []):
        item.pop("operator_subject", None)
        item.pop("account_id", None)
    artifacts = await EvaluationOutcomeRepository(settings.postgres_dsn).artifacts(experiment_id)
    row.update(artifacts)
    row["scorecards"] = enrich_scorecards(
        row["scorecards"], artifacts["outcomes"], artifacts["fills"],
        float(row["spec"].get("strategy", {}).get("starting_equity_usd", 10_000)),
    )
    return row


async def _control(
    experiment_id: str, action: str, subject: str,
) -> dict:
    repository = EvaluationRepository(settings.postgres_dsn)
    experiment = await repository.get_experiment(subject, experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="Evaluation experiment not found")
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    prefix = "evaluation-v2" if experiment.get("schema_version") == 2 else "evaluation"
    handle = client.get_workflow_handle(f"{prefix}-{experiment_id}")
    await handle.signal(action)
    status = {"pause": "paused", "resume": "running", "cancel": "canceled"}[action]
    await repository.set_status(experiment_id, status)
    return {"experimentId": experiment_id, "status": status}


@router.post("/{experiment_id}/pause")
async def pause(
    experiment_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    return await _control(experiment_id, "pause", subject)


@router.post("/{experiment_id}/resume")
async def resume(
    experiment_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    return await _control(
        experiment_id, "resume", authorize(authorization, x_moeazi_subject),
    )


@router.post("/{experiment_id}/cancel")
async def cancel(
    experiment_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    return await _control(
        experiment_id, "cancel", authorize(authorization, x_moeazi_subject),
    )


@router.post("/{experiment_id}/annotations")
async def annotate(
    experiment_id: str, payload: dict,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    body = str(payload.get("body", "")).strip()
    if not body or len(body) > 2_000:
        raise HTTPException(status_code=400, detail="Annotation must be 1-2000 characters")
    repository = EvaluationRepository(settings.postgres_dsn)
    if not await repository.get_experiment(subject, experiment_id):
        raise HTTPException(status_code=404, detail="Evaluation experiment not found")
    annotation_id = str(uuid4())
    await repository.add_annotation(
        annotation_id, experiment_id, payload.get("runId"), subject, body,
        str(payload.get("label", "review"))[:40],
    )
    return {"annotationId": annotation_id}


@router.get("/{experiment_id}/stream")
async def stream(
    experiment_id: str, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    repository = EvaluationRepository(settings.postgres_dsn)
    if not await repository.get_experiment(subject, experiment_id):
        raise HTTPException(status_code=404, detail="Evaluation experiment not found")

    async def events():
        last = ""
        while True:
            row = await repository.get_experiment(subject, experiment_id)
            payload = json.dumps({
                "status": row["status"], "actualCostMicrousd": row["actual_cost_microusd"],
                "runCount": len(row["runs"]),
            }, default=str)
            if payload != last:
                yield f"event: evaluation\ndata: {payload}\n\n"
                last = payload
            else:
                yield "event: heartbeat\ndata: {}\n\n"
            if row["status"] in {"completed", "canceled", "failed"}:
                return
            await asyncio.sleep(2)

    return StreamingResponse(events(), media_type="text/event-stream")
