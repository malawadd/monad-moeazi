import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from pydantic import ValidationError

from moeazi_agent.dependency_safety_contracts import SafetyOperation
from moeazi_agent.dependency_safety_matrix import requirements_for
from moeazi_agent.dependency_safety_observations import (
    execution_context_observations, proposal_observations,
)
from moeazi_agent.recovery_contracts import BackupEvidenceReceipt, RecoveryPointSet
from moeazi_agent.recovery_evaluator import evaluate_recovery_fixture
from moeazi_agent.recovery_registry import DOMAIN_IDS, domain_policies, registry_hash, verify_registry
from moeazi_agent.test_center import (
    ControlUpdate, cas_controls, controls_key, freeze_control_snapshot, get_controls,
    load_json, registry_response, run_fixture,
)

NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parents[2]
FEATURE_1 = "dependency-safety-envelope"
FEATURE_2 = "cross-state-recovery-continuity"
def recovery_scenarios():
    return load_json("recovery_scenarios.json")["scenarios"]


def test_registry_is_exact_versioned_and_hash_verified():
    verify_registry()
    policies = domain_policies()
    assert tuple(item.domain_id for item in policies) == DOMAIN_IDS
    assert len({item.policy_hash for item in policies}) == 7
    assert len(registry_hash()) == 64
    assert policies[4].method == "empty_rebuild"
    assert policies[5].omission_behavior == "block"


def test_every_fixed_recovery_scenario_is_deterministic_and_blocks_normal_resume():
    for fixture in recovery_scenarios():
        first = evaluate_recovery_fixture(fixture, NOW)
        second = evaluate_recovery_fixture(fixture, NOW)
        assert first == second
        assert first["candidate"]["readOnlyOutcome"] == fixture["expectedReadOnly"]
        assert first["candidate"]["normalResumeOutcome"] == "blocked"
        assert first["invariantVerdict"] == "pass"
        assert first["operationImpacts"]["propose"] is False
        assert first["operationImpacts"]["submit"] is False
        transitions = first["stateTransitions"]
        assert transitions[0] == "planned" and transitions[-1] == "closed"
        if "blocked" in transitions:
            assert transitions.index("blocked") == len(transitions) - 2


def test_read_only_resume_capabilities_are_fixed_and_never_authority_increasing():
    result = run_fixture("recovery-coherent-restore", "enforce", NOW, FEATURE_2)
    assert result["candidate"]["readOnlyOutcome"] == "ready"
    assert result["operationImpacts"] == {"inspection": True, "propose": False,
        "readOnlyReconcile": True, "renderPrevious": True, "submit": False}
    blocked = run_fixture("recovery-unresolved-submission", "observe", NOW, FEATURE_2)
    assert blocked["candidate"]["readOnlyOutcome"] == "blocked"
    assert blocked["operationImpacts"]["readOnlyReconcile"] is False


def test_coherent_fixture_verifies_all_required_domains_from_bound_synthetic_evidence():
    result = run_fixture("recovery-coherent-restore", "enforce", NOW, FEATURE_2)
    assert len(result["domainResults"]) == 7
    assert all(item["status"] == "verified" for item in result["domainResults"])
    assert all(item["left_hash"] == item["right_hash"] for item in result["findings"])
    for scenario in ("recovery-missing-execution-state", "recovery-missing-secret-custody"):
        blocked = run_fixture(scenario, "observe", NOW, FEATURE_2)
        assert blocked["candidate"]["readOnlyOutcome"] == "blocked"


