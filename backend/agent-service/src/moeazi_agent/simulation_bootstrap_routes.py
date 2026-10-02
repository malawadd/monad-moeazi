"""Authenticated one-time bootstrap for isolated experiment financial accounts."""
from __future__ import annotations

import json
from hashlib import sha256

from fastapi import APIRouter, Header, HTTPException, Request

from .account_observation_storage import AccountObservationRepository, account_snapshot_hash
from .config import get_settings
from .convex import ConvexWorkerClient
from .finance_contracts import (
    FinanceError, ReconcileCommand, _digest, semantic_request_hash,
)
from .finance_routes import _subject
from .simulation_authority import require_simulation_identity
from .simulation_route_contracts import ExperimentAccountBootstrap


router = APIRouter(tags=["simulated trading lifecycle"])
_LABEL = {"environment": "experiment", "authority": "simulation_only",
          "executionQualified": False}


async def _identity(subject: str, experiment_spec_id: str):
    client = ConvexWorkerClient(get_settings())
    try:
        return await require_simulation_identity(client, subject, experiment_spec_id)
    except Exception as exc:
        raise HTTPException(status_code=403,
            detail="Current simulation identity is unavailable.") from exc
    finally:
        await client.client.aclose()


def _reconcile_command(body: ExperimentAccountBootstrap, writer_epoch: int,
                       expected_revision: int) -> ReconcileCommand:
    provisional = ReconcileCommand.model_construct(
        scope=body.snapshot.scope, expected_revision=expected_revision,
        writer_epoch=writer_epoch, idempotency_key=body.idempotency_key,
        request_hash="0" * 64, snapshot_hash=body.snapshot.snapshot_hash,
        policy_version=body.policy.policy_version, policy_hash=body.policy.policy_hash)
    request_hash = semantic_request_hash("reconcile", provisional)
    return ReconcileCommand.model_validate({**provisional.model_dump(),
                                            "request_hash": request_hash})


def _writer_id(scope, idempotency_key: str) -> str:
    identity = f"{scope.environment}:{scope.scope_id}:{scope.strategy_account_id}:{idempotency_key}"
    return "simulation-bootstrap-" + sha256(identity.encode()).hexdigest()[:32]


@router.post("/accounts/bootstrap")
async def bootstrap_experiment_account(
    body: dict,
    request: Request,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = _subject(authorization, x_moeazi_subject)
    try:
        body = ExperimentAccountBootstrap.model_validate_json(
            json.dumps(body, allow_nan=False))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422,
            detail="Invalid versioned experiment account bootstrap.") from exc

    snapshot, policy = body.snapshot, body.policy
    if snapshot.origin != "recorded_fixture" or \
            not snapshot.source_account_id.startswith("fixture:") or \
            snapshot.rights_ref != "internal_qualification_only" or \
            policy.approved_live is not False or \
            snapshot.policy_version != policy.policy_version:
        raise HTTPException(status_code=422,
            detail="Bootstrap requires a matching internal experiment fixture and policy.")
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
        raise HTTPException(status_code=422, detail="Account snapshot hash does not match its contents.")

    identity = await _identity(subject, body.experiment_spec_id)
    if identity.scope.environment != "experiment" or \
            identity.scope.scope_id != body.experiment_spec_id or snapshot.scope != identity.scope:
        raise HTTPException(status_code=403,
            detail="Account fixture differs from the owned experiment scope.")

    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        raise HTTPException(status_code=503, detail="Financial account bootstrap is unavailable.")
    try:
        epoch = await finance.acquire_writer_epoch(
            identity.scope, _writer_id(identity.scope, body.idempotency_key))
        before = await finance.read_account_risk_snapshot(identity.scope)
        duplicate = before.get("observationSnapshotHash") == snapshot.snapshot_hash
        await AccountObservationRepository(finance.engine).store_experiment_fixture(snapshot)
        await finance.register_policy(identity.scope, epoch, policy)
        reconcile = await finance.reconcile_account(
            _reconcile_command(body, epoch, int(before["accountRevision"])), bootstrap=True)
        if reconcile["status"] != "clean":
            raise HTTPException(status_code=409,
                detail="Experiment account fixture did not reconcile cleanly.")
        stop_hash = _digest("moeazi-finance-command-v1:set-stop", {
            "scope": identity.scope.model_dump(), "stopped": False})
        opened = await finance.set_account_stop(identity.scope, epoch,
            int(reconcile["revision"]), stopped=False,
            idempotency_key=f"{body.idempotency_key}:open", request_hash=stop_hash)
    except HTTPException:
        raise
    except FinanceError as exc:
        raise HTTPException(status_code=409,
            detail="Experiment account bootstrap conflicts with current financial state.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409,
            detail="Experiment account fixture conflicts with current financial state.") from exc
    except Exception as exc:
        raise HTTPException(status_code=503,
            detail="Experiment account bootstrap could not be completed.") from exc

    return {
        **_LABEL,
        "experimentSpecId": body.experiment_spec_id,
        "accountSnapshotHash": snapshot.snapshot_hash,
        "policyHash": policy.policy_hash,
        "revision": opened["revision"],
        "status": reconcile["status"],
        "duplicate": duplicate,
        "lineage": {
            "experimentRequestHash": identity.experiment_request_hash,
            "authorityFingerprint": identity.authority_fingerprint,
            "scopeId": identity.scope.scope_id,
            "strategyAccountId": identity.scope.strategy_account_id,
            "sourceAccountId": snapshot.source_account_id,
            "snapshotOrigin": snapshot.origin,
            "rightsRef": snapshot.rights_ref,
            "sourceEventHash": snapshot.source_event_hash,
            "sourcePayloadHash": snapshot.source_payload_hash,
            "registryHash": snapshot.registry_hash,
            "snapshotCutoffAt": snapshot.cutoff_at.isoformat(),
            "reconciliationRevision": reconcile["revision"],
            "openingRevision": opened["revision"],
            "policyVersion": policy.policy_version,
            "policyHash": policy.policy_hash,
        },
    }
