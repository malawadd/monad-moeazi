"""The phone's funded-vault continuation uses only an operator-capped policy."""
import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_native_vault_contracts import VaultFinanceContext
from moeazi_agent.managed_vault_policy_auto import compile_managed_vault_policy


def context(**changes) -> VaultFinanceContext:
    owner = "0x" + "a" * 40
    vault = "0x" + "b" * 40
    payload = {
        "financialAuthority": "identity_only", "customerSubject": "magic:owner",
        "strategyAccountId": "account-a", "assignmentId": "assignment-a",
        "programVersionId": "version-a", "venueAccountId": "venue-a",
        "mandateId": "mandate-a", "mandateHash": "1" * 64,
        "ownerAddress": owner, "vaultAddress": vault,
        "executorAddress": "0x" + "c" * 40, "vaultCodeHash": "0x" + "2" * 64,
        "programHash": "3" * 64, "policyHash": "4" * 64,
        "capitalUnits": "500000", "maxBuyUnits": "500000",
        "expiresAt": 2000000000000,
        "sourceAccountId": "arbitrum:42161:vault:" + vault,
        "venue": "uniswap",
        "policyJson": {"allowedVenues": ["uniswap"],
            "allowedMarkets": ["WETH-USDC"], "requireStopLoss": False,
            "requireTakeProfit": False, "maxLeverage": 1,
            "maxConcurrentPositions": 1, "maxSlippageBps": 75,
            "maxOrderUsd": 1, "maxDailyVolumeUsd": 5,
            "maxExposureUsd": 1, "maxDailyLossUsd": 1},
    }
    payload.update(changes)
    return VaultFinanceContext.model_validate(payload)


def test_funded_half_dollar_compiles_exact_reviewed_spot_policy():
    reviewed = context(mandateId="xs761vb1x2d0dr0zkfv202brrn8fhc3t")
    instrument, policy = compile_managed_vault_policy(reviewed,
        maximum_auto_capital_units=500000)
    assert instrument.native_instrument_id == "0xc473e2aee3441bf9240be85eb122abb059a3b57c"
    assert policy.max_gross_notional_units == "500000"
    assert policy.max_directional_notional_units == "500000"
    assert policy.fee_ceiling_units == "0"
    assert policy.policy_hash == "2b164c8d8fe730ab7175e12bb431a65fa7721b19e83be9dc84d93f3cc72bf059"


def test_operator_cap_and_frozen_policy_only_reduce_authority():
    with pytest.raises(FinanceError, match="automatic finance cap"):
        compile_managed_vault_policy(context(), maximum_auto_capital_units=0)
    with pytest.raises(FinanceError, match="automatic finance cap"):
        compile_managed_vault_policy(context(), maximum_auto_capital_units=499999)
    reduced = context(policyJson={**context().policy_json, "maxOrderUsd": 0.25})
    _, policy = compile_managed_vault_policy(reduced,
        maximum_auto_capital_units=500000)
    assert policy.max_gross_notional_units == "250000"


@pytest.mark.parametrize("changed", [
    {"allowedVenues": ["hyperliquid"]},
    {"requireStopLoss": True},
    {"maxLeverage": 50},
    {"maxConcurrentPositions": 2},
    {"maxSlippageBps": 100},
])
def test_other_frozen_programs_cannot_inherit_the_internal_live_policy(changed):
    policy_json = {**context().policy_json, **changed}
    with pytest.raises(FinanceError, match="bounded internal spot route"):
        compile_managed_vault_policy(context(policyJson=policy_json),
            maximum_auto_capital_units=500000)
