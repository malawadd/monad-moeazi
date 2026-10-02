from pathlib import Path

from moeazi_agent.operational_secret_storage import MemoryOperationalSecretRepository


def test_migration_has_metadata_only_schema_and_idempotency_constraints():
    sql = (Path(__file__).parents[1] / "migrations" / "014_operational_secret_custody.sql").read_text()
    lowered = sql.lower()
    for forbidden in (" plaintext ", " ciphertext ", " wrapped_key ", " nonce ",
                      " aad_body ", " fingerprint ", " bearer "):
        assert forbidden not in lowered
    assert "unique (tenant_scope, idempotency_key)" in lowered
    assert "unique (decision_hash, sequence)" in lowered
    assert "product_outcome = 'unavailable'" in lowered


def test_memory_repository_starts_empty():
    repository = MemoryOperationalSecretRepository()
    assert repository.decisions == {} and repository.receipts == []
