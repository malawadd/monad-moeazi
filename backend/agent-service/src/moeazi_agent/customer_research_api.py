"""Owner-scoped customer Research routes; operator Lab controls stay separate."""

import os
from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Header, HTTPException, Query
from redis.asyncio import Redis
from temporalio.client import Client

from .config import get_settings
from .convex import ConvexWorkerClient
from .evaluation_outcomes import EvaluationOutcomeRepository
from .evaluation_reservations import release_complete_plan, reserve_complete_plan, reservation_ttl
from .evaluation_scorecards import enrich_scorecards
from .evaluation_storage import EvaluationRepository
from .evaluation_v2_api import _canonical, resolve_spec, preview as build_preview
from .evaluation_v2_contracts import EvaluationCreateV2, EvaluationPreviewV2
from .evaluation_v2_storage import EvaluationV2Repository

router = APIRouter(prefix="/v1/customer-research", tags=["customer research"])
settings = get_settings()


@router.post("/quote")
async def quote(
    request: EvaluationPreviewV2,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    x_moeazi_customer_team: str | None = Header(default=None),
):
    owner, team = _identity(authorization, x_moeazi_subject, x_moeazi_customer_team)
    await _owned(owner, team)
    return await build_preview(request, authorization=authorization,
                               x_moeazi_subject=owner,
                               x_moeazi_customer_team=team, persist=False)


def _identity(authorization: str | None, subject: str | None, team: str | None) -> tuple[str, str]:
    if (authorization != f"Bearer {settings.worker_shared_secret.get_secret_value()}"
            or not subject or not team):
        raise HTTPException(status_code=401, detail="Sign in and choose a team to continue research.")
    return subject, team


async def _owned(owner: str, team: str, include_archived: bool = False) -> dict:
    context = await ConvexWorkerClient(settings).command(
        "getResearchCreditContext", subject=owner, teamId=team,
        includeArchived=include_archived,
    )
    if not context:
        raise HTTPException(status_code=404, detail="Team is unavailable in this account.")
    return context


@router.post("/experiments")
async def start(
    request: EvaluationCreateV2,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    x_moeazi_customer_team: str | None = Header(default=None),
):
    owner, team = _identity(authorization, x_moeazi_subject, x_moeazi_customer_team)
    if not request.spec.confirmed_shadow_only:
        raise HTTPException(status_code=400, detail="Confirm this is a research-only experiment.")
    repo = EvaluationV2Repository(settings.postgres_dsn)
    stored = await repo.preview(owner, request.preview_hash)
    if not stored or stored["customer_team_id"] != team:
        raise HTTPException(status_code=409, detail="Research preview expired or belongs to another team. Preview again.")
    credit = await _owned(owner, team)
    if str(credit["accountId"]) != stored["customer_account_id"]:
        raise HTTPException(status_code=409, detail="Account changed after preview. Preview again.")
    resolved = await resolve_spec(request.spec, owner, team)
    if _canonical(resolved.model_dump(mode="json", by_alias=True)) != _canonical(stored["spec"]):
        raise HTTPException(status_code=409, detail="Saved versions, model routes, or prices changed. Preview again.")
    preview = dict(stored["preview"])
    deterministic_now = (settings.environment in {"local", "development", "test"}
                         and os.getenv("AGENT_CUSTOMER_RESEARCH_DETERMINISTIC") == "true")
    if bool(preview.get("localDeterministic")) != deterministic_now:
        raise HTTPException(status_code=409, detail="Research execution service changed since preview. Preview again.")
    if preview.get("issues") or not preview.get("feasible"):
        raise HTTPException(status_code=409, detail="Research setup has a blocking issue. Review the preview.")
    required = preview["requiredLimits"]
    if any((
        getattr(request.limits, key) < required[key]
        for key in ("maximum_per_observation_microusd", "maximum_peak_day_microusd",
                    "maximum_total_microusd")
    )):
        raise HTTPException(status_code=409, detail="Accepted spend limits no longer cover this plan. Preview again.")
    maximum_credits = int(preview["maximumCredits"])
    if maximum_credits < 1 or maximum_credits > 100_000:
        raise HTTPException(status_code=409, detail="Research credit ceiling is unavailable. Reduce the experiment scope.")
    experiment_id = str(uuid5(NAMESPACE_URL, f"customer-research:{owner}:{team}:{request.preview_hash}"))
    existing = await repo.customer_experiment(owner, team, experiment_id)
    if existing:
        return {"experimentId": experiment_id, "status": existing["status"], "duplicate": True}
    if credit["available"] < maximum_credits:
        raise HTTPException(status_code=409, detail="Credits changed since preview. Add credits or reduce the experiment.")
    convex = ConvexWorkerClient(settings)
    expires = int((datetime.now(timezone.utc) + timedelta(days=2)).timestamp() * 1000)
    reservation = await convex.command(
        "reserveResearchCredits", subject=owner, teamId=team,
        experimentId=experiment_id, amount=maximum_credits, expiresAt=expires,
    )
    if reservation.get("insufficient"):
        raise HTTPException(status_code=409, detail="Available credits cannot cover this research. Review the budget.")
    if reservation.get("duplicate") and reservation.get("status") != "active":
        raise HTTPException(status_code=409, detail="This research reservation has ended. Create a fresh preview.")
    redis = Redis.from_url(settings.redis_url)
    reserved = created = False
    try:
        await reserve_complete_plan(
            redis, experiment_id, preview["dailyMaximums"],
            required["maximum_per_observation_microusd"], request.limits,
            round(settings.evaluation_global_budget_usd * 1_000_000),
            reservation_ttl(preview.get("collectionEndAt")),
        )
        reserved = True
        await repo.create_experiment(
            experiment_id, owner, resolved, preview, stored["plan_items"], team,
            stored["customer_account_id"],
        )
        created = True
        await repo.save_allocations(experiment_id, preview["dailyMaximums"])
        client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
        from .evaluation_v2_temporal import EvaluationExperimentV2Workflow
        await client.start_workflow(
            EvaluationExperimentV2Workflow.run, experiment_id,
            id=f"evaluation-v2-{experiment_id}", task_queue=settings.evaluation_task_queue,
        )
    except Exception as exc:
        if reserved:
            await release_complete_plan(redis, experiment_id, list(preview["dailyMaximums"]))
        if created:
            await EvaluationRepository(settings.postgres_dsn).set_status(
                experiment_id, "failed", str(exc)[:1_000],
            )
        await convex.command("settleResearchCredits", experimentId=experiment_id,
                             billableAmount=0, releaseOnly=True)
        raise HTTPException(status_code=409, detail="Research could not start. Your reserved budget was released. Preview again and retry; if it continues, contact support with the experiment ID.") from exc
    finally:
        await redis.aclose()
    return {"experimentId": experiment_id, "status": "running"}


