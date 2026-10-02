"""Authenticated non-live lifecycle endpoints on Moeazi's existing backend."""
from __future__ import annotations

import json
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request

from .config import get_settings
from .convex import ConvexWorkerClient
from .finance_contracts import FinanceError
from .finance_routes import _subject, _viewer_scope
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_state import RunAdvanceResult
from .simulation_authority import require_simulation_identity
from .simulation_dispatch import ensure_simulation_supervisor
from .simulation_order_reads import read_prepared_orders
from .simulation_outcome_reads import read_simulation_outcome
from .simulation_portfolio_reads import read_simulation_portfolio
from .simulation_bootstrap_routes import router as account_bootstrap_router
from .simulation_observation_catalog import router as observation_catalog_router
from .simulation_run_prepare import router as run_prepare_router
from .simulation_route_contracts import (
    ApprovalRevocation, DatasetRegistration, EntryRequest, OrderReview,
    PortfolioReview, RunApproval, RunControl, RunLookup, RunRegistration,
)
from .simulation_runtime_config import simulation_workflow_id


router = APIRouter(prefix="/v1/simulation", tags=["simulated trading lifecycle"])
_API_WORKER = f"simulation-api-{uuid4()}"
_LABEL = {"environment": "experiment", "authority": "simulation_only", "executionQualified": False}


def _repository(request: Request):
    repository = getattr(request.app.state, "simulation", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="Simulation lifecycle is unavailable.")
    return repository


def _state_payload(state: RunAdvanceResult, run_id: str) -> dict:
    if not isinstance(state, RunAdvanceResult) or state.run_id != run_id:
        raise HTTPException(status_code=503, detail="Simulation state could not be verified.")
    return state.model_dump(mode="json")


async def _registered_identity(subject: str, manifest: SimulationRunManifest):
    client = ConvexWorkerClient(get_settings())
    try:
        identity = await require_simulation_identity(client, subject, manifest.scope.scope_id)
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Current simulation identity is unavailable.") from exc
    finally:
        await client.client.aclose()
    if manifest.scope != identity.scope or manifest.controller_ref != identity.controller_ref \
            or (identity.dataset_hash is not None and identity.dataset_hash != manifest.scenario.dataset_hash):
        raise HTTPException(status_code=403, detail="Simulation manifest differs from its owned experiment.")
    return identity


async def _wake(request: Request, scope, run_id: str, manifest_hash: str) -> dict:
    """SQL registration/control survives an unavailable or ambiguous Temporal call."""
    try:
        receipt = await ensure_simulation_supervisor(request.app.state.temporal,
                                                     scope, run_id, manifest_hash)
        handle = request.app.state.temporal.get_workflow_handle(simulation_workflow_id(scope, run_id))
        await handle.signal("wake")
        return {"status": "requested", "workflowId": receipt["workflow_id"]}
    except Exception:
        return {"status": "retry_required", "reason": "supervisor_dispatch_unconfirmed"}


@router.post("/runs")
async def register_run(body: dict, request: Request,
                       authorization: str | None = Header(default=None),
                       x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    # FastAPI supplies a Python dict; strict financial DTOs must use JSON-mode
    # validation for timestamp strings/arrays without permitting scalar coercion.
    try:
        body = RunRegistration.model_validate_json(json.dumps(body, allow_nan=False))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid versioned simulation manifest.") from exc
    repository = _repository(request)
    identity = await _registered_identity(subject, body.manifest)
    try:
        state = await repository.register_run(body.manifest, created_by_subject=subject,
            experiment_request_hash=identity.experiment_request_hash,
            authority_fingerprint=identity.authority_fingerprint,
            expected_revision=body.expected_revision, idempotency_key=body.idempotency_key)
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail="Simulation registration conflicts with current state.") from exc
    state_payload = _state_payload(state, body.manifest.run_id)
    dispatch = await _wake(request, identity.scope, body.manifest.run_id, body.manifest.manifest_hash)
    return {**_LABEL, "registration": "persisted", "state": state_payload,
            "supervisor": dispatch}


