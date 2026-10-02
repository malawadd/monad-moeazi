from datetime import datetime, timedelta, timezone
import json

import pytest
from fastapi import HTTPException

from moeazi_agent import monitoring_api, tracing
from moeazi_agent.contracts import AgentRunView, EvidenceRef, SignalReport
from moeazi_agent.dependency_safety_contracts import SafetyOperation
from moeazi_agent.dependency_safety_matrix import requirements_for
from moeazi_agent.evaluation_lifecycle import EvaluationLifecycleGate
from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import _digest, evaluate_persistence
from moeazi_agent.evidence_lifecycle_operations import (
    create_hold, record_access, record_local_export,
)
from moeazi_agent.evidence_lifecycle_scenarios import evaluate_legacy_baseline
from moeazi_agent.evidence_lifecycle_service import (
    _canonical_decision_body, preflight_ingested_evidence,
)
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.evidence_lifecycle_registry import policy_for
from moeazi_agent.synthesis import synthesize
from moeazi_agent.storage import AnalysisRepository

NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)
PUBLIC = LifecycleScope(kind="public", key="public")


def _archive():
    ref = EvidenceRef(id="evt-full", source="gdelt", uri="urn:fixture:full",
        observed_at=NOW, event_at=NOW - timedelta(seconds=1), quality_score=0.8,
        content_hash="a" * 64)
    report = SignalReport(role="technical", provider="deterministic", model="fixture",
        horizon="hours", stance="bullish", score=0.4, confidence=0.7,
        evidence=[ref], risks=["volatility"], decision_summary="Bounded result",
        key_factors=["breadth"], uncertainties=["liquidity"],
        expires_at=NOW + timedelta(minutes=5))
    run = AgentRunView(role="technical", provider="deterministic", model="fixture",
        status="completed", evidence_ids=[ref.id])
    result = synthesize("BTC", "focus", [report], [run], 0,
        analysis_id="analysis-full-contract")
    return {"analysis_id": result.analysis_id, "market": result.market,
        "synthesis": result.model_dump(mode="json"),
        "reports": [report.model_dump(mode="json")],
        "calls": [run.model_dump(mode="json")]}


def test_complete_contract_shaped_analysis_archive_is_admitted():
    decision, sanitized, receipts, schedule = evaluate_persistence(
        producer="analysis_archive", purpose="agent_analysis", sink="timescale.analysis_body",
        scope=PUBLIC, payload=_archive(), artifact_id="analysis-full-contract",
        idempotency_key="archive:full-contract", observed_at=NOW)
    assert decision.outcome in {"allow", "transformed"}
    assert sanitized["synthesis"]["scenarios"]
    assert sanitized["reports"][0]["evidence"][0]["source"] == "gdelt"
    assert schedule.artifact_id == "analysis-full-contract" and receipts
    AnalysisRepository._validate_lifecycle_authority(
        sanitized["synthesis"]["analysis_id"], PUBLIC.key, decision, schedule)


def test_real_specialist_citation_and_routing_fields_survive_archive_gate():
    payload = _archive()
    payload["calls"][0].update({
        "selected_evidence_ids": ["evt-full"], "invalid_evidence_ids": [],
        "citation_resolution": "exact_id_only", "citation_status": "resolved",
        "metadata": {"upstreamUsesCustomerBilling": False},
    })
    decision, admitted, _, _ = evaluate_persistence(
        producer="analysis_archive", purpose="agent_analysis", sink="timescale.analysis_body",
        scope=PUBLIC, payload=payload, artifact_id="analysis-full-contract",
        idempotency_key="archive:real-specialist", observed_at=NOW)
    assert decision.outcome in {"allow", "transformed"}
    assert admitted["calls"][0]["citation_status"] == "resolved"


