"""Immutable order ordinals shared by replay entries and owner close attempts."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash
from .lifecycle_run_store import _run_params


async def allocate_order_ordinal(conn, scope: FinanceScope, run_id: str,
                                 manifest_hash: str, kind: str, key: str) -> int:
    """Caller holds the account lock; this also locks the exact run.

    Historical preparations, orders and admissions remain allocated even when
    created before this allocation table. A retry returns its original ordinal.
    """
    _hash(manifest_hash)
    if scope.environment != "experiment" or kind not in {"entry", "maintenance"} or \
            not run_id or not key or len(key) > 200:
        raise FinanceError("order ordinal requires a bounded experiment identity")
    params = {**_run_params(scope, run_id), "manifest": manifest_hash,
              "kind": kind, "key": key}
    run_hash = (await conn.execute(text("""
        SELECT manifest_hash FROM simulation_runs
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id FOR UPDATE
    """), params)).scalar_one_or_none()
    if run_hash != manifest_hash:
        raise FinanceError("order ordinal run manifest differs")
    prior = (await conn.execute(text("""
        SELECT order_ordinal FROM simulation_order_ordinal_allocations
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND allocation_kind=:kind AND allocation_key=:key
          AND manifest_hash=:manifest
    """), params)).scalar_one_or_none()
    if prior is not None:
        return int(prior)
    maximum = (await conn.execute(text("""
        SELECT max(order_ordinal) FROM (
          SELECT order_ordinal FROM simulation_order_ordinal_allocations
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          UNION ALL
          SELECT order_ordinal FROM simulation_order_preparations
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          UNION ALL
          SELECT order_ordinal FROM simulation_orders
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          UNION ALL
          SELECT (payload_json->>'orderOrdinal')::bigint
            FROM simulation_entry_progress
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND step='admission'
          UNION ALL
          SELECT order_ordinal FROM simulation_maintenance_reductions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
        ) used
    """), params)).scalar_one()
    ordinal = int(maximum or 0) + 1
    if ordinal > 9223372036854775807:
        raise FinanceError("order ordinal storage exhausted")
    await conn.execute(text("""
        INSERT INTO simulation_order_ordinal_allocations(environment,scope_id,
          strategy_account_id,run_id,manifest_hash,allocation_kind,
          allocation_key,order_ordinal)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:manifest,
          :kind,:key,:ordinal)
    """), {**params, "ordinal": ordinal})
    return ordinal