def test_point_set_has_per_domain_cutoffs_and_rejects_a_global_snapshot_field():
    result = evaluate_recovery_fixture(recovery_scenarios()[0], NOW)
    with pytest.raises(ValidationError, match="extra"):
        RecoveryPointSet.model_validate({"schema_version": 1, "point_set_id": "rps_" + "a" * 48,
            "run_id": "recovery_" + "b" * 32, "tenant_key": "tenant_" + "c" * 16,
            "registry_hash": "d" * 64, "receipt_hashes": ["e" * 64],
            "domain_cutoffs": {item: NOW for item in DOMAIN_IDS}, "cutoff_spread_seconds": 0,
            "coverage": "complete", "reason_codes": [], "frozen_at": NOW,
            "canonical_hash": result["pointSetHash"], "global_snapshot_at": NOW})
    hashes = [f"{index:064x}" for index in range(1, 8)]
    bindings = dict(zip(DOMAIN_IDS, hashes, strict=True))
    invalid = {"schema_version": 1, "point_set_id": "rps_" + "a" * 48,
        "run_id": "recovery_" + "b" * 32, "tenant_key": "tenant_" + "c" * 16,
        "registry_hash": "d" * 64, "receipt_hashes": ["not-a-hash"],
        "receipt_bindings": bindings,
        "domain_cutoffs": {item: NOW for item in DOMAIN_IDS}, "cutoff_spread_seconds": 0,
        "coverage": "complete", "reason_codes": [], "frozen_at": NOW,
        "canonical_hash": result["pointSetHash"]}
    with pytest.raises(ValidationError, match="pattern"):
        RecoveryPointSet.model_validate(invalid)
    invalid["receipt_hashes"] = sorted(hashes)
    invalid["domain_cutoffs"] = {item: NOW.astimezone(timezone(timedelta(hours=2))) for item in DOMAIN_IDS}
    invalid["frozen_at"] = NOW
    with pytest.raises(ValidationError, match="UTC"):
        RecoveryPointSet.model_validate(invalid)


def test_contracts_reject_semantic_contradictions_and_are_canonical_deterministic():
    result = evaluate_recovery_fixture(recovery_scenarios()[0], NOW)
    assert result == evaluate_recovery_fixture(recovery_scenarios()[0], NOW)
    evidence = result["_storageArtifacts"][1]["payload"]
    evidence["verified"] = True
    evidence["reason_codes"] = ["evidence_missing"]
    evidence["gaps"] = ["evidence_missing"]
    evidence.pop("receipt_id"); evidence.pop("canonical_hash")
    with pytest.raises(ValidationError, match="complete and explicit"):
        BackupEvidenceReceipt.model_validate({**evidence,
            "receipt_id": "ber_" + "a" * 48, "canonical_hash": "b" * 64})


@pytest.mark.parametrize("scenario,reason", [
    ("recovery-corrupt-timescale", "checksum_mismatch"),
    ("recovery-cutoff-disagreement", "cutoff_disagreement"),
    ("recovery-redis-as-truth-rejected", "redis_used_as_truth"),
    ("recovery-wrong-tenant", "wrong_tenant"),
    ("recovery-production-outbound-rejection", "outbound_attempted"),
])
def test_adversarial_scenarios_fail_closed_with_stable_reasons(scenario, reason):
    result = run_fixture(scenario, "observe", NOW, FEATURE_2)
    assert result["candidate"]["readOnlyOutcome"] == "blocked"
    assert reason in result["candidate"]["reasonCodes"]


def test_recovery_continuity_is_authority_critical_only_for_named_operations():
    relevant = {SafetyOperation.PROPOSE, SafetyOperation.REQUEST_APPROVAL,
        SafetyOperation.PREFLIGHT, SafetyOperation.SUBMIT}
    bindings = {
        SafetyOperation.INGEST: {"source": "fixture", "market": "BTC"},
        SafetyOperation.ANALYZE: {"market": "BTC"},
        SafetyOperation.RENDER_PREVIOUS: {"market": "BTC", "snapshot_hash": "a" * 64},
        SafetyOperation.SIMULATE: {"market": "BTC", "venue": "fixture", "account": "acct",
            "analysis_id": "analysis", "quote_reference": "quote"},
        SafetyOperation.PROPOSE: {"market": "BTC", "analysis_decision_hash": "a" * 64, "policy_version": "1"},
        SafetyOperation.REQUEST_APPROVAL: {"market": "BTC", "analysis_decision_hash": "a" * 64, "policy_version": "1"},
        SafetyOperation.PREFLIGHT: {"market": "BTC", "venue": "fixture", "account": "acct",
            "analysis_id": "analysis", "policy_version": "1", "quote_reference": "quote"},
        SafetyOperation.SUBMIT: {"market": "BTC", "venue": "fixture", "account": "acct",
            "analysis_id": "analysis", "policy_version": "1", "quote_reference": "quote"},
        SafetyOperation.RECONCILE: {"venue": "fixture", "account": "acct"},
    }
    for operation, bound in bindings.items():
        assert ("recovery_continuity" in requirements_for(operation, bound)) == (operation in relevant)


