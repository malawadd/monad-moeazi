from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.operational_secret_contracts import digest, with_hash
from moeazi_agent.operational_secret_evaluator import envelope_metadata
from moeazi_agent.operational_secret_fake_vault import FakeVault
from moeazi_agent.operational_secret_lifecycle_contracts import DestructionPlan, RecoveryRequest
from moeazi_agent.operational_secret_operations import (
    assess_readiness, build_access_request, build_descriptor, plan_rotation, recover,
    rotation_receipt, simulate_destruction,
)
from moeazi_agent.operational_secret_registry import class_policies
from moeazi_agent.operational_secret_scenarios import (
    evaluate_fixture, evaluate_vault_fixture, scenario_registry,
)
from moeazi_agent.operational_secret_storage import MemoryOperationalSecretRepository
from moeazi_agent.test_center import ControlUpdate, cas_controls, freeze_control_snapshot, registry_response

TENANT = "tenant_aaaaaaaaaaaaaaaa:account_bbbbbbbbbbbbbbbb"


def vault():
    return FakeVault(environment="test", frozen_lease=True, development_gates_closed=True,
        fixture_id="osc-core-v1", fake_keks={1: bytes.fromhex("11" * 32)})


@pytest.mark.asyncio
async def test_scoped_access_persists_attempt_before_callback_and_terminal_after():
    now = datetime.now(timezone.utc)
    descriptor = build_descriptor(seed="access", tenant_scope=TENANT,
        class_id="model_provider_byok", source_owner="user")
    expires = now + timedelta(minutes=5)
    boundary, repository = vault(), MemoryOperationalSecretRepository()
    handle = boundary.store_fixture(descriptor, b"fixture-sentinel", expires,
        data_nonce=bytes.fromhex("22" * 12), wrap_nonce=bytes.fromhex("33" * 12))
    request = build_access_request(descriptor=descriptor, purpose="provider_call",
        consumer_id="provider_egress", consumer_version="v1", capability="invoke_provider",
        aad_hash=digest(envelope_metadata(descriptor, expires)), idempotency_key="test:access:1",
        requested_at=now)
    seen = []
    result = await boundary.access(handle, request, repository,
        lambda value: seen.append((bytes(value), len(repository.receipts))) or "ok", now)
    assert result == "ok" and seen == [(b"fixture-sentinel", 1)]
    assert [item.stage for item in repository.receipts] == ["authorized_attempt", "terminal"]
    assert "fixture-sentinel" not in repr(repository.__dict__)


@pytest.mark.asyncio
async def test_persistence_failure_prevents_plaintext_release_and_owner_class_is_rejected():
    now = datetime.now(timezone.utc)
    descriptor = build_descriptor(seed="failure", tenant_scope=TENANT,
        class_id="internal_service_auth", source_owner="platform")
    expires = now + timedelta(minutes=1)
    boundary = vault()
    handle = boundary.store_fixture(descriptor, b"never-released", expires)
    request = build_access_request(descriptor=descriptor, purpose="service_auth",
        consumer_id="service_auth_boundary", consumer_version="v1",
        capability="authenticate_service", aad_hash=digest(envelope_metadata(descriptor, expires)),
        idempotency_key="test:persist:fail", requested_at=now)
    called = False
    def callback(_):
        nonlocal called; called = True
    with pytest.raises(RuntimeError, match="persistence failure"):
        await boundary.access(handle, request, MemoryOperationalSecretRepository(True), callback, now)
    assert called is False
    owner = build_descriptor(seed="owner", tenant_scope=TENANT,
        class_id="owner_auth_material", source_owner="user")
    with pytest.raises(ValueError, match="categorically forbidden"):
        boundary.store_fixture(owner, b"forbidden", expires)


