"""Entry identity is fresh, server-derived and strictly non-live."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.simulation_authority import require_simulation_identity, SimulationEntryAuthorizer
from moeazi_agent.lifecycle_state import EntryAuthorizationRequest


CONTEXT = {
    "schemaVersion": 1,
    "scope": {"environment": "experiment", "scopeId": "spec-a", "strategyAccountId": "account-a"},
    "controllerRef": {"schemaVersion": 1, "environment": "experiment",
        "strategyAccountId": "account-a", "controllerKind": "customer_team",
        "controllerId": "spec-a", "controllerVersionId": "version-a", "contentHash": "a" * 64},
    "experimentRequestHash": "b" * 64, "authorityFingerprint": "c" * 64,
    "datasetHash": None, "entryEligible": True,
    "authority": "simulation_identity_only", "liveExecutionAllowed": False,
}


class Client:
    def __init__(self, context):
        self.context = context
        self.calls = []

    async def command(self, command, **payload):
        self.calls.append((command, payload))
        return deepcopy(self.context)


@pytest.mark.asyncio
async def test_identity_resolves_current_context_each_time_and_honors_later_stop():
    client = Client(deepcopy(CONTEXT))
    resolved = await require_simulation_identity(client, "alice", "spec-a")
    assert resolved.scope.strategy_account_id == "account-a"
    assert resolved.controller_ref.controllerId == "spec-a"
    client.context["entryEligible"] = False
    with pytest.raises(FinanceError):
        await require_simulation_identity(client, "alice", "spec-a")
    assert client.calls == [("getSimulationAuthorityContext", {
        "subject": "alice", "experimentSpecId": "spec-a"})] * 2


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("liveExecutionAllowed", True), ("entryEligible", "true"),
    ("schemaVersion", True), ("authority", "live_execution"),
    ("authorityFingerprint", "unknown"),
])
async def test_malformed_or_excess_authority_is_not_a_simulation_identity(field, value):
    context = deepcopy(CONTEXT)
    context[field] = value
    with pytest.raises(FinanceError):
        await require_simulation_identity(Client(context), "alice", "spec-a")


@pytest.mark.asyncio
async def test_cross_scope_and_cross_account_controller_contexts_reject():
    for field, value in [("controllerId", "spec-b"), ("strategyAccountId", "account-b"),
                         ("environment", "live")]:
        context = deepcopy(CONTEXT)
        context["controllerRef"][field] = value
        with pytest.raises(FinanceError):
            await require_simulation_identity(Client(context), "alice", "spec-a")
    with pytest.raises(FinanceError):
        await require_simulation_identity(Client(CONTEXT), "alice", "spec-b")


@pytest.mark.asyncio
async def test_missing_subject_fails_before_lookup_and_unavailable_service_has_no_fallback():
    client = Client(None)
    with pytest.raises(FinanceError):
        await require_simulation_identity(client, "", "spec-a")
    assert client.calls == []
    with pytest.raises(FinanceError):
        await require_simulation_identity(client, "alice", "spec-a")


@pytest.mark.asyncio
async def test_fresh_entry_receipt_binds_persisted_identity_and_rejects_changed_authority():
    client = Client(deepcopy(CONTEXT))
    identity = await require_simulation_identity(client, "alice", "spec-a")
    request = EntryAuthorizationRequest(schema_version=1, scope=identity.scope, run_id="run-a",
        manifest_hash="d" * 64, created_by_subject="alice",
        experiment_request_hash=identity.experiment_request_hash,
        controller_ref=identity.controller_ref, controller_mode="autopilot",
        registered_authority_fingerprint=identity.authority_fingerprint, authority_epoch=4)
    authorizer = SimulationEntryAuthorizer(client)
    receipt = await authorizer(request)
    assert receipt.scope == request.scope
    assert receipt.run_id == request.run_id
    assert receipt.controller_mode == request.controller_mode
    assert receipt.created_by_subject == "alice"
    for key in ("authorityFingerprint", "experimentRequestHash"):
        client.context = deepcopy(CONTEXT)
        client.context[key] = "e" * 64
        with pytest.raises(FinanceError, match="authority has changed"):
            await authorizer(request)


@pytest.mark.asyncio
async def test_receipt_age_includes_identity_transport_delay(monkeypatch):
    started = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
    current = [started]

    class Clock:
        @staticmethod
        def now(tz):
            return current[0]

    class DelayedClient(Client):
        async def command(self, command, **payload):
            current[0] += timedelta(seconds=8)
            return await super().command(command, **payload)

    identity = await require_simulation_identity(Client(CONTEXT), "alice", "spec-a")
    request = EntryAuthorizationRequest(schema_version=1, scope=identity.scope, run_id="run-a",
        manifest_hash="d" * 64, created_by_subject="alice",
        experiment_request_hash=identity.experiment_request_hash,
        controller_ref=identity.controller_ref, controller_mode="autopilot",
        registered_authority_fingerprint=identity.authority_fingerprint, authority_epoch=4)
    monkeypatch.setattr("moeazi_agent.simulation_authority.datetime", Clock)
    receipt = await SimulationEntryAuthorizer(DelayedClient(CONTEXT))(request)
    assert receipt.checked_at == started
    assert current[0] - receipt.checked_at == timedelta(seconds=8)
