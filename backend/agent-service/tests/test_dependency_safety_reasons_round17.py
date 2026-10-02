from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent import dependency_safety_stream as stream
from moeazi_agent.dependency_safety_contracts import (
    DependencyStatus, SafetyOperation, SafetyScope, decision_hash_body, digest,
)
from moeazi_agent.dependency_safety_matrix import (
    build_receipt, evaluate_safety, requirements_for, verify_safety_decision,
)


NOW = datetime(2026, 8, 6, 19, 0, tzinfo=timezone.utc)
ACCOUNT = "round17-account"
SCOPE = SafetyScope(kind="account", key=f"account:{ACCOUNT}",
    strategy_account_id=ACCOUNT)
CASES = [
    (SafetyOperation.INGEST, "evidence_source:news", "source_operation_failed"),
    (SafetyOperation.SIMULATE, "venue_adapter:uniswap", "venue_read_unavailable"),
    (SafetyOperation.SUBMIT, "certification:uniswap", "venue_not_certified"),
]


def bindings(operation):
    if operation is SafetyOperation.INGEST:
        return {"source": "news", "market": "ETH-USDC"}
    if operation is SafetyOperation.SIMULATE:
        return {"market": "ETH-USDC", "venue": "uniswap", "account": ACCOUNT,
            "analysis_id": "analysis-17", "quote_reference": "quote-17"}
    return {"market": "ETH-USDC", "venue": "uniswap", "account": ACCOUNT,
        "analysis_id": "analysis-17", "policy_version": "policy-17",
        "quote_reference": "quote-17"}


def scoped_decision(operation, target, owner_code, form):
    bound = bindings(operation)
    receipts = []
    for dependency_id in requirements_for(operation, bound):
        if form == "missing" and dependency_id == target:
            continue
        status = DependencyStatus.OPEN if form == "status" \
            and dependency_id == target else DependencyStatus.HEALTHY
        reason_code = owner_code if dependency_id == target else "healthy"
        receipts.append(build_receipt(dependency_id, SCOPE, status, NOW, reason_code,
            "round17-r1", "round17-v1", f"round17:{form}:{dependency_id}"))
    incidents = {target: [f"incident:{target}"]} if form == "incident" else None
    return evaluate_safety(operation, SCOPE, f"round17:{operation.value}", receipts,
        bound, f"round17:{operation.value}:{form}", NOW, "enforce",
        latched_incidents=incidents, request_hash="a" * 64)


@pytest.mark.parametrize("operation,target,owner_code", CASES)
@pytest.mark.parametrize("form,expected", [
    ("missing", "dependency_missing"),
    ("status", "dependency_open"),
    ("incident", "dependency_incident_open"),
])
def test_evaluator_scoped_dependency_reasons_are_operation_qualified(
        operation, target, owner_code, form, expected):
    decision = scoped_decision(operation, target, owner_code, form)
    display = verify_safety_decision(decision, operation, decision.subject_key,
        decision.idempotency_key, NOW + timedelta(seconds=1), bindings(operation),
        "a" * 64, require_permit=False)
    assert {"code": expected, "dependency_id": target} in display
    serialized = json.dumps(display)
    assert owner_code not in serialized and "recovery_incomplete" not in serialized


def forged_reason(decision, reason):
    value = decision.model_copy(update={"breaker_state": "open", "outcome": "block",
        "reasons": [reason], "idempotency_key": f"forged:{digest(reason)[:24]}"})
    outer = digest(decision_hash_body(value))
    return value.model_copy(update={"decision_hash": outer,
        "decision_id": f"sed_{outer[:48]}"})


@pytest.mark.parametrize("reason", [
    "missing:owner_signer",
    "open:venue_adapter:uniswap:venue_read_unavailable",
    "open:convex_product_state:context_unavailable:trailing",
    "broken:convex_product_state:context_unavailable",
    "incident_open:convex_product_state:recovery_incomplete:trailing",
])
def test_operation_mismatch_unknown_status_and_trailing_text_fail_closed(reason):
    bound = {"market": "BTC", "snapshot_hash": "b" * 64}
    receipt = build_receipt("convex_product_state", SCOPE, DependencyStatus.HEALTHY,
        NOW, "healthy", "r17", "v17", "round17-render")
    base = evaluate_safety(SafetyOperation.RENDER_PREVIOUS, SCOPE, "render:17",
        [receipt], bound, "round17:render", NOW, "enforce", request_hash="b" * 64)
    value = forged_reason(base, reason)
    with pytest.raises(ValueError):
        verify_safety_decision(value, SafetyOperation.RENDER_PREVIOUS, value.subject_key,
            value.idempotency_key, NOW + timedelta(seconds=1), bound, "b" * 64,
            require_permit=False)


@pytest.mark.asyncio
@pytest.mark.parametrize("operation,target,owner_code", CASES)
@pytest.mark.parametrize("form,expected", [
    ("missing", "dependency_missing"),
    ("status", "dependency_open"),
    ("incident", "dependency_incident_open"),
])
async def test_disclosure_emits_only_scoped_display_enums(monkeypatch,
        operation, target, owner_code, form, expected):
    decision = scoped_decision(operation, target, owner_code, form)
    display = verify_safety_decision(decision, operation, decision.subject_key,
        decision.idempotency_key, NOW + timedelta(seconds=1), bindings(operation),
        "a" * 64, require_permit=False)
    disclosure = stream.DependencySafetyStreamDisclosure(object(), object())
    async def load(*_args): return decision, display
    async def projection(*_args): return None
    async def access(_repository, **kwargs): return object(), kwargs["output"]
    monkeypatch.setattr(disclosure, "_load_decision", load)
    monkeypatch.setattr(disclosure, "_assert_projection", projection)
    monkeypatch.setattr(stream, "record_access", access)
    note = SimpleNamespace(account_id=ACCOUNT, projection_revision=1,
        projection_hash="f" * 64)
    output = await disclosure.disclose(note, ACCOUNT,
        "viewer-round17", NOW + timedelta(seconds=1))
    assert {"code": expected, "dependency_id": target} in output["reason_codes"]
    assert "reasons" not in output and owner_code not in json.dumps(output)