@pytest.mark.asyncio
async def test_terminal_receipt_outage_leaves_access_claimed():
    now = datetime.now(timezone.utc); expires = now + timedelta(minutes=1)
    descriptor = build_descriptor(seed="claim", tenant_scope=TENANT,
        class_id="internal_service_auth", source_owner="platform")
    boundary = vault(); handle = boundary.store_fixture(descriptor, b"claimed", expires)
    request = build_access_request(descriptor=descriptor, purpose="service_auth",
        consumer_id="service_auth_boundary", consumer_version="v1", capability="authenticate_service",
        aad_hash=digest(envelope_metadata(descriptor, expires)), idempotency_key="test:claimed:once", requested_at=now)
    class TerminalFailure(MemoryOperationalSecretRepository):
        async def append_terminal(self, receipt): raise RuntimeError("terminal outage")
    with pytest.raises(RuntimeError, match="terminal outage"):
        await boundary.access(handle, request, TerminalFailure(), lambda _: "ok", now)
    with pytest.raises(PermissionError, match="cannot be reused"):
        await boundary.access(handle, request, MemoryOperationalSecretRepository(), lambda _: "no", now)


@pytest.mark.asyncio
async def test_wrong_scope_and_lost_kek_block_before_callback():
    now = datetime.now(timezone.utc); expires = now + timedelta(minutes=1)
    descriptor = build_descriptor(seed="scope", tenant_scope=TENANT,
        class_id="internal_service_auth", source_owner="platform")
    boundary = vault(); handle = boundary.store_fixture(descriptor, b"not-released", expires)
    request = build_access_request(descriptor=descriptor, purpose="service_auth",
        consumer_id="service_auth_boundary", consumer_version="v1",
        capability="authenticate_service", aad_hash=digest(envelope_metadata(descriptor, expires)),
        idempotency_key="test:wrong:scope", requested_at=now,
        tenant_scope="tenant_cccccccccccccccc:account_dddddddddddddddd")
    called = False
    def callback(_):
        nonlocal called; called = True
    with pytest.raises(PermissionError, match="wrong_tenant"):
        await boundary.access(handle, request, MemoryOperationalSecretRepository(), callback, now)
    boundary.lose_kek(1)
    valid = request.model_copy(update={"tenant_scope": TENANT,
        "idempotency_key": "test:lost:kek", "request_hash": "f" * 64})
    with pytest.raises(PermissionError, match="unavailable"):
        await boundary.access(handle, valid, MemoryOperationalSecretRepository(), callback, now)
    assert called is False


def test_all_recovery_modes_rotation_destruction_and_readiness_are_fail_closed():
    now = datetime.now(timezone.utc)
    outcomes = set()
    for policy in class_policies():
        body = {"request_id": f"orq_{digest({'class': policy.class_id})[:48]}",
            "descriptor_id": f"osc_{digest({'descriptor': policy.class_id})[:48]}",
            "mode": policy.recovery_mode, "tenant_scope": TENANT,
            "consumers": list(policy.workload_identities), "purposes": list(policy.purposes),
            "capabilities": list(policy.capabilities),
            "duration_seconds": policy.access_ttl_seconds,
            "owner_approval_hash": "a" * 64 if policy.recovery_mode.value == "replace" else None,
            "idempotency_key": f"recover:{policy.class_id}"}
        request = with_hash(RecoveryRequest, "request_hash", **body)
        receipt = recover(request, policy.class_id, now); outcomes.add(receipt.outcome)
        assert receipt.upstream_status == "unknown"
    assert outcomes == {"reentered", "reissued", "replaced", "rewrapped",
                        "access_restored", "blocked"}
    descriptor = build_descriptor(seed="rotate", tenant_scope=TENANT,
        class_id="platform_provider_credential", source_owner="platform")
    plan = plan_rotation(descriptor, 2, 2, 2, "rotation:test:one")
    with pytest.raises(ValueError, match="replacement proof"):
        rotation_receipt(plan, "cutover", now)
    assert rotation_receipt(plan, "complete", now, replacement_verified=True).state == "incomplete"
    destruction_body = {"plan_id": f"odp_{'b' * 48}", "descriptor_id": descriptor.descriptor_id,
        "descriptor_hash": descriptor.descriptor_hash, "envelope_hashes": ["c" * 64],
        "dependency_hashes": ["d" * 64], "reviewer_ids": ["reviewer-a", "reviewer-b"]}
    destruction = with_hash(DestructionPlan, "plan_hash", **destruction_body)
    assert simulate_destruction(destruction, now, complete_inventory=True,
        active_envelopes=False, unresolved_lifecycle=False).outcome == "simulated_local"
    readiness = assess_readiness(seed="ready", tenant_scope=TENANT,
        dependency_hashes=["1" * 64, "2" * 64, "3" * 64], inventory_hash="4" * 64,
        receipt_chain_hash="5" * 64, blockers=[], now=now)
    assert readiness.local_fixture_outcome == "ready" and readiness.product_outcome == "unavailable"


