from pathlib import Path


def test_migration_declares_immutable_scoped_bundles():
    sql = (Path(__file__).parents[1] / "migrations" / "021_authoritative_risk_reconciliation.sql").read_text().lower()
    for table in ("risk_source_observations", "risk_input_manifests", "risk_snapshots", "risk_reservations", "risk_execution_attempts", "risk_reconciliation_receipts", "risk_test_center_bundles"):
        assert table in sql
    assert "risk_reconciliation_reject_mutation" in sql and "references agent_test_center_runs" in sql
