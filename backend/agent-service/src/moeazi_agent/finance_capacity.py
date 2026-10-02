"""Canonical asset/location capacity identity and committed hold checks."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceScope, db_native_int
from .finance_observation_contracts import AccountObservationSnapshotRef


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


async def capacity_identity_conflict(conn, scope: FinanceScope,
                                     snapshot: AccountObservationSnapshotRef) -> bool:
    identities: dict[str, tuple[str, str, str]] = {}
    for row in snapshot.observed_balances:
        if row.book != "wallet":
            continue
        key = f"asset:{row.asset_unit_id}:{row.location_id}"
        identity = row.asset_unit_id, row.registry_hash, row.location_id
        if key in identities and identities[key] != identity:
            return True
        identities[key] = identity
    prior = (await conn.execute(text("""
        SELECT capacity_key,asset_unit_id,registry_hash,location_id
        FROM finance_capacity WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), _scope(scope))).mappings().all()
    return any(row["capacity_key"] in identities and identities[row["capacity_key"]] !=
               (row["asset_unit_id"], row["registry_hash"], row["location_id"])
               for row in prior)


async def held_excess(conn, scope: FinanceScope) -> bool:
    rows = (await conn.execute(text("""
        SELECT cap.limit_units,
          coalesce((SELECT sum(c.units) FROM finance_reservation_components c
            JOIN finance_reservations r USING
              (environment,scope_id,strategy_account_id,reservation_id)
            WHERE c.environment=cap.environment AND c.scope_id=cap.scope_id
              AND c.strategy_account_id=cap.strategy_account_id
              AND c.capacity_key=cap.capacity_key
              AND r.status IN ('reserved','submitted','uncertain')),0) AS held
        FROM finance_capacity cap WHERE cap.environment=:environment
          AND cap.scope_id=:scope_id AND cap.strategy_account_id=:strategy_account_id
    """), _scope(scope))).mappings().all()
    return any(db_native_int(row["held"]) > db_native_int(row["limit_units"])
               for row in rows)