def test_fixed_corpus_is_exhaustive_and_sanitized():
    scenarios = scenario_registry()
    assert len(scenarios) >= 40
    assert {item["classId"] for item in scenarios} >= {"owner_auth_material", "vault_data_key",
        "vault_access_binding", "restricted_venue_delegate_key"}
    now = datetime.now(timezone.utc)
    results = [evaluate_fixture(item, "enforce", now) for item in scenarios]
    assert all(item["invariantVerdict"] == "pass" for item in results)
    assert all(item["productOutcome"] == "unavailable" for item in results)
    assert all(item["upstreamRevocationStatus"] != "externally_verified" for item in results)


@pytest.mark.asyncio
async def test_test_center_happy_fixture_crosses_real_fake_vault_receipt_boundary():
    fixture = next(item for item in scenario_registry() if item["id"] == "osc-happy-scoped-access")
    repository = MemoryOperationalSecretRepository()
    result = await evaluate_vault_fixture(fixture, "enforce", datetime.now(timezone.utc),
        "operator_fixture", "a" * 64, repository, "test")
    assert result["invariantVerdict"] == "pass"
    assert [item.stage for item in repository.receipts] == ["authorized_attempt", "terminal"]


class MultiRedis:
    def __init__(self):
        self.values = {}
        self.last_key_count = 0
        self.drift_key = None

    async def get(self, key): return self.values.get(key)

    async def eval(self, script, count, *args):
        import json
        keys, argv = list(args[:count]), list(args[count:])
        self.last_key_count = count
        if "MGET" in script: return [self.values.get(key) for key in keys]
        current = json.loads(self.values[keys[0]])["revision"] if keys[0] in self.values else 0
        if current != int(argv[0]): return 0
        for index, key in enumerate(keys[1:]):
            parsed = json.loads(self.values[key])
            if key == self.drift_key: parsed["revision"] += 1
            offset = 5 + index * 3
            if (parsed["controlHash"] != argv[offset] or parsed["revision"] != int(argv[offset + 1])
                    or parsed["registryHash"] != argv[offset + 2]): return -1
        self.values[keys[0]] = argv[1]
        return 1


@pytest.mark.asyncio
async def test_feature_four_cas_freezes_all_three_prerequisites_atomically():
    redis = MultiRedis(); meta = registry_response()
    def update(feature, revision, mode="enforce"):
        return ControlUpdate(feature_id=feature, registry_version=meta["registryVersion"],
            registry_hash=meta["registryHash"], expected_revision=revision, mode=mode,
            layers=[] if mode == "off" else ["capture", "evaluate", "project", "enforce"])
    await cas_controls(redis, "operator_fixture", update("dependency-safety-envelope", 0))
    await cas_controls(redis, "operator_fixture", update("cross-state-recovery-continuity", 0))
    await cas_controls(redis, "operator_fixture", update("evidence-lifecycle-boundary", 0))
    feature = await cas_controls(redis, "operator_fixture", update("operational-secret-custody", 0))
    assert redis.last_key_count == 4
    assert [item["featureId"] for item in feature["current"]["prerequisiteBindings"]] == [
        "cross-state-recovery-continuity", "dependency-safety-envelope", "evidence-lifecycle-boundary"]
    frozen = await freeze_control_snapshot(redis, "operator_fixture", "operational-secret-custody",
        feature["current"]["controlHash"])
    assert frozen["controlHash"] == feature["current"]["controlHash"]
    assert [item["featureId"] for item in frozen["frozenPrerequisiteBindings"]] == [
        "cross-state-recovery-continuity", "dependency-safety-envelope",
        "evidence-lifecycle-boundary", "operational-secret-custody"]
    assert len(frozen["frozenPrerequisiteHash"]) == 64
    redis.drift_key = next(key for key in redis.values if key.endswith(":evidence-lifecycle-boundary"))
    with pytest.raises(RuntimeError, match="prerequisite changed"):
        await cas_controls(redis, "operator_fixture", update("operational-secret-custody", 1))
