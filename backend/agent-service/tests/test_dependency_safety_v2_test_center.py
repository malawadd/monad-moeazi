from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from moeazi_agent.config import Settings
from moeazi_agent.dependency_safety_contracts import (
    DependencyStatus, SafetyOperation, SafetyScope, canonical_payload_digest,
    safety_request_hash,
)
from moeazi_agent.dependency_safety_matrix import (
    build_receipt, evaluate_safety, verify_safety_decision,
)
from moeazi_agent.test_center import (
    ControlUpdate, cas_controls, feature_is_testable, registry_response, run_fixture,
    sanitize_artifact,
)
from moeazi_agent import test_center_api

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parents[2]


def test_canonical_scope_rejects_caller_authored_keys_and_contradictions():
    with pytest.raises(ValidationError, match="canonical"):
        SafetyScope(kind="account", key="tenant:wrong", strategy_account_id="acct-a")
    with pytest.raises(ValidationError, match="forbidden"):
        SafetyScope(kind="global", key="global", strategy_account_id="acct-a")


def test_equal_time_receipts_have_a_deterministic_hash_tie_break():
    scope = SafetyScope(kind="account", key="account:acct-a", strategy_account_id="acct-a")
    healthy = build_receipt(
        "convex_product_state", scope, DependencyStatus.HEALTHY, NOW,
        "healthy", "r1", "v2", "same-time-healthy",
    )
    opened = build_receipt(
        "convex_product_state", scope, DependencyStatus.OPEN, NOW,
        "opened", "r2", "v2", "same-time-open",
    )
    bindings = {"market": "BTC", "snapshot_hash": "a" * 64}
    first = evaluate_safety(
        SafetyOperation.RENDER_PREVIOUS, scope, "render", [healthy, opened], bindings,
        "render:one", NOW, "enforce", request_hash="a" * 64,
    )
    second = evaluate_safety(
        SafetyOperation.RENDER_PREVIOUS, scope, "render", [opened, healthy], bindings,
        "render:one", NOW, "enforce", request_hash="a" * 64,
    )
    assert first.decision_hash == second.decision_hash
    expected = max((healthy, opened), key=lambda item: item.canonical_hash)
    assert first.outcome == ("allow" if expected.status is DependencyStatus.HEALTHY else "block")


def test_exact_binding_and_request_hash_tamper_fail_closed_and_v1_is_legacy():
    scope = SafetyScope(kind="account", key="account:acct-a", strategy_account_id="acct-a")
    receipt = build_receipt(
        "convex_product_state", scope, DependencyStatus.HEALTHY, NOW,
        "healthy", "r1", "v2", "render",
    )
    bindings = {"market": "BTC", "snapshot_hash": "b" * 64}
    request_hash = canonical_payload_digest({"snapshot": "b" * 64})
    decision = evaluate_safety(
        SafetyOperation.RENDER_PREVIOUS, scope, "render", [receipt], bindings,
        "render:one", NOW, "enforce", request_hash=request_hash,
    )
    verify_safety_decision(
        decision, SafetyOperation.RENDER_PREVIOUS, "render", "render:one", NOW,
        bindings, request_hash,
    )
    with pytest.raises(ValueError, match="bindings"):
        verify_safety_decision(
            decision, SafetyOperation.RENDER_PREVIOUS, "render", "render:one", NOW,
            {"market": "ETH", "snapshot_hash": "b" * 64}, request_hash,
        )
    with pytest.raises(ValueError, match="request hash"):
        verify_safety_decision(
            decision, SafetyOperation.RENDER_PREVIOUS, "render", "render:one", NOW,
            bindings, "c" * 64,
        )
    legacy = decision.model_copy(update={
        "schema_version": 1, "matrix_version": "dependency-safety-v1",
    })
    assert not legacy.permits(NOW)


def test_checked_in_registry_and_scenarios_are_bounded_and_deterministic():
    registry = registry_response()
    assert registry["featureCount"] == 38
    assert registry["modes"] == ["off", "observe", "enforce", "unavailable"]
    available = {item["id"] for item in registry["features"] if feature_is_testable(item)}
    for item in registry["scenarios"]:
        if item["featureId"] not in available:
            with pytest.raises(ValueError, match="unavailable"):
                run_fixture(item["id"], "observe", NOW, item["featureId"])
            continue
        first = run_fixture(item["id"], "observe", NOW, item["featureId"])
        second = run_fixture(item["id"], "observe", NOW, item["featureId"])
        assert first == second and first["invariantVerdict"] == "pass"
    with pytest.raises(ValueError, match="Unknown"):
        run_fixture("../../secrets", "observe", NOW)


