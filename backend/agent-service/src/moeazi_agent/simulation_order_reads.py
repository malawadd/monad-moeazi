"""Bounded, read-only prepared-order review; never an execution permission."""
from datetime import datetime

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .lifecycle_run_store import _run_params


async def read_prepared_orders(repository, scope: FinanceScope, run_id: str,
                               manifest_hash: str, subject: str,
                               after_ordinal: int = 0) -> dict:
    _hash(manifest_hash)
    if scope.environment != "experiment" or not subject or type(after_ordinal) is not int \
            or after_ordinal < 0:
        raise FinanceError("Owned simulation review identity is required")
    params = {**_run_params(scope, run_id), "after": after_ordinal}
    async with repository.finance.engine.connect() as connection:
        conn = await connection.execution_options(isolation_level="REPEATABLE READ")
        async with conn.begin():
            run = await repository._run(conn, scope, run_id, lock=False)
            if run["manifest_hash"] != manifest_hash or run["created_by_subject"] != subject:
                raise FinanceError("Prepared order review owner or manifest differs")
            observed_at = await repository.finance._db_now(conn)
            rows = (await conn.execute(text("""
                SELECT p.order_id,p.order_ordinal,p.intent_id,p.intent_hash,
                  p.reservation_id,p.normalized_payload_hash,p.normalized_payload_json,
                  r.status AS reservation_status,r.expires_at AS reservation_expires_at,
                  o.status AS order_status,a.approval_hash,a.approval_json,
                  a.expires_at AS approval_expires_at,
                  EXISTS(SELECT 1 FROM simulation_approval_revocations x
                    WHERE x.environment=p.environment AND x.scope_id=p.scope_id
                      AND x.strategy_account_id=p.strategy_account_id AND x.run_id=p.run_id
                      AND x.approval_hash=a.approval_hash) AS approval_revoked
                FROM simulation_order_preparations p
                JOIN finance_reservations r ON r.environment=p.environment
                  AND r.scope_id=p.scope_id AND r.strategy_account_id=p.strategy_account_id
                  AND r.reservation_id=p.reservation_id
                LEFT JOIN simulation_orders o ON o.environment=p.environment
                  AND o.scope_id=p.scope_id AND o.strategy_account_id=p.strategy_account_id
                  AND o.run_id=p.run_id AND o.order_id=p.order_id
                LEFT JOIN LATERAL (
                  SELECT approval_hash,approval_json,expires_at FROM simulation_approval_receipts
                  WHERE environment=p.environment AND scope_id=p.scope_id
                    AND strategy_account_id=p.strategy_account_id AND run_id=p.run_id
                    AND normalized_payload_hash=p.normalized_payload_hash
                  ORDER BY approved_at DESC,approval_hash DESC LIMIT 1
                ) a ON true
                WHERE p.environment=:environment AND p.scope_id=:scope_id
                  AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
                  AND p.order_ordinal>:after ORDER BY p.order_ordinal LIMIT 51
            """), params)).mappings().all()
            items = []
            for row in rows[:50]:
                payload = row["normalized_payload_json"]
                if not isinstance(payload, dict) or \
                        payload.get("normalizedPayloadHash") != row["normalized_payload_hash"] or \
                        payload.get("scope") != scope.model_dump(mode="json") or \
                        payload.get("runId") != run_id or payload.get("manifestHash") != manifest_hash or \
                        payload.get("orderId") != row["order_id"] or \
                        payload.get("intentId") != row["intent_id"] or \
                        payload.get("intentHash") != row["intent_hash"] or \
                        _digest("moeazi-simulation-order-payload-v1", {
                            key: value for key, value in payload.items()
                            if key != "normalizedPayloadHash"}) != row["normalized_payload_hash"]:
                    raise FinanceError("Prepared review payload cannot be verified")
                approval = None
                if row["approval_hash"] is not None:
                    body = row["approval_json"]
                    if not isinstance(body, dict) or body.get("approvalHash") != row["approval_hash"] or \
                            body.get("normalizedPayloadHash") != row["normalized_payload_hash"] or \
                            body.get("intentId") != row["intent_id"] or \
                            body.get("intentHash") != row["intent_hash"] or \
                            body.get("scope") != scope.model_dump(mode="json") or \
                            body.get("runId") != run_id or body.get("approvedBySubject") != subject or \
                            _digest("moeazi-simulation-approval-v1", {
                                key: value for key, value in body.items()
                                if key != "approvalHash"}) != row["approval_hash"]:
                        raise FinanceError("Stored approval review cannot be verified")
                    try:
                        if datetime.fromisoformat(body["expiresAt"]) != row["approval_expires_at"]:
                            raise ValueError("expiry differs")
                    except (KeyError, TypeError, ValueError) as exc:
                        raise FinanceError("Stored approval expiry cannot be verified") from exc
                    approval = {"receiptHash": row["approval_hash"],
                        "expiresAt": row["approval_expires_at"].isoformat(),
                        "state": "revoked" if row["approval_revoked"] else
                            "expired" if row["approval_expires_at"] <= observed_at else "active"}
                items.append({"orderId": row["order_id"], "orderOrdinal": row["order_ordinal"],
                    "intentId": row["intent_id"], "normalizedPayloadHash": row["normalized_payload_hash"],
                    "payload": payload, "orderStatus": row["order_status"] or "not_submitted",
                    "reservationStatus": row["reservation_status"],
                    "reservationExpiresAt": row["reservation_expires_at"].isoformat(),
                    "reservationExpired": row["reservation_expires_at"] <= observed_at,
                    "approval": approval})
            return {"observedAt": observed_at.isoformat(), "entriesStopped": run["entries_stopped"],
                "runStatus": run["status"], "items": items,
                "nextAfterOrdinal": items[-1]["orderOrdinal"] if len(rows) > 50 else None,
                "authority": "review_only", "requiresFreshAdmission": True}
