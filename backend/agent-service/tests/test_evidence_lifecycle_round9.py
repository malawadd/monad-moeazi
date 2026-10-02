import inspect
import json
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import BaseModel

from moeazi_agent.dependency_safety_contracts import canonical_payload_digest
from moeazi_agent.evaluation_lifecycle import EvaluationLifecycleGate
from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent import evaluation_pipeline_v2, evaluation_v2_temporal, grounding_evaluator
from moeazi_agent.model_routing import ModelRoute


RUN = datetime(2026, 8, 6, 13, 0, tzinfo=timezone.utc)
HISTORICAL = datetime(2024, 1, 2, tzinfo=timezone.utc)


class Decisions:
    def __init__(self): self.bundles = []
    async def save_decision_bundle(self, *bundle): self.bundles.append(bundle)
    async def verify_provider_dispatch(self, decision, schedule, observed_at):
        if not schedule.artifact_id or observed_at >= min(
                decision.expires_at, schedule.body_expires_at):
            raise RuntimeError("Persisted provider lifecycle decision is expired or blocked")


@pytest.mark.asyncio
async def test_2024_replay_uses_frozen_2026_provider_observation_and_strict_ttl():
    clock = [RUN + timedelta(seconds=299, microseconds=999_999)]
    gate = EvaluationLifecycleGate(None, "fixed-run", "ETH", HISTORICAL,
        provider_observed_at=RUN, dispatch_clock=lambda: clock[0])
    gate.repository = Decisions()
    await gate("specialist", json.dumps({"system": "safe", "user": "safe"}), [])
    decision = gate.provider_decisions["specialist"]
    assert decision.evaluated_at == RUN and decision.expires_at == RUN + timedelta(minutes=5)
    await gate.verify_dispatch("specialist")
    clock[0] = decision.expires_at
    with pytest.raises(RuntimeError, match="expired or blocked"):
        await gate.verify_dispatch("specialist")


@pytest.mark.asyncio
async def test_provider_admission_retry_is_deterministic_under_fake_clock():
    hashes = []
    for _ in range(2):
        gate = EvaluationLifecycleGate(None, "fixed-run", "ETH", HISTORICAL,
            provider_observed_at=RUN, dispatch_clock=lambda: RUN)
        gate.repository = Decisions()
        await gate("synthesis", json.dumps({"system": "safe", "user": "same"}), ["e1"])
        hashes.append(gate.provider_decisions["synthesis"].decision_hash)
    assert hashes[0] == hashes[1]


class Output(BaseModel):
    value: str


class Counter:
    def __init__(self): self.calls = 0
    async def invoke(self, *_args, **_kwargs):
        self.calls += 1
        raise AssertionError("provider dispatch must not occur")


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["openai", "deepseek", "openrouter"])
async def test_every_structured_provider_fails_expired_before_dispatch(monkeypatch, kind):
    counter = Counter()
    if kind == "openai":
        class Responses:
            parse = counter.invoke
        class Client:
            responses = Responses()
        class Provider:
            name = "openai"; client = Client()
        monkeypatch.setattr(grounding_evaluator, "OpenAIProvider", Provider)
    elif kind == "deepseek":
        class Client:
            post = counter.invoke
        class Provider:
            name = "deepseek"; client = Client()
        monkeypatch.setattr(grounding_evaluator, "DeepSeekProvider", Provider)
    else:
        class Provider:
            name = "openrouter"
            def _body(self, *_args): return {"messages": [{"content": ""}]}
            _request = counter.invoke
        monkeypatch.setattr(grounding_evaluator, "OpenRouterProvider", Provider)
    gate = EvaluationLifecycleGate(None, "fixed-run", "ETH", HISTORICAL,
        provider_observed_at=RUN, dispatch_clock=lambda: RUN + timedelta(minutes=5))
    gate.repository = Decisions()
    route = ModelRoute(slot="test", provider=kind, model="fixture",
        credentialSource="platform", maxOutputTokens=128,
        inputPriceMicrousdPerMillion=1, cachedInputPriceMicrousdPerMillion=1,
        outputPriceMicrousdPerMillion=1)
    with pytest.raises(RuntimeError, match="expired or blocked"):
        await grounding_evaluator.structured_evaluation(
            Provider(), route, "safe", Output, "provider-stage", "safe", gate, [])
    assert counter.calls == 0


