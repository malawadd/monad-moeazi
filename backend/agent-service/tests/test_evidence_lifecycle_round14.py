import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent import dependency_safety_stream as stream, monitoring_stream
from moeazi_agent.dependency_safety_contracts import (
    DependencyStatus, SafetyOperation, SafetyScope, canonical_payload_digest,
    decision_hash_body, digest,
)
from moeazi_agent.dependency_safety_matrix import build_receipt, evaluate_safety
from moeazi_agent.dependency_safety_service import (
    DependencyObservation, DependencySafetyService,
)


NOW = datetime.now(timezone.utc).replace(microsecond=123000)
ACCOUNT = "round14-account"
SCOPE = SafetyScope(kind="account", key=f"account:{ACCOUNT}",
    strategy_account_id=ACCOUNT)


def decision(at=NOW):
    receipt = build_receipt("convex_product_state", SCOPE, DependencyStatus.HEALTHY,
        at, "fixture_healthy", "round14-r1", "round14-v1", "round14-observation")
    return evaluate_safety(SafetyOperation.RENDER_PREVIOUS, SCOPE, "render:round14",
        [receipt], {"market": "BTC", "snapshot_hash": "a" * 64}, "round14:render",
        at, "enforce", request_hash="b" * 64)


def invalid_binding_decision(at=NOW, idempotency_key="round15:invalid-binding"):
    value = decision(at).model_copy(update={
        "binding_hash": "0" * 64, "idempotency_key": idempotency_key})
    outer_hash = digest(decision_hash_body(value))
    return value.model_copy(update={
        "decision_hash": outer_hash, "decision_id": f"sed_{outer_hash[:48]}"})


def confidential_reason_decision(at=NOW, idempotency_key="round16:unsafe-reason"):
    value = decision(at).model_copy(update={
        "breaker_state": "open", "outcome": "block",
        "reasons": ["open:convex_product_state:confidential_marker_do_not_emit"],
        "idempotency_key": idempotency_key})
    outer_hash = digest(decision_hash_body(value))
    return value.model_copy(update={
        "decision_hash": outer_hash, "decision_id": f"sed_{outer_hash[:48]}"})


def projection(value, *, revision=1, projected_at=None, **overrides):
    projected_at = projected_at or int((value.evaluated_at + timedelta(seconds=1)).timestamp() * 1000)
    body = stream.projection_hash_body(account_id=ACCOUNT, scope_key=value.scope.key,
        operation=value.operation, decision_id=value.decision_id,
        decision_hash=value.decision_hash, projection_revision=revision,
        projected_at=projected_at)
    result = {"_id": "projection-round14", "_creationTime": float(projected_at),
        "schemaVersion": 2, "strategyAccountId": ACCOUNT,
        "operation": value.operation.value, "subjectKey": value.subject_key,
        "scopeKey": value.scope.key, "mode": value.mode,
        "breakerState": value.breaker_state, "outcome": value.outcome,
        "reasons": value.reasons, "receiptHashes": value.receipt_hashes,
        "incidentKeys": value.incident_keys,
        "bindingsJson": json.dumps(value.bindings, separators=(",", ":")),
        "decisionId": value.decision_id, "decisionHash": value.decision_hash,
        "matrixVersion": value.matrix_version,
        "evaluatedAt": int(value.evaluated_at.timestamp() * 1000),
        "expiresAt": int(value.expires_at.timestamp() * 1000),
        "idempotencyKey": value.idempotency_key,
        "bindingHash": value.binding_hash, "requestHash": value.request_hash,
        "projectionRevision": revision,
        "projectionHash": canonical_payload_digest(body), "updatedAt": projected_at}
    return {**result, **overrides}


def notification(value, projected):
    return stream.build_safety_notification(value, {
        "projectionId": projected["_id"],
        "projectionHash": projected["projectionHash"],
        "projectionRevision": projected["projectionRevision"],
        "projectedAt": projected["updatedAt"],
    })


def row(value, **overrides):
    values = {"decision_id": value.decision_id, "matrix_version": value.matrix_version,
        "mode": value.mode, "operation": value.operation.value,
        "subject_key": value.subject_key, "scope": value.scope.model_dump(mode="json"),
        "breaker_state": value.breaker_state, "outcome": value.outcome,
        "reasons": value.reasons, "receipt_hashes": value.receipt_hashes,
        "incident_keys": value.incident_keys, "bindings": value.bindings,
        "evaluated_at": value.evaluated_at, "expires_at": value.expires_at,
        "idempotency_key": value.idempotency_key, "decision_hash": value.decision_hash,
        "payload": value.model_dump(mode="json")}
    return SimpleNamespace(**{**values, **overrides})


