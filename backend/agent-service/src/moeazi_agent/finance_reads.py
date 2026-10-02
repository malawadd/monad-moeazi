"""Consistent financial reads never turn old observations into current capacity."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, native_int
from .finance_policy import SizingPolicy
from .finance_projection import projection_payload


class FinanceReadMixin:
    async def _read_state(self, conn, scope: FinanceScope, account: dict,
                          now: datetime) -> dict:
        """Reduce view authority without changing persisted journal/history."""
        if account["reconciliation_state"] != "clean":
            return account
        reason = None
        observed_at = account["observed_at"]
        if observed_at is None:
            reason = "observation_unavailable"
        elif observed_at > now:
            reason = "observation_in_future"
        if reason is None:
            row = (await conn.execute(text("""
                SELECT policy_json,policy_hash FROM finance_policy_versions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND policy_version=:policy_version
            """), {"environment": scope.environment, "scope_id": scope.scope_id,
                   "strategy_account_id": scope.strategy_account_id,
                   "policy_version": account["policy_version"]})).mappings().first()
            if row is None or row["policy_hash"] != account["policy_hash"]:
                reason = "policy_unavailable"
            else:
                try:
                    policy = SizingPolicy.model_validate(row["policy_json"])
                    if policy.policy_hash != account["policy_hash"] \
                            or policy.policy_version != account["policy_version"]:
                        raise FinanceError("Stored policy does not match financial state")
                except (ValueError, TypeError):
                    reason = "policy_unavailable"
                else:
                    if now - observed_at > timedelta(seconds=policy.max_observation_age_seconds):
                        reason = "stale_observation"
        return {**account, "reconciliation_state": "unknown",
                "reconciliation_reason": reason} if reason else account

    async def read_account_risk_snapshot(self, scope: FinanceScope) -> dict:
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            now = await self._db_now(conn)
            view = await self._read_state(conn, scope, account, now)
            balances, holds, capacity = await self._projection_rows(conn, scope)
            result = projection_payload(view, balances, holds, capacity, now)
            if any(native_int(row["availableUnits"]) < 0 for row in result["capacity"]):
                result["reconciliationState"] = "quarantined"
                result["reconciliationReason"] = "capacity_deficit"
            return result

    async def read_withdrawable_balance(self, scope: FinanceScope,
                                        asset_unit_id: str, location_id: str) -> dict:
        snapshot = await self.read_account_risk_snapshot(scope)
        unknown = {"status": "unknown", "units": None,
                   "revision": snapshot["accountRevision"]}
        if snapshot["reconciliationState"] != "clean":
            return {**unknown, "reason": snapshot["reconciliationReason"]}
        # Compare identity fields independently: concatenated keys are not proof
        # that an arbitrary caller-selected asset/location tuple is the same pool.
        matches = [item for item in snapshot["capacity"]
                   if item["assetUnitId"] == asset_unit_id and item["locationId"] == location_id]
        if len(matches) != 1:
            return {**unknown, "reason": "capacity_unavailable"}
        units = native_int(matches[0]["availableUnits"])
        if units < 0:
            return {**unknown, "reason": "capacity_deficit"}
        return {"status": "available", "units": str(units), "reason": "reconciled",
                "revision": snapshot["accountRevision"]}