def test_v2_threads_workflow_frozen_run_time_to_all_shared_provider_gates():
    pipeline = inspect.getsource(evaluation_pipeline_v2)
    temporal = inspect.getsource(evaluation_v2_temporal)
    dispatch = inspect.getsource(grounding_evaluator.structured_evaluation)
    assert "market_snapshot[\"observed_at\"]" not in pipeline.split(
        "lifecycle_gate = EvaluationLifecycleGate", 1)[1].split("calls =", 1)[0]
    assert "provider_observed_at=run_observed_at" in pipeline
    assert "market_snapshot, evidence, observed_at" in temporal
    assert dispatch.count("await lifecycle_gate.verify_dispatch(name)") == 4


class Result:
    def __init__(self, row=None, scalar=None): self.row, self.scalar = row, scalar
    def first(self): return self.row
    def all(self): return [] if self.row is None else (
        self.row if isinstance(self.row, list) else [self.row])
    def scalar_one(self): return self.scalar
    def __iter__(self): return iter(self.all())


def row(**values): return type("Row", (), values)()


class TraceConnection:
    def __init__(self, body, decision, schedule, event_time):
        self.body, self.decision, self.schedule = body, decision, schedule
        self.admitted_hash = decision.sanitized_payload_hash
        self.event_time = event_time

    async def execute(self, statement, _values):
        sql = str(statement)
        if "pg_advisory_xact_lock" in sql:
            return Result()
        if "FROM analysis_runs" in sql:
            return Result(row(body_expires_at=RUN + timedelta(hours=1),
                lifecycle_deleted_at=None, outcome="allow", schedule_hash="1" * 64,
                identity_count=1))
        if "FROM agent_trace_events" in sql:
            decision, schedule = self.decision, self.schedule
            return Result(row(event_id="event-a", created_at=self.event_time,
                lifecycle_deleted_at=None, lifecycle_admitted_body=self.body,
                lifecycle_decision_hash=decision.decision_hash,
                decision_hash=decision.decision_hash,
                admitted_payload_hash=self.admitted_hash,
                decision_payload=decision.model_dump(mode="json"),
                decision_scope="account:account-a", decision_outcome=decision.outcome,
                decision_policy=decision.policy_hash,
                schedule_payload=schedule.model_dump(mode="json"),
                schedule_hash=schedule.schedule_hash,
                schedule_scope="account:account-a", schedule_artifact="analysis-a",
                schedule_policy=schedule.policy_hash,
                body_expires_at=schedule.body_expires_at))
        if "FROM evidence_copy_receipts" in sql: return Result(row=[])
        if "SELECT EXISTS" in sql: return Result(scalar=False)
        raise AssertionError(sql)


class Context:
    def __init__(self, connection): self.connection = connection
    async def __aenter__(self): return self.connection
    async def __aexit__(self, *_args): return False


@pytest.mark.asyncio
async def test_stream_body_is_exact_durable_hash_bound_content_and_mismatch_withholds():
    event_time = RUN - timedelta(minutes=1)
    decision_hash = "d" * 64
    body = json.dumps({"account_id": "account-a", "analysis_id": "analysis-a",
        "event_id": "event-a", "created_at": event_time.isoformat(),
        "output_summary": {"source": "durable"}}, sort_keys=True, separators=(",", ":"))
    decision, admitted, _, schedule = evaluate_persistence(
        producer="trace_event", purpose="monitoring", sink="timescale.agent_trace",
        scope=LifecycleScope(kind="account", key="account:account-a",
            strategy_account_id="account-a"),
        payload={"event_id": "event-a", "content": body}, artifact_id="analysis-a",
        idempotency_key="trace:event-a:timescale", observed_at=event_time)
    body = str(admitted["content"])
    decision_hash = decision.decision_hash
    connection = TraceConnection(body, decision, schedule, event_time)
    engine = type("Engine", (), {"begin": lambda _self: Context(connection)})()
    repository = EvidenceLifecycleRepository(engine)
    result = await repository.stream_trace_body("analysis-a", "event-a", event_time,
        decision_hash, "account:account-a", RUN)
    assert result == body and "durable" in result
    connection.admitted_hash = "f" * 64
    with pytest.raises(RuntimeError, match="lifecycle authority"):
        await repository.stream_trace_body("analysis-a", "event-a", event_time,
            decision_hash, "account:account-a", RUN)
