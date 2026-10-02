from pathlib import Path


def test_migration_declares_immutable_scope_qualified_journal():
    sql = (Path(__file__).parents[1] / "migrations" / "022_asset_conservation_journal.sql").read_text().lower()
    for table in ("journal_asset_units", "journal_accounts", "journal_source_events", "journal_input_manifests", "journal_transactions", "journal_postings", "journal_conservation_checks", "journal_commit_receipts", "journal_test_center_bundles"):
        assert table in sql
    assert "pg_advisory_xact_lock" not in sql
    assert "asset_journal_reject_mutation" in sql and "references agent_test_center_runs" in sql
