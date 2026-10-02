"""Runtime gates for the Magic-owned vault lane; owner authority is checked elsewhere."""

from .config import Settings
from .runtime_controls import RuntimeControls


def managed_vault_buy_enabled(settings: Settings, vault_address: str) -> bool:
    if not settings.mainnet_venue_setup_enabled or not settings.managed_vault_execution_enabled:
        return False
    if settings.live_execution_enabled and "uniswap" in settings.certified_venue_set:
        return True
    return (settings.dependency_safety_mode == "enforce"
        and bool(settings.managed_vault_internal_test_address)
        and vault_address == settings.managed_vault_internal_test_address
        and settings.managed_vault_auto_policy_max_usdc_units > 0)


def managed_vault_runtime_readiness(settings: Settings, controls: RuntimeControls,
        vault_address: str = "") -> dict:
    blockers = []
    internal = bool(settings.managed_vault_internal_test_address) \
        and vault_address == settings.managed_vault_internal_test_address \
        and settings.dependency_safety_mode == "enforce" \
        and settings.managed_vault_auto_policy_max_usdc_units > 0
    if not settings.live_execution_enabled and not internal:
        blockers.append("Live execution is disabled in the trading backend.")
    if not settings.mainnet_venue_setup_enabled:
        blockers.append("Mainnet venue setup is disabled in the trading backend.")
    if not settings.managed_vault_execution_enabled:
        blockers.append("Magic vault execution is disabled in the trading backend.")
    if "uniswap" not in settings.certified_venue_set and not internal:
        blockers.append("Uniswap is not enabled for live execution in the trading backend.")
    if controls.manual_guard:
        blockers.append("Manual Guard is pausing automatic analysis and orders.")
    if len(settings.managed_vault_execution_secret.get_secret_value()) < 32:
        blockers.append("The trading backend cannot authenticate the Magic vault execution channel.")
    return {"ready": not blockers, "blockers": blockers}