def test_product_builders_emit_unknown_and_test_center_cannot_emit_healthy_product_receipt():
    proposal = proposal_observations({"strategy": {}, "profile": {}, "policy": {}}, [], False,
        "analysis", {"outcome": "block"}, NOW)
    execution = execution_context_observations({"strategy": {}, "policy": {}, "proposal": {}})
    for observations in (proposal, execution):
        item = observations["recovery_continuity"]
        assert item.status.value == "unknown"
        assert item.reason_code == "recovery_continuity_not_authoritatively_proven"
    source = (ROOT / "agent-service/src/moeazi_agent/recovery_evaluator.py").read_text(encoding="utf-8")
    assert "build_receipt" not in source and "DependencyStatus.HEALTHY" not in source


class DictRedis:
    def __init__(self): self.values = {}
    async def get(self, key): return self.values.get(key)
    async def eval(self, script, count, *args):
        keys, argv = args[:count], args[count:]
        if "MGET" in script:
            return [self.values.get(key) for key in keys]
        key = keys[0]
        expected, payload, _ttl, now, required_mode, *bindings = argv
        current = json.loads(self.values[key])["revision"] if key in self.values else 0
        if current != int(expected): return 0
        for index, prerequisite_key in enumerate(keys[1:]):
            raw = self.values.get(prerequisite_key)
            if not raw: return -1
            prerequisite = json.loads(raw)
            bound_hash, bound_revision, bound_registry = bindings[index * 3:index * 3 + 3]
            if prerequisite["controlHash"] != bound_hash \
                    or prerequisite["revision"] != int(bound_revision) \
                    or prerequisite["registryHash"] != bound_registry \
                    or prerequisite["expiresAt"] <= int(now): return -1
            if required_mode == "enforce" and (prerequisite["effectiveMode"] != "enforce"
                    or "enforce" not in prerequisite["layers"]): return -1
        self.values[key] = payload
        return 1


@pytest.mark.asyncio
async def test_feature_scoped_controls_require_dependency_closed_feature_01():
    redis = DictRedis(); registry = registry_response()
    common = {"registry_version": registry["registryVersion"], "registry_hash": registry["registryHash"]}
    feature_2 = ControlUpdate(feature_id=FEATURE_2, **common, expected_revision=0,
        mode="observe", layers=["capture", "evaluate", "project"])
    with pytest.raises(RuntimeError, match="prerequisite"):
        await cas_controls(redis, "operator_fixture", feature_2)
    first = await cas_controls(redis, "operator_fixture", ControlUpdate(feature_id=FEATURE_1,
        **common, expected_revision=0, mode="observe", layers=["capture", "evaluate", "project"]))
    second = await cas_controls(redis, "operator_fixture", feature_2)
    assert second["current"]["effectiveMode"] == "observe"
    assert second["current"]["prerequisiteBindings"] == [{
        "featureId": FEATURE_1, "revision": first["current"]["revision"],
        "registryHash": first["current"]["registryHash"],
        "controlHash": first["current"]["controlHash"],
    }]
    assert controls_key("operator_fixture", FEATURE_1) != controls_key("operator_fixture", FEATURE_2)
    enforce = ControlUpdate(feature_id=FEATURE_2, **common, expected_revision=1, mode="enforce",
        layers=["capture", "evaluate", "project", "enforce"])
    with pytest.raises(RuntimeError, match="prerequisite"):
        await cas_controls(redis, "operator_fixture", enforce)


