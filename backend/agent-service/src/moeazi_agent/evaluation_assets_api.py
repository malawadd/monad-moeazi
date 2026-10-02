import csv
import io
import json
import re
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from redis.asyncio import Redis

from .config import get_settings
from .evaluation_api import authorize
from .evaluation_storage import EvaluationRepository
from .evaluation_outcomes import EvaluationOutcomeRepository
from .evaluation_v2_contracts import EvaluationAssetDraft
from .evaluation_v2_storage import EvaluationV2Repository
from .routing_service import RoutingService
from .security import sanitize_untrusted_content
from .storage import AnalysisRepository


router = APIRouter(prefix="/internal/evaluations/v2", tags=["evaluation assets"])
settings = get_settings()
ASSET_TYPES = {"template", "safety_suite", "prompt_bundle", "case"}
SECRET_PATTERN = re.compile(
    r"(?i)(api[_-]?key|secret|private[_-]?key|authorization)\s*[:=]\s*\S+|bearer\s+\S+"
)


@router.get("/assets")
async def list_assets(
    type: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    if type and type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported evaluation asset type")
    rows = await EvaluationV2Repository(settings.postgres_dsn).list_assets(owner, type)
    return {"assets": rows}


@router.post("/assets/{asset_type}")
async def create_asset(
    asset_type: str, draft: EvaluationAssetDraft,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    _validate_asset(asset_type, draft.payload, freezing=False)
    if asset_type == "case":
        draft = draft.model_copy(update={"payload": _sanitized_case(draft.payload)})
    repository = EvaluationV2Repository(settings.postgres_dsn)
    row = await repository.create_asset(
        owner, asset_type, draft,
    )
    if asset_type == "case":
        row = await repository.freeze_asset(owner, row["asset_id"]) or row
    return row


@router.put("/assets/{asset_id}")
async def update_asset(
    asset_id: str, draft: EvaluationAssetDraft,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    _reject_secrets(draft.payload)
    row = await EvaluationV2Repository(settings.postgres_dsn).update_asset(
        owner, asset_id, draft,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Editable evaluation asset not found")
    return row


@router.post("/assets/{asset_id}/freeze")
async def freeze_asset(
    asset_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    repository = EvaluationV2Repository(settings.postgres_dsn)
    rows = await repository.list_assets(owner)
    target = next((item for item in rows if item["asset_id"] == asset_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Evaluation asset not found")
    _validate_asset(target["asset_type"], target["payload"], freezing=True)
    return await repository.freeze_asset(owner, asset_id)


@router.post("/cases/capture")
async def capture_case(
    payload: dict,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    market = str(payload.get("market", "")).upper()
    name = str(payload.get("name", f"{market} live capture")).strip()
    if not market:
        raise HTTPException(status_code=400, detail="Market is required")
    redis = Redis.from_url(settings.redis_url)
    try:
        listings = await RoutingService(redis, settings).markets()
    finally:
        await redis.aclose()
    listing = next((item for item in listings if item.market_id == market), None)
    if not listing or not listing.mark_price:
        raise HTTPException(status_code=409, detail="A trustworthy live mark is required")
    evidence = await AnalysisRepository(settings.postgres_dsn).recent_evidence(
        market, settings.evidence_max_items,
    )
    frozen = [{
        "ref": ref.model_dump(mode="json"),
        "content": sanitize_untrusted_content(
            content, settings.evidence_max_chars_per_item,
        ).text,
    } for ref, content in evidence]
    draft = EvaluationAssetDraft(
        name=name, description="Captured from live public market and evidence reads.",
        payload={
            "market": market, "marketSnapshot": {
                **listing.model_dump(mode="json"),
                "observed_at": datetime.now(timezone.utc).isoformat(),
            },
            "evidence": frozen, "source": "live_capture",
        },
    )
    repository = EvaluationV2Repository(settings.postgres_dsn)
    row = await repository.create_asset(
        owner, "case", draft,
    )
    return await repository.freeze_asset(owner, row["asset_id"]) or row


@router.get("/experiments/{experiment_id}/export.json")
async def export_json(
    experiment_id: str,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    row = await EvaluationRepository(settings.postgres_dsn).get_experiment(
        owner, experiment_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation experiment not found")
    return JSONResponse(
        json.loads(json.dumps(row, default=str)),
        headers={"Content-Disposition": f'attachment; filename="evaluation-{experiment_id}.json"'},
    )


@router.get("/experiments/{experiment_id}/export.csv")
async def export_csv(
    experiment_id: str, dataset: str = Query(default="runs"),
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    owner = authorize(authorization, x_moeazi_subject)
    row = await EvaluationRepository(settings.postgres_dsn).get_experiment(
        owner, experiment_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation experiment not found")
    artifacts = (
        await EvaluationOutcomeRepository(settings.postgres_dsn).artifacts(experiment_id)
        if dataset in {"outcomes", "fills"} else {}
    )
    source = {
        "runs": row.get("runs", []), "scorecards": row.get("scorecards", []),
        "cases": row.get("cases", []), "annotations": row.get("annotations", []),
        "outcomes": artifacts.get("outcomes", []), "fills": artifacts.get("fills", []),
    }.get(dataset)
    if source is None:
        raise HTTPException(status_code=400, detail="Unsupported CSV dataset")
    fields = sorted({key for item in source for key in item})
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for item in source:
        writer.writerow({
            key: json.dumps(value, default=str) if isinstance(value, (dict, list)) else value
            for key, value in item.items()
        })
    return Response(
        output.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{dataset}-{experiment_id}.csv"'},
    )


def _validate_asset(asset_type: str, payload: dict, freezing: bool) -> None:
    if asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported evaluation asset type")
    _reject_secrets(payload)
    if not freezing or asset_type != "prompt_bundle":
        if asset_type == "case":
            snapshot = payload.get("marketSnapshot")
            if not payload.get("market") or not isinstance(snapshot, dict):
                raise HTTPException(
                    status_code=400,
                    detail="Cases require market, marketSnapshot, and evidence",
                )
            if not snapshot.get("observed_at") or not snapshot.get("mark_price"):
                raise HTTPException(
                    status_code=400,
                    detail="Case marketSnapshot requires observed_at and mark_price",
                )
            if not isinstance(payload.get("evidence", []), list):
                raise HTTPException(status_code=400, detail="Case evidence must be a list")
        return
    schemas = payload.get("schemas")
    prompts = payload.get("prompts")
    if not isinstance(schemas, dict) or not isinstance(prompts, dict) or not prompts:
        raise HTTPException(
            status_code=400, detail="Frozen prompt bundles require prompts and schemas",
        )
    required = {
        "signal_report": {"score", "confidence", "decision_summary"},
        "synthesis": {"consensus", "confidence", "decision_summary"},
    }
    for name, properties in required.items():
        schema = schemas.get(name, {})
        available = set(schema.get("properties", {}))
        if not properties.issubset(available):
            raise HTTPException(
                status_code=400,
                detail=f"{name} schema is incompatible with canonical scoring fields",
            )


def _reject_secrets(payload: dict) -> None:
    serialized = json.dumps(payload, default=str)
    if SECRET_PATTERN.search(serialized):
        raise HTTPException(status_code=400, detail="Evaluation assets cannot contain secrets")


def _sanitized_case(payload: dict) -> dict:
    return {
        **payload,
        "evidence": [{
            **item,
            "content": sanitize_untrusted_content(
                str(item.get("content", "")), settings.evidence_max_chars_per_item,
            ).text,
        } for item in payload.get("evidence", [])],
    }