def test_artifact_sanitizer_rejects_paths_urls_env_and_floats():
    for unsafe in ("../private", "https://example.invalid", "C:\\host", "/root", "API_ENV"):
        with pytest.raises(ValueError, match="unsafe"):
            sanitize_artifact({"value": unsafe})
    with pytest.raises(ValueError, match="floats"):
        sanitize_artifact({"value": 0.5})
    with pytest.raises(ValueError, match="field name"):
        sanitize_artifact({"private_key": "redacted"})


class FakeRedis:
    def __init__(self):
        self.value = None

    async def get(self, _key):
        return self.value

    async def eval(self, script, count, *args):
        import json
        keys, argv = args[:count], args[count:]
        if "MGET" in script:
            return [self.value if index == 0 else None for index, _key in enumerate(keys)]
        expected, payload = argv[:2]
        current = json.loads(self.value)["revision"] if self.value else 0
        if current != int(expected):
            return 0
        self.value = payload
        return 1


@pytest.mark.asyncio
async def test_controls_are_cas_bounded_and_off_is_conservative():
    redis = FakeRedis()
    registry = registry_response()
    binding = {"feature_id": "dependency-safety-envelope",
        "registry_version": registry["registryVersion"], "registry_hash": registry["registryHash"]}
    first = await cas_controls(redis, "operator_fixture", ControlUpdate(
        **binding, expected_revision=0, mode="observe", layers=["capture", "evaluate"],
    ))
    assert first["current"]["revision"] == 1
    assert first["current"]["manualGuard"] and first["current"]["liteMode"]
    with pytest.raises(RuntimeError, match="revision"):
        await cas_controls(redis, "operator_fixture", ControlUpdate(
            **binding, expected_revision=0, mode="enforce",
            layers=["capture", "evaluate", "project", "enforce"],
        ))
    with pytest.raises(ValidationError):
        ControlUpdate(**binding, expected_revision=1, mode="off", layers=["evaluate"])


def test_startup_and_backend_authorization_fail_closed():
    base = dict(
        _env_file=None, agent_test_center_enabled=True, environment="local",
        test_center_operator_subjects="operator-a", test_center_repository_sha="a" * 40,
    )
    Settings(**base)
    with pytest.raises(ValidationError):
        Settings(**base, live_execution_enabled=True, dependency_safety_mode="enforce")
    with pytest.raises(ValidationError):
        Settings(**base, test_center_bind_host="0.0.0.0")
    with pytest.raises(ValidationError):
        Settings(**{**base, "test_center_operator_subjects": ""})
    monkey = SimpleNamespace(
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "secret"),
        test_center_operator_set=frozenset({"operator-a"}), agent_test_center_enabled=True,
    )
    original = test_center_api.settings
    test_center_api.settings = monkey
    try:
        with pytest.raises(Exception):
            test_center_api.authorize("Bearer secret", "operator-b", "b" * 64)
        assert test_center_api.authorize("Bearer secret", "operator-a", "b" * 64).startswith("operator_")
    finally:
        test_center_api.settings = original


def test_test_center_module_has_no_external_authority_imports_and_migration_is_immutable():
    source = (ROOT / "agent-service/src/moeazi_agent/test_center.py").read_text(encoding="utf-8")
    for forbidden in ("providers", "credentials", "venues", "Convex", "gateway_call", "deployment"):
        assert forbidden not in source
    migration = (ROOT / "agent-service/migrations/007_dependency_safety_v2_test_center.sql").read_text(encoding="utf-8")
    assert "safety_decisions_v2_idempotency" in migration
    assert migration.count("reject_dependency_safety_mutation") == 3
    assert "idempotency_key text" not in migration
    upgrade = (ROOT / "agent-service/migrations/008_dependency_safety_v2_test_center_idempotency.sql").read_text(encoding="utf-8")
    assert upgrade.index("DROP TRIGGER") < upgrade.index("UPDATE agent_test_center_runs")
    assert upgrade.index("UPDATE agent_test_center_runs") < upgrade.index("CREATE TRIGGER")
    assert upgrade.lstrip().startswith("BEGIN;") and upgrade.rstrip().endswith("COMMIT;")
    assert "ADD COLUMN IF NOT EXISTS" in upgrade and "IF NOT EXISTS (SELECT 1 FROM pg_constraint" in upgrade
    assert "WHERE idempotency_key IS NULL" in upgrade and "WHERE request_hash IS NULL" in upgrade