def test_full_focus_archive_fits_bounded_contract_without_relaxing_secret_checks():
    payload = _archive()
    payload["reports"] *= 6
    call = payload["calls"][0]
    call.update({
        "selected_evidence_ids": ["evt-full"], "invalid_evidence_ids": [],
        "citation_resolution": "exact_id_only", "citation_status": "resolved",
        "metadata": {"input_tokens": 300, "output_tokens": 200,
            "servedModel": "qwen/qwen3-30b-a3b-instruct-2507",
            "upstreamProvider": "provider", "modelFamily": "qwen",
            "routingStrategy": "price", "fallbackAttempts": 0,
            "generationId": "synthetic-generation", "upstreamUsesCustomerBilling": False},
    })
    payload["calls"] = [call.copy() for _ in range(7)]
    with pytest.raises(ValueError, match="payload_field_count_exceeded"):
        from moeazi_agent.evidence_lifecycle_evaluator import _validate_shape
        _validate_shape(payload)
    decision, admitted, _, schedule = evaluate_persistence(
        producer="analysis_archive", purpose="agent_analysis", sink="timescale.analysis_body",
        scope=PUBLIC, payload=payload, artifact_id=payload["analysis_id"],
        idempotency_key="archive:full-focus", observed_at=NOW)
    assert decision.outcome in {"allow", "transformed"}
    assert len(admitted["calls"]) == 7 and schedule.artifact_id == payload["analysis_id"]


def test_projection_body_preserves_evaluator_timestamp_hash():
    decision, _, _, _ = evaluate_persistence(
        producer="product_projection", purpose="product_projection",
        sink="convex.analysis_projection", scope=PUBLIC,
        payload={"artifact_type": "analysis_snapshot", "content": "{}"},
        artifact_id="analysis-projection", idempotency_key="projection:analysis-projection",
        observed_at=NOW)
    assert decision.outcome in {"allow", "transformed"}
    assert _digest(_canonical_decision_body(decision)) == decision.decision_hash


@pytest.mark.parametrize("content", [
    '{"apiKey":"synthetic-sensitive-token"}',
    "authorizationToken=synthetic-sensitive-token",
    "privateKey: synthetic-sensitive-token",
    "wallet_key = synthetic-sensitive-token",
])
@pytest.mark.parametrize("producer,purpose,sink,payload", [
    ("push_evidence", "evidence_ingest", "timescale.evidence_body", {
        "evidence_id": "evt-string", "source": "gdelt", "reference": "urn:fixture:string",
        "observed_at": NOW.isoformat(), "content_hash": "b" * 64, "market": "BTC"}),
    ("provider_prompt", "agent_analysis", "provider.model_request", {
        "request_id": "request-string", "market": "BTC", "evidence_ids": ["evt-string"]}),
])
def test_string_encoded_secret_aliases_block_real_ingest_and_provider_shapes(
        content, producer, purpose, sink, payload):
    decision, sanitized, receipts, schedule = evaluate_persistence(
        producer=producer, purpose=purpose, sink=sink, scope=PUBLIC,
        payload={**payload, "content": content}, artifact_id="artifact-string",
        idempotency_key=f"string:{producer}:{len(content)}", observed_at=NOW)
    assert decision.outcome == "block" and decision.reasons == ["prohibited_content"]
    assert content not in decision.model_dump_json()
    assert not sanitized and not receipts and schedule is None


def test_ingest_preflight_exposes_only_nonsecret_decision_revision():
    class Ref:
        id = "evt-secret"; source = "gdelt"; uri = "urn:fixture:secret"
        observed_at = NOW; content_hash = "raw-secret-fingerprint"
    class Item:
        ref = Ref(); content = '{"apiKey":"synthetic-sensitive-token"}'
    with pytest.raises(RuntimeError, match="prohibited_content"):
        preflight_ingested_evidence(Item(), "BTC")


def test_feature_one_requires_lifecycle_for_all_frozen_operations():
    bindings = {
        SafetyOperation.INGEST: {"source": "gdelt", "market": "BTC"},
        SafetyOperation.ANALYZE: {"market": "BTC"},
        SafetyOperation.PROPOSE: {"market": "BTC", "analysis_decision_hash": "a",
            "policy_version": "1"},
        SafetyOperation.REQUEST_APPROVAL: {"market": "BTC", "analysis_decision_hash": "a",
            "policy_version": "1"},
    }
    for operation, values in bindings.items():
        assert "evidence_lifecycle" in requirements_for(operation, values)


