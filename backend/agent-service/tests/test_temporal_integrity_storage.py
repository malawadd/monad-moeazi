from pathlib import Path


def test_temporal_migration_declares_immutable_nonce_and_decision_history():
    sql = (Path(__file__).parents[1] / "migrations" / "016_temporal_integrity.sql").read_text()
    lowered = sql.lower()
    for table in ("temporal_clock_specs", "temporal_observations", "temporal_validity_intervals",
                  "temporal_causal_links", "temporal_nonce_leases", "temporal_nonce_transitions",
                  "temporal_safety_decisions"):
        assert table in lowered
    assert "unique(domain_id,nonce)" in lowered
    assert "unique(domain_id,idempotency_key)" in lowered
    assert "temporal integrity history is immutable" in lowered


def test_phase_zero_bundle_migration_binds_frozen_inputs_and_runs():
    sql = (Path(__file__).parents[1] / "migrations" / "019_phase0_frozen_input_bundles.sql").read_text().lower()
    for table in ("execution_artifact_input_manifests", "temporal_input_manifests",
                  "execution_artifact_test_center_bundles", "temporal_test_center_bundles"):
        assert table in sql
    assert "phase zero frozen input history is immutable" in sql
