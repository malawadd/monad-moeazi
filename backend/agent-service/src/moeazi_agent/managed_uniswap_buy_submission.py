"""Atomic possible-submission marker and immutable managed grant binding."""
from __future__ import annotations

from hashlib import sha256
import json
import re

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, native_int
from .finance_live_authority import require_live_finance_authority
from .finance_policy import SizingReceipt
from .finance_uniswap_quote import load_uniswap_quote


def _scope(scope: FinanceScope) -> dict:
    return scope.model_dump()


async def load_attempt_binding(finance, scope: FinanceScope, intent_id: str) -> dict | None:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT b.*,a.status AS attempt_status,r.status AS reservation_status
          FROM finance_live_uniswap_attempt_bindings b
          JOIN finance_submission_attempts a USING
            (environment,scope_id,strategy_account_id,attempt_id)
          JOIN finance_reservations r USING
            (environment,scope_id,strategy_account_id,reservation_id)
          WHERE b.environment='live' AND b.scope_id='live'
            AND b.strategy_account_id=:account AND b.intent_id=:intent
        """), {"account": scope.strategy_account_id,
               "intent": intent_id})).mappings().first()
    return dict(row) if row else None


async def mark_managed_submission_started(finance, *, scope: FinanceScope,
        reservation_id: str, proposal_id: str, command_id: str,
        assignment_id: str, program_version_id: str, controller_ref: dict,
        grant_id: str, owner_address: str, quote_hash: str,
        amount_in: str, amount_out_minimum: str, deadline: int,
        normalized_payload_hash: str, writer_epoch: int,
        authority_epoch: int, expected_revision: int,
        vault_binding: dict | None = None) -> dict:
    """One SQL commit stores the attempt, sidecar identity, held risk and outbox."""
    _hash(normalized_payload_hash)
    _hash(quote_hash)
    native_int(amount_in, positive=True)
    native_int(amount_out_minimum, positive=True)
    if not all(isinstance(v, str) and v for v in (proposal_id, command_id,
            assignment_id, program_version_id, grant_id, owner_address)):
        raise FinanceError("managed submission identity is incomplete")
    if not isinstance(deadline, int) or isinstance(deadline, bool) or deadline <= 0:
        raise FinanceError("managed submission deadline is invalid")
    if not isinstance(controller_ref, dict) or controller_ref.get("controllerKind") != "managed_program" \
            or controller_ref.get("strategyAccountId") != scope.strategy_account_id \
            or controller_ref.get("controllerId") != assignment_id \
            or controller_ref.get("controllerVersionId") != program_version_id:
        raise FinanceError("managed submission controller differs from assignment")
    if owner_address != owner_address.lower():
        raise FinanceError("managed owner address must be canonical lowercase")
    vault = {"address": None, "executor": None, "code_hash": None,
             "order_id": None, "from_block": None, "program_hash": None,
             "policy_hash": None, "capital": None, "max_buy": None,
             "expires_at": None}
    if vault_binding is not None:
        if set(vault_binding) != {"vaultAddress", "executorAddress", "vaultCodeHash",
                                  "orderId", "fromBlock", "programHash", "policyHash",
                                  "capitalUnits", "maxBuyUnits", "mandateExpiresAt"}:
            raise FinanceError("vault submission binding is incomplete")
        vault = {"address": vault_binding["vaultAddress"],
                 "executor": vault_binding["executorAddress"],
                 "code_hash": vault_binding["vaultCodeHash"],
                 "order_id": vault_binding["orderId"],
                 "from_block": vault_binding["fromBlock"],
                 "program_hash": vault_binding["programHash"],
                 "policy_hash": vault_binding["policyHash"],
                 "capital": vault_binding["capitalUnits"],
                 "max_buy": vault_binding["maxBuyUnits"],
                 "expires_at": vault_binding["mandateExpiresAt"]}
        if (not re.fullmatch(r"0x[0-9a-f]{40}", str(vault["address"]))
                or not re.fullmatch(r"0x[0-9a-f]{40}", str(vault["executor"]))
                or not re.fullmatch(r"0x[0-9a-f]{64}", str(vault["code_hash"]))
                or not re.fullmatch(r"0x[0-9a-f]{64}", str(vault["order_id"]))
                or not re.fullmatch(r"[0-9a-f]{64}", str(vault["program_hash"]))
                or not re.fullmatch(r"[0-9a-f]{64}", str(vault["policy_hash"]))
                or vault["address"] in {owner_address, vault["executor"]}):
            raise FinanceError("vault submission identity is invalid")
        native_int(str(vault["from_block"]), positive=True)
        capital = native_int(str(vault["capital"]), positive=True)
        if native_int(str(vault["max_buy"]), positive=True) > capital:
            raise FinanceError("vault attempt exceeds committed capital")
        expires_at = native_int(str(vault["expires_at"]), positive=True)
        if expires_at % 1000:
            raise FinanceError("vault expiry is not representable on chain")
    request_hash = _digest("moeazi-finance-command-v1:managed-uniswap-submit", {
        "scope": scope.model_dump(), "reservationId": reservation_id,
        "proposalId": proposal_id, "commandId": command_id,
        "assignmentId": assignment_id, "programVersionId": program_version_id,
        "controllerRef": controller_ref, "grantId": grant_id,
        "ownerAddress": owner_address, "quoteHash": quote_hash,
        "amountIn": amount_in, "amountOutMinimum": amount_out_minimum,
        "deadline": deadline, "normalizedPayloadHash": normalized_payload_hash,
        "vaultBinding": vault_binding})
    key = "native-uniswap-submit:" + proposal_id
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        prior = await finance._claim(conn, scope, "managed_uniswap_submit", key, request_hash)
        if prior:
            return {"attemptId": prior["result_id"],
                    "revision": prior["account_revision"], "status": "possible"}
        now = await finance._writer(conn, account, writer_epoch)
        finance._revision(account, expected_revision)
        hold = await finance._reservation(conn, scope, reservation_id)
        view = await finance._read_state(conn, scope, account, now)
        if scope.environment != "live" or account["admission_state"] != "open" \
                or account["authority_epoch"] != authority_epoch \
                or hold["authority_epoch"] != authority_epoch \
                or hold["status"] != "reserved" or hold["expires_at"] <= now \
                or deadline <= int(now.timestamp()) \
                or deadline > int(hold["expires_at"].timestamp()) \
                or view["reconciliation_state"] != "clean" \
                or hold["snapshot_hash"] != account["observation_snapshot_hash"] \
                or hold["policy_hash"] != account["policy_hash"] \
                or hold["controller_ref"] != controller_ref \
                or hold["controller_mode"] != "autopilot" \
                or hold["purpose"] != "trade":
            raise FinanceError("managed submission admission or reservation changed")
        if vault_binding is not None and account["source_account_id"] != \
                f"arbitrum:42161:vault:{vault['address']}":
            raise FinanceError("managed vault source differs from financial account")
        policy = await finance._receipt_policy(conn, scope, hold["policy_version"])
        if policy.policy_hash != hold["policy_hash"]:
            raise FinanceError("managed submission policy changed")
        await require_live_finance_authority(conn, scope, account, policy, now)
        receipt_row = (await conn.execute(text("""
          SELECT receipt_json FROM finance_calculation_receipts
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND receipt_hash=:hash AND authority_class='live_native'
        """), {"account": scope.strategy_account_id,
               "hash": hold["calculation_receipt_hash"]})).mappings().first()
        if receipt_row is None:
            raise FinanceError("managed calculation receipt is missing")
        receipt = SizingReceipt.model_validate_json(json.dumps(receipt_row["receipt_json"]))
        quote = await load_uniswap_quote(conn, quote_hash)
        if receipt.receipt_hash != hold["calculation_receipt_hash"] \
                or receipt.price_snapshot_hash != quote_hash \
                or receipt.action != "spot_buy" or quote.amount_in != amount_in \
                or quote.minimum_amount_out != amount_out_minimum \
                or receipt.quantity_units != quote.minimum_amount_out \
                or receipt.notional_units != amount_in:
            raise FinanceError("managed submission differs from sized exact quote")
        attempt_id = sha256(("finance-attempt-v1:live:live:" + scope.strategy_account_id
                             + ":" + command_id).encode()).hexdigest()
        await conn.execute(text("""
          INSERT INTO finance_submission_attempts(environment,scope_id,strategy_account_id,
            attempt_id,reservation_id,client_id,normalized_payload_hash,status)
          VALUES('live','live',:account,:attempt,:reservation,:client,:payload,'possible')
        """), {"account": scope.strategy_account_id, "attempt": attempt_id,
               "reservation": reservation_id, "client": command_id,
               "payload": normalized_payload_hash})
        await conn.execute(text("""
          INSERT INTO finance_live_uniswap_attempt_bindings(environment,scope_id,
            strategy_account_id,attempt_id,reservation_id,proposal_id,command_id,intent_id,
            grant_id,owner_address,assignment_id,program_version_id,controller_ref,
            quote_hash,amount_in,amount_out_minimum,deadline,normalized_payload_hash,
            vault_address,executor_address,vault_code_hash,order_id,from_block,
            vault_program_hash,vault_policy_hash,vault_capital_units,
            vault_max_buy_units,vault_expires_at)
          VALUES('live','live',:account,:attempt,:reservation,:proposal,:command,:intent,
            :grant,:owner,:assignment,:version,CAST(:controller AS jsonb),:quote,:amount,
            :minimum,:deadline,:payload,:vault,:executor,:vault_code,:order_id,:from_block,
            :program_hash,:vault_policy,:capital,:max_buy,:vault_expires)
        """), {"account": scope.strategy_account_id, "attempt": attempt_id,
               "reservation": reservation_id, "proposal": proposal_id,
               "command": command_id, "intent": hold["intent_id"], "grant": grant_id,
               "owner": owner_address, "assignment": assignment_id,
               "version": program_version_id,
               "controller": json.dumps(controller_ref, sort_keys=True, separators=(",", ":")),
               "quote": quote_hash, "amount": amount_in,
               "minimum": amount_out_minimum, "deadline": deadline,
               "payload": normalized_payload_hash, "vault": vault["address"],
               "executor": vault["executor"], "vault_code": vault["code_hash"],
               "order_id": vault["order_id"], "from_block": vault["from_block"],
               "program_hash": vault["program_hash"],
               "vault_policy": vault["policy_hash"], "capital": vault["capital"],
               "max_buy": vault["max_buy"], "vault_expires": vault["expires_at"]})
        await conn.execute(text("""
          UPDATE finance_reservations SET status='submitted',
            retention_reason='possible_submission',updated_at=clock_timestamp()
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id, "reservation": reservation_id})
        updated = await finance._advance(conn, scope, writer_epoch, account)
        await finance._insert_claim(conn, scope, "managed_uniswap_submit", key,
                                    request_hash, attempt_id, updated["revision"])
        await finance._outbox(conn, scope, updated)
        return {"attemptId": attempt_id, "revision": updated["revision"],
                "status": "possible"}
