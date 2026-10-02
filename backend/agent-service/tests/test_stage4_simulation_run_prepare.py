"""Focused route checks for owned, evidence-bound simulation preparation."""
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from moeazi_agent import finance_routes, simulation_run_prepare, simulation_routes
from moeazi_agent.account_observation_storage import account_snapshot_hash
from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceScope, _digest
from moeazi_agent.finance_observation_contracts import AccountObservationSnapshotRef
from moeazi_agent.finance_policy import SizingPolicy
from moeazi_agent.lifecycle_run_contracts import SimulationRunManifest, simulation_dataset_hash
from moeazi_agent.lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from moeazi_agent.lifecycle_simulator_models import CAUSAL_MODEL_HASH
from moeazi_agent.observation_contracts import BookLevel, InstrumentVersion, MarketObservation, canonical_hash
from moeazi_agent.simulation_authority import SimulationIdentity


H = "a" * 64
T = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
SCOPE = FinanceScope(environment="experiment", scope_id="spec-a", strategy_account_id="acct-a")
CONTROLLER = ControllerRef(schemaVersion=1, environment="experiment",
    strategyAccountId="acct-a", controllerKind="customer_team", controllerId="spec-a",
    controllerVersionId="team-v1", contentHash=H)
HEADERS = {"Authorization": "Bearer route-test", "X-Moeazi-Subject": "alice"}


def records():
    instrument = InstrumentVersion(instrument_version_id="spot-a", venue_id="hyperliquid",
        native_instrument_id="BTC/USDC", product_kind="spot", base_asset_unit_id="BTC:8",
        quote_asset_unit_id="USDC:6", settlement_asset_unit_id="USDC:6", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, size_decimals=8, contract_multiplier="1",
        price_rule="hyperliquid_spot_significant_figures_v1", lot_step="0.00000001",
        min_size="0.00001", margin_model="none", funding_model="none",
        effective_at=T - timedelta(days=1), registry_hash=H)
    observation = MarketObservation(instrument_version_id="spot-a", source_id="hyperliquid",
        source_event_id="event-a", source_kind="recorded_native",
        source_rights_ref="internal_qualification_only", raw_payload_hash=H,
        observation_kind="book_snapshot", event_at=T - timedelta(seconds=2),
        available_at=T, received_at=T, continuity="snapshot_only", finality="not_applicable",
        bids=(BookLevel(price_quote_per_base="25000", size_base="0.01"),),
        asks=(BookLevel(price_quote_per_base="25001", size_base="0.02"),))
    snapshot_body = dict(scope=SCOPE, snapshot_hash=H, source_account_id="fixture:seed-a",
        origin="recorded_fixture", status="accepted", event_at=T - timedelta(seconds=4),
        available_at=T - timedelta(seconds=3), received_at=T - timedelta(seconds=2),
        cutoff_at=T - timedelta(seconds=1), finality_at=T - timedelta(seconds=1),
        finality="admitted_final", has_gap=False, has_reorg=False, balances_complete=True,
        positions_complete=True, rights_ref="internal_qualification_only",
        source_event_hash=H, source_payload_hash=H, registry_hash=H,
        policy_version="sim-policy-v1", observed_balances=(), observed_positions=())
    snapshot = AccountObservationSnapshotRef.model_construct(**snapshot_body)
    snapshot = AccountObservationSnapshotRef.model_validate({**snapshot_body,
        "snapshot_hash": account_snapshot_hash(snapshot)})
    policy_body = dict(policy_version="sim-policy-v1", instrument_version_id="spot-a",
        max_quantity_units="1000000", min_quantity_units="1", quantity_step_units="1",
        max_gross_notional_units="1000000000", max_directional_notional_units="1000000000",
        initial_margin_bps=0, fee_ceiling_units="0", exit_buffer_units="0",
        max_observation_age_seconds=3600, max_reservation_seconds=3600, approved_live=False)
    policy = SizingPolicy.model_validate({**policy_body,
        "policy_hash": _digest("moeazi-finance-policy-v1", policy_body)})
    return instrument, observation, snapshot, policy


class Result:
    def __init__(self, rows): self.rows = rows
    def mappings(self): return self
    def first(self): return self.rows[0] if self.rows else None
    def all(self): return self.rows


class Connection:
    def __init__(self, engine): self.engine = engine
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return None
    async def execute(self, statement, params):
        sql = str(statement)
        if "FROM finance_accounts" in sql:
            return Result([self.engine.account])
        if "FROM finance_policy_versions" in sql:
            return Result([self.engine.policy])
        if "FROM observation_instrument_versions" in sql:
            return Result([self.engine.instrument])
        if "FROM observation_market_events" in sql:
            return Result(self.engine.observations)
        raise AssertionError("unexpected preparation query")


def stored_row(observation):
    return {"observation_hash": canonical_hash(observation.model_dump(mode="json")),
        "normalized_body": observation.model_dump(mode="json"),
        "source_kind": observation.source_kind, "source_rights_ref": observation.source_rights_ref,
        "instrument_version_id": observation.instrument_version_id,
        "source_id": observation.source_id, "source_event_id": observation.source_event_id,
        "raw_payload_hash": observation.raw_payload_hash}