def test_evaluation_scope_is_account_or_hashed_operator_not_public():
    account = EvaluationLifecycleGate(None, "run-account", "BTC", NOW, "account-a", "subject")
    tenant = EvaluationLifecycleGate(None, "run-tenant", "BTC", NOW, None, "subject")
    assert account.scope.key == "account:account-a"
    assert tenant.scope.kind == "tenant" and "subject" not in tenant.scope.key
    assert EvaluationLifecycleGate(None, "run-public", "BTC", NOW).scope.key == "public"


@pytest.mark.asyncio
async def test_local_access_export_and_hold_write_immutable_operation_receipts():
    class Repository:
        operations = []; decisions = []; holds = []
        async def save_disclosure_operation(self, *args, **kwargs):
            self.decisions.append(kwargs["decision"])
            self.operations.append((args, kwargs)); return args[-1]
        async def save_hold(self, hold): self.holds.append(hold)
        async def create_or_replay_hold(self, **kwargs):
            self.hold_args = kwargs
            return "hold-receipt"
    repository = Repository()
    access, accessed = await record_access(repository, artifact_id="analysis-local",
        account_id="account-a", viewer_subject="viewer-a", output={"summary": "sanitized"},
        idempotency_key="access:analysis-local", observed_at=NOW)
    export, exported = await record_local_export(repository, artifact_id="analysis-local",
        account_id="account-a", viewer_subject="viewer-a", output={"summary": "sanitized"},
        idempotency_key="export:analysis-local", observed_at=NOW)
    hold = await create_hold(repository, artifact_id="analysis-local", account_id="account-a",
        reviewer_subject="viewer-a", reason_code="safety_investigation", duration_seconds=60,
        idempotency_key="hold:analysis-local")
    assert [item[0][0] for item in repository.operations] == ["access", "export"]
    assert access.scope.key == export.scope.key == "account:account-a"
    assert access.decision_hash != access.request_hash and accessed == exported
    assert hold == "hold-receipt" and repository.hold_args["idempotency_key"] == \
        "hold:analysis-local"


def test_baseline_evaluator_is_separate_and_candidate_can_diverge():
    fixture = {"operation": "persist", "payload": {"content": "raw"}}
    assert evaluate_legacy_baseline(fixture) == "allow"


class _Result:
    def __init__(self, rowcount=1, first=None, rows=None, scalar=None):
        self.rowcount = rowcount
        self._first = first
        self.rows = rows or []
        self.scalar = scalar
    def first(self): return self._first
    def scalar_one_or_none(self): return self.scalar
    def __iter__(self): return iter(self.rows)


class _Connection:
    def __init__(self, policy):
        self.calls = []; self.policy = policy; self.tombstoned = False; self.operations = {}
    async def execute(self, statement, values):
        sql = str(statement)
        self.calls.append((sql, values))
        if "pg_advisory_xact_lock" in sql:
            return _Result()
        if "SELECT artifact_id FROM evidence_lifecycle_outbox" in sql:
            return _Result(scalar="outbox-artifact")
        if "SELECT 1 FROM evidence_lifecycle_holds" in sql:
            return _Result(0, None)
        if "operation='delete'" in sql and "idempotency_key=:key" in sql:
            stored = self.operations.get(values["key"])
            row = type("Replay", (), {"request_hash": stored[0], "payload": stored[1]})() \
                if stored else None
            return _Result(first=row)
        if "FROM evidence_retention_schedules" in sql:
            row = type("Row", (), {"_mapping": {"schedule_hash": "a" * 64,
                "policy_hash": self.policy.policy_hash,
                "scope_key": values.get("scope", "public"),
                "body_expires_at": NOW - timedelta(seconds=1)}})()
            return _Result(rows=[row])
        if "SELECT payload FROM evidence_copy_receipts" in sql:
            return _Result(rows=[])
        if "INSERT INTO evidence_lifecycle_tombstones" in sql:
            self.tombstoned = True
        if "INSERT INTO evidence_lifecycle_operation_receipts" in sql:
            payload = json.loads(values["payload"])
            if values.get("key"):
                self.operations[values["key"]] = (values["request"], payload)
        if "SELECT 1 FROM evidence_lifecycle_tombstones" in sql:
            return _Result(first=(object() if self.tombstoned else None))
        return _Result()


class _Context:
    def __init__(self, connection): self.connection = connection
    async def __aenter__(self): return self.connection
    async def __aexit__(self, *_): return False


