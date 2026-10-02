"""The Magic owner's wallet balance cannot become managed vault capacity."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from moeazi_agent.arbitrum_managed_vault_observation import build_managed_vault_snapshot
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_MANAGED_VAULT_RIGHTS,
    ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
    require_current_live_native_snapshot, snapshot_coverage_is_complete,
)


OWNER = "0x1234567890abcdef1234567890abcdef12345678"
VAULT = "0xabcdef1234567890abcdef1234567890abcdef12"
EXECUTOR = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
SCOPE = FinanceScope(environment="live", scope_id="live", strategy_account_id="dev-account")
PROGRAM_HASH = "0x" + "11" * 32
POLICY_HASH = "0x" + "22" * 32
CODE_HASH = "0x" + "33" * 32
EXPIRES = int((NOW + timedelta(days=7)).timestamp()) * 1000


def read(**changes):
    return {
        "schemaVersion": "managed-spot-vault-read-v1", "chainId": 42161,
        "vaultAddress": VAULT, "ownerAddress": OWNER, "executorAddress": EXECUTOR,
        "programHash": PROGRAM_HASH, "policyHash": POLICY_HASH,
        "capitalUnits": "1000000", "maxBuyUnits": "500000",
        "expiresAt": EXPIRES, "funded": True, "stopped": False,
        "vaultUsdcUnits": "700000", "vaultWethUnits": "100000000000000",
        "ownerUsdcUnits": "999000000", "ownerEthWei": "250000000000000",
        "finalizedBlockNumber": "123456789",
        "finalizedBlockHash": "0x" + "ab" * 32,
        "finalizedBlockTimestamp": str(int((NOW - timedelta(seconds=12)).timestamp())),
        "codeHash": CODE_HASH,
    } | changes


def snapshot(payload=None):
    return build_managed_vault_snapshot(payload or read(), scope=SCOPE,
        expected_vault=VAULT, expected_owner=OWNER, expected_executor=EXECUTOR,
        expected_program_hash=PROGRAM_HASH, expected_policy_hash=POLICY_HASH,
        expected_code_hash=CODE_HASH, capital_units="1000000",
        max_buy_units="500000", mandate_expires_at=EXPIRES,
        policy_version="managed-vault-v1", received_at=NOW)


def test_only_vault_balances_enter_live_finance():
    observed = snapshot()
    assert observed.source_account_id == f"arbitrum:42161:vault:{VAULT}"
    assert observed.rights_ref == ARBITRUM_MANAGED_VAULT_RIGHTS
    assert observed.coverage_scope == ARBITRUM_MANAGED_PAIR_COVERAGE
    assert observed.positions_complete is False and snapshot_coverage_is_complete(observed)
    amounts = {row.asset_unit_id: row.units for row in observed.observed_balances}
    assert amounts == {ARBITRUM_USDC_UNIT_ID: "700000",
                       ARBITRUM_WETH_UNIT_ID: "100000000000000"}
    assert "999000000" not in amounts.values()
    assert "250000000000000" not in amounts.values()
    assert require_current_live_native_snapshot(observed, scope=SCOPE,
        source_account_id=observed.source_account_id,
        policy_version="managed-vault-v1", now=NOW,
        max_age_seconds=60) == observed


@pytest.mark.parametrize("change", [
    {"ownerAddress": VAULT}, {"executorAddress": OWNER},
    {"vaultAddress": OWNER}, {"programHash": "0x" + "44" * 32},
    {"policyHash": "0x" + "44" * 32}, {"codeHash": "0x" + "44" * 32},
    {"capitalUnits": "2000000"}, {"maxBuyUnits": "800000"},
    {"funded": False}, {"chainId": 10},
    {"finalizedBlockHash": "bad"}, {"ownerEthWei": "-1"},
    {"extra": "untrusted"},
])
def test_identity_and_evidence_drift_fail_closed(change):
    with pytest.raises((ValidationError, ValueError)):
        snapshot(read(**change))


def test_vault_snapshot_cannot_be_recast_as_owner_wallet():
    observed = snapshot()
    body = observed.model_dump()
    body["source_account_id"] = f"arbitrum:42161:wallet:{OWNER}"
    with pytest.raises(ValidationError):
        type(observed).model_validate(body)
