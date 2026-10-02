"""One finance-reserved, executor-signed sell from a stopped Magic vault."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import re

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, native_int
from .finance_native_activation_api import _registered_policy
from .finance_observation_contracts import ARBITRUM_WETH_UNIT_ID
from .finance_uniswap_quote import (
    UniswapQuoteEvidenceRepository, UniswapV3Quote, quote_evidence_hash,
    load_uniswap_quote,
)
from .managed_uniswap_buy_api import _sidecar
from .managed_uniswap_close_flow import observe_stopped_pair
from .managed_uniswap_exit_reservation import reserve_stopped_weth_exit
from .managed_uniswap_exit_submission import (
    load_exit_binding, mark_exit_submission_started,
)
from .managed_vault_buy_helpers import vault_from_binding, vault_sidecar
from .managed_vault_exit_settlement import settle_confirmed_vault_exit


HASH = re.compile(r"^[0-9a-f]{64}$")


def _sell_input(vault: dict, order_id: str, quote, deadline: int) -> dict:
    return {**{key: vault[key] for key in ("vaultAddress", "ownerAddress",
        "executorAddress", "codeHash", "programHash", "policyHash",
        "capitalUnits", "maxBuyUnits", "expiresAt")},
        "orderId": order_id, "amountIn": quote.amount_in,
        "amountOutMinimum": quote.minimum_amount_out,
        "deadline": deadline}


async def reconcile_vault_exit(finance, settings, scope: FinanceScope,
                               binding: dict) -> dict:
    native = vault_from_binding(binding)
    vault = {**native, "expiresAt": native["mandateExpiresAt"]}
    async with finance.engine.connect() as conn:
        hold = (await conn.execute(text("""
          SELECT * FROM finance_reservations WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id,
            "reservation": binding["reservation_id"]})).mappings().first()
        quote = await load_uniswap_quote(conn, binding["quote_hash"])
    if not hold or quote.amount_in != str(binding["amount_in"]) \
            or quote.minimum_amount_out != str(binding["amount_out_minimum"]):
        raise FinanceError("retained vault exit quote or reservation differs")
    reservation = {**dict(hold), "attempt_id": binding["attempt_id"],
        "client_id": binding["command_id"],
        "normalized_payload_hash": binding["normalized_payload_hash"]}
    observed = await vault_sidecar(settings, "managed-vault-observe-sell",
        {**_sell_input(vault, native["orderId"], quote,
                      int(binding["deadline"])),
         "fromBlock": native["fromBlock"]}, private=True)
    if observed.get("orderId") != native["orderId"]:
        raise FinanceError("observed vault sell differs from immutable exit attempt")
    if observed.get("status") == "pending":
        return {"status": "pending", "code": "VAULT_EXIT_AWAITING_FINALITY",
            "submittedOperationMayStillSettle": True}
    if observed.get("status") != "confirmed":
        raise FinanceError("vault sell observation returned unknown state")
    proof = await settle_confirmed_vault_exit(finance, settings,
        scope=scope, reservation=reservation, quote=quote,
        operation=observed, native=vault)
    operation = {"confirmedBlockNumber": observed["blockNumber"],
        "confirmedBlockHash": observed["blockHash"],
        "actualInputUnits": observed["actualInputUnits"],
        "actualOutputUnits": observed["actualOutputUnits"],
        "transactionHash": observed["transactionHash"]}
    return {"status": "confirmed_flat", "code": "VAULT_EXIT_FINANCE_CONFIRMED_FLAT",
        "proof": proof, "operation": operation,
        "submittedOperationMayStillSettle": False}


