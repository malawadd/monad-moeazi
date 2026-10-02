"""A queued rule is nonauthorizing work, never a caller-provided financial hold."""
from moeazi_agent.finance_contracts import FinanceError, _digest
from test_stage3_simulation_routes import HEADERS, LOOKUP, setup


def entry_body():
    rule = {"schema_version": 1, "instrument_version_id": "btc-spot-v1",
            "action": "spot_buy", "side": "buy", "trigger": "always",
            "threshold_price_quote_per_base": None, "desired_quantity_units": "100",
            "horizon_seconds": 30, "rationale_summary": "Deterministic simulation rule"}
    rule["rule_hash"] = _digest("moeazi-replay-strategy-rule-v1", rule)
    return {**LOOKUP, "request_id": "entry-a", "rule": rule}


def test_owned_rule_queues_before_dispatch_without_a_financial_hold(monkeypatch):
    http, calls = setup(monkeypatch)

    async def queue(scope, run, manifest, rule, actor, request_id):
        assert actor == "alice" and request_id == "entry-a"
        assert rule.desired_quantity_units == "100"
        calls.append("queued")
        return {"requestId": request_id, "status": "queued", "projectionRevision": 1}

    http.app.state.simulation.queue_entry_request = queue
    result = http.post("/v1/simulation/runs/request-entry", headers=HEADERS, json=entry_body())
    assert result.status_code == 200, result.text
    assert calls == ["owner", "queued", "dispatch"]
    assert result.json()["nonAuthorizing"] is True
    assert result.json()["supervisor"]["status"] == "retry_required"


def test_rule_or_authority_injection_rejects_before_queue(monkeypatch):
    http, calls = setup(monkeypatch)
    for extra in ({"reservation_id": "forged"}, {"worker_id": "root"},
                  {"created_by_subject": "bob"}, {"strategy_account_id": "foreign"}):
        result = http.post("/v1/simulation/runs/request-entry", headers=HEADERS,
                           json={**entry_body(), **extra})
        assert result.status_code == 422
    body = entry_body()
    body["rule"]["desired_quantity_units"] = "999999"
    assert http.post("/v1/simulation/runs/request-entry", headers=HEADERS,
                     json=body).status_code == 422
    assert http.post("/v1/simulation/runs/request-entry", json=entry_body()).status_code == 401
    assert calls == []


def test_stopped_or_conflicting_request_does_not_wake_worker(monkeypatch):
    http, calls = setup(monkeypatch)

    async def reject(*args):
        calls.append("rejected")
        raise FinanceError("run stopped or request identity changed")

    http.app.state.simulation.queue_entry_request = reject
    response = http.post("/v1/simulation/runs/request-entry", headers=HEADERS, json=entry_body())
    assert response.status_code == 409
    assert calls == ["owner", "rejected"]
