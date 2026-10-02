from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .operational_secret_contracts import SecretAccessDecision, SecretAccessReceipt


class OperationalSecretRepository:
    """Append-only metadata owner. This boundary has no envelope-material parameters."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def persist_authorization(self, decision: SecretAccessDecision,
                                    receipt: SecretAccessReceipt) -> None:
        _assert_receipt_matches(decision, receipt, authorization=True)
        async with self.engine.begin() as conn:
            existing = (await conn.execute(text("""
                SELECT request_hash FROM operational_secret_access_decisions
                WHERE idempotency_key=:key
            """), {"key": receipt.idempotency_key})).first()
            if existing and existing.request_hash != decision.request_hash:
                raise RuntimeError("Operational secret idempotency conflict")
            if existing:
                return
            await conn.execute(text("""
                INSERT INTO operational_secret_access_decisions
                  (decision_id,tenant_scope,descriptor_id,class_id,purpose,consumer_id,
                   consumer_version,capability,envelope_version,aad_hash,request_hash,descriptor_hash,
                   envelope_hash,policy_hash,workload_registry_hash,outcome,reasons,
                   decided_at,expires_at,idempotency_key,decision_hash)
                VALUES (:decision_id,:tenant_scope,:descriptor_id,:class_id,:purpose,:consumer_id,
                  :consumer_version,:capability,:envelope_version,:aad_hash,:request_hash,:descriptor_hash,
                  :envelope_hash,:policy_hash,:workload_registry_hash,:outcome,
                  CAST(:reasons AS jsonb),:decided_at,:expires_at,:idempotency_key,:decision_hash)
            """), {**decision.model_dump(mode="python"),
                "idempotency_key": receipt.idempotency_key,
                "reasons": json.dumps(decision.reasons)})
            await self._insert_receipt(conn, receipt)

    async def append_terminal(self, receipt: SecretAccessReceipt) -> None:
        async with self.engine.begin() as conn:
            first = (await conn.execute(text("""
                SELECT tenant_scope,descriptor_id,class_id,purpose,consumer_id,consumer_version,
                       capability,envelope_version,aad_hash,policy_hash,request_hash,idempotency_key
                FROM operational_secret_access_receipts
                WHERE decision_hash=:decision AND sequence=1
            """), {"decision": receipt.decision_hash})).first()
            if not first:
                raise RuntimeError("Authorized-attempt receipt is missing")
            _assert_receipt_row_matches(first, receipt)
            await self._insert_receipt(conn, receipt)

    async def _insert_receipt(self, conn, receipt: SecretAccessReceipt) -> None:
        await conn.execute(text("""
            INSERT INTO operational_secret_access_receipts
              (receipt_id,tenant_scope,descriptor_id,class_id,purpose,consumer_id,
               consumer_version,capability,envelope_version,aad_hash,policy_hash,
               decision_hash,request_hash,idempotency_key,stage,outcome,
               reason,sequence,occurred_at,receipt_hash)
            VALUES (:receipt_id,:tenant_scope,:descriptor_id,:class_id,:purpose,:consumer_id,
              :consumer_version,:capability,:envelope_version,:aad_hash,:policy_hash,
              :decision_hash,:request_hash,:idempotency_key,:stage,
              :outcome,:reason,:sequence,:occurred_at,:receipt_hash)
            ON CONFLICT (receipt_hash) DO NOTHING
        """), receipt.model_dump(mode="python"))

    async def append_lifecycle(self, row: dict[str, Any]) -> None:
        async with self.engine.begin() as conn:
            existing = (await conn.execute(text("""
                SELECT request_hash FROM operational_secret_lifecycle_decisions
                WHERE tenant_scope=:tenant AND idempotency_key=:key
            """), {"tenant": row["tenant_scope"], "key": row["idempotency_key"]})).first()
            if existing and existing.request_hash != row["request_hash"]:
                raise RuntimeError("Operational secret lifecycle idempotency conflict")
            if not existing:
                await conn.execute(text("""
                    INSERT INTO operational_secret_lifecycle_decisions
                      (decision_id,tenant_scope,descriptor_id,operation,request_hash,
                       predecessor_hash,outcome,reasons,idempotency_key,occurred_at,decision_hash)
                    VALUES (:decision_id,:tenant_scope,:descriptor_id,:operation,:request_hash,
                      :predecessor_hash,:outcome,CAST(:reasons AS jsonb),:idempotency_key,
                      :occurred_at,:decision_hash)
                """), {**row, "reasons": json.dumps(row["reasons"])})


class MemoryOperationalSecretRepository:
    def __init__(self, fail_authorization: bool = False):
        self.decisions: dict[str, SecretAccessDecision] = {}
        self.receipts: list[SecretAccessReceipt] = []
        self.fail_authorization = fail_authorization

    async def persist_authorization(self, decision: SecretAccessDecision,
                                    receipt: SecretAccessReceipt) -> None:
        _assert_receipt_matches(decision, receipt, authorization=True)
        if self.fail_authorization:
            raise RuntimeError("Synthetic receipt persistence failure")
        existing = self.decisions.get(receipt.idempotency_key)
        if existing and existing.request_hash != decision.request_hash:
            raise RuntimeError("Operational secret idempotency conflict")
        if not existing:
            self.decisions[receipt.idempotency_key] = decision
            self.receipts.append(receipt)

    async def append_terminal(self, receipt: SecretAccessReceipt) -> None:
        first=next((item for item in self.receipts if item.decision_hash == receipt.decision_hash and item.sequence == 1),None)
        if not first:
            raise RuntimeError("Authorized-attempt receipt is missing")
        _assert_receipt_matches(first, receipt, authorization=False)
        if not any(item.receipt_hash == receipt.receipt_hash for item in self.receipts):
            self.receipts.append(receipt)

def _fields(value):
    return ("tenant_scope","descriptor_id","class_id","purpose","consumer_id","consumer_version",
        "capability","envelope_version","aad_hash","policy_hash","request_hash","idempotency_key")
def _assert_receipt_matches(decision, receipt, *, authorization):
    if any(getattr(decision,key,None)!=getattr(receipt,key,None) for key in _fields(receipt) if key!="idempotency_key") or (authorization and (receipt.sequence!=1 or receipt.stage!="authorized_attempt")):
        raise RuntimeError("Operational secret receipt identity mismatch")
def _assert_receipt_row_matches(row, receipt):
    if any(getattr(row,key)!=getattr(receipt,key) for key in _fields(receipt)):
        raise RuntimeError("Operational secret receipt identity mismatch")
