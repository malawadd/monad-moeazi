from types import SimpleNamespace

import pytest

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.finance_observation_contracts import (
    ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID)
from moeazi_agent.managed_vault_release_settlement import release_proof


OWNER = "0x56b6c8ef6e04fa995f835f56c009f01623af5963"
VAULT = "0x000000000000000000000000000000000000fa02"
BLOCK = "0x" + "f" * 64


def _fixture(usdc="0", weth="0", block="120"):
    location = f"arbitrum:42161:vault:{VAULT}"
    scope = FinanceScope(environment="live", scope_id="live",
        strategy_account_id="strategy-1")
    snapshot = SimpleNamespace(scope=scope, source_account_id=location,
        source_block_number=block, source_block_hash=BLOCK,
        snapshot_hash="a" * 64, observed_balances=(
            SimpleNamespace(asset_unit_id=ARBITRUM_USDC_UNIT_ID,
                location_id=location, book="wallet", units=usdc),
            SimpleNamespace(asset_unit_id=ARBITRUM_WETH_UNIT_ID,
                location_id=location, book="wallet", units=weth)))
    context = {"mandateId": "mandate-1", "vaultAddress": VAULT,
        "ownerAddress": OWNER}
    operation = {"status": "confirmed", "ownerAddress": OWNER,
        "vaultAddress": VAULT, "transactionHash": "0x" + "d" * 64,
        "blockNumber": "110", "blockHash": BLOCK, "amountUnits": "1095927"}
    return operation, snapshot, context


def test_release_requires_finalized_owner_transfer_and_empty_vault():
    operation, snapshot, context = _fixture()
    proof, digest = release_proof(operation, snapshot, context)
    assert proof["amountUnits"] == "1095927"
    assert proof["ownerAddress"] == OWNER
    assert len(digest) == 64
    for changed in ({"ownerAddress": VAULT}, {"status": "pending"},
                    {"transactionHash": "bad"}):
        with pytest.raises(FinanceError):
            release_proof({**operation, **changed}, snapshot, context)
    for after in (_fixture(usdc="1")[1], _fixture(weth="1")[1],
                  _fixture(block="100")[1]):
        with pytest.raises(FinanceError):
            release_proof(operation, after, context)
