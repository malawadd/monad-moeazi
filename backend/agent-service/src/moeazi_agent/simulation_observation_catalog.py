"""Authenticated, bounded catalog of admitted native replay observations."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field
from sqlalchemy import text

from .finance_contracts import StrictFinanceModel
from .finance_routes import _subject, _viewer_scope


router = APIRouter(tags=["simulated trading lifecycle"])
_MAX_LIMIT = 100


class ObservationCatalogRequest(StrictFinanceModel):
    experiment_spec_id: str = Field(min_length=1, max_length=160)
    instrument_version_id: str | None = Field(default=None, min_length=1, max_length=256)
    limit: int = Field(default=50, ge=1, le=_MAX_LIMIT)


def _time(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Stored observation timestamp has no timezone")
    return value.isoformat()


async def _observations(engine, body: ObservationCatalogRequest) -> tuple[list[dict], bool]:
    async with engine.connect() as conn:
        result = await conn.execute(text("""
            SELECT observation_hash, instrument_version_id, source_kind,
                   source_rights_ref, observation_kind, event_at, available_at, received_at
            FROM observation_market_events
            WHERE source_kind = 'recorded_native'
              AND source_rights_ref = 'internal_qualification_only'
              AND (CAST(:instrument AS text) IS NULL
                   OR instrument_version_id = CAST(:instrument AS text))
            ORDER BY available_at ASC, event_at ASC, received_at ASC, observation_hash ASC
            LIMIT :row_limit
        """), {"instrument": body.instrument_version_id,
                "row_limit": body.limit + 1})
        rows = result.mappings().all()
    truncated = len(rows) > body.limit
    observations = [{
        "observationHash": row["observation_hash"],
        "instrumentVersionId": row["instrument_version_id"],
        "sourceKind": row["source_kind"],
        "sourceRightsRef": row["source_rights_ref"],
        "observationKind": row["observation_kind"],
        "eventAt": _time(row["event_at"]),
        "availableAt": _time(row["available_at"]),
        "receivedAt": _time(row["received_at"]),
    } for row in rows[:body.limit]]
    return observations, truncated


@router.post("/observations/catalog")
async def catalog_observations(
    body: ObservationCatalogRequest,
    request: Request,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = _subject(authorization, x_moeazi_subject)
    await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    finance = getattr(request.app.state, "finance", None)
    engine = getattr(finance, "engine", None)
    if engine is None:
        raise HTTPException(status_code=503, detail="Observation catalog is unavailable.")
    try:
        observations, truncated = await _observations(engine, body)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Observation catalog is unavailable.") from exc
    return {"environment": "experiment", "authority": "simulation_only",
            "executionQualified": False, "observations": observations,
            "truncated": truncated}
