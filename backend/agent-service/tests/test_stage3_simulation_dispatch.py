"""Ambiguous workflow starts retain economic identity and cannot replace history."""
from copy import deepcopy

import pytest
from pydantic import ValidationError
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.simulation_dispatch import ensure_simulation_supervisor


class Client:
    def __init__(self, lose_response=False):
        self.started = None
        self.lose_response = lose_response
        self.calls = []

    async def start_workflow(self, name, payload, **options):
        self.calls.append((name, deepcopy(payload), deepcopy(options)))
        if self.started:
            raise WorkflowAlreadyStartedError(options["id"], name)
        self.started = deepcopy(options)
        if self.lose_response:
            raise ConnectionError("accepted start response lost")

    def get_workflow_handle(self, workflow_id):
        assert self.started["id"] == workflow_id
        return self

    async def describe(self):
        return self

    async def memo(self):
        return self.started["memo"]


def scope():
    return FinanceScope(environment="experiment", scope_id="spec-a", strategy_account_id="account-a")


@pytest.mark.asyncio
async def test_ambiguous_start_recovers_exact_workflow_without_new_economics():
    client = Client(lose_response=True)
    with pytest.raises(ConnectionError):
        await ensure_simulation_supervisor(client, scope(), "run-a", "a" * 64)
    result = await ensure_simulation_supervisor(client, scope(), "run-a", "a" * 64)
    assert result["duplicate"] is True
    assert result["execution_qualified"] is False
    assert client.calls[0] == client.calls[1]
    assert client.started["id_reuse_policy"] == WorkflowIDReusePolicy.REJECT_DUPLICATE
    assert client.started["task_queue"] == "moeazi-trading-simulation-v1"


@pytest.mark.asyncio
async def test_changed_manifest_cannot_reuse_existing_workflow_identity():
    client = Client()
    await ensure_simulation_supervisor(client, scope(), "run-a", "a" * 64)
    with pytest.raises(FinanceError, match="different immutable identity"):
        await ensure_simulation_supervisor(client, scope(), "run-a", "b" * 64)
    assert len(client.calls) == 2


@pytest.mark.asyncio
async def test_live_scope_rejects_before_temporal_dispatch():
    client = Client()
    with pytest.raises(ValidationError, match="cannot bind a live scope"):
        await ensure_simulation_supervisor(client,
            FinanceScope(environment="live", scope_id="live", strategy_account_id="account-a"),
            "run-a", "a" * 64)
    assert client.calls == []
