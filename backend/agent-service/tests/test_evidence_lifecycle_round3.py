import json
import inspect
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.contracts import AgentRunView, EvidenceRef, SignalReport
from moeazi_agent.evaluation_lifecycle import EvaluationLifecycleGate
from moeazi_agent.evaluation_storage import EvaluationRepository
from moeazi_agent.evidence_lifecycle_contracts import (
    CopyDispositionReceipt, LifecycleScope,
)
from moeazi_agent.evidence_lifecycle_deletion import aggregate_deletion, digest
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_registry import policy_for
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.evidence_lifecycle_operations import validate_runtime_restore
from moeazi_agent import evidence_lifecycle_workflow
from moeazi_agent.storage import AnalysisRepository
from moeazi_agent.synthesis import synthesize

NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)
PUBLIC = LifecycleScope(kind="public", key="public")


def archive_payload(long_metadata: bool = False):
    ref = EvidenceRef(id="event-round3", source="gdelt", uri="urn:fixture:round3",
        observed_at=NOW, event_at=NOW, quality_score=1, content_hash="a" * 64)
    report = SignalReport(role="technical", provider="deterministic", model="fixture",
        horizon="hours", stance="neutral", score=0, confidence=1, evidence=[ref],
        risks=[], expires_at=NOW + timedelta(minutes=5))
    call = AgentRunView(role="technical", provider="deterministic", model="fixture",
        status="completed", evidence_ids=[ref.id]).model_dump(mode="json")
    call["metadata"] = {"bounded": "x" * 3_000 if long_metadata else "ok"}
    synthesis = synthesize("BTC", "focus", [report],
        [AgentRunView.model_validate({key: value for key, value in call.items()
            if key in AgentRunView.model_fields})], 0, analysis_id="analysis-round3")
    return {"analysis_id": synthesis.analysis_id, "market": synthesis.market,
        "synthesis": synthesis.model_dump(mode="json"),
        "reports": [report.model_dump(mode="json")], "calls": [call]}


@pytest.mark.parametrize("content", [
    r'{"api\u004bey":"synthetic-secret"}',
    "api\u200bKey=synthetic-secret",
    r"authorization\u0054oken=synthetic-secret",
    "private\u200bKey:synthetic-secret",
])
def test_escaped_and_zero_width_secret_aliases_fail_closed(content):
    decision, payload, receipts, schedule = evaluate_persistence(
        producer="provider_prompt", purpose="agent_analysis", sink="provider.model_request",
        scope=PUBLIC, payload={"request_id": "request-round3", "market": "BTC",
            "content": content, "evidence_ids": []}, artifact_id="request-round3",
        idempotency_key="round3:escaped-secret", observed_at=NOW)
    assert decision.outcome == "block" and decision.reasons == ["prohibited_content"]
    assert not payload and not receipts and schedule is None


@pytest.mark.parametrize("content", [
    "API key rotation guidance has no assigned value",
    "capikey market label", "authorization tokenization overview",
])
def test_benign_secret_near_matches_remain_admissible(content):
    decision, payload, receipts, _ = evaluate_persistence(
        producer="provider_prompt", purpose="agent_analysis", sink="provider.model_request",
        scope=PUBLIC, payload={"request_id": "request-benign", "market": "BTC",
            "content": content, "evidence_ids": []}, artifact_id="request-benign",
        idempotency_key=f"round3:benign:{len(content)}", observed_at=NOW)
    assert decision.outcome in {"allow", "transformed"}
    assert payload["evidence_ids"] == [] and receipts


def test_empty_archive_collections_return_bounded_receipts_not_stop_iteration():
    source = archive_payload()
    source["reports"] = []
    source["calls"] = []
    decision, admitted, receipts, schedule = evaluate_persistence(
        producer="analysis_archive", purpose="agent_analysis", sink="timescale.analysis_body",
        scope=PUBLIC, payload=source, artifact_id=source["analysis_id"],
        idempotency_key="round3:empty-archive", observed_at=NOW)
    assert decision.outcome in {"allow", "transformed"}
    assert admitted["reports"] == admitted["calls"] == []
    assert len(receipts) == len(source) and schedule


class Result:
    rowcount = 1
    def __init__(self, rows=None): self.rows = rows or []
    def all(self): return self.rows


