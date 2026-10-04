from __future__ import annotations

import json
import re
from datetime import datetime
from importlib.resources import files

from .dependency_safety_contracts import DependencyStatus, SafetyOperation, SafetyScope
from .dependency_safety_matrix import build_receipt, evaluate_safety, requirements_for
from .recovery_evaluator import evaluate_recovery_fixture
from .test_center_common import sanitize_artifact
from .test_center_public import public_feature

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")
FEATURE_1 = "dependency-safety-envelope"
FEATURE_2 = "cross-state-recovery-continuity"
FEATURE_3 = "evidence-lifecycle-boundary"
FEATURE_4 = "operational-secret-custody"
FEATURE_6 = "temporal-integrity"
FEATURE_8 = "capability-delegation-lifecycle"
FEATURE_9 = "authoritative-risk-snapshot-and-reconciliation"
FEATURE_10 = "asset-conservation-journal"
FEATURE_12 = "venue-price-liquidation-safety"
FEATURE_13 = "collateral-resilience-exit-capacity"
FEATURE_14 = "verified-strategy-termination"
FEATURE_15 = "incident-communication-outbox"
FEATURE_16 = "safety-change-quorum"
FEATURE_17 = "operator-qualification"
FEATURE_18 = "mandate-policy-semantic-fidelity"
FEATURE_20 = "risk-tiered-approval-consent"
SAFE_LAYERS = ("capture", "evaluate", "project", "enforce")


def load_json(name: str) -> dict:
    return json.loads(files("moeazi_agent").joinpath(name).read_text(encoding="utf-8"))


