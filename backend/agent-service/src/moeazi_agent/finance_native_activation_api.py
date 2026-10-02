"""Native managed-program finance bootstrap for the exact Arbitrum USDC/WETH pair."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import re
import time
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_pair_observation import build_arbitrum_managed_pair_snapshot
from .config import get_settings
from .finance_contracts import FinanceError, FinanceScope, ReconcileCommand, _digest, semantic_request_hash
from .finance_observation_contracts import ARBITRUM_MANAGED_PAIR_COVERAGE
from .finance_policy import SizingPolicy
from .finance_routes import _subject
from .finance_native_activation_contracts import (
    ActivationContext, ActivationRequest, exact_pair_policy, normal_address, validate_grant,
)


router = APIRouter(prefix="/v1/finance", tags=["native finance activation"])


def _activation_url(worker_url: str, operation: str) -> str:
    parts = urlsplit(worker_url)
    if parts.scheme not in {"http", "https"} or not parts.netloc or parts.query or parts.fragment \
            or not parts.path.rstrip("/").endswith("/worker"):
        raise ValueError("Convex worker URL must end in /worker")
    path = parts.path.rstrip("/")[:-len("/worker")] + f"/native-finance-activation/{operation}"
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


async def _post_json(url: str, payload: dict, secret: str, timeout: float) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload,
            headers={"Authorization": f"Bearer {secret}"})
    if not response.is_success:
        raise RuntimeError("trusted observation or activation service rejected the request")
    result = response.json()
    if not isinstance(result, dict):
        raise ValueError("trusted service response must be an object")
    return result


async def _registered_policy(finance, scope: FinanceScope, preferred_version: str | None,
                             preferred_hash: str | None) -> SizingPolicy:
    query = text("""
      SELECT p.policy_version,p.policy_hash,p.policy_json,p.approved_live,
             i.manifest,i.registry_hash AS instrument_registry_hash
      FROM finance_policy_versions p JOIN observation_instrument_versions i
        ON i.instrument_version_id=p.policy_json->>'instrument_version_id'
      WHERE p.environment=:environment AND p.scope_id=:scope_id
        AND p.strategy_account_id=:strategy_account_id AND p.approved_live IS TRUE
        AND i.venue_id='uniswap'
    """)
    async with finance.engine.connect() as conn:
        rows = (await conn.execute(query, scope.model_dump())).mappings().all()
    candidates = []
    for row in rows:
        try:
            policy = SizingPolicy.model_validate(row["policy_json"])
        except (ValueError, TypeError):
            continue
        if policy.policy_version != row["policy_version"] or policy.policy_hash != row["policy_hash"] \
                or row["approved_live"] is not True:
            continue
        if exact_pair_policy(policy, row["manifest"], row["instrument_registry_hash"]):
            candidates.append(policy)
    if preferred_version:
        candidates = [item for item in candidates if item.policy_version == preferred_version]
        candidates = [item for item in candidates
                      if preferred_hash is None or item.policy_hash == preferred_hash]
    if not candidates:
        raise LookupError("approved_live_finance_policy_missing")
    if len(candidates) != 1:
        raise LookupError("approved_live_finance_policy_ambiguous")
    return candidates[0]


async def _account_state(finance, scope: FinanceScope) -> dict:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT revision,source_account_id,policy_version,policy_hash,admission_state,
                 reconciliation_state,observation_snapshot_hash,authority_epoch
          FROM finance_accounts WHERE environment=:environment AND scope_id=:scope_id
            AND strategy_account_id=:strategy_account_id
        """), scope.model_dump())).mappings().first()
    if row is None:
        raise FinanceError("financial account registration disappeared")
    return dict(row)


def _reconcile_command(scope: FinanceScope, snapshot_hash: str, policy: SizingPolicy,
                       epoch: int, revision: int, key: str) -> ReconcileCommand:
    provisional = ReconcileCommand.model_construct(scope=scope, expected_revision=revision,
        writer_epoch=epoch, idempotency_key=key, request_hash="0" * 64,
        snapshot_hash=snapshot_hash, policy_version=policy.policy_version,
        policy_hash=policy.policy_hash)
    return ReconcileCommand.model_validate({**provisional.model_dump(),
        "request_hash": semantic_request_hash("reconcile", provisional)})


def _block(reason: str, *, status: int = 409):
    raise HTTPException(status_code=status, detail={"status": "blocked", "reason": reason,
        "authority": "none", "executionQualified": False})