@router.post("/runs/read")
async def read_run(body: RunLookup, request: Request,
                   authorization: str | None = Header(default=None),
                   x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        state = await _repository(request).read_run(scope, body.run_id, body.manifest_hash)
        lineage = await _repository(request).read_run_lineage(scope, body.run_id,
            body.manifest_hash, subject)
    except FinanceError as exc:
        raise HTTPException(status_code=404, detail="Owned simulation run is unavailable.") from exc
    return {**_LABEL, "state": _state_payload(state, body.run_id), "lineage": lineage}


@router.post("/runs/control")
async def control_run(body: RunControl, request: Request,
                      authorization: str | None = Header(default=None),
                      x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        outcome = await _repository(request).apply_control(scope, body.run_id, body.manifest_hash,
            body.control, worker_id=_API_WORKER, command_id=body.control.command_id,
            requested_by_subject=subject)
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail="Simulation control conflicts with current state.") from exc
    # Persist the latch before a Temporal signal; an unavailable supervisor cannot
    # leave a merely queued stop that still allows SQL admission of new entries.
    dispatch = await _wake(request, scope, body.run_id, body.manifest_hash)
    return {**_LABEL, "control": outcome, "supervisor": dispatch}


@router.post("/runs/wake")
async def wake_run(body: RunLookup, request: Request,
                   authorization: str | None = Header(default=None),
                   x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        await _repository(request).read_run(scope, body.run_id, body.manifest_hash)
    except FinanceError as exc:
        raise HTTPException(status_code=404, detail="Owned simulation run is unavailable.") from exc
    return {**_LABEL, "supervisor": await _wake(request, scope, body.run_id, body.manifest_hash)}


@router.post("/runs/approve")
async def approve_run_order(body: dict, request: Request,
                            authorization: str | None = Header(default=None),
                            x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    try:
        body = RunApproval.model_validate_json(json.dumps(body, allow_nan=False))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid simulation approval.") from exc
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        receipt = await _repository(request).record_simulation_approval(
            scope, body.run_id, body.manifest_hash, body.intent_id,
            body.normalized_payload_hash, subject, body.expires_at, body.command_id)
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail="Approval conflicts with the prepared simulation order.") from exc
    return {**_LABEL, "approval": receipt,
            "supervisor": await _wake(request, scope, body.run_id, body.manifest_hash)}


@router.post("/runs/revoke-approval")
async def revoke_run_approval(body: ApprovalRevocation, request: Request,
                              authorization: str | None = Header(default=None),
                              x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        receipt = await _repository(request).revoke_simulation_approval(
            scope, body.run_id, body.manifest_hash, body.approval_hash, subject)
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail="Owned simulation approval is unavailable.") from exc
    # Revocation persists before dispatch and remains available after entry stop.
    return {**_LABEL, "approval": receipt,
            "supervisor": await _wake(request, scope, body.run_id, body.manifest_hash)}


@router.post("/runs/request-entry")
async def request_run_entry(body: dict, request: Request,
                            authorization: str | None = Header(default=None),
                            x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    try:
        body = EntryRequest.model_validate_json(json.dumps(body, allow_nan=False))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid simulation strategy request.") from exc
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        receipt = await _repository(request).queue_entry_request(
            scope, body.run_id, body.manifest_hash, body.rule, subject, body.request_id)
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail="Strategy request conflicts with its simulation run.") from exc
    # This stores intent to research/trade in simulation. Only the isolated worker
    # may calculate sizing, reserve financial capacity or prepare an order.
    return {**_LABEL, "entryRequest": receipt, "nonAuthorizing": True,
            "supervisor": await _wake(request, scope, body.run_id, body.manifest_hash)}


@router.post("/runs/prepared-orders")
async def review_run_orders(body: OrderReview, request: Request,
                            authorization: str | None = Header(default=None),
                            x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        review = await read_prepared_orders(_repository(request), scope, body.run_id,
                                           body.manifest_hash, subject, body.after_ordinal)
    except FinanceError as exc:
        raise HTTPException(status_code=404, detail="Owned simulation order review is unavailable.") from exc
    return {**_LABEL, "review": review}


@router.post("/runs/dataset")
async def register_run_dataset(body: dict, request: Request,
                               authorization: str | None = Header(default=None),
                               x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    try:
        body = DatasetRegistration.model_validate_json(json.dumps(body, allow_nan=False))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid stored simulation dataset request.") from exc
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        receipt = await _repository(request).register_run_dataset(
            scope, body.run_id, body.manifest_hash, body.observation_hashes, subject)
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail="Dataset conflicts with its owned simulation run.") from exc
    return {**_LABEL, "dataset": receipt,
            "supervisor": await _wake(request, scope, body.run_id, body.manifest_hash)}


@router.post("/runs/portfolio")
async def review_run_portfolio(body: PortfolioReview, request: Request,
                               authorization: str | None = Header(default=None),
                               x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        result = await read_simulation_portfolio(_repository(request), scope,
            body.run_id, body.manifest_hash, subject,
            after_instrument=body.after_instrument, after_location=body.after_location)
    except (FinanceError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Owned simulation portfolio is unavailable.") from exc
    return {**_LABEL, "portfolio": result}


@router.post("/runs/outcome")
async def review_run_outcome(body: RunLookup, request: Request,
                             authorization: str | None = Header(default=None),
                             x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "experiment", body.experiment_spec_id)
    try:
        outcome = await read_simulation_outcome(_repository(request), scope,
            body.run_id, body.manifest_hash, subject)
    except FinanceError as exc:
        raise HTTPException(status_code=409,
            detail="A verified completed outcome is unavailable for this run.") from exc
    return {**_LABEL, "outcome": outcome}


router.include_router(account_bootstrap_router)
router.include_router(observation_catalog_router)
router.include_router(run_prepare_router)
