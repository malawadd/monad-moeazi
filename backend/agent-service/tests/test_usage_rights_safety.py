from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from moeazi_agent.usage_rights_canonical import CanonicalError, json_loads_strict
from moeazi_agent.usage_rights_decision_contracts import UsageObligationReceipt
from moeazi_agent.usage_rights_evaluator import close_obligations, evaluate
from moeazi_agent.usage_rights_scenarios import _context, _pack, _scope, _subject
from moeazi_agent.usage_rights_canonical import digest
from moeazi_agent.usage_rights_decision_contracts import UsageOperationRequest


def _request():
    now = datetime(2026, 9, 7, tzinfo=timezone.utc); scope = _scope(); body = {"scope":scope,"subject":_subject(scope),"operation":"fetch","purpose":"fixture_test","destination_class":"local_test","recipient_class":"fixture_user","commercial":False,"adaptation":False,"retention_seconds":0,"quantity":1,"requested_at":now,"feature03_context":_context(scope),"idempotency_hash":digest("idempotency")}
    return UsageOperationRequest(**body, request_hash=digest(body))


def test_strict_json_rejects_float_and_duplicate_keys():
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1.0}')
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1,"x":2}')


def test_unfulfilled_or_invalid_obligation_never_permits():
    request = _request(); pack = _pack(request.scope, "fetch"); raw = pack.assertions[0].model_dump(exclude={"assertion_hash"}, mode="python") | {"obligations": ("notice",)}; assertion = pack.assertions[0].__class__(**raw, assertion_hash=digest(raw))
    body = pack.model_dump(exclude={"rulepack_hash", "assertions"}, mode="python") | {"assertions": (assertion,)}
    pack = pack.__class__(**body, rulepack_hash=digest(body)); decision = evaluate(pack, request, request.requested_at)
    assert decision.fixture_disposition == "pending_obligations"
    receipt_body = {"decision_hash": decision.decision_hash, "obligation": "notice", "output_hash": digest("output"), "fulfiller_fingerprint": digest("fixture"), "status": "failed", "fulfilled_at": request.requested_at}
    receipt = UsageObligationReceipt(**receipt_body, receipt_hash=digest(receipt_body))
    assert close_obligations(decision, [receipt], request.requested_at).fixture_disposition == "pending_obligations"


def test_fixture_domain_has_no_runtime_or_network_imports():
    forbidden = ("requests", "httpx", "web3", "temporal", "convex", "subprocess", "wallet", "signer", "gateway", "sidecar", "venue")
    for path in Path("src/moeazi_agent").glob("usage_rights_*.py"):
        content = path.read_text(encoding="utf-8").lower()
        assert not any(f"import {item}" in content or f"from {item}" in content for item in forbidden), path.name
