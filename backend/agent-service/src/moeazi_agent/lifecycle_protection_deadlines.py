"""Historical protection deadlines are wake candidates, never fresh market data."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_protection_contracts import ProtectionObligation
from .lifecycle_run_store import _run_params


async def next_protection_deadline(conn, manifest, current):
    row = (await conn.execute(text("""
        SELECT protection_order_id,originating_order_id,originating_event_hash,
          policy_hash,intended_hash,intended_json FROM simulation_protections
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND intended_json IS NOT NULL
          AND resolution_hash IS NULL
          AND status IN ('intended','requested','confirmed','rejected','uncertain')
          AND (intended_json->>'deadline_at_cursor')::timestamptz>:current
        ORDER BY (intended_json->>'deadline_at_cursor')::timestamptz,protection_order_id
        LIMIT 1
    """), {**_run_params(manifest.scope, manifest.run_id), "current": current})).mappings().first()
    if row is None:
        return None
    obligation = ProtectionObligation.model_validate_json(json.dumps(row["intended_json"]))
    if obligation.scope != manifest.scope or obligation.run_id != manifest.run_id or \
            obligation.manifest_hash != manifest.manifest_hash or \
            obligation.policy_hash != manifest.policy_hash or \
            any(getattr(obligation, key) != row[key] for key in (
                "protection_order_id", "originating_order_id", "originating_event_hash",
                "policy_hash", "intended_hash")):
        raise FinanceError("Protection deadline differs from its source-bound obligation")
    # An out-of-dataset deadline remains an unresolved obligation. Never extend
    # the frozen experiment or invent a fresh book to make an exit appear viable.
    if obligation.deadline_at_cursor > manifest.scenario.simulation_end_at:
        return None
    return obligation.deadline_at_cursor
