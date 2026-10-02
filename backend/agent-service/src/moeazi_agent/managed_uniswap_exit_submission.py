"""Atomic possible-submission marker for one stopped, reduce-only Uniswap exit."""
from __future__ import annotations

from hashlib import sha256
import json
import re

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, native_int
from .finance_live_authority import require_live_finance_authority
from .finance_policy import SizingReceipt
from .finance_uniswap_quote import load_uniswap_quote


async def load_exit_binding(finance, scope: FinanceScope, assignment_id: str,
                            command_id: str) -> dict | None:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT b.*,a.status AS attempt_status,r.status AS reservation_status
          FROM finance_live_uniswap_exit_bindings b
          JOIN finance_submission_attempts a USING
            (environment,scope_id,strategy_account_id,attempt_id)
          JOIN finance_reservations r USING
            (environment,scope_id,strategy_account_id,reservation_id)
          WHERE b.environment='live' AND b.scope_id='live'
            AND b.strategy_account_id=:account AND b.assignment_id=:assignment
            AND b.command_id=:command
        """), {"account": scope.strategy_account_id, "assignment": assignment_id,
               "command": command_id})).mappings().first()
    return dict(row) if row else None


async def mark_exit_submission_started(finance, *, scope: FinanceScope,
        reservation_id: str, context: dict, command_id: str, quote_hash: str,
        amount_in: str, amount_out_minimum: str, deadline: int,
        normalized_payload_hash: str, writer_epoch: int,
        expected_revision: int, vault_binding: dict | None = None) -> dict:
    _hash(normalized_payload_hash)
    _hash(quote_hash)
    native_int(amount_in, positive=True)
    native_int(amount_out_minimum, positive=True)
    if (scope.environment != "live" or scope.scope_id != "live"
            or context.get("authority") != "reduce_only_close"
            or context.get("strategyAccountId") != scope.strategy_account_id
            or not isinstance(deadline, int) or isinstance(deadline, bool)):
        raise FinanceError("exit submission identity is invalid")
    vault = {"address": None, "executor": None, "code": None,
             "order": None, "from_block": None, "program": None,
             "policy": None, "capital": None, "max_buy": None,
             "expires": None}
    if vault_binding is not None:
        if set(vault_binding) != {"vaultAddress", "executorAddress", "vaultCodeHash",
                "orderId", "fromBlock", "programHash", "policyHash",
                "capitalUnits", "maxBuyUnits", "mandateExpiresAt"}:
            raise FinanceError("vault exit binding is incomplete")
        vault = {"address": vault_binding["vaultAddress"],
            "executor": vault_binding["executorAddress"],
            "code": vault_binding["vaultCodeHash"],
            "order": vault_binding["orderId"],
            "from_block": vault_binding["fromBlock"],
            "program": vault_binding["programHash"],
            "policy": vault_binding["policyHash"],
            "capital": vault_binding["capitalUnits"],
            "max_buy": vault_binding["maxBuyUnits"],
            "expires": vault_binding["mandateExpiresAt"]}
        if (not all(re.fullmatch(r"0x[0-9a-f]{40}", str(vault[key]))
                    for key in ("address", "executor"))
                or not all(re.fullmatch(r"0x[0-9a-f]{64}", str(vault[key]))
                    for key in ("code", "order"))
                or not all(re.fullmatch(r"[0-9a-f]{64}", str(vault[key]))
                    for key in ("program", "policy"))
                or vault["address"] == context["ownerAddress"]):
            raise FinanceError("vault exit identity is invalid")
        native_int(str(vault["from_block"]), positive=True)
        capital = native_int(str(vault["capital"]), positive=True)
        if native_int(str(vault["max_buy"]), positive=True) > capital \
                or native_int(str(vault["expires"]), positive=True) % 1000:
            raise FinanceError("vault exit mandate terms differ")
    request_hash = _digest("moeazi-finance-command-v1:managed-uniswap-exit-submit", {
        "scope": scope.model_dump(), "reservationId": reservation_id,
        "assignmentId": context["assignmentId"],
        "programVersionId": context["programVersionId"],
        "customerSubject": context["customerSubject"],
        "commandId": command_id, "grantId": context["executionGrantId"],
        "ownerAddress": context["ownerAddress"], "quoteHash": quote_hash,
        "amountIn": amount_in, "amountOutMinimum": amount_out_minimum,
        "deadline": deadline, "normalizedPayloadHash": normalized_payload_hash,
        "vaultBinding": vault_binding})
    key = "native-uniswap-exit-submit:" + context["assignmentId"] + ":" + command_id
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        prior = await finance._claim(conn, scope, "managed_uniswap_exit_submit",
                                     key, request_hash)
        if prior:
            return {"attemptId": prior["result_id"],
                    "revision": prior["account_revision"], "status": "possible"}
        now = await finance._writer(conn, account, writer_epoch)
        finance._revision(account, expected_revision)
        hold = await finance._reservation(conn, scope, reservation_id)
        view = await finance._read_state(conn, scope, account, now)
        if (account["admission_state"] != "stopped"
                or view["reconciliation_state"] != "clean"
                or hold["status"] != "reserved" or hold["expires_at"] <= now
                or hold["authority_epoch"] != account["authority_epoch"]
                or hold["snapshot_hash"] != account["observation_snapshot_hash"]
                or hold["policy_hash"] != account["policy_hash"]
                or hold["controller_ref"] != context["controllerRef"]
                or hold["controller_mode"] != "autopilot"
                or hold["purpose"] != "trade"
                or deadline <= int(now.timestamp())
                or deadline > int(hold["expires_at"].timestamp())):
            raise FinanceError("stopped exit hold or account state changed")
        if vault_binding is not None and account["source_account_id"] != \
                f"arbitrum:42161:vault:{vault['address']}":
            raise FinanceError("vault exit source differs from held account")
        policy = await finance._receipt_policy(conn, scope, hold["policy_version"])
        if policy.policy_hash != hold["policy_hash"]:
            raise FinanceError("native exit policy changed")
        await require_live_finance_authority(conn, scope, account, policy, now)
        receipt_row = (await conn.execute(text("""
          SELECT receipt_json FROM finance_calculation_receipts
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND receipt_hash=:hash AND authority_class='live_native'
        """), {"account": scope.strategy_account_id,
               "hash": hold["calculation_receipt_hash"]})).mappings().first()
        if receipt_row is None:
            raise FinanceError("native exit calculation receipt is missing")
        receipt = SizingReceipt.model_validate_json(json.dumps(receipt_row["receipt_json"]))
        quote = await load_uniswap_quote(conn, quote_hash)
        if (receipt.receipt_hash != hold["calculation_receipt_hash"]
                or receipt.price_snapshot_hash != quote_hash
                or receipt.action != "spot_sell"
                or quote.amount_in != amount_in
                or quote.minimum_amount_out != amount_out_minimum
                or receipt.quantity_units != amount_in
                or receipt.notional_units != amount_out_minimum):
            raise FinanceError("native exit attempt differs from held quote")
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
          INSERT INTO finance_live_uniswap_exit_bindings(environment,scope_id,
            strategy_account_id,attempt_id,reservation_id,assignment_id,
            program_version_id,customer_subject,command_id,intent_id,grant_id,
            owner_address,frozen_program_policy_hash,controller_ref,quote_hash,
            amount_in,amount_out_minimum,deadline,normalized_payload_hash,
            vault_address,executor_address,vault_code_hash,order_id,from_block,
            vault_program_hash,vault_policy_hash,vault_capital_units,
            vault_max_buy_units,vault_expires_at)
          VALUES('live','live',:account,:attempt,:reservation,:assignment,:version,
            :subject,:command,:intent,:grant,:owner,:frozen,CAST(:controller AS jsonb),
            :quote,:amount,:minimum,:deadline,:payload,:vault,:executor,:code,
            :order_id,:from_block,:program,:vault_policy,:capital,:max_buy,:expires)
        """), {"account": scope.strategy_account_id, "attempt": attempt_id,
               "reservation": reservation_id,
               "assignment": context["assignmentId"],
               "version": context["programVersionId"],
               "subject": context["customerSubject"], "command": command_id,
               "intent": hold["intent_id"], "grant": context["executionGrantId"],
               "owner": context["ownerAddress"],
               "frozen": context["frozenProgramPolicyHash"],
               "controller": json.dumps(context["controllerRef"], sort_keys=True),
               "quote": quote_hash, "amount": amount_in,
               "minimum": amount_out_minimum, "deadline": deadline,
               "payload": normalized_payload_hash,
               "vault": vault["address"], "executor": vault["executor"],
               "code": vault["code"], "order_id": vault["order"],
               "from_block": vault["from_block"], "program": vault["program"],
               "vault_policy": vault["policy"], "capital": vault["capital"],
               "max_buy": vault["max_buy"], "expires": vault["expires"]})
        await conn.execute(text("""
          UPDATE finance_reservations SET status='submitted',
            retention_reason='possible_submission',updated_at=clock_timestamp()
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id, "reservation": reservation_id})
        updated = await finance._advance(conn, scope, writer_epoch, account)
        await finance._insert_claim(conn, scope, "managed_uniswap_exit_submit",
                                    key, request_hash, attempt_id, updated["revision"])
        await finance._outbox(conn, scope, updated)
        return {"attemptId": attempt_id, "revision": updated["revision"],
                "status": "possible"}