class Engine:
    def __init__(self, instrument, observation, snapshot, policy):
        self.instrument = {"instrument_version_id": instrument.instrument_version_id,
            "registry_hash": instrument.registry_hash, "manifest": instrument.model_dump(mode="json")}
        self.observation = stored_row(observation)
        self.observations = [self.observation]
        self.account = {"revision": 5, "reconciliation_state": "clean",
            "source_account_id": snapshot.source_account_id,
            "observation_snapshot_hash": snapshot.snapshot_hash,
            "policy_version": policy.policy_version, "policy_hash": policy.policy_hash}
        self.policy = {"policy_json": policy.model_dump(mode="json"),
                       "policy_hash": policy.policy_hash}
    def connect(self): return Connection(self)


def payload(observation, *, seed=3):
    observations = observation if isinstance(observation, (tuple, list)) else (observation,)
    return {"experiment_spec_id": "spec-a", "run_id": "prepared-a",
        "observation_hashes": [canonical_hash(item.model_dump(mode="json"))
                               for item in observations],
        "rule": {"schema_version": 1, "instrument_version_id": "spot-a",
            "action": "spot_buy", "side": "buy", "trigger": "always",
            "threshold_price_quote_per_base": None, "desired_quantity_units": "1000",
            "horizon_seconds": 60, "rationale_summary": "test signal"},
        "scenario": {"schema_version": 1, "seed": seed, "clock_mode": "historical_replay",
            "simulation_cursor_at": T.isoformat(),
            "simulation_end_at": (T + timedelta(minutes=5)).isoformat(),
            "evidence_cutoff_at": T.isoformat(), "latency_ms": 0, "cancel_latency_ms": 0,
            "max_book_age_ms": 5000, "depth_participation_bps": 10000, "fee_bps": 0,
            "funding_bps": 0, "protection_outcome_model": "confirm",
            "queue_model": "no_queue_estimate", "fee_rules": [], "funding_rules": [],
            "outcome_rules": [], "max_execution_deviation_bps": 500,
            "order_time_in_force_ms": 500, "max_fill_events_per_order": 4},
        "protection_policy": {"schema_version": 1,
            "policy_version": "bounded-historical-unprotected-v1",
            "maximum_unprotected_seconds": 1,
            "allow_increases_before_deadline": True,
            "deadline_action": "stop_and_escalate"}}


def setup(monkeypatch):
    instrument, observation, snapshot, policy = records()
    engine = Engine(instrument, observation, snapshot, policy)
    finance = SimpleNamespace(engine=engine,
        read_account_risk_snapshot=lambda scope: None)
    async def risk(scope):
        return {"reconciliationState": "clean", "accountRevision": "5",
                "observationSnapshotHash": snapshot.snapshot_hash}
    finance.read_account_risk_snapshot = risk
    stored = []
    async def load_snapshot(self, value):
        assert value == snapshot.snapshot_hash
        return snapshot
    async def store_evidence(self, value):
        stored.append(value)
        return value.snapshot_hash
    monkeypatch.setattr(simulation_run_prepare.AccountObservationRepository, "load_by_hash", load_snapshot)
    monkeypatch.setattr(simulation_run_prepare.ObservationRepository, "store_evidence_snapshot", store_evidence)
    async def identity(subject, spec):
        assert subject == "alice" and spec == "spec-a"
        return SimulationIdentity(SCOPE, CONTROLLER, "b" * 64, "c" * 64, None)
    monkeypatch.setattr(simulation_run_prepare, "_identity", identity)
    monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "route-test")))
    app = FastAPI()
    app.include_router(simulation_routes.router)
    app.state.finance = finance
    return TestClient(app), observation, stored


def test_prepare_returns_registerable_manifest_rule_and_ordered_dataset(monkeypatch):
    http, observation, stored = setup(monkeypatch)
    response = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                         json=payload(observation))
    assert response.status_code == 200, response.text
    body = response.json()
    manifest = SimulationRunManifest.model_validate_json(json.dumps(body["manifest"]))
    assert body["controllerMode"] == "shadow"
    assert body["expectedRevision"] == 5
    assert body["observationHashes"] == [canonical_hash(observation.model_dump(mode="json"))]
    assert body["datasetHash"] == simulation_dataset_hash((observation,))
    assert body["rule"]["rule_hash"] == manifest.strategy_artifact_hash
    assert manifest.account_snapshot_hash == body["accountSnapshotHash"]
    assert stored[0].snapshot_hash == body["evidenceSnapshotHash"]
    assert manifest.scenario.dataset_hash == body["datasetHash"]
    assert manifest.manifest_hash
    changed = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                        json=payload(observation, seed=4)).json()
    assert changed["manifest"]["manifest_hash"] != body["manifest"]["manifest_hash"]
    assert changed["manifest"]["scenario"]["scenario_hash"] != manifest.scenario.scenario_hash
    assert body["manifest"]["scenario"]["model_version"] == CAUSAL_MODEL_VERSION
    assert body["manifest"]["scenario"]["model_hash"] == CAUSAL_MODEL_HASH