async def execute_vault_exit(finance, settings, *, scope: FinanceScope,
        context: dict, subject: str, command_id: str) -> dict:
    vault = context.get("vault")
    if (not isinstance(vault, dict)
            or context.get("executionGrantId") != "vault-" + vault.get("mandateId", "")
            or context.get("customerSubject") != subject
            or context.get("sourceAccountId") !=
                f"arbitrum:42161:vault:{vault.get('vaultAddress')}"):
        raise FinanceError("stopped Magic vault close identity is unavailable")
    snapshot = await observe_stopped_pair(finance, scope, context,
                                           command_id=command_id)
    weth_rows = [row for row in snapshot.observed_balances
        if row.asset_unit_id == ARBITRUM_WETH_UNIT_ID
        and row.location_id == snapshot.source_account_id
        and row.book == "wallet"]
    if len(weth_rows) != 1:
        raise FinanceError("finalized vault WETH exposure is unavailable")
    amount_in = native_int(weth_rows[0].units, nonnegative=True)
    if amount_in == 0:
        from .managed_uniswap_close_api import _result_for_observed_flat
        return await _result_for_observed_flat(finance, settings, scope,
            context, snapshot)
    raw_quote = await _sidecar("scoped-quote", {"scope": "exit",
        "amountIn": str(amount_in),
        "slippageBps": context["maxSlippageBps"]})
    quote = UniswapV3Quote.model_validate(raw_quote)
    if quote.amount_in != str(amount_in):
        raise FinanceError("vault exit quote differs from finalized WETH balance")
    await UniswapQuoteEvidenceRepository(finance.engine).store_sidecar_quote(
        raw_quote, received_at=datetime.now(timezone.utc))
    async with finance.engine.connect() as conn:
        account = (await conn.execute(text("""
          SELECT revision,policy_version,policy_hash FROM finance_accounts
          WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account
        """), {"account": scope.strategy_account_id})).mappings().first()
    if not account:
        raise FinanceError("Magic vault financial account is unavailable")
    policy = await _registered_policy(finance, scope,
        account["policy_version"], account["policy_hash"])
    expires = datetime.now(timezone.utc) + timedelta(
        seconds=min(policy.max_reservation_seconds, 240))
    epoch = await finance.acquire_writer_epoch(scope,
        "native-uniswap-activation-v1")
    hold = await reserve_stopped_weth_exit(finance, scope=scope,
        context=context, quote=quote, command_id=command_id,
        writer_epoch=epoch, expires_at=expires)
    deadline = min(int(expires.timestamp()),
        int(datetime.now(timezone.utc).timestamp()) + 240)
    order_id = "0x" + sha256(("moeazi-vault-exit-v1:" + hold["intentId"]).encode()).hexdigest()
    prepared = await _sidecar("managed-vault-prepare-sell",
        _sell_input(vault, order_id, quote, deadline))
    payload_hash = prepared.get("normalizedPayloadHash") if isinstance(prepared, dict) else None
    if (not isinstance(prepared, dict) or prepared.get("orderId") != order_id
            or prepared.get("amountIn") != quote.amount_in
            or prepared.get("amountOutMinimum") != quote.minimum_amount_out
            or prepared.get("executorAddress") != vault["executorAddress"]
            or not isinstance(payload_hash, str) or not HASH.fullmatch(payload_hash)):
        raise FinanceError("vault sell preflight differs from reserved close")
    marker = await mark_exit_submission_started(finance, scope=scope,
        reservation_id=hold["reservationId"], context=context,
        command_id=command_id, quote_hash=quote_evidence_hash(quote),
        amount_in=quote.amount_in, amount_out_minimum=quote.minimum_amount_out,
        deadline=deadline, normalized_payload_hash=payload_hash,
        writer_epoch=epoch, expected_revision=int(hold["revision"]),
        vault_binding={"vaultAddress": vault["vaultAddress"],
            "executorAddress": vault["executorAddress"],
            "vaultCodeHash": vault["codeHash"], "orderId": order_id,
            "fromBlock": prepared["finalizedBlockNumber"],
            "programHash": vault["programHash"],
            "policyHash": vault["policyHash"],
            "capitalUnits": vault["capitalUnits"],
            "maxBuyUnits": vault["maxBuyUnits"],
            "mandateExpiresAt": vault["expiresAt"]})
    if marker.get("status") != "possible":
        raise FinanceError("vault sell attempt was not durably marked")
    attempt = await finance.verify_possible_submission(scope,
        intent_id=hold["intentId"], client_id=command_id,
        normalized_payload_hash=payload_hash, venue_id="uniswap")
    if (not attempt or attempt["notionalUnits"] != quote.minimum_amount_out
            or attempt["quantityUnits"] != quote.amount_in
            or attempt["sourceAccountId"] != context["sourceAccountId"]):
        raise FinanceError("vault sell attempt differs from financial close")
    claimed = await finance.claim_live_dispatch(scope,
        attempt_id=attempt["attemptId"], reservation_id=attempt["reservationId"],
        client_id=command_id, normalized_payload_hash=payload_hash,
        snapshot_hash=attempt["snapshotHash"], policy_hash=attempt["policyHash"],
        authority_epoch=attempt["authorityEpoch"])
    if not claimed:
        raise FinanceError("vault sell dispatch was already claimed or authority changed")
    try:
        await vault_sidecar(settings, "managed-vault-broadcast-sell",
            {**_sell_input(vault, order_id, quote, deadline),
             "normalizedPayloadHash": payload_hash}, private=True, timeout=45)
    except Exception:
        state = await finance.read_account_risk_snapshot(scope)
        await finance.mark_submission_uncertain(scope, hold["reservationId"],
            epoch, int(state["accountRevision"]),
            "native-vault-exit-uncertain:" + hold["intentId"])
    binding = await load_exit_binding(finance, scope,
        context["assignmentId"], command_id)
    if not binding or binding["attempt_id"] != marker["attemptId"]:
        raise FinanceError("durable Magic vault sell binding disappeared")
    from .managed_uniswap_close_api import _result_for_binding
    return await _result_for_binding(finance, settings, scope, binding)
