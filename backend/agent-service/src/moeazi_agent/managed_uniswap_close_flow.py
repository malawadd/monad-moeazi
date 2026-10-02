"""Trusted context, observation and settlement helpers for one managed exit."""
from __future__ import annotations

from datetime import datetime, timezone
import httpx
from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_pair_observation import build_arbitrum_managed_pair_snapshot
from .arbitrum_managed_vault_observation import build_managed_vault_snapshot
from .config import get_settings
from .finance_contracts import (
    FinanceError, FinanceScope, ReconcileCommand, native_int, semantic_request_hash,
)
from .finance_uniswap_quote import load_uniswap_quote
from .managed_uniswap_buy_api import _sidecar
from .managed_uniswap_exit_settlement import settle_confirmed_exit
from .managed_vault_buy_helpers import vault_sidecar


async def close_context(settings, assignment_id: str, subject: str) -> dict:
    base = settings.convex_worker_url.rstrip("/")
    if not base.endswith("/worker"):
        raise FinanceError("Convex worker URL is not a trusted close-context base")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(base[:-7] + "/native-finance-trade/close-context",
            json={"assignmentId": assignment_id, "subject": subject},
            headers={"Authorization": "Bearer "
                     + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("managed stopped-position context is unavailable")
    value = response.json()
    if (not isinstance(value, dict) or value.get("authority") != "reduce_only_close"
            or value.get("assignmentId") != assignment_id
            or value.get("customerSubject") != subject):
        raise FinanceError("managed close context does not bind authenticated owner")
    return value


async def active_exit_grant(context: dict) -> dict:
    response = await _sidecar("scoped-grant/read", {
        "grantId": context["executionGrantId"], "scope": "exit",
        "owner": context["ownerAddress"]})
    if not isinstance(response, dict) or response.get("consumed") is not False:
        raise FinanceError("managed exit grant is missing or consumed")
    grant = response.get("grant")
    review = grant.get("review") if isinstance(grant, dict) else None
    if (not isinstance(review, dict) or grant.get("grantId") != context["executionGrantId"]
            or grant.get("scope") != "exit" or grant.get("state") != "active"
            or grant.get("owner") != context["ownerAddress"]
            or grant.get("strategyAccountId") != context["strategyAccountId"]
            or grant.get("assignmentId") != context["assignmentId"]
            or grant.get("frozenPolicyHash") != context["frozenProgramPolicyHash"]
            or review.get("chainId") != 42161
            or review.get("tokenIn") != "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
            or review.get("tokenOut") != "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
            or review.get("feeTier") != 3000
            or review.get("recipient") != context["ownerAddress"]
            or review.get("maxCalls") != 1
            or review.get("callValueWei") != "0"):
        raise FinanceError("one-use exit grant differs from frozen owner pair")
    expiry = native_int(str(grant.get("expiresAt")), positive=True)
    if expiry <= int(datetime.now(timezone.utc).timestamp()):
        raise FinanceError("managed exit grant expired")
    return grant


async def observe_stopped_pair(finance, scope: FinanceScope, context: dict,
                               *, command_id: str):
    vault = context.get("vault")
    raw = (await vault_sidecar(get_settings(), "managed-vault-read", vault)
           if isinstance(vault, dict)
           else await _sidecar("account", {"owner": context["ownerAddress"]}))
    if not isinstance(raw, dict):
        raise FinanceError("finalized owner pair account is unavailable")
    if isinstance(vault, dict) and raw.get("stopped") is not True:
        raise FinanceError("Magic-owned vault has not finalized its on-chain stop")
    async with finance.engine.connect() as conn:
        account = (await conn.execute(text("""
          SELECT revision,source_account_id,policy_version,policy_hash,
            admission_state,observation_snapshot_hash FROM finance_accounts
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
        """), {"account": scope.strategy_account_id})).mappings().first()
    if (not account or account["admission_state"] != "stopped"
            or account["source_account_id"] != context["sourceAccountId"]):
        raise FinanceError("managed financial admission was not stopped")
    snapshot = (build_managed_vault_snapshot(raw, scope=scope,
        expected_vault=vault["vaultAddress"], expected_owner=context["ownerAddress"],
        expected_executor=vault["executorAddress"],
        expected_program_hash="0x" + vault["programHash"],
        expected_policy_hash="0x" + vault["policyHash"],
        expected_code_hash=vault["codeHash"], capital_units=vault["capitalUnits"],
        max_buy_units=vault["maxBuyUnits"], mandate_expires_at=vault["expiresAt"],
        policy_version=account["policy_version"],
        received_at=datetime.now(timezone.utc)) if isinstance(vault, dict)
        else build_arbitrum_managed_pair_snapshot(raw, scope=scope,
            expected_account=context["ownerAddress"],
            policy_version=account["policy_version"],
            received_at=datetime.now(timezone.utc)))
    await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
    if account["observation_snapshot_hash"] != snapshot.snapshot_hash:
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        provisional = ReconcileCommand.model_construct(scope=scope,
            expected_revision=int(account["revision"]), writer_epoch=epoch,
            idempotency_key="native-uniswap-exit-before:" + command_id
                + ":" + snapshot.snapshot_hash,
            request_hash="0" * 64, snapshot_hash=snapshot.snapshot_hash,
            policy_version=account["policy_version"],
            policy_hash=account["policy_hash"])
        command = ReconcileCommand.model_validate({**provisional.model_dump(mode="python"),
            "request_hash": semantic_request_hash("reconcile", provisional)})
        result = await finance.reconcile_account(command)
        if result["status"] != "clean":
            raise FinanceError("stopped pair account has unresolved native economics")
    return snapshot


async def stored_exit_quote(finance, binding: dict):
    async with finance.engine.connect() as conn:
        return await load_uniswap_quote(conn, binding["quote_hash"])


async def reconcile_exit(finance, *, scope: FinanceScope, binding: dict,
                         context: dict, sidecar=_sidecar) -> dict:
    if binding.get("vault_address"):
        from .managed_vault_exit_flow import reconcile_vault_exit
        return await reconcile_vault_exit(finance, get_settings(), scope, binding)
    outcome = await sidecar("scoped-reconcile", {
        "grantId": binding["grant_id"], "scope": "exit"})
    if not outcome:
        return {"status": "pending", "code": "EXIT_OPERATION_NOT_VISIBLE",
            "submittedOperationMayStillSettle": True}
    if (outcome.get("grantId") != binding["grant_id"]
            or outcome.get("scope") != "exit"
            or outcome.get("intentId") != binding["intent_id"]
            or outcome.get("idempotencyKey") != binding["command_id"]):
        raise FinanceError("sidecar exit operation differs from retained attempt")
    if outcome.get("state") != "confirmed":
        return {"status": "pending", "code": "EXIT_OPERATION_UNRESOLVED",
            "sidecarState": outcome.get("state"),
            "submittedOperationMayStillSettle": True}
    reservation = {
        "reservation_id": binding["reservation_id"],
        "attempt_id": binding["attempt_id"],
        "intent_id": binding["intent_id"],
        "client_id": binding["command_id"],
        "normalized_payload_hash": binding["normalized_payload_hash"],
        "snapshot_hash": binding["before_snapshot_hash"]
            if "before_snapshot_hash" in binding else None,
        "policy_version": binding["policy_version"]
            if "policy_version" in binding else None,
        "policy_hash": binding["policy_hash"]
            if "policy_hash" in binding else None,
    }
    if not all(reservation.values()):
        async with finance.engine.connect() as conn:
            hold = (await conn.execute(text("""
              SELECT snapshot_hash,policy_version,policy_hash FROM finance_reservations
              WHERE environment='live' AND scope_id='live'
                AND strategy_account_id=:account AND reservation_id=:reservation
            """), {"account": scope.strategy_account_id,
                   "reservation": binding["reservation_id"]})).mappings().first()
        if not hold:
            raise FinanceError("native exit hold disappeared")
        reservation.update(snapshot_hash=hold["snapshot_hash"],
            policy_version=hold["policy_version"], policy_hash=hold["policy_hash"])
    quote = await stored_exit_quote(finance, binding)
    try:
        proof = await settle_confirmed_exit(finance, scope=scope,
            reservation=reservation, quote=quote, operation=outcome,
            native={"ownerAddress": binding["owner_address"]}, sidecar=sidecar)
    except FinanceError:
        return {"status": "pending", "code": "EXIT_FINANCE_RECONCILIATION_PENDING",
            "submittedOperationMayStillSettle": True}
    return {"status": "confirmed_flat", "code": "EXIT_FINANCE_CONFIRMED_FLAT",
        "proof": proof, "operation": outcome,
        "submittedOperationMayStillSettle": False}
