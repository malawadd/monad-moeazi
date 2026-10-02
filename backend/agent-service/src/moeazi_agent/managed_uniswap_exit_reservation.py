"""Account-locked, reduce-only WETH reservation while new admission is stopped."""
from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_from_row, account_snapshot_hash
from .controller_contracts import ControllerRef
from .finance_contracts import (
    FinanceError, FinanceScope, ReserveCommand, _digest, db_native_int, native_int,
    semantic_request_hash,
)
from .finance_market_evidence import resolve_sizing_request
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_WETH_UNIT_ID,
    ARBITRUM_USDC_UNIT_ID,
)
from .finance_policy import SizingRequest, size_intent
from .finance_uniswap_quote import UniswapV3Quote, quote_evidence_hash


def exit_intent_id(scope: FinanceScope, assignment_id: str, command_id: str) -> str:
    return sha256(("moeazi-managed-uniswap-exit-v1:" + scope.strategy_account_id
                   + ":" + assignment_id + ":" + command_id).encode()).hexdigest()


def exit_authority_fingerprint(scope: FinanceScope, context: dict,
                               authority_epoch: int) -> str:
    return _digest("moeazi-managed-uniswap-exit-authority-v1", {
        "scope": scope.model_dump(), "assignmentId": context["assignmentId"],
        "programVersionId": context["programVersionId"],
        "customerSubject": context["customerSubject"],
        "ownerAddress": context["ownerAddress"],
        "executionGrantId": context["executionGrantId"],
        "authorityEpoch": authority_epoch})