def future_book(observation):
    body = observation.model_dump(mode="json")
    body.update(source_event_id="event-b", event_at=(T + timedelta(seconds=1)).isoformat(),
        available_at=(T + timedelta(seconds=2)).isoformat(),
        received_at=(T + timedelta(seconds=3)).isoformat(),
        bids=[{"price_quote_per_base": "25010", "size_base": "0.01"}],
        asks=[{"price_quote_per_base": "25011", "size_base": "0.02"}])
    return MarketObservation.model_validate(body)


def test_prepare_uses_available_prefix_for_initial_evidence_but_keeps_full_dataset(monkeypatch):
    http, first, stored = setup(monkeypatch)
    future = future_book(first)
    engine = http.app.state.finance.engine
    engine.observations.append(stored_row(future))
    response = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                         json=payload((first, future)))
    assert response.status_code == 200, response.text
    body = response.json()
    first_hash = canonical_hash(first.model_dump(mode="json"))
    future_hash = canonical_hash(future.model_dump(mode="json"))
    assert body["observationHashes"] == [first_hash, future_hash]
    assert body["datasetHash"] == simulation_dataset_hash((first, future))
    assert body["manifest"]["scenario"]["dataset_hash"] == body["datasetHash"]
    assert stored[0].accepted_observation_hashes == (first_hash,)
    assert all(row.source_event_id != future.source_event_id for row in stored[0].excluded)


def test_prepare_rejects_book_available_by_cutoff_but_received_after_it(monkeypatch):
    http, first, stored = setup(monkeypatch)
    body = first.model_dump(mode="json")
    body.update(source_event_id="event-unreceived",
        event_at=(T - timedelta(seconds=1)).isoformat(),
        available_at=T.isoformat(), received_at=(T + timedelta(seconds=3)).isoformat())
    unreceived = MarketObservation.model_validate(body)
    http.app.state.finance.engine.observations.append(stored_row(unreceived))
    response = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                         json=payload((first, unreceived)))
    assert response.status_code == 409 and not stored


def test_prepare_requires_downstream_latest_book_to_be_fresh_at_cursor(monkeypatch):
    http, first, stored = setup(monkeypatch)
    early_body = first.model_dump(mode="json")
    early_body["available_at"] = (T - timedelta(seconds=1)).isoformat()
    early = MarketObservation.model_validate(early_body)
    latest_body = first.model_dump(mode="json")
    latest_body.update(source_event_id="event-latest",
        event_at=(T - timedelta(seconds=10)).isoformat(),
        available_at=T.isoformat(), received_at=T.isoformat())
    stale_latest = MarketObservation.model_validate(latest_body)
    engine = http.app.state.finance.engine
    engine.observations[:] = [stored_row(early), stored_row(stale_latest)]
    request = payload((early, stale_latest))
    request["scenario"]["simulation_cursor_at"] = (T + timedelta(seconds=1)).isoformat()
    response = http.post("/v1/simulation/runs/prepare", headers=HEADERS, json=request)
    assert response.status_code == 409 and not stored


def test_prepare_rejects_corpus_without_initial_decision_book_or_tampered_future_row(monkeypatch):
    http, first, stored = setup(monkeypatch)
    future = future_book(first)
    engine = http.app.state.finance.engine
    engine.observations[:] = [stored_row(future)]
    no_initial_book = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                                json=payload(future))
    assert no_initial_book.status_code == 409 and not stored

    http, first, stored = setup(monkeypatch)
    future = future_book(first)
    engine = http.app.state.finance.engine
    bad_future = stored_row(future)
    bad_future["normalized_body"]["asks"][0]["price_quote_per_base"] = "25012"
    engine.observations.append(bad_future)
    tampered_future = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                                json=payload((first, future)))
    assert tampered_future.status_code == 409 and not stored


def test_prepare_rejects_missing_auth_invalid_source_and_stale_account(monkeypatch):
    http, observation, stored = setup(monkeypatch)
    request = payload(observation)
    assert http.post("/v1/simulation/runs/prepare", json=request).status_code == 401
    engine = http.app.state.finance.engine
    forged_model = payload(observation)
    forged_model["scenario"]["model_version"] = "legacy-v1"
    forged_model["scenario"]["model_hash"] = "f" * 64
    rejected_model = http.post("/v1/simulation/runs/prepare", headers=HEADERS,
                               json=forged_model)
    assert rejected_model.status_code == 422 and not stored
    engine.observation["source_rights_ref"] = "spoofed"
    invalid = http.post("/v1/simulation/runs/prepare", headers=HEADERS, json=request)
    assert invalid.status_code == 409 and not stored
    engine.observation["source_rights_ref"] = observation.source_rights_ref
    http.app.state.finance.read_account_risk_snapshot = lambda scope: None
    async def stale(scope):
        return {"reconciliationState": "unknown", "accountRevision": "5",
                "observationSnapshotHash": engine.account["observation_snapshot_hash"]}
    http.app.state.finance.read_account_risk_snapshot = stale
    stale_result = http.post("/v1/simulation/runs/prepare", headers=HEADERS, json=request)
    assert stale_result.status_code == 409 and not stored
