"""Bounded exact outcome summaries for completed experimental runs."""
from __future__ import annotations

import json
from fractions import Fraction

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash, native_int
from .lifecycle_checkpoint_verify import verify_replay_checkpoint
from .lifecycle_position_math_contracts import PositionArithmeticState, exact_pair
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params

MAX_DATASET_OBSERVATIONS = 128
MAX_RUN_ORDERS = 16
MAX_SOURCE_EVENTS = 256
MAX_POSITIONS = 32
MAX_RULES = 128


def _group_totals(positions: tuple[PositionArithmeticState, ...], field: str) -> list[dict]:
    values: dict[tuple[str, str], int] = {}
    for state in positions:
        for row in getattr(state, field):
            key = (row.asset_unit_id, row.registry_hash)
            values[key] = values.get(key, 0) + native_int(row.signed_units)
    return [{"assetUnitId": asset, "registryHash": registry, "units": str(units)}
            for (asset, registry), units in sorted(values.items()) if units]


def _realized_by_asset(positions: tuple[PositionArithmeticState, ...]) -> list[dict]:
    values: dict[tuple[str, str], Fraction] = {}
    for state in positions:
        key = (state.settlement_asset_unit_id, state.settlement_registry_hash)
        amount = exact_pair(state.realized_pnl_numerator, state.realized_pnl_denominator)
        values[key] = values.get(key, Fraction()) + amount
    return [{"assetUnitId": asset, "registryHash": registry,
             "numerator": str(amount.numerator), "denominator": str(amount.denominator)}
            for (asset, registry), amount in sorted(values.items())]


async def read_simulation_outcome(repository, scope: FinanceScope, run_id: str,
                                  manifest_hash: str, subject: str) -> dict:
    """Read a small completed-flat run through the independent replay oracle."""
    _hash(manifest_hash)
    if scope.environment != "experiment" or not subject or not run_id:
        raise FinanceError("simulation outcome needs an owned experiment identity")
    params = _run_params(scope, run_id)
    async with repository.finance.engine.connect() as connection:
        connection = await connection.execution_options(isolation_level="REPEATABLE READ")
        async with connection.begin():
            await connection.execute(text("SET TRANSACTION READ ONLY"))
            run = await repository._run(connection, scope, run_id, lock=False)
            if run["manifest_hash"] != manifest_hash or \
                    run["created_by_subject"] != subject:
                raise FinanceError("simulation outcome owner or manifest differs")
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            if manifest.manifest_hash != manifest_hash or manifest.scope != scope or \
                    manifest.run_id != run_id:
                raise FinanceError("simulation outcome manifest body differs")
            if run["status"] != "completed_flat" or not run["entries_stopped"] or \
                    run["pending_obligations"] or \
                    run["replay_cursor_at"] != manifest.scenario.simulation_end_at:
                raise FinanceError("simulation outcome requires a completed flat run")
            if max(len(manifest.scenario.fee_rules),
                   len(manifest.scenario.funding_rules),
                   len(manifest.scenario.outcome_rules)) > MAX_RULES:
                raise FinanceError("simulation outcome exceeds the bounded scenario rule limit")

            counts = (await connection.execute(text("""
                SELECT COALESCE((SELECT observation_count FROM simulation_run_datasets
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id),0)
                    AS dataset_count,
                  (SELECT count(*) FROM simulation_orders WHERE environment=:environment
                    AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                    AND run_id=:run_id) AS order_count,
                  (SELECT count(*) FROM simulation_order_events WHERE environment=:environment
                    AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                    AND run_id=:run_id) AS source_event_count,
                  (SELECT count(*) FROM simulation_positions WHERE environment=:environment
                    AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                    AND run_id=:run_id) AS position_count,
                  (SELECT count(*) FROM simulation_positions WHERE environment=:environment
                    AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                    AND run_id=:run_id AND (reconciliation_state<>'clean'
                      OR pending_obligations)) AS dirty_position_count
            """), params)).mappings().one()
            if not 1 <= counts["dataset_count"] <= MAX_DATASET_OBSERVATIONS or \
                    counts["order_count"] > MAX_RUN_ORDERS or \
                    counts["source_event_count"] > MAX_SOURCE_EVENTS or \
                    counts["position_count"] > MAX_POSITIONS or \
                    counts["dirty_position_count"]:
                raise FinanceError("simulation outcome exceeds its bounded clean-run scope")
            account = (await connection.execute(text("""
                SELECT revision,reconciliation_state,observation_snapshot_hash,
                  source_account_id
                FROM finance_accounts WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            if account["reconciliation_state"] != "clean":
                raise FinanceError("simulation outcome account is not reconciled clean")
            current_snapshot_hash = _hash(account["observation_snapshot_hash"])

            oracle, events = await verify_replay_checkpoint(
                connection, scope, manifest, run, account, read_only=True)
            positions = tuple(oracle.positions[key] for key in sorted(oracle.positions))
            for state in positions:
                if native_int(state.signed_quantity_units) or \
                        native_int(state.collateral_units) or \
                        native_int(state.margin_reserved_units) or \
                        exact_pair(state.open_cost_numerator, state.open_cost_denominator) or \
                        exact_pair(state.unrealized_pnl_numerator,
                                   state.unrealized_pnl_denominator):
                    raise FinanceError("completed-flat outcome has residual position exposure")
            return {
                "authority": "review_only",
                "runId": run_id,
                "manifestHash": manifest_hash,
                "status": "completed_flat",
                "clockMode": manifest.scenario.clock_mode,
                "replayCursorAt": run["replay_cursor_at"].isoformat(),
                "eventCounts": {
                    "source": str(oracle.source_count),
                    "trading": str(sum(event.kind == "fill" for event in events)),
                    "economic": str(oracle.economic_count),
                },
                "realizedPnlBySettlementAsset": _realized_by_asset(positions),
                "feesByAsset": _group_totals(positions, "fee_totals"),
                "fundingByAsset": _group_totals(positions, "funding_totals"),
                "aggregatePnl": {"status": "unknown",
                    "reason": "native asset values have no shared valuation basis"},
                "returnOnEquity": {"status": "unknown",
                    "reason": "a comparable opening equity valuation is unavailable"},
                "lineage": {
                    "scenarioHash": manifest.scenario.scenario_hash,
                    "datasetHash": manifest.scenario.dataset_hash,
                    "openingAccountSnapshotHash": manifest.account_snapshot_hash,
                    "currentAccountSnapshotHash": current_snapshot_hash,
                    "sourceRoot": oracle.source_root,
                    "journalRoot": oracle.journal_root,
                    "positionRoot": oracle.position_root,
                    "verifiedPositionCount": str(len(positions)),
                    "verifiedSourceEventCount": str(len(events)),
                    "accountRevision": str(account["revision"]),
                },
            }