async def reserve_stopped_weth_exit(finance, *, scope: FinanceScope, context: dict,
        quote: UniswapV3Quote, command_id: str, writer_epoch: int,
        expires_at: datetime) -> dict:
    """Hold the exact observed WETH wallet balance; no stopped-state buy bypass."""
    if (scope.environment != "live" or scope.scope_id != "live"
            or context.get("authority") != "reduce_only_close"
            or context.get("strategyAccountId") != scope.strategy_account_id
            or quote.token_in != "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
            or quote.token_out != "0xaf88d065e77c8cc2239327c5edb3a432268e5831"):
        raise FinanceError("exit is outside the stopped managed WETH/USDC scope")
    controller = ControllerRef.model_validate(context["controllerRef"])
    if (controller.environment != "live" or controller.controllerKind != "managed_program"
            or controller.controllerId != context["assignmentId"]
            or controller.controllerVersionId != context["programVersionId"]
            or controller.strategyAccountId != scope.strategy_account_id):
        raise FinanceError("managed exit controller differs from paused assignment")
    intent = exit_intent_id(scope, context["assignmentId"], command_id)
    claim_key = "native-uniswap-exit:" + context["assignmentId"] + ":" + command_id
    quote_hash = quote_evidence_hash(quote)
    request_hash = _digest("moeazi-finance-command-v1:managed-exit-reserve", {
        "scope": scope.model_dump(), "assignmentId": context["assignmentId"],
        "commandId": command_id, "grantId": context["executionGrantId"],
        "quoteHash": quote_hash, "expiresAt": expires_at.isoformat()})
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        prior = await finance._claim(conn, scope, "managed_exit_reserve",
                                     claim_key, request_hash)
        if prior:
            return {"reservationId": prior["result_id"],
                    "revision": prior["account_revision"], "intentId": intent,
                    "status": "reserved"}
        now = await finance._writer(conn, account, writer_epoch)
        view = await finance._read_state(conn, scope, account, now)
        expected_source = (f"arbitrum:42161:vault:{context['vault']['vaultAddress']}"
            if isinstance(context.get("vault"), dict)
            else "arbitrum:42161:wallet:" + context["ownerAddress"])
        if (account["admission_state"] != "stopped"
                or view["reconciliation_state"] != "clean"
                or account["source_account_id"] != context["sourceAccountId"]
                or context["sourceAccountId"] != expected_source
                or expires_at <= now):
            raise FinanceError("stopped managed account is not clean for reduction")
        policy = await finance._receipt_policy(conn, scope, account["policy_version"])
        if (not policy.approved_live or policy.policy_hash != account["policy_hash"]
                or (expires_at - now).total_seconds() > policy.max_reservation_seconds):
            raise FinanceError("managed exit policy or bounded hold changed")
        from .finance_live_authority import require_live_finance_authority
        await require_live_finance_authority(conn, scope, account, policy, now)
        snapshot_row = (await conn.execute(text("""
          SELECT * FROM observation_account_snapshots
          WHERE snapshot_hash=:hash AND environment='live' AND scope_id='live'
            AND strategy_account_id=:account
        """), {"hash": account["observation_snapshot_hash"],
               "account": scope.strategy_account_id})).mappings().first()
        if snapshot_row is None:
            raise FinanceError("exit lacks a current finalized pair snapshot")
        snapshot = account_snapshot_from_row(snapshot_row)
        if (account_snapshot_hash(snapshot) != snapshot.snapshot_hash
                or snapshot.coverage_scope != ARBITRUM_MANAGED_PAIR_COVERAGE):
            raise FinanceError("exit pair snapshot is not admitted")
        location = snapshot.source_account_id
        registrations = {(item.asset_unit_id, item.location_id, item.book): item.registry_hash
                         for item in snapshot.observed_balances}
        base_registry = registrations.get((ARBITRUM_WETH_UNIT_ID, location, "wallet"))
        quote_registry = registrations.get((ARBITRUM_USDC_UNIT_ID, location, "wallet"))
        if not base_registry or not quote_registry:
            raise FinanceError("exit pair asset registration is incomplete")
        balance = (await conn.execute(text("""
          SELECT units FROM finance_balances WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND asset_unit_id=:asset
            AND location_id=:location AND book='wallet'
        """), {"account": scope.strategy_account_id, "asset": ARBITRUM_WETH_UNIT_ID,
               "location": location})).mappings().first()
        weth = db_native_int(balance["units"]) if balance else 0
        if weth <= 0 or weth != native_int(quote.amount_in, positive=True):
            raise FinanceError("exit quote must consume the entire reconciled WETH wallet")
        unresolved = (await conn.execute(text("""
          SELECT 1 FROM finance_reservations WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND purpose='trade'
            AND status IN ('reserved','submitted','uncertain') LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        if unresolved:
            raise FinanceError("an unresolved trade must reconcile before exit")
        numerator, denominator = quote.quote_per_raw_base_unit
        request = SizingRequest(action="spot_sell",
            instrument_version_id=policy.instrument_version_id,
            desired_quantity_units=quote.amount_in,
            quantity_asset_unit_id=ARBITRUM_WETH_UNIT_ID,
            quantity_registry_hash=base_registry,
            quote_asset_unit_id=ARBITRUM_USDC_UNIT_ID,
            quote_registry_hash=quote_registry, location_id=location,
            quote_per_quantity_numerator=str(numerator),
            quote_per_quantity_denominator=str(denominator),
            price_snapshot_hash=quote_hash,
            account_snapshot_hash=snapshot.snapshot_hash,
            existing_gross_notional_units=quote.minimum_amount_out,
            existing_directional_notional_units=quote.minimum_amount_out)
        authoritative = await resolve_sizing_request(conn, scope, account, policy, request)
        receipt = size_intent(policy, authoritative, int(account["revision"]))
        if (receipt.quantity_units != quote.amount_in
                or receipt.notional_units != quote.minimum_amount_out):
            raise FinanceError("policy cannot reserve the complete native WETH exit")
        await finance._store_receipt(conn, scope, account, policy,
            receipt.model_dump(mode="json"), receipt.receipt_hash)
        fingerprint = exit_authority_fingerprint(scope, context,
            int(account["authority_epoch"]))
        provisional = ReserveCommand.model_construct(scope=scope,
            controller_ref=controller, controller_mode="autopilot",
            expected_revision=int(account["revision"]), writer_epoch=writer_epoch,
            authority_epoch=int(account["authority_epoch"]),
            authority_fingerprint=fingerprint, idempotency_key=claim_key,
            request_hash="0" * 64, intent_id=intent, purpose="trade",
            policy_version=policy.policy_version, policy_hash=policy.policy_hash,
            snapshot_hash=snapshot.snapshot_hash,
            calculation_receipt_hash=receipt.receipt_hash,
            components=receipt.components, expires_at=expires_at)
        command = ReserveCommand.model_validate({**provisional.model_dump(mode="python"),
            "request_hash": semantic_request_hash("reserve", provisional)})
        await finance._capacity_check(conn, scope, command.components)
        reservation_id = sha256(("finance-reservation-v1:live:live:"
            + scope.strategy_account_id + ":" + claim_key).encode()).hexdigest()
        revision = int(account["revision"]) + 1
        await conn.execute(text("""
          INSERT INTO finance_reservations(environment,scope_id,strategy_account_id,
            reservation_id,idempotency_key,request_hash,intent_id,purpose,controller_ref,
            controller_mode,snapshot_hash,policy_version,policy_hash,writer_epoch,
            authority_epoch,authority_fingerprint,calculation_receipt_hash,
            admitted_revision,status,expires_at)
          VALUES('live','live',:account,:reservation,:key,:request,:intent,'trade',
            CAST(:controller AS jsonb),'autopilot',:snapshot,:policy,:policy_hash,
            :writer,:authority,:fingerprint,:receipt,:revision,'reserved',:expires)
        """), {"account": scope.strategy_account_id, "reservation": reservation_id,
               "key": claim_key, "request": command.request_hash,
               "intent": intent, "controller": json.dumps(controller.model_dump(mode="json")),
               "snapshot": snapshot.snapshot_hash, "policy": policy.policy_version,
               "policy_hash": policy.policy_hash, "writer": writer_epoch,
               "authority": account["authority_epoch"], "fingerprint": fingerprint,
               "receipt": receipt.receipt_hash, "revision": revision,
               "expires": expires_at})
        for ordinal, component in enumerate(command.components, 1):
            await conn.execute(text("""
              INSERT INTO finance_reservation_components(environment,scope_id,
                strategy_account_id,reservation_id,ordinal,capacity_key,asset_unit_id,
                registry_hash,location_id,units)
              VALUES('live','live',:account,:reservation,:ordinal,:key,:asset,
                :registry,:location,:units)
            """), {"account": scope.strategy_account_id,
                   "reservation": reservation_id, "ordinal": ordinal,
                   "key": component.capacity_key, "asset": component.asset_unit_id,
                   "registry": component.registry_hash,
                   "location": component.location_id, "units": component.units})
        updated = await finance._advance(conn, scope, writer_epoch, account)
        await finance._insert_claim(conn, scope, "managed_exit_reserve",
            claim_key, request_hash, reservation_id, revision)
        await finance._outbox(conn, scope, updated)
        return {"reservationId": reservation_id, "revision": revision,
                "intentId": intent, "status": "reserved"}