class Connection:
    def __init__(self, decision=None, schedule=None):
        self.calls = []; self.decision = decision; self.schedule = schedule
    async def execute(self, statement, values):
        self.calls.append((str(statement), values))
        if "FROM evidence_lifecycle_decisions d JOIN" in str(statement) \
                and self.decision and self.schedule:
            return Result([SimpleNamespace(decision_payload=self.decision.model_dump(
                mode="json"), decision_hash=self.decision.decision_hash,
                decision_scope=self.decision.scope.key,
                decision_policy=self.decision.policy_hash, outcome=self.decision.outcome,
                schedule_payload=self.schedule.model_dump(mode="json"),
                schedule_hash=self.schedule.schedule_hash,
                artifact_id=self.schedule.artifact_id,
                schedule_scope=self.schedule.scope_key,
                schedule_policy=self.schedule.policy_hash,
                body_expires_at=self.schedule.body_expires_at)])
        return Result()


class Context:
    def __init__(self, connection): self.connection = connection
    async def __aenter__(self): return self.connection
    async def __aexit__(self, *_): return False


class Engine:
    def __init__(self, decision=None, schedule=None):
        self.connection = Connection(decision, schedule)
    def begin(self): return Context(self.connection)


@pytest.mark.asyncio
async def test_analysis_storage_writes_exact_admitted_transformed_archive():
    source = archive_payload(long_metadata=True)
    decision, admitted, _, schedule = evaluate_persistence(producer="analysis_archive",
        purpose="agent_analysis", sink="timescale.analysis_body", scope=PUBLIC,
        payload=source, artifact_id=source["analysis_id"],
        idempotency_key="round3:storage-equality", observed_at=NOW)
    assert admitted["calls"][0]["metadata"]["bounded"] == "x" * 2_048
    engine = Engine(decision, schedule)
    repository = object.__new__(AnalysisRepository)
    repository.engine = engine
    from moeazi_agent.contracts import MarketSynthesis
    await repository.save_run(MarketSynthesis.model_validate(admitted["synthesis"]),
        [SignalReport.model_validate(item) for item in admitted["reports"]],
        admitted["calls"], "public", None,
        lifecycle_decision=decision, lifecycle_schedule=schedule,
        admitted_archive=admitted)
    analysis_values = next(values for sql, values in engine.connection.calls
        if "INSERT INTO analysis_runs" in sql)
    provider_values = engine.connection.calls[-1][1]
    assert json.loads(analysis_values["synthesis"]) == admitted["synthesis"]
    assert json.loads(provider_values["metadata"]) == admitted["calls"][0]["metadata"]
    assert provider_values["lifecycle"] == decision.decision_hash
    assert analysis_values["body_expires"] == schedule.body_expires_at


@pytest.mark.asyncio
async def test_evaluation_storage_writes_admitted_body_and_lifecycle_hash():
    class Decisions:
        async def save_decision_bundle(self, *_): return None
    gate = EvaluationLifecycleGate(None, "run-round3", "BTC", NOW)
    gate.repository = Decisions()
    run = {"run_id": "run-round3", "experiment_id": "experiment", "case_id": "case",
        "subject_id": "subject", "analysis_id": None, "status": "failed",
        "prompt_bundle": {"text": "Ｆixture"}, "output": {}, "validation": {},
        "strategy_results": [], "input_tokens": 0, "output_tokens": 0,
        "provider_cost_microusd": 0, "latency_ms": 1, "error": None}
    decision_hash, admitted = await gate.archive("case", run)
    engine = Engine()
    await EvaluationRepository(engine).save_run(admitted)
    stored = engine.connection.calls[0][1]
    assert stored["lifecycle_decision_hash"] == decision_hash
    assert json.loads(stored["prompt_bundle"]) == admitted["prompt_bundle"]


def test_one_local_copy_receipt_cannot_verify_registry_inventory():
    policy = policy_for("analysis_archive", "agent_analysis", "timescale.analysis_body")
    schedule_hash = "c" * 64
    body = {"artifact_id": "analysis-round3", "schedule_hash": schedule_hash,
        "copy_id": "timescale.analysis_body",
        "owner_id": "timescale_history", "revision": 1, "predecessor_hash": None,
        "status": "verified_logical", "evidence_reference": "fixture",
        "observed_at": NOW.isoformat()}
    receipt_hash = digest(body)
    receipt = CopyDispositionReceipt.model_validate({**body,
        "receipt_id": f"ecd_{receipt_hash[:48]}", "receipt_hash": receipt_hash})
    result = aggregate_deletion(
        "analysis-round3", policy.policy_hash, schedule_hash, [receipt], NOW)
    assert result.outcome == "partial"
    assert set(result.expected_copies) == set(policy.expected_copies)


