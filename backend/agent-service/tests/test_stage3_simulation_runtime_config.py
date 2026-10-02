"""Configuration/identity barriers for the isolated non-live worker."""
import pytest
from pydantic import ValidationError

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.simulation_runtime_config import (
    SIMULATION_QUEUE, SimulationWorkerConfig, simulation_workflow_id,
)


def config(**changes):
    return SimulationWorkerConfig(
        **{"postgres_dsn": "postgresql+asyncpg://local:password@localhost/test",
           "convex_identity_url": "https://example.convex.site/simulation-worker",
           "identity_secret": "test-only-secret-with-32-characters", **changes})


def test_worker_defaults_disabled_and_uses_distinct_queue():
    value = config()
    assert value.enabled is False
    assert SIMULATION_QUEUE == "moeazi-trading-simulation-v1"
    assert "test-only-secret" not in repr(value)
    assert "password@" not in repr(value)
    assert not hasattr(value, "openai_api_key")
    assert not hasattr(value, "execution_gateway_url")
    with pytest.raises(ValidationError):
        config(live_execution_enabled=True)


@pytest.mark.parametrize("endpoint", [
    "http://remote.example/simulation-worker", "https://example.convex.site/worker",
    "https://user:secret@example.convex.site/simulation-worker",
    "https://example.convex.site/simulation-worker?token=secret",
])
def test_worker_endpoint_does_not_redirect_credentials(endpoint):
    with pytest.raises(ValidationError):
        config(convex_identity_url=endpoint)


def test_explicit_database_and_authentication_are_required():
    with pytest.raises(ValidationError):
        config(identity_secret="")
    with pytest.raises(ValidationError):
        config(identity_secret="short-test-secret")
    with pytest.raises(ValidationError):
        config(postgres_dsn="sqlite:///simulation.sqlite")
    with pytest.raises(ValidationError) as error:
        config(postgres_dsn="sensitive-malformed-database-secret")
    assert "sensitive-malformed-database-secret" not in str(error.value)


def test_existing_provider_environment_is_not_loaded_as_worker_configuration(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "provider-must-not-be-copied")
    monkeypatch.setenv("LIVE_EXECUTION_ENABLED", "true")
    value = config()
    assert value.enabled is False
    assert "provider-must-not-be-copied" not in value.model_dump_json()


def test_workflow_identity_is_stable_and_separates_scopes_and_runs():
    scope = FinanceScope(environment="experiment", scope_id="spec-a", strategy_account_id="account-a")
    first = simulation_workflow_id(scope, "run-1")
    assert simulation_workflow_id(scope, "run-1") == first
    assert simulation_workflow_id(scope, "run-2") != first
    assert simulation_workflow_id(scope.model_copy(update={"scope_id": "spec-b"}), "run-1") != first
    assert simulation_workflow_id(scope.model_copy(update={"strategy_account_id": "account-b"}), "run-1") != first
    with pytest.raises(FinanceError):
        simulation_workflow_id(FinanceScope(environment="live", scope_id="live",
                                           strategy_account_id="account-a"), "run-1")