def registry_response() -> dict:
    meta = load_json("feature_registry_meta.json")
    registry = load_json("feature_registry.json")
    scenarios = [{**item, "featureId": FEATURE_1}
        for item in load_json("test_center_scenarios.json")["scenarios"]]
    scenarios += [{**item, "featureId": FEATURE_2, "operation": "recovery_drill"}
        for item in load_json("recovery_scenarios.json")["scenarios"]]
    scenarios += [{**item, "featureId": FEATURE_3}
        for item in load_json("evidence_lifecycle_scenarios.json")["scenarios"]]
    from .operational_secret_scenarios import scenario_registry
    scenarios += [{**item, "featureId": FEATURE_4} for item in scenario_registry()]
    from .temporal_integrity_scenarios import scenario_registry as temporal_scenarios
    scenarios += [{**item, "featureId": FEATURE_6} for item in temporal_scenarios()]
    from .instrument_lifecycle_scenarios import scenario_registry as instrument_scenarios
    scenarios += [{**item, "featureId": "instrument-lifecycle-registry"} for item in instrument_scenarios()]
    from .capability_delegation_scenarios import scenario_registry as capability_scenarios
    scenarios += [{**item, "featureId": FEATURE_8} for item in capability_scenarios()]
    from .risk_reconciliation_scenarios import scenario_registry as risk_scenarios
    scenarios += [{**item, "featureId": FEATURE_9} for item in risk_scenarios()]
    from .asset_journal_scenarios import scenario_registry as journal_scenarios
    scenarios += [{**item, "featureId": FEATURE_10} for item in journal_scenarios()]
    from .venue_price_scenarios import scenario_registry as venue_price_scenarios
    scenarios += [{**item, "featureId": FEATURE_12} for item in venue_price_scenarios()]
    from .collateral_resilience_scenarios import scenario_registry as collateral_scenarios
    scenarios += [{**item, "featureId": FEATURE_13} for item in collateral_scenarios()]
    from .strategy_termination_scenarios import scenario_registry as termination_scenarios
    scenarios += [{**item, "featureId": FEATURE_14} for item in termination_scenarios()]
    from .incident_communication_scenarios import scenario_registry as communication_scenarios
    scenarios += [{**item, "featureId": FEATURE_15} for item in communication_scenarios()]
    from .safety_change_quorum_scenarios import scenario_registry as quorum_scenarios
    scenarios += [{**item, "featureId": FEATURE_16} for item in quorum_scenarios()]
    from .operator_qualification_scenarios import scenario_registry as qualification_scenarios
    scenarios += [{**item, "featureId": FEATURE_17} for item in qualification_scenarios()]
    from .mandate_policy_scenarios import scenario_registry as mandate_policy_scenarios
    scenarios += [{**item, "featureId": FEATURE_18} for item in mandate_policy_scenarios()]
    from .effective_authority_scenarios import scenario_registry as effective_authority_scenarios
    scenarios += [{**item, "featureId": "effective-authority-decision", "operation": "effective_authority_projection"}
        for item in effective_authority_scenarios()]
    from .risk_tiered_consent_scenarios import scenario_registry as consent_scenarios
    scenarios += [{**item, "featureId": FEATURE_20, "operation": "consume_fixture_consent"}
        for item in consent_scenarios()]
    from .usage_rights_scenarios import scenario_registry as usage_rights_scenarios
    scenarios += [{**item, "featureId": "external-usage-rights"} for item in usage_rights_scenarios()]
    from .product_eligibility_scenarios import scenario_registry as eligibility_scenarios
    scenarios += [{**item, "featureId": "external-product-eligibility"} for item in eligibility_scenarios()]
    from .customer_contestation_scenarios import scenario_registry as contestation_scenarios
    scenarios += [{**item, "operation": "inspect_case", "featureId": "customer-contestation"} for item in contestation_scenarios()]
    from .portability_scenarios import scenario_registry as portability_scenarios
    scenarios += [{**item, "operation": "inspect_export", "featureId": "customer-account-portability"} for item in portability_scenarios()]
    from .evidence_event_scenarios import scenario_registry as evidence_event_scenarios
    scenarios += [{**item, "featureId": "evidence-event-fabric"} for item in evidence_event_scenarios()]
    from .schedule_sync_scenarios import scenario_registry as schedule_sync_scenarios
    scenarios += [{**item, "featureId": "schedule-sync-outbox"} for item in schedule_sync_scenarios()]
    from .safety_assurance_scenarios import scenario_registry as assurance_scenarios
    scenarios += [{**item, "featureId": "system-safety-assurance-corpus"} for item in assurance_scenarios()]
    from .claim_disagreement_scenarios import scenario_registry as ledger_scenarios
    scenarios += [{**item, "featureId": "claim-disagreement-ledger"} for item in ledger_scenarios()]
    from .source_value_registry import scenarios as source_value_scenarios
    scenarios += [{**item, "featureId": "specialist-source-value-attribution", "operation": "resolve_citations"}
        for item in source_value_scenarios()]
    from .evidence_integrity_registry import scenarios as integrity_scenarios
    scenarios += [{**item, "featureId": "manipulation-aware-evidence-integrity"}
        for item in integrity_scenarios()]
    from .shadow_tca_registry import scenarios as shadow_tca_scenarios
    scenarios += [{**item, "featureId": "calibrated-shadow-execution-tca"} for item in shadow_tca_scenarios()]
    from .decision_memory_registry import scenarios as decision_memory_scenarios
    scenarios += [{**item, "featureId": "outcome-linked-decision-memory"} for item in decision_memory_scenarios()]
    from .promotion_registry import scenarios as promotion_scenarios
    scenarios += [{**item, "featureId": "outcome-calibrated-promotion"} for item in promotion_scenarios()]
    from .selective_prediction_registry import scenarios as selective_prediction_scenarios
    scenarios += [{**item, "featureId": "calibrated-selective-prediction"} for item in selective_prediction_scenarios()]
    from .analytical_diversity_registry import scenarios as diversity_scenarios
    scenarios += [{**item, "featureId": "analytical-diversity-audit"} for item in diversity_scenarios()]
    return {
        **meta, "modes": ["off", "observe", "enforce", "unavailable"],
        "layers": list(SAFE_LAYERS),
        "features": [public_feature(item, 0 if item["order"] <= 7 else 1
            if item["order"] <= 14 else 2 if item["order"] <= 24 else 3)
            for item in registry["features"]],
        "scenarios": [{"id": item["id"], "operation": item["operation"],
            "featureId": item["featureId"]} for item in scenarios],
    }


