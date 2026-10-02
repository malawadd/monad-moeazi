"""Recheck an ordinary human approval without borrowing close authority."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceError, _digest


async def check_order_approval(conn, params, manifest, run, intent, prepared,
        approval_receipt_hash, now, *, maintenance: bool) -> None:
    if maintenance:
        if approval_receipt_hash is not None:
            raise FinanceError("maintenance cannot borrow ordinary approval")
        return
    if manifest.controller_mode != "approval_required":
        if approval_receipt_hash is not None:
            raise FinanceError("non-Approval mode cannot borrow an Approval receipt")
        return
    if approval_receipt_hash is None:
        raise FinanceError("Approval order lacks exact approved payload")
    approval = (await conn.execute(text("""
        SELECT a.* FROM simulation_approval_receipts a
        WHERE a.environment=:environment AND a.scope_id=:scope_id
          AND a.strategy_account_id=:strategy_account_id AND a.run_id=:run_id
          AND a.approval_hash=:hash AND NOT EXISTS (
            SELECT 1 FROM simulation_approval_revocations x
            WHERE x.environment=a.environment AND x.scope_id=a.scope_id
              AND x.strategy_account_id=a.strategy_account_id
              AND x.run_id=a.run_id AND x.approval_hash=a.approval_hash)
    """), {**params, "hash": approval_receipt_hash})).mappings().first()
    if not approval or approval["intent_id"] != intent.intent_id or \
            approval["intent_hash"] != intent.intent_hash or \
            approval["normalized_payload_hash"] != prepared["normalized_payload_hash"] or \
            approval["approved_by_subject"] != run["created_by_subject"] or \
            not approval["approved_at"] <= now < approval["expires_at"]:
        raise FinanceError("simulation Approval receipt expired or differs")
    body = approval["approval_json"]
    if body.get("approvalHash") != approval_receipt_hash or \
            _digest("moeazi-simulation-approval-v1", {
                key: value for key, value in body.items()
                if key != "approvalHash"}) != approval_receipt_hash:
        raise FinanceError("stored Approval receipt digest differs")