@pytest.mark.asyncio
async def test_feature_02_run_snapshot_fails_after_prerequisite_change_reset_or_expiry():
    redis = DictRedis(); registry = registry_response()
    common = {"registry_version": registry["registryVersion"], "registry_hash": registry["registryHash"]}
    first = (await cas_controls(redis, "operator_fixture", ControlUpdate(feature_id=FEATURE_1,
        **common, expected_revision=0, mode="observe", layers=["capture", "evaluate", "project"])))["current"]
    second = (await cas_controls(redis, "operator_fixture", ControlUpdate(feature_id=FEATURE_2,
        **common, expected_revision=0, mode="observe", layers=["capture", "evaluate", "project"])))["current"]
    assert (await freeze_control_snapshot(redis, "operator_fixture", FEATURE_2,
        second["controlHash"]))["controlHash"] == second["controlHash"]
    await cas_controls(redis, "operator_fixture", ControlUpdate(feature_id=FEATURE_1,
        **common, expected_revision=1, mode="off", layers=[]))
    with pytest.raises(RuntimeError, match="prerequisite closure"):
        await freeze_control_snapshot(redis, "operator_fixture", FEATURE_2, second["controlHash"])
    redis.values[controls_key("operator_fixture", FEATURE_1)] = json.dumps({**first, "expiresAt": 1})
    with pytest.raises(RuntimeError, match="prerequisite closure"):
        await freeze_control_snapshot(redis, "operator_fixture", FEATURE_2, second["controlHash"])


@pytest.mark.asyncio
async def test_feature_02_multi_key_cas_rejects_prerequisite_race():
    class RaceRedis(DictRedis):
        async def eval(self, script, count, *args):
            if "MGET" not in script and count > 1:
                key = args[1]
                value = json.loads(self.values[key]); value["revision"] += 1
                value["controlHash"] = "f" * 64; self.values[key] = json.dumps(value)
            return await super().eval(script, count, *args)
    redis = RaceRedis(); registry = registry_response()
    common = {"registry_version": registry["registryVersion"], "registry_hash": registry["registryHash"]}
    await cas_controls(redis, "operator_fixture", ControlUpdate(feature_id=FEATURE_1,
        **common, expected_revision=0, mode="observe", layers=["capture", "evaluate", "project"]))
    with pytest.raises(RuntimeError, match="changed during"):
        await cas_controls(redis, "operator_fixture", ControlUpdate(feature_id=FEATURE_2,
            **common, expected_revision=0, mode="observe", layers=["capture", "evaluate", "project"]))
    assert controls_key("operator_fixture", FEATURE_2) not in redis.values


@pytest.mark.asyncio
async def test_malformed_or_expired_feature_lease_restores_safe_off():
    redis = DictRedis(); key = controls_key("operator_fixture", FEATURE_2)
    redis.values[key] = json.dumps({"featureId": FEATURE_2, "effectiveMode": "enforce"})
    assert (await get_controls(redis, "operator_fixture", FEATURE_2))["effectiveMode"] == "off"
    registry = registry_response()
    value = {"featureId": FEATURE_2, "registryVersion": registry["registryVersion"],
        "registryHash": registry["registryHash"], "revision": 1, "requestedMode": "observe",
        "effectiveMode": "observe", "layers": ["capture", "evaluate", "project"],
        "manualGuard": True, "liteMode": True, "expiresAt": 1, "controlHash": "a" * 64}
    redis.values[key] = json.dumps(value)
    assert (await get_controls(redis, "operator_fixture", FEATURE_2))["effectiveMode"] == "off"


@pytest.mark.asyncio
async def test_feature05_controls_fail_closed_without_prerequisite_closure():
    redis = DictRedis(); registry = registry_response()
    update = ControlUpdate(feature_id="execution-artifact-certification",
        registry_version=registry["registryVersion"], registry_hash=registry["registryHash"],
        expected_revision=0, mode="observe", layers=["capture"])
    with pytest.raises(RuntimeError, match="prerequisite"):
        await cas_controls(redis, "operator_fixture", update)
    assert redis.values == {}


