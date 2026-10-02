import json
from datetime import datetime, timezone
from typing import Literal

import orjson
from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import create_async_engine

from .config import get_settings
from .convex import ConvexWorkerClient
from .tracing import TraceRepository, sanitize
from .evidence_lifecycle_operations import (
    create_hold, record_access, record_local_delete, record_local_export,
    operation_idempotency_key,
)
from .evidence_lifecycle_storage import EvidenceLifecycleRepository
from .monitoring_stream import monitoring_events
from .contracts import StrictModel
from pydantic import Field


router = APIRouter(prefix="/v1/monitoring", tags=["agent monitoring"])
settings = get_settings()
engine = create_async_engine(settings.postgres_dsn, pool_pre_ping=True)

def authorize(value: str | None, subject: str | None) -> str:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}" or not subject:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return subject


async def account_for(subject: str) -> str:
    owner = await ConvexWorkerClient(settings).command("getProviderOwnerContext", subject=subject)
    if not owner:
        raise HTTPException(status_code=404, detail="Strategy account not found")
    return str(owner["strategyAccountId"])


def _unattributed_usage(account_rows: list[dict], team_rows: list[dict]) -> list[dict]:
    fields = ("calls", "successful_calls", "input_tokens", "cached_input_tokens",
              "output_tokens", "provider_cost_microusd", "platform_credits", "latency_ms")
    key_fields = ("day", "provider", "model", "credential_source")
    attributed: dict[tuple, dict] = {}
    for row in team_rows:
        key = tuple(row[field] for field in key_fields)
        total = attributed.setdefault(key, {field: 0 for field in fields})
        for field in fields:
            total[field] += int(row[field])
    result = []
    for row in account_rows:
        key = tuple(row[field] for field in key_fields)
        current = attributed.get(key, {})
        remainder = {field: max(0, int(row[field]) - current.get(field, 0))
                     for field in fields}
        if remainder["calls"] or remainder["provider_cost_microusd"]:
            result.append({**row, **remainder, "team_id": None,
                           "team_version_id": None, "deployment_id": None,
                           "market_id": None})
    return result


@router.get("/runs")
async def list_runs(
    days: int = Query(default=7, ge=1, le=7), market: str = "", team: str = "",
    version: str = "", deployment: str = "",
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None), x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    rows = await TraceRepository(engine).list_runs(account,
        {"days": days, "market": market, "team_id": team,
         "team_version_id": version, "deployment_id": deployment,
         "limit": limit}, subject)
    output = {"runs": [_jsonable(row) for row in rows], "retentionDays": 7}
    _, admitted = await record_access(EvidenceLifecycleRepository(engine),
        artifact_id=f"monitoring:runs:{account}", account_id=account,
        viewer_subject=subject, output=output,
        idempotency_key=operation_idempotency_key("access", f"runs:{account}", output),
        observed_at=datetime.now(timezone.utc),
        source_artifact_ids=[str(row["analysis_id"]) for row in rows])
    return admitted