class HoldResult:
    def __init__(self, scalar=None): self.scalar = scalar; self.rowcount = 1
    def scalar_one_or_none(self): return self.scalar
    def first(self): return self.scalar


class HoldConnection:
    def __init__(self): self.operations = {}; self.holds = []; self.calls = []
    async def execute(self, statement, values):
        sql = str(statement); self.calls.append(sql)
        if "idempotency_key=:key" in sql:
            stored = self.operations.get(values["key"])
            return HoldResult(type("Replay", (), {"request_hash": stored[0],
                "payload": stored[1]})() if stored else None)
        if "SELECT payload FROM evidence_lifecycle_holds" in sql:
            return HoldResult(self.holds[-1] if self.holds else None)
        if "INSERT INTO evidence_lifecycle_holds" in sql:
            self.holds.append(json.loads(values["hold"]))
        if "INSERT INTO evidence_lifecycle_operation_receipts" in sql:
            payload = json.loads(values["payload"])
            self.operations[values["key"]] = (values["request"], payload)
        return HoldResult()


class HoldEngine:
    def __init__(self): self.connection = HoldConnection()
    def begin(self): return Context(self.connection)


@pytest.mark.asyncio
async def test_hold_retry_replays_and_renewal_is_monotonic_with_expiry_outbox():
    engine = HoldEngine(); repository = EvidenceLifecycleRepository(engine)
    args = {"artifact_id": "analysis-hold", "scope_key": "account:account-a",
        "reviewer_hash": "a" * 64, "reason_code": "safety_investigation",
        "duration_seconds": 60, "observed_at": NOW}
    first = await repository.create_or_replay_hold(**args, idempotency_key="hold:first")
    replay = await repository.create_or_replay_hold(**args, idempotency_key="hold:first")
    renewal = await repository.create_or_replay_hold(**{**args,
        "observed_at": NOW + timedelta(seconds=30)}, idempotency_key="hold:renewal")
    assert replay == first and len(engine.connection.holds) == 2
    assert renewal.revision == 2 and renewal.supersedes_hold_hash == first.hold_hash
    assert sum("INSERT INTO evidence_lifecycle_hold_outbox" in sql
        for sql in engine.connection.calls) == 2


@pytest.mark.asyncio
async def test_runtime_restore_validation_consumes_persisted_tombstone():
    class Tombstones:
        async def get_tombstone(self, artifact_id, copy_id, scope_key):
            body = {"artifact_id": artifact_id, "scope_key": scope_key,
                "copy_id": copy_id,
                "cutoff_at": NOW.isoformat(), "policy_hash": "a" * 64,
                "inventory_hash": "b" * 64, "copy_receipt_hash": "c" * 64,
                "body_present": False}
            tombstone_hash = digest(body)
            from moeazi_agent.evidence_lifecycle_deletion import LifecycleTombstone
            return LifecycleTombstone.model_validate({**body,
                "tombstone_id": f"elt_{tombstone_hash[:48]}",
                "tombstone_hash": tombstone_hash})
    result = await validate_runtime_restore(Tombstones(), artifact_id="analysis-restore",
        copy_id="timescale.analysis_body", current_policy_hash="a" * 64,
        restored_policy_hash="a" * 64, inventory_hash="b" * 64,
        scope_matches=True, evaluated_at=NOW)
    assert result.outcome == "quarantine" and result.reason_codes == ["deleted_body"]


@pytest.mark.asyncio
async def test_hold_expiry_appends_transition_and_projects_conservative_state():
    repository_source = inspect.getsource(EvidenceLifecycleRepository.prepare_hold_expiry)
    assert "transition_hash" in repository_source and "SET transition_hash" in repository_source
    assert "SET dispatched_at" not in repository_source
    source = inspect.getsource(evidence_lifecycle_workflow.expire_hold_activity)
    assert 'lifecycleState="partial"' in source
    assert "projectEvidenceLifecycleStatus" in source and "ack_hold_expiry" in source
    assert "nack_hold_expiry" in source
