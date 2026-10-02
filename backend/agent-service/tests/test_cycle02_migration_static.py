"""Static, no-database checks for additive Cycle 2 migration 052."""
from pathlib import Path


def test_migration_052_is_rerunnable_and_scope_qualified():
    migration = Path(__file__).parents[1] / "migrations" / "052_phase0_atomic_scope_integrity.sql"
    body = migration.read_text(encoding="utf-8")
    assert body.count("CREATE UNIQUE INDEX IF NOT EXISTS") >= 1
    assert body.count("CREATE INDEX IF NOT EXISTS") >= 3
    assert "phase0_payload_scope_matches" in body
    for table in ("risk_source_observations", "risk_input_manifests", "risk_snapshots",
                  "risk_reservations", "risk_execution_attempts", "risk_reconciliation_receipts"):
        assert table in body
    assert "DROP TRIGGER IF EXISTS" in body and "BEFORE INSERT" in body