@router.get("/usage")
async def usage(
    days: int = Query(default=7, ge=1, le=7), team: str = "", version: str = "",
    deployment: str = "", market: str = "",
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    repository = TraceRepository(engine)
    account_rows = await repository.usage_summary(account, days, subject)
    team_rows = await repository.team_usage_summary(account, days)
    if team == "legacy":
        rows = _unattributed_usage(account_rows, team_rows)
    elif team or version or deployment or market:
        rows = await repository.team_usage_summary(
            account, days, team, version, deployment, market.upper())
    else:
        rows = account_rows
    output = {"usage": [_jsonable(row) for row in rows], "days": days,
        "unattributedCostMicrousd": sum(row["provider_cost_microusd"] for row in
            _unattributed_usage(account_rows, team_rows))}
    _, admitted = await record_access(EvidenceLifecycleRepository(engine),
        artifact_id=f"monitoring:usage:{account}", account_id=account,
        viewer_subject=subject, output=output,
        idempotency_key=operation_idempotency_key("access", f"usage:{account}", output),
        observed_at=datetime.now(timezone.utc))
    return admitted


@router.get("/safety")
async def safety(
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    projection = await ConvexWorkerClient(settings).command(
        "getDependencySafetyProjection", strategyAccountId=account,
    )
    output = _jsonable(projection or {"decisions": [], "health": [], "incidents": []})
    _, admitted = await record_access(EvidenceLifecycleRepository(engine),
        artifact_id=f"monitoring:safety:{account}", account_id=account,
        viewer_subject=subject, output=output,
        idempotency_key=operation_idempotency_key("access", f"safety:{account}", output),
        observed_at=datetime.now(timezone.utc))
    return admitted


@router.get("/runs/{analysis_id}")
async def run_trace(
    analysis_id: str, team: str = "", authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    trace = await TraceRepository(engine).get_trace(account, analysis_id, subject)
    if not trace:
        raise HTTPException(status_code=404, detail="Run trace not found or expired")
    if team and trace["run"].get("team_id") != team:
        raise HTTPException(status_code=404, detail="Run trace is unavailable in this team")
    lifecycle_bindings = trace.pop("_lifecycle_bindings")
    events = [_jsonable(row) for row in trace["events"]]
    output = {"run": _jsonable(trace["run"]), "events": events, "graph": _graph(events)}
    _, admitted = await record_access(EvidenceLifecycleRepository(engine),
        artifact_id=analysis_id, account_id=account, viewer_subject=subject,
        output=output, idempotency_key=operation_idempotency_key("access", analysis_id, output),
        observed_at=datetime.now(timezone.utc),
        source_trace_bindings=lifecycle_bindings)
    return admitted


class LifecycleAction(StrictModel):
    artifact_id: str = Field(min_length=8, max_length=120)
    reason_code: Literal["safety_investigation", "customer_contestation", "legal_review"] = \
        "safety_investigation"
    duration_seconds: int = Field(default=3600, ge=60, le=86_400)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120,
        pattern=r"^[A-Za-z0-9._:-]+$")
@router.post("/lifecycle/export")
async def lifecycle_export(request: LifecycleAction,
        authorization: str | None = Header(default=None),
        x_moeazi_subject: str | None = Header(default=None)):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    trace = await TraceRepository(engine).get_trace(account, request.artifact_id, subject)
    if not trace: raise HTTPException(status_code=404, detail="Artifact not found")
    lifecycle_bindings = trace.pop("_lifecycle_bindings")
    output = _jsonable(trace)
    receipt, admitted = await record_local_export(EvidenceLifecycleRepository(engine),
        artifact_id=request.artifact_id, account_id=account, viewer_subject=subject,
        output=output, idempotency_key=request.idempotency_key or
            operation_idempotency_key("export", request.artifact_id, output),
        observed_at=datetime.now(timezone.utc),
        source_trace_bindings=lifecycle_bindings)
    return {"receipt": receipt.model_dump(mode="json"), "output": admitted}
@router.post("/lifecycle/hold")
async def lifecycle_hold(request: LifecycleAction,
        authorization: str | None = Header(default=None),
        x_moeazi_subject: str | None = Header(default=None)):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    if not await TraceRepository(engine).get_trace(account, request.artifact_id, subject):
        raise HTTPException(status_code=404, detail="Artifact not found")
    hold = await create_hold(EvidenceLifecycleRepository(engine), artifact_id=request.artifact_id,
        account_id=account, reviewer_subject=subject, reason_code=request.reason_code,
        duration_seconds=request.duration_seconds,
        idempotency_key=request.idempotency_key or
            f"hold:{request.artifact_id}:{request.reason_code}")
    await ConvexWorkerClient(settings).command("projectEvidenceLifecycleStatus",
        strategyAccountId=account, artifactId=request.artifact_id,
        scopeKey=f"account:{account}", lifecycleState="held", expectedCopyCount=1,
        resolvedCopyCount=0, holdHash=hold.hold_hash, holdRevision=hold.revision,
        latestDecisionHash=hold.hold_hash, transitionHash=hold.hold_hash,
        transitionAt=int(hold.starts_at.timestamp() * 1000), transitionPhase="hold_started")
    return hold.model_dump(mode="json")
@router.post("/lifecycle/delete")
async def lifecycle_delete(request: LifecycleAction,
        authorization: str | None = Header(default=None),
        x_moeazi_subject: str | None = Header(default=None)):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    if not await TraceRepository(engine).get_trace(account, request.artifact_id, subject):
        raise HTTPException(status_code=404, detail="Artifact not found")
    receipt = await record_local_delete(EvidenceLifecycleRepository(engine),
        artifact_id=request.artifact_id, account_id=account,
        idempotency_key=request.idempotency_key or f"delete:{request.artifact_id}")
    state = {"verified": "deleted", "partial": "partial",
        "unverifiable": "unverifiable"}.get(receipt["outcome"], "held")
    await ConvexWorkerClient(settings).command("projectEvidenceLifecycleStatus",
        strategyAccountId=account, artifactId=request.artifact_id,
        scopeKey=f"account:{account}", lifecycleState=state,
        expectedCopyCount=len(receipt.get("expected_copies", [])),
        resolvedCopyCount=len(receipt.get("copy_receipt_hashes", {})),
        deletionReceiptHash=receipt["receipt_hash"], latestDecisionHash=receipt["receipt_hash"],
        transitionHash=receipt["receipt_hash"],
        transitionAt=int(datetime.fromisoformat(receipt["evaluated_at"]).timestamp() * 1000),
        transitionPhase="deletion")
    return receipt


@router.get("/stream")
async def stream(
    authorization: str | None = Header(default=None), x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    account = await account_for(subject)
    events = monitoring_events(account, settings.redis_url, engine,
        viewer_subject=subject, convex_client=ConvexWorkerClient(settings))
    return StreamingResponse(events, media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"})


def _jsonable(value):
    return orjson.loads(orjson.dumps(sanitize(value), default=str))
def _graph(events: list[dict]) -> dict:
    nodes = [{
        "id": row["event_id"], "type": row["event_type"],
        "data": {
            "label": _label(row), "status": row["status"], "role": row.get("role"),
            "provider": row.get("provider"), "model": row.get("model"),
            "credentialSource": row.get("credential_source"),
            "servedModel": row.get("served_model"),
            "upstreamProvider": row.get("upstream_provider"),
            "modelFamily": row.get("model_family"),
            "routingStrategy": row.get("routing_strategy"),
            "fallbackAttempts": row.get("fallback_attempts", 0),
            "generationId": row.get("generation_id"),
            "costSource": row.get("cost_source", "rate_estimate"),
            "decisionSummary": row.get("decision_summary"),
            "input": row.get("input_summary", {}), "output": row.get("output_summary", {}),
            "tokens": {
                "input": row.get("input_tokens", 0), "cached": row.get("cached_input_tokens", 0),
                "output": row.get("output_tokens", 0),
            },
            "providerCostMicrousd": row.get("provider_cost_microusd", 0),
            "platformCredits": row.get("platform_credits", 0), "latencyMs": row.get("latency_ms", 0),
            "error": row.get("error"),
        },
    } for row in events]
    evidence = [row for row in events if row["event_type"] == "evidence"]
    specialists = [row for row in events if row["event_type"] == "model_call"]
    syntheses = [row for row in events if row["event_type"] == "synthesis"]
    decision = next((row for row in events if row["event_type"] == "analysis"), None)
    edges: list[dict] = []
    for specialist in specialists:
        wanted = set((specialist.get("input_summary") or {}).get("evidenceIds", []))
        sources = [row for row in evidence if not wanted or (row.get("output_summary") or {}).get("evidenceId") in wanted]
        for source in sources:
            edges.append(_edge(source["event_id"], specialist["event_id"]))
    if syntheses:
        first = [row for row in syntheses if row.get("role") in {
            "critic", "synthesis_primary", "synthesis_challenger",
            "openai_synthesis", "deepseek_synthesis", "synthesis",
        }]
        for specialist in specialists:
            for target in first:
                edges.append(_edge(specialist["event_id"], target["event_id"]))
        arbiter = next((row for row in syntheses if row.get("role") == "arbiter"), None)
        final = next((row for row in reversed(syntheses) if row.get("role") in {"arbiter", "synthesis"}), syntheses[-1])
        if arbiter:
            for source in syntheses:
                if source is not arbiter:
                    edges.append(_edge(source["event_id"], arbiter["event_id"]))
        if decision:
            edges.append(_edge(final["event_id"], decision["event_id"]))
    actions = [row for row in events if row["event_type"] in {
        "proposal", "policy_check", "quote", "simulation", "execution", "reconciliation",
    } or row["event_type"].startswith("dependency_safety_")]
    previous = decision["event_id"] if decision else (syntheses[-1]["event_id"] if syntheses else None)
    for action in actions:
        if previous:
            edges.append(_edge(previous, action["event_id"]))
        previous = action["event_id"]
    return {"nodes": nodes, "edges": edges}


def _edge(source: str, target: str) -> dict:
    return {"id": f"{source}->{target}", "source": source, "target": target}


def _label(row: dict) -> str:
    if row["event_type"] == "evidence": return str((row.get("output_summary") or {}).get("source", "Evidence"))
    if row["event_type"] == "analysis": return "Team decision"
    if row["event_type"] == "policy_check": return "Policy gate"
    if row["event_type"].startswith("dependency_safety_"):
        return f"Safety · {row['event_type'].removeprefix('dependency_safety_').replace('_', ' ').title()}"
    if row["event_type"] == "reconciliation": return "Receipt reconciliation"
    return str(row.get("role") or row["event_type"]).replace("_", " ").title()