def test_registry_v4_exposes_features_02_through_07_and_all_effect_contracts():
    registry = registry_response(); first, second, third, fourth, fifth, sixth, seventh, eighth, ninth, tenth, eleventh, *later = registry["features"]
    assert second["availability"] == "available" and second["defaultMode"] == "off"
    assert second["layers"]["enforce"] == "isolated-test-center"
    assert second["effects"] == {"authority": True, "cost": False,
        "persistence": True, "sideEffects": False}
    assert first["commitSha"] == "f59c77c00e6b72c9c069af2b80de4647ee790287"
    assert third["availability"] == "available"
    assert third["defaultMode"] == "off"
    assert third["layers"]["enforce"] == "isolated-test-center"
    assert third["productAvailability"] == "unavailable"
    assert third["audit"] == "Reviewed — findings deferred"
    assert third["effects"] == {"authority": True, "cost": True,
        "persistence": True, "sideEffects": True}
    assert fourth["availability"] == "available" and fourth["defaultMode"] == "off"
    assert fourth["productAvailability"] == "unavailable"
    assert fourth["effects"] == {"authority": True, "cost": False,
        "persistence": True, "sideEffects": False}
    assert fifth["availability"] == "available" and fifth["defaultMode"] == "off"
    assert fifth["productAvailability"] == "unavailable"
    assert sixth["id"] == "temporal-integrity" and sixth["availability"] == "available"
    assert seventh["id"] == "instrument-lifecycle-registry" and seventh["availability"] == "available"
    assert seventh["productAvailability"] == "unavailable"
    assert eighth["id"] == "capability-delegation-lifecycle" and eighth["availability"] == "available"
    assert eighth["productAvailability"] == "unavailable"
    assert ninth["id"] == "authoritative-risk-snapshot-and-reconciliation" and ninth["availability"] == "available"
    assert ninth["productAvailability"] == "unavailable"
    assert tenth["id"] == "asset-conservation-journal" and tenth["availability"] == "available"
    assert eleventh["id"] == "intent-execution-equivalence" and eleventh["availability"] == "available"
    feature12, feature13, feature14, feature15, feature16, feature17, feature18, feature19, feature20, feature21, feature22, feature23, feature24, feature25, feature26, *queued = later
    assert feature12["id"] == "venue-price-liquidation-safety"
    assert feature12["availability"] == "available" and feature12["productAvailability"] == "unavailable"
    assert feature13["id"] == "collateral-resilience-exit-capacity"
    assert feature13["availability"] == "available" and feature13["productAvailability"] == "unavailable"
    assert feature13["dependencies"] == ["venue-price-liquidation-safety"]
    assert feature14["id"] == "verified-strategy-termination"
    assert feature14["availability"] == "available" and feature14["productAvailability"] == "unavailable"
    assert feature14["dependencies"] == [
        "cross-state-recovery-continuity", "intent-execution-equivalence"]
    assert feature15["id"] == "incident-communication-outbox"
    assert feature15["availability"] == "available" and feature15["dependencies"] == []
    assert feature16["id"] == "safety-change-quorum"
    assert feature16["availability"] == "available" and feature16["dependencies"] == []
    assert feature16["productAvailability"] == "unavailable"
    assert feature17["id"] == "operator-qualification"
    assert feature17["availability"] == "available" and feature17["productAvailability"] == "unavailable"
    assert feature18["id"] == "mandate-policy-semantic-fidelity"
    assert feature18["availability"] == "available" and feature18["productAvailability"] == "unavailable"
    assert feature19["id"] == "effective-authority-decision"
    assert feature19["availability"] == "available" and feature19["productAvailability"] == "unavailable"
    assert feature19["testCenter"] == "Isolated enforce"
    assert feature20["id"] == "risk-tiered-approval-consent" and feature20["availability"] == "available"
    assert feature20["testCenter"] == "Isolated enforce" and feature20["productAvailability"] == "unavailable"
    assert feature21["id"] == "external-usage-rights" and feature21["availability"] == "available"
    assert feature21["testCenter"] == "Isolated enforce" and feature21["productAvailability"] == "unavailable"
    assert feature22["id"] == "external-product-eligibility" and feature22["availability"] == "available"
    assert feature22["testCenter"] == "Isolated enforce" and feature22["productAvailability"] == "unavailable"
    assert feature23["id"] == "customer-contestation" and feature23["availability"] == "available"
    assert feature23["testCenter"] == "Isolated enforce" and feature23["productAvailability"] == "unavailable"
    assert feature24["id"] == "customer-account-portability" and feature24["availability"] == "available"
    assert feature24["testCenter"] == "Isolated enforce" and feature24["productAvailability"] == "unavailable"
    assert feature25["id"] == "evidence-event-fabric" and feature25["availability"] == "available"
    assert feature25["testCenter"] == "Isolated enforce" and feature25["productAvailability"] == "unavailable"
    assert feature26["id"] == "schedule-sync-outbox" and feature26["availability"] == "available"
    assert feature26["testCenter"] == "Isolated enforce" and feature26["productAvailability"] == "unavailable"
    feature27, feature28, *remaining = queued
    assert feature27["id"] == "system-safety-assurance-corpus"
    assert feature27["availability"] == "available" and feature27["productAvailability"] == "unavailable"
    assert feature28["id"] == "claim-disagreement-ledger"
    assert feature28["availability"] == "available" and feature28["productAvailability"] == "unavailable"
    feature29, feature30, feature31, feature32, feature33, feature34, feature35, feature36, feature37, *remaining = remaining
    assert feature29["id"] == "specialist-source-value-attribution"
    assert feature29["availability"] == "available" and feature29["productAvailability"] == "unavailable"
    assert feature30["id"] == "manipulation-aware-evidence-integrity"
    assert feature30["availability"] == "available" and feature30["productAvailability"] == "unavailable"
    assert feature31["id"] == "portfolio-aware-sizing"
    assert feature31["availability"] == "available" and feature31["productAvailability"] == "unavailable"
    assert feature32["id"] == "multi-venue-execution-quality-routing"
    assert feature32["availability"] == "available" and feature32["productAvailability"] == "unavailable"
    assert feature33["id"] == "calibrated-shadow-execution-tca"
    assert feature33["availability"] == "available" and feature33["productAvailability"] == "unavailable"
    assert feature34["id"] == "deterministic-run-planning"
    assert feature34["availability"] == "available" and feature34["productAvailability"] == "unavailable"
    assert feature35["id"] == "outcome-linked-decision-memory"
    assert feature35["availability"] == "available" and feature35["productAvailability"] == "unavailable"
    assert feature35["testCenter"] == "Isolated enforce"
    assert feature36["id"] == "outcome-calibrated-promotion"
    assert feature36["availability"] == "available" and feature36["productAvailability"] == "unavailable"
    assert feature36["testCenter"] == "Isolated enforce"
    assert feature37["id"] == "calibrated-selective-prediction"
    assert feature37["availability"] == "available" and feature37["productAvailability"] == "unavailable"
    assert feature37["testCenter"] == "Isolated enforce"
    feature38, *remaining = remaining
    assert (feature38["id"], feature38["availability"], feature38["implementation"], feature38["implementationVerification"]) == (
        "analytical-diversity-audit", "available", "Implemented", "PASS")
    assert remaining == []
    assert all(set(item["effects"]) == {"authority", "cost", "persistence", "sideEffects"}
        for item in registry["features"])
def test_recovery_modules_have_no_external_authority_imports_or_capabilities():
    for name in ("recovery_evaluator.py", "recovery_registry.py", "recovery_storage.py"):
        source = (ROOT / "agent-service/src/moeazi_agent" / name).read_text(encoding="utf-8")
        for forbidden in ("from .providers", "from .credentials", "from .venues",
            "from .convex", "gateway_call(", "httpx.", "requests."):
            assert forbidden not in source.lower()
