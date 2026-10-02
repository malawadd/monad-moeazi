"""Activities keep caller data away from account, epoch and worker authority."""
from copy import deepcopy

import pytest
from temporalio.exceptions import ApplicationError

from moeazi_agent.lifecycle_state import RunAdvanceResult
from moeazi_agent.simulation_activities import SimulationActivities


PAYLOAD = {"scope": {"environment": "experiment", "scope_id": "spec-a",
                      "strategy_account_id": "account-a"},
           "run_id": "run-a", "manifest_hash": "a" * 64,
           "command_id": "advance:2", "entries_inhibited": True}


class Repository:
    def __init__(self):
        self.calls = []

    async def advance_run(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return RunAdvanceResult(schema_version=1, run_id="run-a", status="awaiting_protection",
            cursor_sequence=2, projection_revision=3, pending_obligations=True,
            next_action="await_signal")

    async def apply_control(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return {"commandId": kwargs["command_id"], "operation": "stop_entries",
                "outcome": "applied", "projectionRevision": 4}


@pytest.mark.asyncio
async def test_activity_preserves_retry_identity_and_entry_inhibition():
    repo = Repository()
    activities = SimulationActivities(repo, "physical-worker-a")
    first = await activities.advance(PAYLOAD)
    second = await activities.advance(PAYLOAD)
    assert first == second
    assert repo.calls[0] == repo.calls[1]
    args, options = repo.calls[0]
    assert args[3:] == ("physical-worker-a", "advance:2")
    assert options == {"entries_inhibited": True}


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"worker_id": "forged-worker"}, {"writer_epoch": 999}, {"entries_inhibited": "false"},
    {"command_sequence": 8}, {"signer": "forbidden"},
    {"scope": {"environment": "live", "scope_id": "live", "strategy_account_id": "account-a"}},
])
async def test_untrusted_authority_and_live_scope_never_reach_repository(change):
    repo = Repository()
    with pytest.raises(ApplicationError):
        await SimulationActivities(repo, "physical-worker-a").advance({**deepcopy(PAYLOAD), **change})
    assert repo.calls == []


@pytest.mark.asyncio
async def test_control_uses_bound_run_and_stable_original_command():
    repo = Repository()
    body = {key: value for key, value in PAYLOAD.items()
            if key not in {"command_id", "entries_inhibited"}}
    body["control"] = {"command_id": "stop-1", "operation": "stop_entries"}
    result = await SimulationActivities(repo, "physical-worker-a").control(body)
    assert result["commandId"] == "stop-1"
    assert repo.calls[0][1] == {"worker_id": "physical-worker-a", "command_id": "stop-1"}
    body["control"]["scope_id"] = "spec-b"
    with pytest.raises(ApplicationError):
        await SimulationActivities(repo, "physical-worker-a").control(body)
    assert len(repo.calls) == 1
