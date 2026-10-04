import asyncio
import json
from types import SimpleNamespace

import pytest

from moeazi_agent.test_center import TestCenterRepository as CenterRepository


class Result:
    def __init__(self, row=None): self.row = row
    def first(self): return self.row


class RaceConnection:
    def __init__(self, engine): self.engine = engine

    async def execute(self, statement, values):
        sql = str(statement)
        if "INSERT INTO agent_test_center_runs" in sql:
            key = (values["operatorTestId"], values["idempotencyKey"])
            async with self.engine.lock:
                await asyncio.sleep(0)
                if key in self.engine.runs: return Result()
                self.engine.runs[key] = SimpleNamespace(
                    request_hash=values["requestHash"], payload=json.loads(values["payload"]),
                )
                return Result(self.engine.runs[key])
        if "SELECT request_hash,payload FROM agent_test_center_runs" in sql:
            return Result(self.engine.runs.get((values["operator"], values["key"])))
        if "INSERT INTO agent_test_center_events" in sql:
            self.engine.events.add(values["id"])
            return Result()
        raise AssertionError(sql)


class RaceTransaction:
    def __init__(self, engine): self.connection = RaceConnection(engine)
    async def __aenter__(self): return self.connection
    async def __aexit__(self, *_args): return False


class RaceEngine:
    def __init__(self):
        self.lock = asyncio.Lock(); self.runs = {}; self.events = set()
    def begin(self): return RaceTransaction(self)


def run_payload(request_hash="c" * 64):
    return {"runId": f"run-{'d' * 32}", "operatorTestId": "operator_fixture",
        "featureId": "dependency-safety-envelope",
        "scenarioId": "healthy-render", "mode": "observe", "repositorySha": "a" * 40,
        "registryVersion": "v1", "registryHash": "b" * 64, "controlHash": "c" * 64,
        "fixtureHash": "d" * 64, "safeEnvironment": "test", "invariantVerdict": "pass",
        "idempotencyKey": "race:key", "requestHash": request_hash,
        "events": [{"sequence": 1, "eventType": "run_frozen", "status": "complete"}]}


@pytest.mark.asyncio
async def test_run_idempotency_is_atomic_under_concurrent_races():
    engine = RaceEngine(); repository = CenterRepository(engine)
    first, second = await asyncio.gather(
        repository.save_run(run_payload()), repository.save_run(run_payload()),
    )
    assert first == second
    assert len(engine.runs) == 1 and len(engine.events) == 1
    with pytest.raises(RuntimeError, match="conflict"):
        await repository.save_run(run_payload("e" * 64))
