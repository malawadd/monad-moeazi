"""Stable worker-command selection of one durable entry request."""
from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_run_store import _run_params


async def claim_entry_request(conn, scope, run_id, manifest_hash, command_id):
    """Caller holds the financial account and run locks before selecting."""
    params = {**_run_params(scope, run_id), "command_id": command_id}
    prior = (await conn.execute(text("""
        SELECT manifest_hash,request_id FROM simulation_entry_dispatch_claims
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND command_id=:command_id
    """), params)).mappings().first()
    if prior is not None:
        if prior["manifest_hash"] != manifest_hash:
            raise FinanceError("Entry processing command changed its manifest")
        request_id = prior["request_id"]
    else:
        request_id = (await conn.execute(text("""
            SELECT request_id FROM simulation_entry_requests
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND status IN ('queued','evaluating','awaiting_finance','awaiting_approval',
                             'awaiting_evidence')
            ORDER BY request_sequence LIMIT 1
        """), params)).scalar_one_or_none()
        await conn.execute(text("""
            INSERT INTO simulation_entry_dispatch_claims(environment,scope_id,
              strategy_account_id,run_id,command_id,manifest_hash,request_id)
            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
              :command_id,:manifest_hash,:request_id)
        """), {**params, "manifest_hash": manifest_hash, "request_id": request_id})
    if request_id is None:
        return None
    row = (await conn.execute(text("""
        SELECT * FROM simulation_entry_requests WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND request_id=:request_id FOR UPDATE
    """), {**params, "request_id": request_id})).mappings().first()
    if row is None or row["manifest_hash"] != manifest_hash:
        raise FinanceError("Claimed entry request no longer matches its command")
    return dict(row)
