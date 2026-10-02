"""Consume one durable live submission marker before any venue side effect."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceScope, _hash


class FinanceDispatchClaimMixin:
    async def claim_live_dispatch(self, scope: FinanceScope, *, attempt_id: str,
                                  reservation_id: str, client_id: str,
                                  normalized_payload_hash: str,
                                  snapshot_hash: str, policy_hash: str,
                                  authority_epoch: int) -> bool:
        """Single winner; a lost response is reconciliation-only, never retried."""
        if scope.environment != "live" or not attempt_id or not reservation_id \
                or not client_id or type(authority_epoch) is not int:
            return False
        _hash(normalized_payload_hash)
        _hash(snapshot_hash)
        _hash(policy_hash)
        params = {"environment": scope.environment, "scope_id": scope.scope_id,
                  "strategy_account_id": scope.strategy_account_id,
                  "attempt_id": attempt_id, "reservation_id": reservation_id,
                  "client_id": client_id, "payload_hash": normalized_payload_hash,
                  "snapshot_hash": snapshot_hash, "policy_hash": policy_hash,
                  "authority_epoch": authority_epoch}
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            if account["admission_state"] not in {"open", "stopped"} \
                    or account["reconciliation_state"] != "clean" \
                    or account["observation_snapshot_hash"] != snapshot_hash \
                    or account["policy_hash"] != policy_hash \
                    or account["authority_epoch"] != authority_epoch:
                return False
            if account["admission_state"] == "stopped":
                reduce_only = (await conn.execute(text("""
                  SELECT 1 FROM finance_live_uniswap_exit_bindings b
                  JOIN finance_reservations r USING
                    (environment,scope_id,strategy_account_id,reservation_id)
                  JOIN finance_calculation_receipts c ON
                    c.environment=r.environment AND c.scope_id=r.scope_id
                    AND c.strategy_account_id=r.strategy_account_id
                    AND c.receipt_hash=r.calculation_receipt_hash
                  WHERE b.environment=:environment AND b.scope_id=:scope_id
                    AND b.strategy_account_id=:strategy_account_id
                    AND b.attempt_id=:attempt_id AND b.reservation_id=:reservation_id
                    AND b.command_id=:client_id
                    AND b.normalized_payload_hash=:payload_hash
                    AND r.status='submitted' AND r.controller_mode='autopilot'
                    AND c.authority_class='live_native'
                    AND c.receipt_json->>'action'='spot_sell'
                  LIMIT 1
                """), params)).first()
                if not reduce_only:
                    return False
            result = await conn.execute(text("""
                UPDATE finance_submission_attempts AS a SET status='dispatching'
                FROM finance_reservations AS r
                WHERE a.environment=:environment AND a.scope_id=:scope_id
                  AND a.strategy_account_id=:strategy_account_id
                  AND a.attempt_id=:attempt_id AND a.reservation_id=:reservation_id
                  AND a.client_id=:client_id
                  AND a.normalized_payload_hash=:payload_hash
                  AND a.status='possible'
                  AND r.environment=a.environment AND r.scope_id=a.scope_id
                  AND r.strategy_account_id=a.strategy_account_id
                  AND r.reservation_id=a.reservation_id
                  AND r.status='submitted' AND r.purpose='trade'
                  AND r.controller_mode IN ('approval_required','autopilot')
                  AND r.snapshot_hash=:snapshot_hash
                  AND r.policy_hash=:policy_hash
                  AND r.authority_epoch=:authority_epoch
                  AND r.expires_at > clock_timestamp()
                RETURNING a.attempt_id
            """), params)
            return result.first() is not None
