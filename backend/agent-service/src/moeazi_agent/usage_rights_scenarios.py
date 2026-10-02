"""Closed synthetic corpus: one exact scenario for each usage operation."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from importlib.resources import files
from .usage_rights_canonical import digest, json_loads_strict
from .usage_rights_decision_contracts import UsageOperationRequest, safe_projection
from .usage_rights_evaluator import evaluate
from .usage_rights_registry import operations, registry_hash
from .usage_rights_rulepack_contracts import UsageRightsAssertion, UsageRightsRulepack
from .usage_rights_scope_contracts import Feature03ContextBinding, UsageRightsScope
from .usage_rights_subject_contracts import UsageSubjectLeaf, UsageSubjectSpec

NOW = datetime(2026, 9, 7, tzinfo=timezone.utc)


@lru_cache(maxsize=1)
def _scenario_rows() -> tuple[dict, ...]:
    rows = []
    for name in ("usage_rights_scenarios_01.json", "usage_rights_scenarios_02.json", "usage_rights_scenarios_03.json"):
        value = json_loads_strict(files("moeazi_agent").joinpath(name).read_text("utf-8"))
        if set(value) != {"schemaVersion", "scenarios"} or value["schemaVersion"] != 1: raise ValueError("usage_rights_scenario_file_invalid")
        rows.extend(value["scenarios"])
    if len(rows) < 36 or not set(operations()).issubset({row["operation"] for row in rows}) or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("usage_rights_scenario_closure_invalid")
    if not {"happy", "deny", "manual", "missing_context", "expired", "missing_assertion", "obligation", "lineage", "threshold"}.issubset({row.get("fault", "happy") for row in rows}):
        raise ValueError("usage_rights_scenario_family_closure_invalid")
    return tuple(rows)


def scenario_registry() -> list[dict]:
    return list(_scenario_rows())


@lru_cache(maxsize=1)
def expectations() -> dict:
    value = json_loads_strict(files("moeazi_agent").joinpath("usage_rights_expectations.json").read_text("utf-8"))
    if set(value) != {"schemaVersion", "expected"} or set(value["expected"]) != {row["id"] for row in scenario_registry()}: raise ValueError("usage_rights_expectation_closure_invalid")
    return value["expected"]


def _scope() -> UsageRightsScope:
    body = {"tenant_fingerprint": "tenant:fixture", "operator_fingerprint": "operator:fixture", "account_fingerprint": "account:fixture", "chain_id": 42161, "environment": "local"}
    return UsageRightsScope(**body, scope_hash=digest(body))


def _subject(scope, fault="happy"):
    kind = "derived" if fault == "lineage" else "raw"
    leaf = UsageSubjectLeaf(leaf_id="leaf:fixture", subject_class=kind, revision=1, subject_fingerprint=digest("fixture-subject"))
    body = {"scope": scope, "subject_id": "subject:fixture", "subject_class": kind, "revision": 1,
            "leaves": (leaf,), "lineage_nodes": (), "lineage_edges": ()}
    return UsageSubjectSpec(**body, subject_hash=digest(body))


def _context(scope):
    body = {"run_id": "run-" + "a" * 32, "scope_hash": scope.scope_hash, "operator_fingerprint": scope.operator_fingerprint,
            "decision_hash": digest("feature03-decision"), "policy_hash": digest("feature03-policy"), "status": "requires_revalidation", "frozen_at": NOW}
    return Feature03ContextBinding(**body, binding_hash=digest(body))


def _pack(scope, operation, fault="happy", now=NOW):
    assertion_body = {"assertion_id": "assertion:fixture", "subject_class": "raw", "subject_revision": 1, "operation": operation,
                      "purpose": "fixture_test", "destination_class": "local_test", "recipient_class": "fixture_user", "commercial": False,
                      "adaptation": False, "max_retention_seconds": 3600, "max_quantity": 1,
                      "disposition": "deny" if fault == "deny" else "manual_legal_review_required" if fault == "manual" else "allow",
                      "obligations": ("attribution",) if fault == "obligation" else ()}
    assertion = UsageRightsAssertion(**assertion_body, assertion_hash=digest(assertion_body))
    if fault == "missing_assertion": assertion_body["operation"] = "cache" if operation != "cache" else "fetch"
    assertion = UsageRightsAssertion(**assertion_body, assertion_hash=digest(assertion_body))
    if fault == "manual":
        second_body = assertion.model_dump(exclude={"assertion_hash"}, mode="python") | {"assertion_id": "assertion:fixture-two"}
        assertions = (assertion, UsageRightsAssertion(**second_body, assertion_hash=digest(second_body)))
    else:
        assertions = (assertion,)
    body = {"scope": scope, "rulepack_id": "pack:fixture", "revision": 1, "predecessor_hash": None, "source_hashes": (digest("source"),),
            "attestation_hashes": (digest("attestation"),), "assertions": assertions, "golden_manifest_hash": digest("golden"),
            "effective_at": now - timedelta(seconds=1), "expires_at": now - timedelta(milliseconds=1) if fault == "expired" else now + timedelta(minutes=5), "registry_hash": registry_hash()}
    return UsageRightsRulepack(**body, rulepack_hash=digest(body))


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    row = next((row for row in _scenario_rows() if row["id"] == scenario_id), None)
    if row is None: raise ValueError("Unknown checked-in usage rights scenario")
    fault = row.get("fault", "happy"); scope = _scope(); subject = _subject(scope, fault); context = None if fault == "missing_context" else _context(scope)
    request_body = {"scope": scope, "subject": subject, "operation": row["operation"], "purpose": "fixture_test",
                    "destination_class": "local_test", "recipient_class": "fixture_user", "commercial": False, "adaptation": False,
                    "retention_seconds": 0, "quantity": 2 if fault == "threshold" else 1, "requested_at": now, "feature03_context": context,
                    "idempotency_hash": digest({"id": scenario_id, "run": run_hash})}
    request = UsageOperationRequest(**request_body, request_hash=digest(request_body))
    decision = evaluate(_pack(scope, row["operation"], fault, now), request, now)
    result = {"scenarioId": scenario_id, "requestedOperation": row["operation"], "permissionOutcome": decision.disposition,
              "fixtureDisposition": decision.fixture_disposition, "lineageCoverage": len(decision.leaf_matches),
              "requiredObligationCount": 0, "fulfilledObligationCount": 0, "packStatus": "active", "sourceStatus": "current",
              "changeDirection": "none", "reasonCodes": [match.reason_code for match in decision.leaf_matches],
              "selectedPrerequisiteStatus": "requires_revalidation", "eventCount": 4, "decisionHash": decision.decision_hash,
              "registryHash": registry_hash(), "fixtureHash": digest({"scenario": scenario_id, "run": run_hash}),
              "fixtureOnly": True, "productOutcome": "unavailable", "authorityEffect": "none", "operationPerformed": False,
              "externalAttempts": 0, "providerCost": 0, "invariantVerdict": "pass", "_artifacts": {"request": request, "decision": decision}}
    result.update(safe_projection(decision))
    for key, expected in expectations()[scenario_id].items():
        if result.get(key) != expected: raise AssertionError(f"usage_rights_expectation_failed:{scenario_id}:{key}")
    return result