def test_test_center_compose_has_minimal_environment_and_internal_network_only():
    compose = (ROOT / "docker-compose.agents.yml").read_text(encoding="utf-8")
    service = compose[compose.index("  test-center:"):compose.index("  worker:")]
    assert "<<: *agent-service" not in service and "env_file:" not in service
    for forbidden in ("OPENAI_API_KEY", "DEEPSEEK_API_KEY", "CONVEX_", "TEMPORAL_",
        "ARBITRUM_RPC_URL", "LIVE_EXECUTION", "MASTER_KEY", "VENUE", "SIDECAR", "GATEWAY"):
        assert forbidden not in service
    required = ("ENVIRONMENT", "POSTGRES_DSN", "REDIS_URL", "WORKER_SHARED_SECRET",
        "AGENT_TEST_CENTER_ENABLED", "TEST_CENTER_OPERATOR_SUBJECTS", "TEST_CENTER_BIND_HOST",
        "TEST_CENTER_EXTERNAL_NETWORK_ENABLED", "TEST_CENTER_REPOSITORY_SHA")
    assert all(name in service for name in required)
    assert 'ports: ["127.0.0.1:8110:8110"]' in service
    assert "networks: [test-center-runtime]" in service
    assert "test-center-runtime:\n    internal: true" in compose
    assert compose.count("test-center-runtime") == 4


def test_preflight_admission_precedes_quote_work_and_dispatch_rechecks_exact_hashes():
    source = (ROOT / "agent-service/src/moeazi_agent/execution_api.py").read_text(encoding="utf-8")
    preflight = source[source.index('async def preflight('):source.index('@app.post("/internal/preflight/admission")')]
    assert preflight.index("verify_safety_decision") < preflight.index("gateway.preflight")
    dispatch = source[source.index("async def dispatch("):source.index('@app.post("/internal/cancel")')]
    assert "actual_bindings" in dispatch
    assert "safety_request_hash(SafetyOperation.SUBMIT" in dispatch


@pytest.mark.parametrize("mode,layers", [
    ("off", ["capture"]),
    ("observe", ["evaluate"]),
    ("observe", ["capture", "project"]),
    ("enforce", ["capture", "evaluate", "enforce"]),
])
def test_test_center_rejects_non_closed_layer_combinations(mode, layers):
    registry = registry_response()
    with pytest.raises(ValidationError, match="layers|layer"):
        ControlUpdate(feature_id="dependency-safety-envelope",
            registry_version=registry["registryVersion"], registry_hash=registry["registryHash"],
            expected_revision=0, mode=mode, layers=layers)


@pytest.mark.parametrize("kind,values", [
    ("tenant", {"tenant_id": "tenant-a", "strategy_account_id": "acct-a"}),
    ("account", {"strategy_account_id": "acct-a", "venue": "uniswap"}),
    ("venue", {"strategy_account_id": "acct-a", "venue": "uniswap", "market": "BTC"}),
    ("market", {"strategy_account_id": "acct-a", "market": "BTC", "workflow_id": "wf"}),
    ("workflow", {"strategy_account_id": "acct-a", "workflow_id": "wf", "market": "BTC"}),
])
def test_scope_rejects_every_forbidden_field_combination(kind, values):
    with pytest.raises(ValidationError, match="forbidden"):
        SafetyScope(kind=kind, key="caller-key", **values)


