"""HTTP corpus registration accepts only bounded immutable source references."""
from test_stage3_simulation_routes import HEADERS, LOOKUP, setup


def test_dataset_api_preserves_order_and_uses_authenticated_owner(monkeypatch):
    http, calls = setup(monkeypatch)

    async def register(scope, run, manifest, hashes, subject):
        assert subject == "alice" and hashes == ("b" * 64, "a" * 64)
        calls.append("dataset_registered")
        return {"datasetHash": "c" * 64, "observationCount": 2, "status": "registered"}

    http.app.state.simulation.register_run_dataset = register
    result = http.post("/v1/simulation/runs/dataset", headers=HEADERS,
        json={**LOOKUP, "observation_hashes": ["b" * 64, "a" * 64]})
    assert result.status_code == 200, result.text
    assert calls == ["owner", "dataset_registered", "dispatch"]
    assert result.json()["supervisor"]["status"] == "retry_required"
    assert result.json()["executionQualified"] is False


def test_dataset_rejects_raw_sources_duplicate_hashes_and_untrusted_identity(monkeypatch):
    http, calls = setup(monkeypatch)
    for fields in ({"observations": [{"price": "100"}]}, {"observation_hashes": []},
                   {"observation_hashes": ["bad"]},
                   {"observation_hashes": ["a" * 64, "a" * 64]},
                   {"observation_hashes": ["a" * 64], "created_by_subject": "bob"}):
        result = http.post("/v1/simulation/runs/dataset", headers=HEADERS,
                           json={**LOOKUP, **fields})
        assert result.status_code == 422
    valid = {**LOOKUP, "observation_hashes": ["a" * 64]}
    assert http.post("/v1/simulation/runs/dataset", json=valid).status_code == 401
    assert http.post("/v1/simulation/runs/dataset", json=valid,
        headers={**HEADERS, "X-Moeazi-Subject": "bob"}).status_code == 404
    assert calls == []