class Result:
    def __init__(self, rows): self.rows = rows
    def all(self): return self.rows


class Connection:
    def __init__(self, rows): self.rows = rows
    async def execute(self, *_args, **_kwargs): return Result(self.rows)


class Context:
    def __init__(self, value): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *_args): return False


class Engine:
    def __init__(self, rows): self.rows = rows
    def connect(self): return Context(Connection(self.rows))


class Convex:
    def __init__(self, decisions): self.decisions = decisions; self.calls = 0
    async def command(self, name, **payload):
        assert name == "getDependencySafetyProjection" and payload == {
            "strategyAccountId": ACCOUNT}
        self.calls += 1
        current = self.decisions() if callable(self.decisions) else self.decisions
        return {"decisions": current, "health": [], "incidents": []}


@pytest.mark.asyncio
async def test_safety_disclosure_reloads_both_owners_and_records_governed_access(monkeypatch):
    value = decision(); projected = projection(value); note = notification(value, projected)
    recorded = []
    async def access(_repository, **kwargs):
        recorded.append(kwargs)
        return object(), kwargs["output"]
    monkeypatch.setattr(stream, "record_access", access)
    disclosure = stream.DependencySafetyStreamDisclosure(
        Engine([row(value)]), Convex([projected]))
    output = await disclosure.disclose(note, ACCOUNT, "viewer-round14",
        value.evaluated_at + timedelta(seconds=2))
    assert output["decision_hash"] == value.decision_hash
    assert set(output) == {"schema_version", "scope_key", "operation", "mode",
        "breaker_state", "outcome", "reason_codes", "decision_hash", "matrix_version",
        "evaluated_at", "expires_at", "projection_revision", "projection_hash"}
    assert output["reason_codes"] == [] and "reasons" not in output
    assert len(recorded) == 1 and recorded[0]["artifact_id"] == f"monitoring:safety:{ACCOUNT}"
    assert recorded[0]["viewer_subject"] == "viewer-round14"


@pytest.mark.asyncio
@pytest.mark.parametrize("defect", ["missing_db", "tampered_db", "invalid_binding_hash",
    "unsafe_reason", "expired_db",
    "missing_projection", "stale_projection", "superseded", "tampered_projection",
    "ambiguous"])
async def test_safety_disclosure_withholds_every_uncertain_or_superseded_state(
        monkeypatch, defect):
    value = invalid_binding_decision() if defect == "invalid_binding_hash" else (
        confidential_reason_decision() if defect == "unsafe_reason" else
        decision(NOW - timedelta(minutes=2)) if defect == "expired_db" else decision())
    projected = projection(value); note = notification(value, projected)
    rows = [] if defect == "missing_db" else [row(value)]
    if defect == "tampered_db": rows = [row(value, subject_key="forged")]
    decisions = [projected]
    if defect == "missing_projection": decisions = []
    if defect == "stale_projection":
        decisions = [{**projected, "expiresAt": int(NOW.timestamp() * 1000)}]
    if defect == "superseded":
        decisions = [{**projected, "decisionHash": "f" * 64}]
    if defect == "tampered_projection":
        decisions = [{**projected, "projectionHash": "f" * 64}]
    if defect == "ambiguous": decisions = [projected, projected]
    async def must_not_access(*_args, **_kwargs):
        raise AssertionError("governed access ran for invalid authority")
    monkeypatch.setattr(stream, "record_access", must_not_access)
    observed_at = NOW + timedelta(seconds=2) if defect == "expired_db" \
        else value.evaluated_at + timedelta(seconds=2)
    with pytest.raises(RuntimeError):
        await stream.DependencySafetyStreamDisclosure(
            Engine(rows), Convex(decisions)).disclose(note, ACCOUNT, "viewer",
                observed_at)


def test_safety_notification_is_strict_identity_only_and_rejects_secret_unknown_fields():
    value = decision(); projected = projection(value); note = notification(value, projected)
    payload = json.loads(note.model_dump_json())
    assert set(payload) == {"schema_version", "account_id", "scope_key", "operation",
        "decision_id", "decision_hash", "decision_evaluated_at", "projection_id",
        "projection_hash", "projection_revision", "projected_at"}
    assert stream.parse_safety_notification(json.dumps(payload), ACCOUNT) == note
    assert stream.parse_safety_notification(json.dumps(
        {**payload, "api_key": "sk-synthetic-round14-secret-value"}), ACCOUNT) is None
    assert stream.parse_safety_notification(json.dumps(
        {**payload, "account_id": "other-account"}), ACCOUNT) is None
    assert stream.parse_safety_notification(json.dumps(
        {**payload, "account_id": "round14", "scope_key": "account:round14-account"}),
        "round14") is None
    assert stream.parse_safety_notification("not-json", ACCOUNT) is None
    assert stream.build_safety_notification(value, {
        "projectionId": projected["_id"], "projectionHash": projected["projectionHash"],
        "projectionRevision": 2, "projectedAt": projected["updatedAt"],
        "superseded": True,
    }) is None


