from pathlib import Path


def test_migration_declares_immutable_fixture_history_and_atomic_bundle():
    sql = (Path(__file__).parents[1] / "migrations" / "020_capability_delegation_lifecycle.sql").read_text().lower()
    for table in ("capability_grant_specs", "capability_state_observations", "capability_input_manifests",
                  "capability_lifecycle_transitions", "capability_decisions", "capability_test_center_bundles"):
        assert table in sql
    assert "capability_delegation_reject_mutation" in sql
    assert "references agent_test_center_runs" in sql