@router.get("/experiments")
async def list_experiments(
    limit: int = Query(default=50, ge=1, le=100),
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    x_moeazi_customer_team: str | None = Header(default=None),
):
    owner, team = _identity(authorization, x_moeazi_subject, x_moeazi_customer_team)
    await _owned(owner, team, include_archived=True)
    repository = EvaluationV2Repository(settings.postgres_dsn)
    return {"experiments": await repository.customer_experiments(owner, team, limit)}


@router.get("/experiments/{experiment_id}")
async def detail(
    experiment_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    x_moeazi_customer_team: str | None = Header(default=None),
):
    owner, team = _identity(authorization, x_moeazi_subject, x_moeazi_customer_team)
    repo = EvaluationV2Repository(settings.postgres_dsn)
    binding = await repo.customer_experiment(owner, team, experiment_id)
    if not binding or str((await _owned(owner, team, include_archived=True))["accountId"]) != binding["customer_account_id"]:
        raise HTTPException(status_code=404, detail="Research result is unavailable for this team.")
    row = await EvaluationRepository(settings.postgres_dsn).get_experiment(owner, experiment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Research result is unavailable.")
    for subject in row.get("spec", {}).get("subjects", []):
        subject.pop("operator_subject", None)
        subject.pop("account_id", None)
    artifacts = await EvaluationOutcomeRepository(settings.postgres_dsn).artifacts(experiment_id)
    row.update(artifacts)
    row["scorecards"] = enrich_scorecards(
        row["scorecards"], artifacts["outcomes"], artifacts["fills"],
        float(row["spec"].get("strategy", {}).get("starting_equity_usd", 10_000)),
    )
    row["creditBudget"] = {"maximum": binding["work_plan"].get("maximumCredits"),
                           "validated": await repo.validated_research_credits(experiment_id)}
    return row


@router.post("/experiments/{experiment_id}/cancel")
async def cancel(
    experiment_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    x_moeazi_customer_team: str | None = Header(default=None),
):
    owner, team = _identity(authorization, x_moeazi_subject, x_moeazi_customer_team)
    binding = await EvaluationV2Repository(settings.postgres_dsn).customer_experiment(owner, team, experiment_id)
    if not binding or str((await _owned(owner, team))["accountId"]) != binding["customer_account_id"]:
        raise HTTPException(status_code=404, detail="Research experiment is unavailable for this team.")
    if binding["status"] in {"completed", "failed", "canceled"}:
        return {"experimentId": experiment_id, "status": binding["status"]}
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    await client.get_workflow_handle(f"evaluation-v2-{experiment_id}").signal("cancel")
    return {"experimentId": experiment_id, "status": "canceling"}
