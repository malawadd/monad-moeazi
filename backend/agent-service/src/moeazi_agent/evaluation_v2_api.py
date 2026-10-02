import hashlib
import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException
from redis.asyncio import Redis
from temporalio.client import Client

from .config import get_settings
from .convex import ConvexWorkerClient
from .evaluation_api import authorize
from .evaluation_planner import build_evaluation_plan
from .evaluation_reservations import (
    release_complete_plan, reserve_complete_plan, reservation_ttl,
)
from .evaluation_v2_contracts import (
    EvaluationCreateV2, EvaluationExperimentV2, EvaluationPreviewV2,
    EvaluationRoleSetting,
)
from .evaluation_v2_storage import EvaluationV2Repository
from .roles import Assignment, ROLES
from .routing_service import RoutingService
from .security import SYSTEM_BOUNDARY
from .providers import specialist_prompt, synthesis_prompt
from .contracts import SignalReport, SynthesisDraft
from .model_routing import ModelRouting
from .evaluation_customer_cost import summarize_customer_cost

router = APIRouter(prefix="/internal/evaluations/v2", tags=["evaluation lab v2"])
settings = get_settings()

async def resolve_spec(
    spec: EvaluationExperimentV2, owner_subject: str, customer_team_id: str | None = None,
) -> EvaluationExperimentV2:
    convex = ConvexWorkerClient(settings)
    owner = await convex.command("getProviderOwnerContext", subject=owner_subject)
    account_id = str(owner["strategyAccountId"]) if owner else None
    subjects = []
    for subject in spec.subjects:
        routing = subject.routing
        if customer_team_id:
            if not subject.team_version_id or subject.configuration_version or routing or subject.role_settings:
                raise HTTPException(status_code=400, detail="Choose a saved team version without ad hoc routing.")
            owned = await convex.command(
                "getOwnedTeamVersion", subject=owner_subject,
                teamId=customer_team_id, versionId=subject.team_version_id,
            )
            if not owned:
                raise HTTPException(status_code=404, detail="Saved team version is unavailable in this account.")
            config = owned["config"]
            if not set(spec.markets).issubset(set(config["markets"])):
                raise HTTPException(status_code=409, detail="Add the selected market to the saved team version.")
            routing = ModelRouting.model_validate(json.loads(config["modelRoutingJson"]))
            roles = [item["id"] for item in config["roles"] if item["enabled"]]
            used = [routing.route(f"role:{role}") for role in roles]
            used.append(routing.route("synthesis"))
            if spec.stages.forecast:
                used.append(routing.route("forecast"))
            if spec.stages.model_strategy:
                used.append(routing.route("strategy"))
            if spec.stages.semantic_grounding:
                used.append(routing.route("grounding_evaluator"))
            for route in used:
                if route.input_price == 0 or route.output_price == 0:
                    payer = "your provider account" if route.credential_source == "byok" else "Moeazi credits"
                    stage = route.slot.removeprefix("role:").replace("_", " ").capitalize()
                    raise HTTPException(status_code=409, detail=(
                        f"{stage}: {route.model} pricing is unknown ({payer}). "
                        "Choose a priced model or confirm its rate in team Configure before Research."
                    ))
            checked_connections = {}
            for route in used:
                if route.credential_source != "byok":
                    continue
                if route.connection_id not in checked_connections:
                    checked_connections[route.connection_id] = await convex.command(
                        "getProviderConnectionForWorker", subject=owner_subject,
                        connectionId=route.connection_id,
                    )
                connection = checked_connections[route.connection_id]
                capabilities = json.loads(connection.get("capabilitiesJson") or "{}") if connection else {}
                if (not connection or connection.get("status") != "verified"
                        or connection.get("provider") != route.provider
                        or route.model not in capabilities.get("compatibleModels", [])):
                    stage = route.slot.removeprefix("role:").replace("_", " ").capitalize()
                    raise HTTPException(status_code=409, detail=(
                        f"{stage}: {route.model} cannot use this key yet. "
                        "Choose a verified, tested model in team Configure; compatibility tests may be billable."
                    ))
            subjects.append(subject.model_copy(update={
                "routing": routing, "tier": config["tier"], "selected_roles": roles,
                "role_settings": [EvaluationRoleSetting(id=item["id"], horizon=item["horizon"],
                    instructions=item.get("instructions", "")) for item in config["roles"] if item["enabled"]],
                "quorum_minimum": len(roles) // 2 + 1,
                "prompt_bundle_id": "agent-v2", "operator_subject": owner_subject,
                "account_id": str(owned["accountId"]),
            }))
            continue
        if subject.configuration_version:
            if not account_id:
                raise HTTPException(status_code=409, detail="A strategy account is required")
            config = await convex.command(
                "getEvaluationModelConfiguration", subject=owner_subject,
                version=subject.configuration_version,
            )
            if not config:
                raise HTTPException(status_code=409, detail="Model configuration is unavailable")
            configured = config["routes"]
            if routing is not None:
                allowed_connections = {
                    item.get("connectionId") for item in configured["routes"]
                    if item.get("connectionId")
                }
                requested_connections = {
                    item.connection_id for item in routing.routes if item.connection_id
                }
                if not requested_connections.issubset(allowed_connections):
                    raise HTTPException(
                        status_code=409,
                        detail="Ad hoc routes must use connections from the base configuration",
                    )
            else:
                routing = configured
        subjects.append(subject.model_copy(update={
            "routing": routing, "operator_subject": owner_subject, "account_id": account_id,
        }))
    return spec.model_copy(update={"subjects": subjects})
