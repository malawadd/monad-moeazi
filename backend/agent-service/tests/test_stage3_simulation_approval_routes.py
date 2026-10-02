"""Approval HTTP ownership and persistence ordering; repository tested separately."""
from moeazi_agent.finance_contracts import FinanceError
from test_stage3_simulation_routes import HEADERS, LOOKUP, setup


APPROVAL = {**LOOKUP, "intent_id": "intent-a", "normalized_payload_hash": "b" * 64,
            "expires_at": "2026-09-30T18:00:00Z", "command_id": "approve-a"}


def test_approval_actor_is_authenticated_and_persisted_before_wake(monkeypatch):
    http, calls = setup(monkeypatch)
    captured = []

    async def approve(scope, run, manifest, intent, payload, actor, expiry, command):
        captured.append((scope, run, manifest, intent, payload, actor, expiry, command))
        calls.append("approval_persisted")
        return {"approvalReceiptHash": "c" * 64, "status": "recorded"}

    http.app.state.simulation.record_simulation_approval = approve
    result = http.post("/v1/simulation/runs/approve", headers=HEADERS, json=APPROVAL)
    assert result.status_code == 200, result.text
    assert calls == ["owner", "approval_persisted", "dispatch"]
    assert captured[0][5] == "alice"
    assert captured[0][6].utcoffset().total_seconds() == 0
    assert result.json()["supervisor"]["status"] == "retry_required"
    assert result.json()["executionQualified"] is False


def test_approval_rejects_actor_scope_and_expiry_injection_before_storage(monkeypatch):
    http, calls = setup(monkeypatch)
    for altered in ({"approved_by_subject": "bob"}, {"strategy_account_id": "foreign"},
                    {"expires_at": 1790790000}, {"expires_at": "2026-09-30T18:00:00"},
                    {"normalized_payload_hash": "arbitrary"}):
        result = http.post("/v1/simulation/runs/approve", headers=HEADERS,
                           json={**APPROVAL, **altered})
        assert result.status_code == 422, result.text
    assert http.post("/v1/simulation/runs/approve", json=APPROVAL).status_code == 401
    assert http.post("/v1/simulation/runs/approve", json=APPROVAL,
        headers={**HEADERS, "X-Moeazi-Subject": "bob"}).status_code == 404
    assert calls == []


def test_repository_rejection_never_dispatches_a_simulated_order(monkeypatch):
    http, calls = setup(monkeypatch)

    async def reject(*args):
        calls.append("rejected")
        raise FinanceError("unprepared payload or stopped run")

    http.app.state.simulation.record_simulation_approval = reject
    result = http.post("/v1/simulation/runs/approve", headers=HEADERS, json=APPROVAL)
    assert result.status_code == 409
    assert calls == ["owner", "rejected"]


def test_revocation_remains_owned_and_persists_without_entry_eligibility(monkeypatch):
    http, calls = setup(monkeypatch)

    async def revoke(scope, run, manifest, approval, actor):
        assert actor == "alice" and approval == "c" * 64
        calls.append("revoked")
        return {"approvalReceiptHash": approval, "status": "revoked"}

    http.app.state.simulation.revoke_simulation_approval = revoke
    result = http.post("/v1/simulation/runs/revoke-approval", headers=HEADERS,
                       json={**LOOKUP, "approval_hash": "c" * 64})
    assert result.status_code == 200
    assert calls == ["owner", "revoked", "dispatch"]
    assert result.json()["approval"]["status"] == "revoked"
