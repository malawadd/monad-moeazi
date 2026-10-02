"""Consistent simulated portfolio views; never financial admission evidence."""
import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, db_native_int, native_int
from .finance_observation_contracts import account_snapshot_from_row
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


async def read_simulation_portfolio(repository, scope: FinanceScope, run_id: str,
                                    manifest_hash: str, subject: str, *,
                                    after_instrument: str = "", after_location: str = "") -> dict:
    _hash(manifest_hash)
    if scope.environment != "experiment" or not subject or \
            bool(after_instrument) != bool(after_location) or \
            len(after_instrument) > 256 or len(after_location) > 256:
        raise FinanceError("Simulation portfolio needs an owned bounded identity")
    params = {**_run_params(scope, run_id), "instrument": after_instrument,
              "location": after_location}
    async with repository.finance.engine.connect() as connection:
        conn = await connection.execution_options(isolation_level="REPEATABLE READ")
        async with conn.begin():
            await conn.execute(text("SET TRANSACTION READ ONLY"))
            run = await repository._run(conn, scope, run_id, lock=False)
            if run["manifest_hash"] != manifest_hash or run["created_by_subject"] != subject:
                raise FinanceError("Simulation portfolio owner or manifest differs")
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            if manifest.manifest_hash != manifest_hash or manifest.scope != scope:
                raise FinanceError("Simulation portfolio manifest body differs")
            account = (await conn.execute(text("""
                SELECT revision,admission_state,reconciliation_state,reconciliation_reason,
                  observation_snapshot_hash,source_account_id FROM finance_accounts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            observed = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": account["observation_snapshot_hash"]})).mappings().first()
            if observed is None:
                raise FinanceError("Simulation portfolio account observation is unavailable")
            snapshot = account_snapshot_from_row(observed)
            if snapshot.scope != scope or snapshot.source_account_id != account["source_account_id"] or \
                    account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
                raise FinanceError("Simulation portfolio account observation differs")
            rows = (await conn.execute(text("""
                SELECT * FROM simulation_positions WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND (instrument_version_id,location_id)>(:instrument,:location)
                ORDER BY instrument_version_id,location_id LIMIT 51
            """), params)).mappings().all()
            items = []
            for row in rows[:50]:
                state = PositionArithmeticState.model_validate_json(json.dumps(row["arithmetic_state_json"]))
                if state.scope != scope or state.run_id != run_id or \
                        state.instrument_version_id != row["instrument_version_id"] or \
                        state.location_id != row["location_id"] or \
                        _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json")) != \
                            row["arithmetic_state_hash"] or \
                        native_int(state.signed_quantity_units) != db_native_int(row["signed_exposure_units"]) or \
                        native_int(state.collateral_units) != db_native_int(row["collateral_units"]):
                    raise FinanceError("Simulation portfolio position differs from exact state")
                items.append({"instrumentVersionId": state.instrument_version_id,
                    "locationId": state.location_id, "revision": str(row["revision"]),
                    "arithmetic": state.model_dump(mode="json"),
                    "reconciliationState": row["reconciliation_state"],
                    "pendingObligations": row["pending_obligations"], "reason": row["reason"]})
            holds = (await conn.execute(text("""
                SELECT c.asset_unit_id,c.registry_hash,c.location_id,sum(c.units) units
                FROM finance_reservation_components c JOIN finance_reservations r
                  USING(environment,scope_id,strategy_account_id,reservation_id)
                WHERE c.environment=:environment AND c.scope_id=:scope_id
                  AND c.strategy_account_id=:strategy_account_id
                  AND r.status IN ('reserved','submitted','uncertain')
                GROUP BY c.asset_unit_id,c.registry_hash,c.location_id
                ORDER BY c.asset_unit_id,c.registry_hash,c.location_id LIMIT 101
            """), params)).mappings().all()
            protections = (await conn.execute(text("""
                SELECT status,count(*) total,
                  count(*) FILTER (WHERE resolution_hash IS NULL) unresolved,
                  count(*) FILTER (WHERE resolution_hash IS NOT NULL) resolved
                FROM simulation_protections
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                GROUP BY status ORDER BY status
            """), params)).mappings().all()
            return {"authority": "review_only", "requiresFreshAdmission": True,
                "runId": run_id, "manifestHash": manifest_hash,
                "clockMode": manifest.scenario.clock_mode,
                "replayCursorAt": run["replay_cursor_at"].isoformat(),
                "projectionRevision": str(run["projection_revision"]),
                "account": {"revision": str(account["revision"]),
                    "admissionState": account["admission_state"],
                    "reconciliationState": account["reconciliation_state"],
                    "reason": account["reconciliation_reason"],
                    "snapshotHash": snapshot.snapshot_hash, "observationOrigin": snapshot.origin,
                    "observationCutoffAt": snapshot.cutoff_at.isoformat()},
                "positions": items,
                "nextPosition": {"instrumentVersionId": items[-1]["instrumentVersionId"],
                    "locationId": items[-1]["locationId"]} if len(rows) > 50 else None,
                "heldCapacityScope": "entire_experiment_account",
                "heldCapacityComplete": len(holds) <= 100,
                "heldCapacity": [{"assetUnitId": row["asset_unit_id"],
                    "registryHash": row["registry_hash"], "locationId": row["location_id"],
                    "units": str(db_native_int(row["units"]))} for row in holds[:100]],
                "protectionMechanism": "immediate_reduce_only_market",
                "protectionAcceptanceMeaning": "reduction_request_accepted_exposure_pending",
                "restingStopQualified": False,
                "protectionRecordCounts": {row["status"]: str(row["total"]) for row in protections},
                "unresolvedProtectionRecordCounts": {row["status"]: str(row["unresolved"])
                    for row in protections if row["unresolved"]},
                "resolvedProtectionRecordCounts": {row["status"]: str(row["resolved"])
                    for row in protections if row["resolved"]}}