def run_fixture(scenario_id: str, mode: str, now: datetime,
        feature_id: str, control_hash: str | None, canonical_hash) -> dict:
    if feature_id == "outcome-linked-decision-memory":
        from .decision_memory_scenarios import evaluate_fixture
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}), {"trustStatus": "requires_revalidation"})
        result.pop("_artifacts", None); return sanitize_artifact(result)
    if feature_id == "outcome-calibrated-promotion":
        from .promotion_evaluator import evaluate
        context={key:{"trustStatus":"requires_revalidation","zeroAttempts":True,"notAuthorizing":True} for key in ("calibrated-shadow-execution-tca","outcome-linked-decision-memory")}
        result=evaluate(scenario_id,mode,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),context)
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "calibrated-selective-prediction":
        from .selective_prediction_evaluator import evaluate
        context={key:{"trustStatus":"requires_revalidation","zeroAttempts":True,"notAuthorizing":True} for key in ("manipulation-aware-evidence-integrity","portfolio-aware-sizing","outcome-calibrated-promotion")}
        result=evaluate(scenario_id,mode,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),context)
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "analytical-diversity-audit":
        from .analytical_diversity_evaluator import REQUIRED, evaluate
        context={key:{"trustStatus":"requires_revalidation","zeroAttempts":True,"notAuthorizing":True} for key in REQUIRED}
        result=evaluate(scenario_id,mode,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),context)
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "calibrated-shadow-execution-tca":
        from .shadow_tca_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),{"trustStatus":"requires_revalidation","decision":"hypothetical_route","zeroAttempts":True,"contextHash":"fixture"})
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "external-product-eligibility":
        from .product_eligibility_test_center_adapter import evaluate
        result=evaluate(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id})); result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "customer-contestation":
        from .customer_contestation_test_center_adapter import evaluate
        result=evaluate(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id})); result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "customer-account-portability":
        from .portability_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id})); result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "external-usage-rights":
        from .usage_rights_test_center_adapter import evaluate
        result=evaluate(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id})); result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == FEATURE_20:
        from .risk_tiered_consent_test_center_adapter import evaluate
        result=evaluate(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}))
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "effective-authority-decision":
        from .effective_authority_test_center_adapter import evaluate
        result=evaluate(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}))
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == FEATURE_18:
        from .mandate_policy_test_center_adapter import evaluate
        result = evaluate(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": FEATURE_18, "scenarioId": scenario_id}))
        result.pop("_artifacts", None)
        return sanitize_artifact(result)
    if feature_id == "evidence-event-fabric":
        from .evidence_event_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}))
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "schedule-sync-outbox":
        from .schedule_sync_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}))
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "system-safety-assurance-corpus":
        from .safety_assurance_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}))
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "claim-disagreement-ledger":
        from .claim_disagreement_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),{"contextHash":"fixture"})
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "specialist-source-value-attribution":
        from .source_value_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),{"contextHash":"fixture"})
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == "manipulation-aware-evidence-integrity":
        from .evidence_integrity_scenarios import evaluate_fixture
        result=evaluate_fixture(scenario_id,mode,now,"fixture-operator",canonical_hash({"featureId":feature_id,"scenarioId":scenario_id}),{"contextHash":"fixture"})
        result.pop("_artifacts",None); return sanitize_artifact(result)
    if feature_id == FEATURE_2:
        scenarios = load_json("recovery_scenarios.json")["scenarios"]
        fixture = next((item for item in scenarios if item["id"] == scenario_id), None)
        if not fixture or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in recovery scenario")
        return sanitize_artifact(evaluate_recovery_fixture(fixture, now, control_hash))
    if feature_id == FEATURE_3:
        from .evidence_lifecycle_scenarios import evaluate_lifecycle_fixture
        scenarios = load_json("evidence_lifecycle_scenarios.json")["scenarios"]
        fixture = next((item for item in scenarios if item["id"] == scenario_id), None)
        if not fixture or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in evidence lifecycle scenario")
        return sanitize_artifact(evaluate_lifecycle_fixture(fixture, mode, now))
    if feature_id == FEATURE_4:
        from .operational_secret_scenarios import evaluate_fixture, scenario_registry
        fixture = next((item for item in scenario_registry() if item["id"] == scenario_id), None)
        if not fixture or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in operational secret scenario")
        return sanitize_artifact(evaluate_fixture(fixture, mode, now))
    if feature_id == FEATURE_6:
        from .temporal_integrity_scenarios import evaluate_fixture, scenario_registry
        fixture = next((item for item in scenario_registry() if item["id"] == scenario_id), None)
        if not fixture or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in temporal integrity scenario")
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": FEATURE_6, "scenarioId": scenario_id}))
        result.pop("_decision")
        result.pop("_inputManifest")
        return sanitize_artifact(result)
    if feature_id == "instrument-lifecycle-registry":
        from .instrument_lifecycle_scenarios import evaluate_fixture, scenario_registry
        fixture = next((item for item in scenario_registry() if item["id"] == scenario_id), None)
        if not fixture or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in instrument lifecycle scenario")
        return sanitize_artifact(evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id})))
    if feature_id == FEATURE_8:
        from .capability_delegation_scenarios import evaluate_fixture, scenario_registry
        fixture = next((item for item in scenario_registry() if item["id"] == scenario_id), None)
        if not fixture or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in capability scenario")
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}))
        result.pop("_decision"); result.pop("_inputManifest")
        result.pop("_grants"); result.pop("_observations"); result.pop("_transitions")
        return sanitize_artifact(result)
    if feature_id == FEATURE_9:
        from .risk_reconciliation_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in risk scenario")
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}))
        for key in ("_manifest", "_observations", "_snapshot", "_reservation", "_attempt", "_reconciliation"):
            result.pop(key)
        return sanitize_artifact(result)
    if feature_id == FEATURE_10:
        from .asset_journal_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in journal scenario")
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}), control_hash)
        for key in ("_manifest", "_units", "_accounts", "_events", "_candidates", "_check", "_receipt"):
            result.pop(key)
        return sanitize_artifact(result)
    if feature_id == FEATURE_12:
        from .venue_price_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in venue-price scenario")
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}), control_hash)
        return sanitize_artifact({key: value for key, value in result.items() if not key.startswith("_")})
    if feature_id == FEATURE_13:
        from .collateral_resilience_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in collateral scenario")
        result = evaluate_fixture(scenario_id, mode, now, "fixture-operator",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}), control_hash)
        return sanitize_artifact({key: value for key, value in result.items() if not key.startswith("_")})
    if feature_id == FEATURE_14:
        from .strategy_termination_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in termination scenario")
        bindings = {name: {"runId": f"run-{canonical_hash({'feature': name})[:32]}", "runHash": canonical_hash({"run": name}),
            "bundleHash": canonical_hash({"bundle": name}), "controlHash": control_hash or canonical_hash({"control": name}),
            "registryHash": canonical_hash({"registry": name})} for name in (FEATURE_2, "intent-execution-equivalence")}
        result = evaluate_fixture(scenario_id, mode, now, "operator:fixture",
            canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}), control_hash, bindings)
        return sanitize_artifact({key: value for key, value in result.items() if not key.startswith("_")})
    if feature_id == FEATURE_15:
        from .incident_communication_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in incident communication scenario")
        result = evaluate_fixture(scenario_id, mode, now, "operator:fixture", canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}))
        return sanitize_artifact({key: value for key, value in result.items() if not key.startswith("_")})
    if feature_id == FEATURE_16:
        from .safety_change_quorum_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in safety change quorum scenario")
        result = evaluate_fixture(scenario_id, mode, now, "operator:fixture", canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}))
        return sanitize_artifact({key: value for key, value in result.items() if not key.startswith("_")})
    if feature_id == FEATURE_17:
        from .operator_qualification_scenarios import evaluate_fixture, scenario_registry
        if not any(item["id"] == scenario_id for item in scenario_registry()) or not ID_PATTERN.fullmatch(scenario_id):
            raise ValueError("Unknown checked-in operator qualification scenario")
        result = evaluate_fixture(scenario_id, mode, now, "operator:fixture", canonical_hash({"featureId": feature_id, "scenarioId": scenario_id}))
        return sanitize_artifact({key: value for key, value in result.items() if not key.startswith("_")})
    if feature_id != FEATURE_1:
        raise ValueError("Feature is unavailable in the Test Center")
    scenarios = load_json("test_center_scenarios.json")["scenarios"]
    fixture = next((item for item in scenarios if item["id"] == scenario_id), None)
    if not fixture or not ID_PATTERN.fullmatch(scenario_id):
        raise ValueError("Unknown checked-in Test Center scenario")
    fixture_hash = canonical_hash(fixture)
    operation = SafetyOperation(fixture["operation"])
    scope = SafetyScope.model_validate(fixture["scope"])
    statuses = fixture.get("statuses", {})
    receipts = [build_receipt(
        dependency_id, scope, DependencyStatus(statuses.get(dependency_id, "healthy")),
        now, "synthetic_fixture", fixture_hash, "test-center-v1",
        f"fixture:{scenario_id}:{dependency_id}",
    ) for dependency_id in requirements_for(operation, fixture["bindings"])]
    decision = evaluate_safety(operation, scope, f"test:{scenario_id}", receipts,
        fixture["bindings"], f"test:{scenario_id}:{fixture_hash}", now, mode,
        request_hash=fixture_hash)
    verdict = "pass" if decision.outcome == fixture["expectedOutcome"] else "fail"
    return sanitize_artifact({
        "scenarioId": scenario_id, "fixtureHash": fixture_hash,
        "expectedOutcome": fixture["expectedOutcome"], "actualOutcome": decision.outcome,
        "invariantVerdict": verdict, "decisionHash": decision.decision_hash,
        "requestHash": decision.request_hash, "bindingHash": decision.binding_hash,
        "reasons": decision.reasons,
    })
