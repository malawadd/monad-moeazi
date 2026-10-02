"""Authenticated lifecycle route sequencing with fake identity/storage/Temporal."""
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from moeazi_agent import finance_routes, simulation_routes
from moeazi_agent.lifecycle_state import RunAdvanceResult
from test_stage3_run_contracts import manifest
from test_stage3_lifecycle_contracts import SCOPE


HEADERS = {"Authorization": "Bearer route-test", "X-Moeazi-Subject": "alice"}
LOOKUP = {"experiment_spec_id": SCOPE.scope_id, "run_id": "run-a", "manifest_hash": "a" * 64}


def setup(monkeypatch):
    calls = []

    async def owner(subject, environment, spec):
        from fastapi import HTTPException
        if subject != "alice" or spec != SCOPE.scope_id or environment != "experiment":
            raise HTTPException(status_code=404, detail="unowned")
        calls.append("owner")
        return SCOPE

    async def identity(subject, run):
        assert subject == "alice"
        calls.append("entry_identity")
        return SimpleNamespace(scope=SCOPE, experiment_request_hash="b" * 64,
                               authority_fingerprint="c" * 64)

    class Repository:
        async def register_run(self, run, **kwargs):
            calls.append("registered")
            assert kwargs["created_by_subject"] == "alice"
            assert "writer_epoch" not in kwargs
            return self.result()

        async def read_run(self, scope, run_id, manifest_hash):
            assert scope == SCOPE
            calls.append("read")
            return self.result()

        async def read_run_lineage(self, scope, run_id, manifest_hash, subject):
            assert scope == SCOPE and subject == "alice"
            calls.append("lineage")
            return {"manifestHash": manifest_hash, "datasetHash": "d" * 64}

        async def apply_control(self, scope, run_id, manifest_hash, control, **kwargs):
            assert scope == SCOPE
            assert kwargs["requested_by_subject"] == "alice"
            calls.append("persisted_stop")
            return {"commandId": control.command_id, "operation": control.operation,
                    "outcome": "applied", "projectionRevision": 3}

        def result(self):
            return RunAdvanceResult(schema_version=1, run_id="run-a", status="registered",
                cursor_sequence=0, projection_revision=0, pending_obligations=False,
                next_action="await_signal")

    class Temporal:
        async def start_workflow(self, *args, **kwargs):
            calls.append("dispatch")
            raise ConnectionError("local Temporal unavailable")

    monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "route-test")))
    monkeypatch.setattr(simulation_routes, "_viewer_scope", owner)
    monkeypatch.setattr(simulation_routes, "_registered_identity", identity)
    app = FastAPI()
    app.include_router(simulation_routes.router)
    app.state.simulation = Repository()
    app.state.temporal = Temporal()
    return TestClient(app), calls


def test_stop_is_persisted_before_failed_dispatch_and_remains_truthful(monkeypatch):
    http, calls = setup(monkeypatch)
    result = http.post("/v1/simulation/runs/control", headers=HEADERS,
        json={**LOOKUP, "control": {"command_id": "stop-a", "operation": "stop_entries"}})
    assert result.status_code == 200
    assert calls == ["owner", "persisted_stop", "dispatch"]
    body = result.json()
    assert body["control"]["outcome"] == "applied"
    assert body["supervisor"]["status"] == "retry_required"
    assert body["executionQualified"] is False


def test_foreign_or_untrusted_caller_never_reads_or_controls(monkeypatch):
    http, calls = setup(monkeypatch)
    assert http.post("/v1/simulation/runs/read", json=LOOKUP).status_code == 401
    assert http.post("/v1/simulation/runs/read", json=LOOKUP,
        headers={**HEADERS, "X-Moeazi-Subject": "bob"}).status_code == 404
    assert http.post("/v1/simulation/runs/read", headers=HEADERS,
        json={**LOOKUP, "strategy_account_id": "foreign"}).status_code == 422
    assert calls == []


def test_owned_read_uses_viewer_scope_without_requiring_new_entry_eligibility(monkeypatch):
    http, calls = setup(monkeypatch)
    result = http.post("/v1/simulation/runs/read", headers=HEADERS, json=LOOKUP)
    assert result.status_code == 200
    assert calls == ["owner", "read", "lineage"]
    assert result.json()["authority"] == "simulation_only"
    assert result.json()["lineage"]["datasetHash"] == "d" * 64


def test_json_manifest_registers_before_dispatch_and_has_no_client_writer_epoch(monkeypatch):
    http, calls = setup(monkeypatch)
    body = {"manifest": manifest().model_dump(mode="json"), "expected_revision": 1,
            "idempotency_key": "register-run-key-01"}
    result = http.post("/v1/simulation/runs", headers=HEADERS, json=body)
    assert result.status_code == 200, result.text
    assert calls == ["entry_identity", "registered", "dispatch"]
    assert result.json()["registration"] == "persisted"
    assert result.json()["supervisor"]["status"] == "retry_required"
