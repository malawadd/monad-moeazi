from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from moeazi_agent.operational_secret_contracts import SecretHandle, digest
from moeazi_agent.operational_secret_lifecycle_contracts import LegacyInventoryItem
from moeazi_agent.operational_secret_evaluator import classify_legacy
from moeazi_agent.operational_secret_operations import build_descriptor
from moeazi_agent.operational_secret_registry import (
    class_policies, registry_hash, verify_registry, workload_registry_hash,
)

TENANT = "tenant_aaaaaaaaaaaaaaaa:account_bbbbbbbbbbbbbbbb"


def test_registry_is_complete_hash_bound_and_owner_material_is_forbidden():
    verify_registry()
    policies = {item.class_id: item for item in class_policies()}
    assert len(policies) == 10
    assert policies["owner_auth_material"].recovery_mode == "forbidden"
    assert policies["owner_auth_material"].owner_material_rule == "reject"
    assert len(registry_hash()) == len(workload_registry_hash()) == 64


def test_descriptor_and_handle_are_safe_metadata_only():
    descriptor = build_descriptor(seed="contract", tenant_scope=TENANT,
        class_id="model_provider_byok", source_owner="user")
    assert descriptor.descriptor_hash == digest(descriptor.model_dump(exclude={"descriptor_hash"}))
    handle = SecretHandle(descriptor_id=descriptor.descriptor_id, envelope_version=1)
    assert set(handle.model_dump()) == {"schema_version", "descriptor_id", "envelope_version"}
    with pytest.raises(ValidationError):
        SecretHandle(descriptor_id=descriptor.descriptor_id, envelope_version=1, bearer="bad")


def test_contracts_reject_floats_and_non_utc_times():
    with pytest.raises(ValidationError):
        LegacyInventoryItem(fixture_id="bad-time", store="convex", table="safe",
            fields=[], source="shape", caller="test", role="platform", status="active",
            version=1.5)
    descriptor = build_descriptor(seed="timezone", tenant_scope=TENANT,
        class_id="internal_service_auth", source_owner="platform")
    assert descriptor.creation_revision == 1
    assert datetime.now(timezone.utc).utcoffset().total_seconds() == 0


def test_legacy_classifier_is_metadata_only_and_quarantines_wallet_owner_paths():
    item = LegacyInventoryItem(fixture_id="wallet-owner-shape", store="convex",
        table="walletSecrets", fields=["owner_key"], source="static_shape",
        caller="private.ts", role="owner", status="legacy", version=1)
    result = classify_legacy(item)
    assert result.disposition == "quarantine_owner_equivalent"
    assert result.capability_status == "disabled"
    with pytest.raises(ValueError, match="metadata shape only"):
        classify_legacy(LegacyInventoryItem(fixture_id="unsafe-shape", store="convex",
            table="safe", fields=["ciphertext"], source="static_shape",
            caller="actions.ts", role="platform", status="legacy", version=1))
