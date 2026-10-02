from moeazi_agent.config import Settings
from moeazi_agent.managed_vault_runtime_readiness import (
    managed_vault_buy_enabled, managed_vault_runtime_readiness,
)
from moeazi_agent.runtime_controls import RuntimeControls


def controls(manual_guard: bool) -> RuntimeControls:
    return RuntimeControls(manual_guard=manual_guard, lite_mode=True, version=1,
                           updated_at="2026-10-02T00:00:00Z", updated_by="test")


def test_managed_vault_runtime_denies_development_defaults():
    result = managed_vault_runtime_readiness(Settings(_env_file=None), controls(True))
    assert result["ready"] is False
    assert any("Manual Guard" in item for item in result["blockers"])
    assert any("Live execution" in item for item in result["blockers"])


def test_managed_vault_runtime_requires_all_live_backend_gates():
    settings = Settings(_env_file=None, live_execution_enabled=True,
                        mainnet_venue_setup_enabled=True,
                        managed_vault_execution_enabled=True,
                        dependency_safety_mode="enforce", certified_venues="uniswap",
                        managed_vault_execution_secret="x" * 32)
    assert managed_vault_runtime_readiness(settings, controls(True))["ready"] is False
    assert managed_vault_runtime_readiness(settings, controls(False)) == {
        "ready": True, "blockers": []}


def test_internal_qualification_only_opens_the_exact_funded_vault():
    vault = "0x" + "a" * 40
    settings = Settings(_env_file=None, live_execution_enabled=False,
        mainnet_venue_setup_enabled=True, managed_vault_execution_enabled=True,
        dependency_safety_mode="enforce", certified_venues="",
        managed_vault_internal_test_address=vault,
        managed_vault_auto_policy_max_usdc_units=500000,
        managed_vault_execution_secret="x" * 32)
    assert managed_vault_buy_enabled(settings, vault)
    assert not managed_vault_buy_enabled(settings, "0x" + "b" * 40)
    assert managed_vault_runtime_readiness(settings, controls(False), vault)["ready"]
    assert not managed_vault_runtime_readiness(settings, controls(False),
        "0x" + "b" * 40)["ready"]
    assert not managed_vault_runtime_readiness(settings, controls(True), vault)["ready"]
