"""A finalized Magic vault sell needs an exact event and later account read."""
from types import SimpleNamespace

import pytest

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.managed_vault_exit_settlement import vault_exit_proof


def test_vault_exit_proof_binds_actual_sell_and_later_vault_snapshot():
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id="account-a")
    vault = "0x" + "a" * 40
    block_hash = "0x" + "b" * 64
    native = {"vaultAddress": vault, "orderId": "0x" + "c" * 64,
              "executionGrantId": "vault-mandate-a"}
    operation = {"status": "confirmed", "orderId": native["orderId"],
        "transactionHash": "0x" + "d" * 64, "blockHash": block_hash,
        "blockNumber": "123", "actualInputUnits": "1000",
        "actualOutputUnits": "2300"}
    reservation = {"reservation_id": "r" * 64, "attempt_id": "a" * 64,
        "intent_id": "i" * 64, "client_id": "command-a",
        "normalized_payload_hash": "p" * 64, "snapshot_hash": "s" * 64}
    quote = SimpleNamespace(amount_in="1000", minimum_amount_out="2200")
    snapshot = SimpleNamespace(scope=scope,
        source_account_id=f"arbitrum:42161:vault:{vault}",
        source_block_number="124", source_block_hash="0x" + "e" * 64,
        snapshot_hash="t" * 64)
    body, digest = vault_exit_proof(operation, reservation, quote, snapshot, native)
    assert body["actualInputUnits"] == "1000"
    assert body["actualOutputUnits"] == "2300"
    assert len(digest) == 64
    with pytest.raises(FinanceError):
        vault_exit_proof({**operation, "actualOutputUnits": "1"},
            reservation, quote, snapshot, native)
    with pytest.raises(FinanceError):
        vault_exit_proof(operation, reservation, quote,
            SimpleNamespace(**{**snapshot.__dict__, "source_account_id":
                "arbitrum:42161:wallet:" + vault}), native)
