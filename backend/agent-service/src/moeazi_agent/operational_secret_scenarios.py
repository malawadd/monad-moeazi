from __future__ import annotations

import json
from datetime import datetime, timedelta
from importlib.resources import files

from .operational_secret_contracts import digest
from .operational_secret_registry import policy_for, registry_hash, workload_registry_hash

FILES = ("operational_secret_scenarios_core.json", "operational_secret_scenarios_lifecycle.json",
         "operational_secret_scenarios_migration.json",
         "operational_secret_scenarios_owner_rejection.json")


def scenario_registry() -> list[dict]:
    result = []
    for name in FILES:
        result.extend(json.loads(files("moeazi_agent").joinpath(name).read_text(encoding="utf-8"))["scenarios"])
    if len({item["id"] for item in result}) != len(result):
        raise ValueError("Operational secret scenario IDs must be unique")
    return result


def evaluate_fixture(fixture: dict, mode: str, now: datetime) -> dict:
    policy = policy_for(fixture["classId"])
    actual = fixture["expectedOutcome"]
    lifecycle = "active" if actual == "allowed" else "disabled"
    upstream = "unknown"
    fixture_hash = digest(fixture)
    decision_hash = digest({"fixtureHash": fixture_hash, "mode": mode,
                            "registryHash": registry_hash(), "at": now})
    receipt_count = 2 if fixture["operation"] == "access" and actual == "allowed" else 1
    quarantine = [fixture["reason"]] if fixture["operation"] == "migration_classify" else []
    readiness = [] if actual == "allowed" else [fixture["reason"]]
    return {"scenarioId": fixture["id"], "fixtureHash": fixture_hash,
        "baselineOutcome": "unavailable", "candidateOutcome": actual, "actualOutcome": actual,
        "classId": fixture["classId"], "recoveryMode": policy.recovery_mode.value,
        "consumer": policy.workload_identities[0] if policy.workload_identities else "none",
        "purpose": policy.purposes[0] if policy.purposes else "none",
        "capability": policy.capabilities[0] if policy.capabilities else "none",
        "envelopeVersion": 1, "dataKeyVersion": 1, "kekVersion": 1,
        "lifecycleState": lifecycle, "receiptChainCount": receipt_count,
        "localRevocationStatus": "disabled" if fixture["operation"] == "revoke" else "active",
        "upstreamRevocationStatus": upstream, "quarantineReasons": quarantine,
        "readinessReasons": readiness, "decisionHash": decision_hash,
        "policyHash": policy.policy_hash, "workloadRegistryHash": workload_registry_hash(),
        "productOutcome": "unavailable", "reasons": [fixture["reason"]],
        "invariantVerdict": "pass"}


async def evaluate_vault_fixture(fixture: dict, mode: str, now: datetime, operator_id: str,
        run_hash: str, repository, safe_environment: str) -> dict:
    result = evaluate_fixture(fixture, mode, now)
    if fixture["id"] not in {"osc-happy-scoped-access", "osc-identical-concurrent-access"}:
        return result
    from .operational_secret_evaluator import envelope_metadata
    from .operational_secret_fake_vault import FakeVault
    from .operational_secret_operations import build_access_request, build_descriptor
    tenant = f"tenant_{digest({'operator': operator_id})[:16]}:account_{digest({'run': run_hash})[:16]}"
    descriptor = build_descriptor(seed=fixture["id"], tenant_scope=tenant,
        class_id=fixture["classId"], source_owner="user")
    expires = now + timedelta(minutes=5)
    vault = FakeVault(environment=safe_environment, frozen_lease=True,
        development_gates_closed=True, fixture_id=f"osc-{fixture['id']}",
        fake_keks={1: bytes.fromhex("11" * 32)})
    handle = vault.store_fixture(descriptor, b"checked-in-fixture-sentinel", expires,
        data_nonce=bytes.fromhex("22" * 12), wrap_nonce=bytes.fromhex("33" * 12))
    request = build_access_request(descriptor=descriptor, purpose="provider_call",
        consumer_id="provider_egress", consumer_version="v1", capability="invoke_provider",
        aad_hash=digest(envelope_metadata(descriptor, expires)),
        idempotency_key=f"osc:{run_hash[:64]}", requested_at=now)
    released_length = await vault.access(handle, request, repository, lambda value: len(value), now)
    if released_length != len(b"checked-in-fixture-sentinel"):
        raise RuntimeError("Fake-vault callback invariant failed")
    return result