class Repo:
    async def load_current_receipts(self, *_args): return []
    async def save_bundle(self, *_args, **_kwargs): return None


class PublisherConvex:
    def __init__(self, projected): self.projected = projected
    async def command(self, name, **_payload):
        if name == "getDependencySafetyProjection":
            return {"decisions": [], "health": [], "incidents": []}
        return {"projectionId": self.projected["_id"],
            "projectionHash": self.projected["projectionHash"],
            "projectionRevision": self.projected["projectionRevision"],
            "projectedAt": self.projected["updatedAt"], "incidentSignals": []}


class PublisherRedis:
    def __init__(self): self.messages = []
    async def ping(self): return True
    async def set(self, *_args, **_kwargs): return True
    async def publish(self, channel, payload): self.messages.append((channel, payload))


@pytest.mark.asyncio
async def test_dependency_safety_publisher_emits_only_strict_identity():
    value = decision(); projected = projection(value); redis = PublisherRedis()
    observation = DependencyObservation(status=DependencyStatus.HEALTHY,
        reason_code="fixture_healthy", source_revision="round14-r1",
        adapter_version="round14-v1")
    await DependencySafetyService(SimpleNamespace(dependency_safety_mode="enforce"),
        Repo()).assess(operation=SafetyOperation.RENDER_PREVIOUS, scope=SCOPE,
        subject_key="render:round14", observations={"convex_product_state": observation},
        bindings={"market": "BTC", "snapshot_hash": "a" * 64},
        idempotency_key="round14:render", evaluated_at=NOW,
        convex=PublisherConvex(projected), redis=redis, request_hash="b" * 64)
    assert len(redis.messages) == 1
    published = json.loads(redis.messages[0][1])
    assert set(published) == set(json.loads(notification(value, projected).model_dump_json()))
    assert "reasons" not in published and "body" not in published


class FakePubSub:
    def __init__(self, messages): self.messages = list(messages)
    async def subscribe(self, *_args): return None
    async def unsubscribe(self, *_args): return None
    async def aclose(self): return None
    async def get_message(self, **_kwargs): return self.messages.pop(0) if self.messages else None


class FakeRedis:
    def __init__(self, messages): self.pub = FakePubSub(messages)
    def pubsub(self): return self.pub
    async def aclose(self): return None


@pytest.mark.asyncio
async def test_safety_sse_revalidates_after_open_and_never_forwards_redis_body(monkeypatch):
    value = decision(); projected = projection(value); note = notification(value, projected)
    class Disclosure:
        calls = 0
        def __init__(self, *_args): pass
        async def disclose(self, *_args):
            self.calls += 1
            if self.calls == 2: raise RuntimeError("superseded")
            return {"decision_hash": value.decision_hash, "call": self.calls}
    monkeypatch.setattr(monitoring_stream, "DependencySafetyStreamDisclosure", Disclosure)
    valid = note.model_dump_json()
    forged = json.dumps({**json.loads(valid), "body": {"api_key": "synthetic-secret"}})
    messages = [{"channel": f"dependency-safety:{ACCOUNT}", "data": forged},
        {"channel": f"dependency-safety:{ACCOUNT}", "data": valid},
        {"channel": f"dependency-safety:{ACCOUNT}", "data": valid},
        {"channel": f"dependency-safety:{ACCOUNT}", "data": valid}]
    events = monitoring_stream.monitoring_events(ACCOUNT, "redis://unused", object(),
        viewer_subject="viewer", convex_client=object(), redis_client=FakeRedis(messages),
        pause_seconds=0)
    try:
        await anext(events)
        first = await anext(events); second = await anext(events)
        assert '"call": 1' in first and '"call": 3' in second
        assert "api_key" not in first + second and "synthetic-secret" not in first + second
    finally:
        await events.aclose()


def test_all_redis_sse_branches_use_authoritative_reconstruction():
    source = __import__("inspect").getsource(monitoring_stream.monitoring_events)
    assert "event: safety\\ndata: {data}" not in source
    assert "event: trace\\ndata: {data}" not in source
    assert "safety.disclose" in source and "lifecycle.stream_trace_body" in source
