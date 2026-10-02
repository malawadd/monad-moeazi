"""Connect a confirmed Magic vault mandate to the existing live finance writer."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import logging
import re
import time

from fastapi import APIRouter, Header, HTTPException, Request

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_vault_observation import build_managed_vault_snapshot
from .config import get_settings
from .finance_contracts import FinanceError, FinanceScope, _digest
from .finance_native_activation_api import (
    _account_state, _activation_url, _block, _post_json, _reconcile_command,
    _registered_policy,
)
from .finance_native_vault_contracts import VaultActivationRequest, VaultFinanceContext
from .finance_observation_contracts import ARBITRUM_MANAGED_PAIR_COVERAGE
from .finance_routes import _subject
from .managed_vault_policy_auto import compile_managed_vault_policy
from .observation_storage import ObservationRepository


router = APIRouter(prefix="/v1/finance", tags=["native Magic vault finance"])
logger = logging.getLogger(__name__)


def _vault_url(worker_url: str, operation: str) -> str:
    old = _activation_url(worker_url, operation)
    return old.replace(f"/native-finance-activation/{operation}",
                       f"/native-vault-finance/{operation}")


@router.post("/managed-program/vault-activation-authority")
async def activate_managed_vault_finance(
    body: VaultActivationRequest, request: Request,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = _subject(authorization, x_moeazi_subject)
    settings = get_settings()
    secret = settings.worker_shared_secret.get_secret_value()
    try:
        raw_context = await _post_json(_vault_url(settings.convex_worker_url, "context"),
            {"mandateId": body.mandate_id}, secret, settings.routing_timeout_seconds)
        context = VaultFinanceContext.model_validate(raw_context)
        context.validate_identity(mandate_id=body.mandate_id, subject=subject)
    except Exception:
        _block("owned_funded_magic_vault_context_unavailable", status=503)
    if context.expires_at <= time.time_ns() // 1_000_000:
        _block("managed_vault_mandate_expired")
    try:
        read = await _post_json(settings.execution_sidecar_url.rstrip("/")
            + "/internal/uniswap/managed-vault-read", context.sidecar_expectation(),
            secret, settings.routing_timeout_seconds)
        if read.get("funded") is not True or read.get("stopped") is not False:
            raise ValueError("Vault is not funded and active")
    except Exception:
        _block("finalized_managed_vault_unavailable")
    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        _block("native_finance_writer_unavailable", status=503)
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=context.strategy_account_id)
    try:
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        before = await _account_state(finance, scope)
        if before["source_account_id"] not in {None, context.source_account_id}:
            _block("finance_source_account_mismatch")
        instrument, proposed_policy = compile_managed_vault_policy(context,
            maximum_auto_capital_units=settings.managed_vault_auto_policy_max_usdc_units)
        if before["admission_state"] == "open" and before["policy_version"] \
                and (before["policy_version"] != proposed_policy.policy_version
                     or before["policy_hash"] != proposed_policy.policy_hash):
            _block("existing_open_finance_policy_differs_from_magic_vault")
        await ObservationRepository(finance.engine).register_instrument(instrument)
        await finance.register_policy(scope, epoch, proposed_policy)
        policy = await _registered_policy(finance, scope,
            proposed_policy.policy_version, proposed_policy.policy_hash)
        if (int(policy.max_gross_notional_units) > int(context.max_buy_units)
                or int(policy.max_directional_notional_units) > int(context.capital_units)):
            _block("finance_policy_exceeds_magic_vault_mandate")
    except LookupError as error:
        _block(str(error))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Managed vault finance policy refresh failed")
        _block("managed_vault_finance_policy_unavailable", status=503)
    try:
        snapshot = build_managed_vault_snapshot(read, scope=scope,
            expected_vault=context.vault_address, expected_owner=context.owner_address,
            expected_executor=context.executor_address,
            expected_program_hash="0x" + context.program_hash,
            expected_policy_hash="0x" + context.policy_hash,
            expected_code_hash=context.vault_code_hash,
            capital_units=context.capital_units, max_buy_units=context.max_buy_units,
            mandate_expires_at=context.expires_at,
            policy_version=policy.policy_version, received_at=datetime.now(timezone.utc))
        await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
        digest = hashlib.sha256((context.mandate_id + ":" +
                                 snapshot.snapshot_hash).encode()).hexdigest()
        result = await finance.reconcile_account(_reconcile_command(scope,
            snapshot.snapshot_hash, policy, epoch, int(before["revision"]),
            "native-vault-reconcile:" + digest),
            bootstrap=before["source_account_id"] is None)
        if result.get("status") != "clean":
            _block("vault_finance_reconciliation_" + str(result.get("reason", "blocked")))
        current = await _account_state(finance, scope)
        if (current["source_account_id"] != snapshot.source_account_id
                or current["policy_version"] != policy.policy_version
                or current["policy_hash"] != policy.policy_hash
                or current["reconciliation_state"] != "clean"
                or current["observation_snapshot_hash"] != snapshot.snapshot_hash):
            _block("vault_finance_state_changed_during_activation")
        if current["admission_state"] == "open":
            opened = {"revision": int(current["revision"]), "state": "open",
                      "authorityEpoch": int(current["authority_epoch"])}
        elif current["admission_state"] == "stopped":
            stop_hash = _digest("moeazi-finance-command-v1:set-stop", {
                "scope": scope.model_dump(), "stopped": False})
            opened = await finance.set_account_stop(scope, epoch, int(current["revision"]),
                stopped=False, idempotency_key="native-vault-open:" + digest
                + ":" + str(current["revision"]), request_hash=stop_hash)
        else:
            _block("vault_finance_admission_state_unknown")
        if opened.get("state") != "open":
            _block("vault_finance_admission_not_open")
    except HTTPException:
        raise
    except (FinanceError, ValueError, TypeError):
        _block("managed_vault_snapshot_or_reconciliation_invalid")
    except Exception:
        _block("managed_vault_snapshot_or_reconciliation_unavailable", status=503)
    expires_at = min(context.expires_at, time.time_ns() // 1_000_000 + 15 * 60_000)
    if expires_at <= time.time_ns() // 1_000_000:
        _block("managed_vault_mandate_expired")
    receipt = {"mandateId": context.mandate_id,
        "strategyAccountId": context.strategy_account_id,
        "assignmentId": context.assignment_id,
        "programVersionId": context.program_version_id,
        "venueAccountId": context.venue_account_id,
        "ownerAddress": context.owner_address, "contentHash": context.program_hash,
        "financeSnapshotHash": snapshot.snapshot_hash,
        "accountRevision": str(opened["revision"]), "writerEpoch": str(epoch),
        "authorityEpoch": str(opened["authorityEpoch"]), "expiresAt": expires_at}
    try:
        proof = await _post_json(_vault_url(settings.convex_worker_url, "receipt"),
            receipt, secret, settings.routing_timeout_seconds)
        if (not isinstance(proof.get("receiptId"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", str(proof.get("receiptHash", "")))
                or proof.get("expiresAt") != expires_at):
            raise ValueError("Vault finance receipt result does not close")
    except Exception:
        try:
            stop_hash = _digest("moeazi-finance-command-v1:set-stop", {
                "scope": scope.model_dump(), "stopped": True})
            await finance.set_account_stop(scope, epoch, int(opened["revision"]),
                stopped=True, idempotency_key="native-vault-receipt-failed:" + digest,
                request_hash=stop_hash)
        except Exception:
            _block("vault_receipt_failed_and_finance_stop_unverified", status=503)
        _block("managed_vault_finance_receipt_unavailable", status=503)
    return {"status": "ready", "authority": "native_magic_vault_finance",
        "executionQualified": False, "ownerAddress": context.owner_address,
        "strategyAccountId": context.strategy_account_id,
        "assignmentId": context.assignment_id, "programVersionId": context.program_version_id,
        "mandateId": context.mandate_id, "venueAccountId": context.venue_account_id,
        "sourceAccountId": snapshot.source_account_id,
        "financeSnapshotHash": snapshot.snapshot_hash,
        "coverageScope": ARBITRUM_MANAGED_PAIR_COVERAGE,
        "accountRevision": str(opened["revision"]), "writerEpoch": str(epoch),
        "authorityEpoch": str(opened["authorityEpoch"]),
        "financePolicyVersion": policy.policy_version,
        "financePolicyHash": policy.policy_hash,
        "expiresAt": expires_at, "activationReceiptId": proof["receiptId"],
        "activationReceiptHash": proof["receiptHash"]}
