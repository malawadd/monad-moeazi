import json
from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.orchestrator import AnalysisOrchestrator, AnalysisRequest
from moeazi_agent.providers import DeterministicProvider


RUN = datetime(2026, 8, 6, 15, 0, tzinfo=timezone.utc)
SCOPE = LifecycleScope(kind="public", key="public")


def make_decision(stage="specialist", observed_at=RUN):
    artifact = f"fixed-run:{stage}"
    decision, sanitized, receipts, schedule = evaluate_persistence(
        producer="provider_prompt", purpose="evaluation", sink="provider.model_request",
        scope=SCOPE, payload={"request_id": artifact, "market": "ETH",
            "content": json.dumps({"system": "safe", "user": "safe"}),
            "evidence_ids": []}, artifact_id=artifact,
        idempotency_key=f"evaluation:fixed-run:{stage}", observed_at=observed_at)
    assert schedule is not None
    return decision, sanitized, receipts, schedule


def persisted_row(decision, schedule, **changes):
    values = {
        "decision_id": decision.decision_id,
        "idempotency_key": decision.idempotency_key,
        "input_digest": decision.input_digest,
        "decision_hash": decision.decision_hash,
        "producer": decision.producer, "purpose": decision.purpose,
        "sink": decision.sink, "scope_kind": decision.scope.kind,
        "scope_key": decision.scope.key, "policy_hash": decision.policy_hash,
        "inventory_hash": decision.inventory_hash, "outcome": decision.outcome,
        "reasons": decision.reasons, "evaluated_at": decision.evaluated_at,
        "expires_at": decision.expires_at,
        "admitted_payload_hash": decision.sanitized_payload_hash,
        "payload": decision.model_dump(mode="json"),
        "schedule_id": schedule.schedule_id,
        "schedule_artifact_id": schedule.artifact_id,
        "schedule_scope_key": schedule.scope_key,
        "schedule_policy_hash": schedule.policy_hash,
        "schedule_hash": schedule.schedule_hash,
        "schedule_body_expires_at": schedule.body_expires_at,
        "schedule_expected_copies": schedule.expected_copies,
        "schedule_payload": schedule.model_dump(mode="json"),
    }
    values.update(changes)
    return type("Row", (), values)()


class Result:
    def __init__(self, value): self.value = value
    def first(self): return self.value


class Connection:
    def __init__(self, rows): self.rows = rows
    async def execute(self, _statement, values):
        return Result(self.rows.get(values["hash"]))


class Context:
    def __init__(self, connection): self.connection = connection
    async def __aenter__(self): return self.connection
    async def __aexit__(self, *_args): return False


def repository_for(rows):
    connection = Connection(rows)
    engine = type("Engine", (), {"connect": lambda _self: Context(connection)})()
    return EvidenceLifecycleRepository(engine)


@pytest.mark.asyncio
async def test_persisted_verifier_strict_expiry_and_current_retry_determinism():
    first = make_decision()
    second = make_decision()
    assert first[0].decision_hash == second[0].decision_hash
    row = persisted_row(first[0], first[3])
    repository = repository_for({first[0].decision_hash: row})
    await repository.verify_provider_dispatch(
        first[0], first[3], first[0].expires_at - timedelta(microseconds=1))
    with pytest.raises(RuntimeError, match="expired or blocked"):
        await repository.verify_provider_dispatch(
            second[0], second[3], second[0].expires_at)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing", "malformed", "tamper", "row", "artifact"])
async def test_persisted_verifier_rejects_missing_mismatch_and_tamper(failure):
    decision, _sanitized, _receipts, schedule = make_decision()
    row = persisted_row(decision, schedule)
    if failure == "missing": rows = {}
    else:
        if failure == "malformed": row.payload = "{"
        elif failure == "tamper":
            row.payload = {**decision.model_dump(mode="json"), "policy_hash": "f" * 64}
        elif failure == "row": row.input_digest = "f" * 64
        elif failure == "artifact": row.schedule_artifact_id = "different-artifact"
        rows = {decision.decision_hash: row}
    with pytest.raises(RuntimeError, match="unavailable|malformed|binding"):
        await repository_for(rows).verify_provider_dispatch(
            decision, schedule, RUN)


class PersistedGate:
    def __init__(self, now):
        self.now = now
        self.rows = {}
        self.repository = repository_for(self.rows)
        self.decisions = {}

    async def __call__(self, stage, content, evidence_ids):
        artifact = f"fixed-run:{stage}"
        decision, sanitized, _receipts, schedule = evaluate_persistence(
            producer="provider_prompt", purpose="evaluation", sink="provider.model_request",
            scope=SCOPE, payload={"request_id": artifact, "market": "ETH",
                "content": content, "evidence_ids": sorted(evidence_ids)},
            artifact_id=artifact, idempotency_key=f"evaluation:fixed-run:{stage}",
            observed_at=RUN)
        self.rows[decision.decision_hash] = persisted_row(decision, schedule)
        self.decisions[stage] = (decision, schedule)
        return str(sanitized["content"])

    async def verify_dispatch(self, stage):
        decision, schedule = self.decisions[stage]
        await self.repository.verify_provider_dispatch(decision, schedule, self.now)


class CountingProvider(DeterministicProvider):
    def __init__(self):
        self.analysis_calls = 0
        self.synthesis_calls = 0
        self.credits = 0
        self.cost_microusd = 0

    async def analyze(self, *args, **kwargs):
        self.analysis_calls += 1
        self.credits += 3
        return await super().analyze(*args, **kwargs)

    async def synthesize(self, *args, **kwargs):
        self.synthesis_calls += 1
        self.credits += 7
        return await super().synthesize(*args, **kwargs)


@pytest.mark.asyncio
async def test_orchestrator_specialist_exact_expiry_has_zero_call_credit_and_cost():
    provider = CountingProvider()
    gate = PersistedGate(RUN + timedelta(minutes=5))
    orchestrator = AnalysisOrchestrator(
        {"openai": provider, "deepseek": provider}, max_concurrency=1,
        allow_single_provider=True, lifecycle_gate=gate,
        lifecycle_dispatch_gate=gate.verify_dispatch)
    with pytest.raises(RuntimeError, match="expired or blocked"):
        await orchestrator.run(AnalysisRequest(
            market="ETH", tier="max", scope="evaluation", lite_mode=True))
    assert (provider.analysis_calls, provider.credits, provider.cost_microusd) == (0, 0, 0)


@pytest.mark.asyncio
async def test_orchestrator_synthesis_exact_expiry_has_zero_call_credit_and_cost():
    provider = CountingProvider()
    gate = PersistedGate(RUN + timedelta(minutes=5))
    orchestrator = AnalysisOrchestrator(
        {"openai": provider}, max_concurrency=1, lifecycle_gate=gate,
        lifecycle_dispatch_gate=gate.verify_dispatch)
    with pytest.raises(RuntimeError, match="expired or blocked"):
        await orchestrator._synthesis_call("synthesis", "openai",
            AnalysisRequest(market="ETH", tier="focus", scope="evaluation"), [])
    assert (provider.synthesis_calls, provider.credits, provider.cost_microusd) == (0, 0, 0)