def test_registry_exposes_exact_full_queue_and_layer_states():
    registry = registry_response()
    assert len(registry["features"]) == 38
    assert [item["order"] for item in registry["features"]] == list(range(1, 39))
    assert all(set(item["layers"]) == {"capture", "evaluate", "project", "enforce"}
               for item in registry["features"])
    first, second, third, fourth, fifth, sixth, seventh, eighth, ninth, tenth, eleventh, *queued = registry["features"]
    assert (first["implementation"], first["implementationVerification"], first["audit"]) == (
        "Implemented", "PASS", "Reviewed — no findings")
    assert first["commitSha"] == "f59c77c00e6b72c9c069af2b80de4647ee790287"
    assert (second["implementation"], second["implementationVerification"], second["audit"]) == (
        "Implemented", "PASS", "Reviewed — no findings")
    assert second["commitSha"] == "0b6a22090be3ed8f2897606a15dd2db6abca504e"
    assert (third["implementation"], third["implementationVerification"], third["audit"]) == (
        "Implemented", "PASS", "Reviewed — findings deferred")
    assert third["availability"] == "available" and third["defaultMode"] == "off"
    assert third["layers"]["enforce"] == "isolated-test-center"
    assert (fourth["implementation"], fourth["implementationVerification"], fourth["audit"]) == (
        "Implemented", "PASS", "Reviewed — findings deferred")
    assert fourth["remediation"] == "Deferred to roadmap audit goal"
    assert fourth["availability"] == "available" and fourth["defaultMode"] == "off"
    assert fourth["productAvailability"] == "unavailable"
    assert fourth["dependencies"] == ["cross-state-recovery-continuity",
        "dependency-safety-envelope", "evidence-lifecycle-boundary"]
    assert (fifth["implementation"], fifth["implementationVerification"], fifth["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert fifth["dependencies"] == ["operational-secret-custody"]
    assert (sixth["implementation"], sixth["implementationVerification"], sixth["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert sixth["availability"] == "available" and sixth["productAvailability"] == "unavailable"
    assert (seventh["implementation"], seventh["implementationVerification"], seventh["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert seventh["availability"] == "available" and seventh["productAvailability"] == "unavailable"
    assert (eighth["implementation"], eighth["implementationVerification"], eighth["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert eighth["availability"] == "available" and eighth["productAvailability"] == "unavailable"
    assert (ninth["implementation"], ninth["implementationVerification"], ninth["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert ninth["availability"] == "available" and ninth["productAvailability"] == "unavailable"
    assert (tenth["implementation"], tenth["implementationVerification"], tenth["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert tenth["availability"] == "available" and tenth["productAvailability"] == "unavailable"
    assert (eleventh["implementation"], eleventh["implementationVerification"], eleventh["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert eleventh["availability"] == "available" and eleventh["productAvailability"] == "unavailable"
    feature12, feature13, feature14, feature15, feature16, feature17, feature18, feature19, feature20, feature21, feature22, feature23, feature24, feature25, *later = queued
    assert (feature12["implementation"], feature12["implementationVerification"], feature12["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature13["implementation"], feature13["implementationVerification"], feature13["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert feature13["availability"] == "available" and feature13["productAvailability"] == "unavailable"
    assert (feature14["implementation"], feature14["implementationVerification"], feature14["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert feature14["availability"] == "available" and feature14["productAvailability"] == "unavailable"
    assert feature14["testCenter"] == "Isolated enforce"
    assert (feature15["implementation"], feature15["implementationVerification"], feature15["audit"]) == (
        "Implemented", "PASS", "Reviewed — archived privately")
    assert feature15["availability"] == "available" and feature15["dependencies"] == []
    assert (feature16["implementation"], feature16["implementationVerification"], feature16["audit"]) == (
        "Implemented", "PASS", "Reviewed \u2014 archived privately")
    assert (feature17["id"], feature17["implementation"], feature17["implementationVerification"], feature17["audit"]) == (
        "operator-qualification", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature18["id"], feature18["implementation"], feature18["implementationVerification"], feature18["audit"]) == (
        "mandate-policy-semantic-fidelity", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature19["id"], feature19["implementation"], feature19["implementationVerification"]) == (
        "effective-authority-decision", "Implemented", "PASS")
    assert feature19["availability"] == "available" and feature19["testCenter"] == "Isolated enforce"
    assert feature19["productAvailability"] == "unavailable"
    assert feature19["audit"] == "Reviewed — archived privately"
    assert (feature20["id"], feature20["implementation"], feature20["implementationVerification"], feature20["audit"]) == ("risk-tiered-approval-consent", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature20["availability"] == "available" and feature20["testCenter"] == "Isolated enforce"
    assert (feature21["id"], feature21["implementation"], feature21["implementationVerification"], feature21["audit"]) == ("external-usage-rights", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature21["availability"] == "available" and feature21["testCenter"] == "Isolated enforce"
    assert (feature22["id"], feature22["implementation"], feature22["implementationVerification"], feature22["audit"]) == ("external-product-eligibility", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature22["availability"] == "available" and feature22["testCenter"] == "Isolated enforce"
    assert (feature23["id"], feature23["implementation"], feature23["implementationVerification"], feature23["audit"]) == ("customer-contestation", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature23["availability"] == "available" and feature23["testCenter"] == "Isolated enforce"
    assert (feature24["id"], feature24["implementation"], feature24["implementationVerification"], feature24["audit"]) == ("customer-account-portability", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature24["availability"] == "available" and feature24["testCenter"] == "Isolated enforce"
    assert (feature25["id"], feature25["implementation"], feature25["implementationVerification"], feature25["audit"]) == ("evidence-event-fabric", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature25["availability"] == "available" and feature25["testCenter"] == "Isolated enforce"
    assert feature25["productAvailability"] == "unavailable"
    feature26 = registry["features"][25]
    assert (feature26["id"], feature26["implementation"], feature26["implementationVerification"], feature26["audit"]) == ("schedule-sync-outbox", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature26["availability"] == "available" and feature26["testCenter"] == "Isolated enforce"
    assert feature16["availability"] == "available" and feature16["dependencies"] == []
    assert feature16["productAvailability"] == "unavailable"
    feature27, feature28, feature29, feature30, feature31, feature32, feature33, feature34, feature35, feature36, feature37, *queued = registry["features"][26:]
    assert (feature27["id"], feature27["implementation"], feature27["implementationVerification"], feature27["audit"]) == (
        "system-safety-assurance-corpus", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature28["id"], feature28["implementation"], feature28["implementationVerification"], feature28["audit"]) == (
        "claim-disagreement-ledger", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature29["id"], feature29["implementation"], feature29["implementationVerification"], feature29["audit"]) == (
        "specialist-source-value-attribution", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature30["id"], feature30["implementation"], feature30["implementationVerification"], feature30["audit"]) == (
        "manipulation-aware-evidence-integrity", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature31["id"], feature31["implementation"], feature31["implementationVerification"], feature31["audit"]) == (
        "portfolio-aware-sizing", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature32["id"], feature32["implementation"], feature32["implementationVerification"], feature32["audit"]) == (
        "multi-venue-execution-quality-routing", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature33["id"], feature33["implementation"], feature33["implementationVerification"], feature33["audit"]) == (
        "calibrated-shadow-execution-tca", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature34["id"], feature34["implementation"], feature34["implementationVerification"], feature34["audit"]) == (
        "deterministic-run-planning", "Implemented", "PASS", "Reviewed — archived privately")
    assert (feature35["id"], feature35["implementation"], feature35["implementationVerification"], feature35["audit"]) == (
        "outcome-linked-decision-memory", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature35["availability"] == "available" and feature35["defaultMode"] == "off"
    assert feature35["layers"]["enforce"] == "isolated-test-center"
    assert (feature36["id"], feature36["implementation"], feature36["implementationVerification"]) == (
        "outcome-calibrated-promotion", "Implemented", "PASS")
    assert feature36["audit"].endswith("archived privately")
    assert feature36["availability"] == "available" and feature36["defaultMode"] == "off"
    assert feature36["layers"]["enforce"] == "isolated-test-center"
    assert (feature37["id"], feature37["implementation"], feature37["implementationVerification"], feature37["audit"]) == (
        "calibrated-selective-prediction", "Implemented", "PASS", "Reviewed — archived privately")
    assert feature37["availability"] == "available" and feature37["testCenter"] == "Isolated enforce"
    feature38, *remaining = queued
    assert (feature38["id"], feature38["availability"], feature38["implementation"], feature38["implementationVerification"]) == (
        "analytical-diversity-audit", "available", "Implemented", "PASS")
    assert remaining == []


def test_request_hash_golden_vectors_match_cross_language_fixture():
    import json
    vectors = json.loads((ROOT / "tests/fixtures/dependencySafetyRequestHashes.json").read_text())
    for vector in vectors:
        assert safety_request_hash(SafetyOperation(vector["operation"]),
            vector["request"], vector["bindings"]) == vector["expectedHash"]


@pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")])
def test_request_hash_rejects_non_finite_numbers(value):
    with pytest.raises(ValueError, match="finite"):
        canonical_payload_digest({"value": value})
