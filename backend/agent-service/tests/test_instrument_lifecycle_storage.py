from pathlib import Path

from datetime import datetime, timezone

from moeazi_agent.instrument_lifecycle_contracts import InstrumentOperationDecision, RegistryScope, digest
from moeazi_agent.instrument_lifecycle_storage import storage_scope


def test_instrument_lifecycle_migration_declares_immutable_scoped_history():
    sql = (Path(__file__).parents[1] / "migrations" / "017_instrument_lifecycle_registry.sql").read_text().lower()
    for table in ("instrument_assets", "instrument_native_identities", "instrument_definition_versions",
                  "instrument_aliases", "instrument_lifecycle_events", "instrument_continuity_transforms",
                  "instrument_registry_snapshots", "instrument_operation_decisions", "instrument_rebaseline_plans",
                  "instrument_rebaseline_receipts", "instrument_projection_transitions"):
        assert table in sql
    assert "unique(tenant_id,scope_key,idempotency_key)" in sql
    assert "instrument lifecycle history is immutable" in sql


def test_storage_key_keeps_full_instrument_scope():
    now = datetime(2026, 8, 11, tzinfo=timezone.utc)
    def decision(account: str, venue: str, environment: str, namespace: str):
        scope = RegistryScope(tenant_id="tenant:fixture", account_id=account, venue=venue,
            environment=environment, namespace=namespace)
        body = {"operation": "reconcile", "scope": scope, "stable_id": None, "definition_hash": None,
            "snapshot_hash": "a" * 64, "event_watermark": 0, "outcome": "unknown", "reasons": ["fixture"],
            "permitted_lanes": [], "expires_at": now, "idempotency_key": "instrument:storage", "request_hash": "b" * 64}
        return InstrumentOperationDecision(**body, decision_hash=digest(body))
    assert storage_scope(decision("account:one", "hyperliquid", "hyperliquid-mainnet", "hl_perp")) != \
        storage_scope(decision("account:two", "gmx", "arbitrum-mainnet", "gmx_v2"))


def test_cycle_scope_migration_is_additive_and_covers_fixture_decisions():
    sql = (Path(__file__).parents[1] / "migrations" / "051_cycle01_fixture_scope_integrity.sql").read_text().lower()
    for table in ("evidence_lifecycle_decisions", "operational_secret_access_decisions",
                  "execution_artifact_decisions", "temporal_safety_decisions",
                  "instrument_operation_decisions", "capability_decisions", "risk_reservations"):
        assert table in sql
    assert "not valid" in sql and "create unique index if not exists" in sql
    assert "osc_decision_payload_scope_check" not in sql
    assert "operational secret scalar authority columns are incomplete" in sql