@router.get("/catalog")
async def catalog(
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    redis = Redis.from_url(settings.redis_url)
    try:
        markets = await RoutingService(redis, settings).markets()
    finally:
        await redis.aclose()
    configurations = await ConvexWorkerClient(settings).command(
        "listEvaluationModelConfigurations", subject=owner,
    )
    ranked = sorted(markets, key=lambda item: float(item.volume_24h_usd or 0), reverse=True)
    market_rows = [{
        "market": item.market_id, "markPrice": item.mark_price,
        "volume24hUsd": item.volume_24h_usd,
        "venues": [venue.value for venue in item.venues],
        "readiness": "ready" if item.mark_price else "unscorable",
    } for item in ranked]
    return {
        "markets": market_rows, "configurations": configurations or [],
        "roles": [{
            "id": role.name, "horizon": role.horizon,
            "critical": role.critical, "directionalOrRisk": role.directional_or_risk,
            "purpose": role.name.replace("_", " ").title(),
        } for role in ROLES],
        "horizons": ["5m", "1h", "4h", "24h"],
        "builtInSafetyCases": [
            {"id": "missing_evidence", "label": "Missing evidence"},
            {"id": "stale_evidence", "label": "Stale evidence"},
            {"id": "contradiction", "label": "Contradictory evidence"},
            {"id": "prompt_injection", "label": "Prompt injection"},
            {"id": "wrong_market", "label": "Wrong-market leakage"},
            {"id": "confidence_inflation", "label": "Confidence inflation"},
        ],
        "globalDailyLimitMicrousd": round(settings.evaluation_global_budget_usd * 1_000_000),
        "systemBoundary": SYSTEM_BOUNDARY,
        "defaultPromptBundle": {
            "id": "agent-v2", "name": "Production-compatible agent-v2",
            "prompts": {
                **{
                    role.name: {
                        "system": SYSTEM_BOUNDARY,
                        "user": specialist_prompt(
                            Assignment(role, "deepseek"),
                            "{{market}}", "{{evidence}}",
                        ),
                    } for role in ROLES
                },
                "synthesis": {
                    "system": SYSTEM_BOUNDARY,
                    "user": synthesis_prompt(
                        "{{market}}", "focus", "synthesis",
                        [{"reports": "{{validated_reports}}"}],
                    ),
                },
            },
            "schemas": {
                "signal_report": SignalReport.model_json_schema(),
                "synthesis": SynthesisDraft.model_json_schema(),
            },
        },
    }
@router.post("/preview")
async def preview(
    request: EvaluationPreviewV2,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    x_moeazi_customer_team: str | None = Header(default=None),
    persist: bool = True,
):
    if x_moeazi_customer_team:
        if authorization != f"Bearer {settings.worker_shared_secret.get_secret_value()}" or not x_moeazi_subject:
            raise HTTPException(status_code=401, detail="Sign in to preview research.")
        owner = x_moeazi_subject
    else:
        owner = authorize(authorization, x_moeazi_subject)
    resolved = await resolve_spec(request.spec, owner, x_moeazi_customer_team)
    asset_repository = EvaluationV2Repository(settings.postgres_dsn)
    for asset_id in [*resolved.replay_case_ids, *resolved.custom_safety_case_ids]:
        asset = await asset_repository.asset(asset_id, owner)
        if not asset or asset["asset_type"] != "case" or asset["status"] != "frozen":
            raise HTTPException(
                status_code=409,
                detail=f"Frozen evaluation case is unavailable: {asset_id}",
            )
    redis = Redis.from_url(settings.redis_url)
    try:
        listings = await RoutingService(redis, settings).markets()
    finally:
        await redis.aclose()
    by_market = {item.market_id: item for item in listings}
    high_liquidity = {
        item.market_id for item in sorted(
            listings, key=lambda item: float(item.volume_24h_usd or 0), reverse=True,
        )[:20]
    }
    missing = sorted(set(resolved.markets) - set(by_market))
    if missing:
        raise HTTPException(
            status_code=409, detail=f"Markets are unavailable: {', '.join(missing[:8])}",
        )
    plan = build_evaluation_plan(
        resolved, round(settings.evaluation_global_budget_usd * 1_000_000),
        request.limits,
    )
    redis = Redis.from_url(settings.redis_url)
    try:
        days = sorted(plan["dailyMaximums"])
        reserved = await redis.mget(
            *[f"evaluation:v2:global-reserved:{day}" for day in days]
        ) if days else []
    finally:
        await redis.aclose()
    global_limit = round(settings.evaluation_global_budget_usd * 1_000_000)
    available_by_day = {
        day: max(0, global_limit - int(reserved[index] or 0))
        for index, day in enumerate(days)
    }
    plan["globalAvailableByDay"] = available_by_day
    for day, required_cost in plan["dailyMaximums"].items():
        available = available_by_day.get(day, global_limit)
        if required_cost > available and not any(
            item["code"] == f"global_capacity:{day}" for item in plan["issues"]
        ):
            plan["issues"].append({
                "code": f"global_capacity:{day}", "severity": "blocking",
                "requiredMicrousd": required_cost, "availableMicrousd": available,
                "message": f"Shared global capacity for {day} is already allocated.",
            })
    plan["feasible"] = not plan["issues"]
    if plan["issues"] and not plan["alternatives"]:
        plan["alternatives"] = [
            {"code": "shorter_duration", "label": "Shorten live collection",
             "changes": {"durationMinutes": max(
                 15, int((resolved.schedule.duration_minutes or 15) / 2),
             )}},
            {"code": "fewer_markets", "label": "Keep the highest-liquidity markets",
             "changes": {"marketCount": max(1, len(resolved.markets) // 2)}},
            {"code": "lower_frequency", "label": "Run observations less often",
             "changes": {"cadenceMultiplier": 2}},
        ]
    plan["marketUniverse"] = [{
        "market": market, "status": (
            "live_shadow_ready" if by_market[market].mark_price
            else "temporarily_unscorable"
        ),
        "reason": (
            "Live venue mark is available" if by_market[market].mark_price
            else "No trustworthy mark price is currently available"
        ),
        "liquidity_tier": "high" if market in high_liquidity else "standard",
        "cadence_minutes": (
            resolved.schedule.cadence_for(market)
            if resolved.mode != "replay" else 0
        ),
        "mark_price": by_market[market].mark_price,
    } for market in resolved.markets]
    plan["previewIssuedAt"] = datetime.now(timezone.utc).isoformat()
    customer_account_id = None
    if x_moeazi_customer_team:
        customer_account_id = resolved.subjects[0].account_id
        if not customer_account_id or any(
            item.account_id != customer_account_id for item in resolved.subjects
        ):
            raise HTTPException(status_code=409, detail="All saved versions must belong to this account.")
        credit = await ConvexWorkerClient(settings).command(
            "getResearchCreditContext", subject=owner, teamId=x_moeazi_customer_team,
        )
        if not credit or str(credit["accountId"]) != customer_account_id:
            raise HTTPException(status_code=404, detail="Team is unavailable in this account.")
        plan.update(summarize_customer_cost(plan, resolved.stages.semantic_sample_rate))
        maximum_credits = plan["maximumCredits"]
        plan["availableCredits"] = credit["available"]
        plan["localDeterministic"] = (
            settings.environment in {"local", "development", "test"}
            and os.getenv("AGENT_CUSTOMER_RESEARCH_DETERMINISTIC") == "true"
        )
        if plan["localDeterministic"] and (
            resolved.stages.forecast or resolved.stages.semantic_grounding
            or resolved.stages.model_strategy
        ):
            plan["issues"].append({
                "code": "deterministic_stage_unavailable", "severity": "blocking",
                "message": "Local deterministic research supports specialist and synthesis validation only. Disable forecast and model stages for this test.",
            })
        if maximum_credits > credit["available"]:
            plan["issues"].append({
                "code": "insufficient_credits", "severity": "blocking",
                "message": "Available credits cannot cover this experiment. Reduce its scope or add credits.",
            })
        plan["feasible"] = not plan["issues"]
    plan["previewHash"] = hashlib.sha256(_canonical({
        "owner": owner, "customerTeam": x_moeazi_customer_team,
        "spec": resolved.model_dump(mode="json", by_alias=True),
        "plan": {key: value for key, value in plan.items() if key != "previewHash"},
    }).encode()).hexdigest()
    if persist:
        await asset_repository.save_preview(
            owner, resolved, plan, plan["_items"],
            x_moeazi_customer_team, customer_account_id,
        )
    return {key: value for key, value in plan.items() if not key.startswith("_")}
@router.post("/experiments")
async def create_experiment(
    request: EvaluationCreateV2,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    if not request.spec.confirmed_shadow_only:
        raise HTTPException(status_code=400, detail="Shadow-only confirmation is required")
    repository = EvaluationV2Repository(settings.postgres_dsn)
    stored = await repository.preview(owner, request.preview_hash)
    if not stored:
        raise HTTPException(status_code=409, detail="Preview expired; calculate it again")
    resolved = await resolve_spec(request.spec, owner)
    if _canonical(resolved.model_dump(mode="json", by_alias=True)) != _canonical(stored["spec"]):
        raise HTTPException(status_code=409, detail="Experiment changed after preview")
    preview_value = dict(stored["preview"])
    if preview_value.get("issues"):
        raise HTTPException(status_code=409, detail="The preview is not finish-safe")
    required = preview_value["requiredLimits"]
    if (
        request.limits.maximum_per_observation_microusd
        < required["maximum_per_observation_microusd"]
        or request.limits.maximum_peak_day_microusd
        < required["maximum_peak_day_microusd"]
        or request.limits.maximum_total_microusd
        < required["maximum_total_microusd"]
    ):
        raise HTTPException(status_code=409, detail="Accepted limits cannot finish this plan")
    experiment_id = str(uuid4())
    redis = Redis.from_url(settings.redis_url)
    reserved = False
    created = False
    try:
        await reserve_complete_plan(
            redis, experiment_id, preview_value["dailyMaximums"],
            required["maximum_per_observation_microusd"], request.limits,
            round(settings.evaluation_global_budget_usd * 1_000_000),
            reservation_ttl(preview_value.get("collectionEndAt")),
        )
        reserved = True
        await repository.create_experiment(
            experiment_id, owner, resolved, preview_value, stored["plan_items"],
        )
        created = True
        await repository.save_allocations(experiment_id, preview_value["dailyMaximums"])
        client = await Client.connect(
            settings.temporal_address, namespace=settings.temporal_namespace,
        )
        from .evaluation_v2_temporal import EvaluationExperimentV2Workflow
        await client.start_workflow(
            EvaluationExperimentV2Workflow.run, experiment_id,
            id=f"evaluation-v2-{experiment_id}", task_queue=settings.evaluation_task_queue,
        )
    except Exception as exc:
        if reserved:
            await release_complete_plan(
                redis, experiment_id, list(preview_value["dailyMaximums"]),
            )
        if created:
            from .evaluation_storage import EvaluationRepository
            await EvaluationRepository(settings.postgres_dsn).set_status(
                experiment_id, "failed", str(exc)[:1_000],
            )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    finally:
        await redis.aclose()
    return {"experimentId": experiment_id, "status": "running"}
def _canonical(value) -> str:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            pass
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