class _Engine:
    def __init__(self, policy=None): self.connection = _Connection(policy)
    def begin(self): return _Context(self.connection)


@pytest.mark.asyncio
async def test_due_expiry_atomically_clears_archive_bodies_with_receipt_and_tombstone():
    policy = policy_for("analysis_archive", "agent_analysis", "timescale.analysis_body")
    engine = _Engine(policy)
    assert await EvidenceLifecycleRepository(engine).expire_artifact_body(
        "analysis-due", NOW, force=False)
    statements = [sql for sql, _ in engine.connection.calls]
    updates = [sql for sql in statements if "UPDATE" in sql]
    for table in ("analysis_runs", "signal_reports", "provider_calls", "evaluation_runs"):
        assert any(f"UPDATE {table}" in sql for sql in updates)
    assert any("INSERT INTO evidence_copy_receipts" in sql for sql in statements)
    assert any("INSERT INTO evidence_lifecycle_tombstones" in sql for sql in statements)


@pytest.mark.asyncio
async def test_local_delete_identical_retry_replays_without_state_regression():
    policy = policy_for("analysis_archive", "agent_analysis", "timescale.analysis_body")
    engine = _Engine(policy)
    repository = EvidenceLifecycleRepository(engine)
    first = await repository.dispose_artifact("analysis-replay", NOW, force=True,
        scope_key="account:account-a", idempotency_key="delete:analysis-replay")
    updates = sum("UPDATE" in sql for sql, _ in engine.connection.calls)
    second = await repository.dispose_artifact("analysis-replay", NOW + timedelta(seconds=5),
        force=True, scope_key="account:account-a",
        idempotency_key="delete:analysis-replay")
    assert second == first and second["outcome"] == "partial"
    assert sum("UPDATE" in sql for sql, _ in engine.connection.calls) == updates


@pytest.mark.asyncio
async def test_outbox_start_failure_remains_retryable_then_can_acknowledge():
    engine = _Engine()
    repository = EvidenceLifecycleRepository(engine)
    await repository.mark_outbox("a" * 64, "public", False)
    await repository.mark_outbox("a" * 64, "public", True)
    calls = [(sql, values) for sql, values in engine.connection.calls
        if "UPDATE evidence_lifecycle_outbox" in sql]
    assert [values["success"] for _, values in calls] == [False, True]
    assert "dispatched_at=CASE WHEN :success" in calls[0][0]
    assert "available_at=CASE WHEN :success" in calls[0][0]
    assert "temporal_start_failed" in calls[0][0]


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", [monitoring_api.lifecycle_hold,
    monitoring_api.lifecycle_delete])
async def test_owner_mutations_stop_before_action_for_cross_account_artifact(
        monkeypatch, endpoint):
    async def account_for(_subject): return "account-a"
    class Traces:
        async def get_trace(self, account_id, artifact_id, subject):
            assert (account_id, artifact_id, subject) == (
                "account-a", "analysis-account-b", "subject-a")
            return None
    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("cross-account lifecycle mutation ran")
    monkeypatch.setattr(monitoring_api, "authorize", lambda *_: "subject-a")
    monkeypatch.setattr(monitoring_api, "account_for", account_for)
    monkeypatch.setattr(monitoring_api, "TraceRepository", lambda *_: Traces())
    monkeypatch.setattr(monitoring_api, "create_hold", must_not_run)
    monkeypatch.setattr(monitoring_api, "record_local_delete", must_not_run)
    request = monitoring_api.LifecycleAction(artifact_id="analysis-account-b")
    with pytest.raises(HTTPException) as error:
        await endpoint(request)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_cross_account_trace_lookup_never_emits_allowed_access_receipt(monkeypatch):
    class MissingResult:
        def first(self): return None
        def all(self): return []
    class Connection:
        async def execute(self, *_args, **_kwargs): return MissingResult()
    class Context:
        async def __aenter__(self): return Connection()
        async def __aexit__(self, *_args): return False
    class Engine:
        def begin(self): return Context()
    with pytest.raises(RuntimeError, match="identity is ambiguous or unavailable"):
        await tracing.TraceRepository(Engine()).get_trace(
            "account-a", "analysis-account-b", "subject-a")