@router.post("/managed-program/activation-authority")
async def activate_managed_program_finance(
    body: ActivationRequest,
    request: Request,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = _subject(authorization, x_moeazi_subject)
    settings = get_settings()
    secret = settings.worker_shared_secret.get_secret_value()
    try:
        context_url = _activation_url(settings.convex_worker_url, "context")
    except ValueError:
        _block("native_finance_activation_url_invalid", status=503)
    try:
        raw_context = await _post_json(context_url,
            {"assignmentId": body.assignment_id, "executionGrantId": body.execution_grant_id},
            secret, settings.routing_timeout_seconds)
        context = ActivationContext.model_validate(raw_context)
    except Exception:
        _block("managed_program_activation_context_unavailable", status=503)
    try:
        owner = normal_address(context.owner_address)
        if context.customer_subject != subject or context.owner_address != owner \
                or context.source_account_id != f"arbitrum:42161:wallet:{owner}" \
                or context.assignment_id != body.assignment_id \
                or context.execution_grant_id != body.execution_grant_id \
                or context.venue != "uniswap" or context.financial_authority != "identity_only":
            raise ValueError("activation context identity differs from request")
        sidecar = settings.execution_sidecar_url.rstrip("/") + "/internal/uniswap/"
        account_task = _post_json(sidecar + "account", {"owner": owner}, secret,
                                  settings.routing_timeout_seconds)
        buy_task = _post_json(sidecar + "scoped-grant/read", {"grantId": body.execution_grant_id,
            "scope": "buy", "owner": owner}, secret, settings.routing_timeout_seconds)
        exit_task = _post_json(sidecar + "scoped-grant/read", {"grantId": body.execution_grant_id,
            "scope": "exit", "owner": owner}, secret, settings.routing_timeout_seconds)
        account_read, buy_read, exit_read = await asyncio.gather(account_task, buy_task, exit_task)
        if account_read.get("accountMode") != "kernel-7702":
            raise ValueError("finalized owner is not delegated to the scoped Kernel")
        buy_hash, buy_expiry = validate_grant(buy_read, scope="buy", grant_id=body.execution_grant_id,
                                              owner=owner, context=context)
        exit_hash, exit_expiry = validate_grant(exit_read, scope="exit", grant_id=body.execution_grant_id,
                                                owner=owner, context=context)
        if buy_hash != exit_hash or buy_expiry != exit_expiry:
            raise ValueError("buy and exit grants do not share one frozen policy and expiry")
    except Exception:
        _block("scoped_uniswap_grant_or_owner_evidence_invalid")

    now_ms = time.time_ns() // 1_000_000
    expires_at = min(buy_expiry * 1000, context.authority_expires_at, now_ms + 15 * 60_000)
    if expires_at <= now_ms:
        _block("managed_program_or_grant_authority_expired")

    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        _block("native_finance_writer_unavailable", status=503)
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=context.strategy_account_id)
    writer_id = "native-uniswap-activation-v1"
    try:
        epoch = await finance.acquire_writer_epoch(scope, writer_id)
        before = await _account_state(finance, scope)
        if before["source_account_id"] not in {None, f"arbitrum:42161:wallet:{owner}"}:
            _block("finance_source_account_mismatch")
        policy = await _registered_policy(finance, scope, before["policy_version"],
                                          before["policy_hash"])
    except LookupError as exc:
        _block(str(exc))
    except HTTPException:
        raise
    except Exception:
        _block("native_finance_policy_or_account_unavailable", status=503)

    now = datetime.now(timezone.utc)
    try:
        snapshot = build_arbitrum_managed_pair_snapshot(account_read, scope=scope,
            expected_account=owner, policy_version=policy.policy_version, received_at=now)
        await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
        digest = hashlib.sha256((f"{context.assignment_id}:{body.execution_grant_id}:"
                                 f"{snapshot.snapshot_hash}").encode()).hexdigest()
        reconcile_key = "native-uniswap-reconcile:" + digest
        result = await finance.reconcile_account(_reconcile_command(scope, snapshot.snapshot_hash,
            policy, epoch, int(before["revision"]), reconcile_key),
            bootstrap=before["source_account_id"] is None)
        if result.get("status") != "clean":
            _block("finance_account_reconciliation_" + str(result.get("reason", "blocked")))
        current = await _account_state(finance, scope)
        if current["source_account_id"] != snapshot.source_account_id \
                or current["policy_version"] != policy.policy_version \
                or current["policy_hash"] != policy.policy_hash \
                or current["reconciliation_state"] != "clean" \
                or current["observation_snapshot_hash"] != snapshot.snapshot_hash:
            _block("finance_account_state_changed_during_activation")
        if current["admission_state"] == "open":
            opened = {"revision": int(current["revision"]), "state": "open",
                      "authorityEpoch": int(current["authority_epoch"])}
        elif current["admission_state"] == "stopped":
            stop_hash = _digest("moeazi-finance-command-v1:set-stop", {
                "scope": scope.model_dump(), "stopped": False})
            opened = await finance.set_account_stop(scope, epoch, int(current["revision"]),
                stopped=False,
                idempotency_key="native-uniswap-open:" + digest + ":" + str(current["revision"]),
                request_hash=stop_hash)
        else:
            _block("finance_account_admission_state_unknown")
        if opened.get("state") != "open":
            _block("finance_account_admission_not_open")
    except HTTPException:
        raise
    except (FinanceError, ValueError, TypeError):
        _block("native_finance_snapshot_or_reconciliation_invalid")
    except Exception:
        _block("native_finance_snapshot_or_reconciliation_unavailable", status=503)

    if expires_at <= time.time_ns() // 1_000_000:
        try:
            stop_hash = _digest("moeazi-finance-command-v1:set-stop", {
                "scope": scope.model_dump(), "stopped": True})
            await finance.set_account_stop(scope, epoch, int(opened["revision"]), stopped=True,
                idempotency_key="native-uniswap-expired:" + digest,
                request_hash=stop_hash)
        except Exception:
            _block("activation_expired_and_finance_stop_unverified", status=503)
        _block("managed_program_or_grant_authority_expired")
    receipt = {"strategyAccountId": context.strategy_account_id,
        "assignmentId": context.assignment_id, "programVersionId": context.program_version_id,
        "venueAccountId": context.venue_account_id, "venue": "uniswap",
        "ownerAddress": owner, "contentHash": context.content_hash,
        "financeSnapshotHash": snapshot.snapshot_hash, "accountRevision": str(opened["revision"]),
        "writerEpoch": str(epoch), "authorityEpoch": str(opened["authorityEpoch"]),
        "executionGrantId": body.execution_grant_id, "executionGrantHash": buy_hash,
        "expiresAt": expires_at}
    try:
        receipt_url = _activation_url(settings.convex_worker_url, "receipt")
        proof = await _post_json(receipt_url, receipt, secret, settings.routing_timeout_seconds)
        proof_hash = proof.get("receiptHash")
        if not isinstance(proof.get("receiptId"), str) or not proof["receiptId"] \
                or not isinstance(proof_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", proof_hash) \
                or proof.get("expiresAt") != expires_at:
            raise ValueError("Convex receipt result did not close over the requested authority")
    except Exception:
        try:
            stop_hash = _digest("moeazi-finance-command-v1:set-stop", {
                "scope": scope.model_dump(), "stopped": True})
            await finance.set_account_stop(scope, epoch, int(opened["revision"]), stopped=True,
                idempotency_key="native-uniswap-receipt-failed:" + digest,
                request_hash=stop_hash)
        except Exception:
            _block("activation_receipt_failed_and_finance_stop_unverified", status=503)
        _block("activation_receipt_not_published", status=503)
    return {"status": "ready", "authority": "native_finance_pair_bootstrap",
        "executionQualified": False, "ownerAddress": owner,
        "strategyAccountId": context.strategy_account_id, "assignmentId": context.assignment_id,
        "programVersionId": context.program_version_id, "contentHash": context.content_hash,
        "venue": "uniswap", "venueAccountId": context.venue_account_id,
        "sourceAccountId": snapshot.source_account_id,
        "financeSnapshotHash": snapshot.snapshot_hash,
        "coverageScope": ARBITRUM_MANAGED_PAIR_COVERAGE,
        "accountRevision": str(opened["revision"]), "writerEpoch": str(epoch),
        "authorityEpoch": str(opened["authorityEpoch"]), "financePolicyVersion": policy.policy_version,
        "financePolicyHash": policy.policy_hash, "executionGrantId": body.execution_grant_id,
        "executionGrantHash": buy_hash, "expiresAt": expires_at,
        "activationReceiptId": proof["receiptId"], "activationReceiptHash": proof_hash}
