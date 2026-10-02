"""Exact, bounded outcome reads and non-mutating replay source verification."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_position_math_contracts import AssetTotal, PositionArithmeticState
from moeazi_agent.lifecycle_source_replay import materialize_run_events
from moeazi_agent.simulation_outcome_reads import read_simulation_outcome
from test_stage3_lifecycle_contracts import H, SCOPE, T
from test_stage3_run_contracts import manifest


class Result:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows

    def one(self):
        assert len(self.rows) == 1
        return self.rows[0]


class ReplayConnection:
    def __init__(self, run, counts=None, account=None):
        self.run = run
        self.counts = counts or {"dataset_count": 1, "order_count": 0,
            "source_event_count": 0, "position_count": 0,
            "dirty_position_count": 0}
        self.account = account or {"revision": 3, "reconciliation_state": "clean",
                                  "observation_snapshot_hash": H,
                                  "source_account_id": "fixture:account-a"}
        self.sql = []

    async def execution_options(self, **_kwargs):
        return self

    def begin(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def execute(self, statement, _params=None):
        query = str(statement)
        self.sql.append(query)
        if query.startswith("SET TRANSACTION READ ONLY"):
            return Result()
        if "SELECT manifest_hash,manifest_json,replay_cursor_at FROM simulation_runs" in query:
            return Result([self.run])
        if "SELECT order_id,event_hash,source_stream" in query:
            return Result()
        if "SELECT COALESCE((SELECT observation_count" in query:
            return Result([self.counts])
        if "SELECT revision,reconciliation_state,observation_snapshot_hash" in query:
            return Result([self.account])
        if query.lstrip().startswith("INSERT"):
            return Result()
        raise AssertionError(query)


def _run(manifest_body):
    return {"manifest_hash": manifest_body.manifest_hash,
        "manifest_json": manifest_body.model_dump(mode="json"),
        "replay_cursor_at": manifest_body.scenario.simulation_cursor_at,
        "run_id": manifest_body.run_id, "status": "completed_flat",
        "entries_stopped": True, "pending_obligations": False,
        "created_by_subject": "subject-a"}


def _event(cursor):
    return SimpleNamespace(order_id="order-a", simulation_cursor_at=cursor,
        sequence=1, source_event_id="source-a", event_hash=H,
        source_stream="spot_book", source_revision="1", kind="fill",
        event_at=cursor, available_at=cursor,
        model_dump=lambda **_kw: {"eventHash": H})


@pytest.mark.asyncio
async def test_read_only_materializer_rejects_missing_due_fact_without_lock_or_insert(monkeypatch):
    from moeazi_agent import lifecycle_source_replay as source

    run_manifest = manifest()
    connection = ReplayConnection(_run(run_manifest))
    monkeypatch.setattr(source, "_simulated", lambda *_args, **_kwargs:
                        _async_value((_event(T),)))
    with pytest.raises(FinanceError, match="read-only replay source prefix"):
        await materialize_run_events(connection, run_manifest, read_only=True)
    run_select = next(query for query in connection.sql if
                      "SELECT manifest_hash,manifest_json,replay_cursor_at" in query)
    assert "FOR UPDATE" not in run_select
    assert not any(query.lstrip().startswith("INSERT") for query in connection.sql)


@pytest.mark.asyncio
async def test_default_materializer_retains_writer_lock_and_insert(monkeypatch):
    from moeazi_agent import lifecycle_source_replay as source

    run_manifest = manifest()
    connection = ReplayConnection(_run(run_manifest))
    monkeypatch.setattr(source, "_simulated", lambda *_args, **_kwargs:
                        _async_value((_event(T),)))
    result = await materialize_run_events(connection, run_manifest)
    assert len(result) == 1
    run_select = next(query for query in connection.sql if
                      "SELECT manifest_hash,manifest_json,replay_cursor_at" in query)
    assert "FOR UPDATE" in run_select
    assert any(query.lstrip().startswith("INSERT INTO simulation_order_events")
               for query in connection.sql)


async def _async_value(value):
    return value


def _position(manifest_body, instrument, realized_num, realized_den, fees, funding):
    return PositionArithmeticState(scope=SCOPE, run_id=manifest_body.run_id,
        instrument_version_id=instrument, instrument_registry_hash=H,
        location_id="spot:test", quantity_kind="asset_native",
        base_asset_unit_id="ETH:18", base_registry_hash=H,
        settlement_asset_unit_id="USDC:6", settlement_registry_hash=H,
        signed_quantity_units="0", contract_size_unit_id=None,
        contract_size_units=None, open_cost_numerator="0", open_cost_denominator="1",
        realized_pnl_numerator=realized_num, realized_pnl_denominator=realized_den,
        unrealized_pnl_numerator="0", unrealized_pnl_denominator="1",
        mark_price_numerator=None, mark_price_denominator=None,
        margin_reserved_units="0", collateral_units="0",
        fee_totals=tuple(AssetTotal(asset_unit_id="ETH:18", registry_hash=H,
                                    signed_units=str(fees)) for _ in [0] if fees),
        funding_totals=tuple(AssetTotal(asset_unit_id="USDC:6", registry_hash=H,
                                        signed_units=str(funding)) for _ in [0] if funding))


class FakeEngine:
    def __init__(self, connection):
        self.connection = connection

    def connect(self):
        return self.connection


class FakeRepository:
    def __init__(self, connection):
        self.finance = SimpleNamespace(engine=FakeEngine(connection))
        self.durable_run = connection.run

    async def _run(self, _connection, _scope, _run_id, *, lock):
        assert lock is False
        return self.durable_run


@pytest.mark.asyncio
async def test_outcome_summarizes_only_verified_exact_native_units(monkeypatch):
    from moeazi_agent import simulation_outcome_reads as outcome

    run_manifest = manifest()
    durable = _run(run_manifest)
    durable["replay_cursor_at"] = run_manifest.scenario.simulation_end_at
    connection = ReplayConnection(durable, counts={"dataset_count": 8,
        "order_count": 2, "source_event_count": 3, "position_count": 2,
        "dirty_position_count": 0})
    left = _position(run_manifest, "spot-a", "1", "2", 10, -3)
    right = _position(run_manifest, "spot-b", "1", "3", 5, 2)
    oracle = SimpleNamespace(source_count=3, economic_count=2,
        source_root=H, journal_root=H, position_root=H,
        positions={("spot-a", "spot:test"): left,
                   ("spot-b", "spot:test"): right})
    facts = (SimpleNamespace(kind="fill"), SimpleNamespace(kind="funding"),
             SimpleNamespace(kind="cancelled"))

    async def verified(*_args, **kwargs):
        assert kwargs == {"read_only": True}
        assert _args[4]["source_account_id"] == "fixture:account-a"
        return oracle, facts

    monkeypatch.setattr(outcome, "verify_replay_checkpoint", verified)
    receipt = await read_simulation_outcome(FakeRepository(connection), SCOPE,
        run_manifest.run_id, run_manifest.manifest_hash, "subject-a")
    assert receipt["eventCounts"] == {"source": "3", "trading": "1", "economic": "2"}
    assert receipt["realizedPnlBySettlementAsset"] == [{"assetUnitId": "USDC:6",
        "registryHash": H, "numerator": "5", "denominator": "6"}]
    assert receipt["feesByAsset"][0]["units"] == "15"
    assert receipt["fundingByAsset"][0]["units"] == "-1"
    assert receipt["aggregatePnl"]["status"] == "unknown"
    assert receipt["returnOnEquity"]["status"] == "unknown"


@pytest.mark.asyncio
async def test_outcome_owner_and_size_bounds_fail_before_oracle(monkeypatch):
    from moeazi_agent import simulation_outcome_reads as outcome

    run_manifest = manifest()
    durable = _run(run_manifest)
    durable["replay_cursor_at"] = run_manifest.scenario.simulation_end_at
    connection = ReplayConnection(durable, counts={"dataset_count": 1,
        "order_count": 0, "source_event_count": 257, "position_count": 0,
        "dirty_position_count": 0})
    called = False

    async def verified(*_args, **_kwargs):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(outcome, "verify_replay_checkpoint", verified)
    with pytest.raises(FinanceError, match="owner or manifest"):
        await read_simulation_outcome(FakeRepository(connection), SCOPE,
            run_manifest.run_id, run_manifest.manifest_hash, "wrong-subject")
    durable["created_by_subject"] = "subject-a"
    with pytest.raises(FinanceError, match="bounded clean-run scope"):
        await read_simulation_outcome(FakeRepository(connection), SCOPE,
            run_manifest.run_id, run_manifest.manifest_hash, "subject-a")
    assert not called
