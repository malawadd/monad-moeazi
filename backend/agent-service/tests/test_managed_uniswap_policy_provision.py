"""One internal policy setup must bind a frozen owner and native venue cap."""
from datetime import datetime, timezone
import hashlib
import json
import time

import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_native_activation_contracts import ActivationContext
from moeazi_agent.finance_observation_contracts import (
    ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
)
from moeazi_agent.managed_uniswap_policy_provision import (
    PREFLIGHT_GRANT_ID, ProvisionRequest, validate_provision,
)


OWNER = "0x" + "a" * 40
ACCOUNT = "account-a"
ASSIGNMENT = "assignment-a"
VERSION = "version-a"
FROZEN_HASH = "b" * 64


def policy(max_usdc: str = "2000000") -> dict:
    body = {"policy_version": "internal-uniswap-v1", "instrument_version_id": "pair-v1",
        "max_quantity_units": "1000000000000000000", "min_quantity_units": "1",
        "quantity_step_units": "1", "max_gross_notional_units": max_usdc,
        "max_directional_notional_units": max_usdc, "initial_margin_bps": 0,
        "fee_ceiling_units": "10000", "exit_buffer_units": "0",
        "max_observation_age_seconds": 60, "max_reservation_seconds": 60,
        "approved_live": True}
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    body["policy_hash"] = hashlib.sha256(
        ("moeazi-finance-policy-v1\n" + raw).encode()).hexdigest()
    return body


def request(max_usdc: str = "2000000") -> ProvisionRequest:
    return ProvisionRequest.model_validate({"assignmentId": ASSIGNMENT,
        "subject": "magic:user-a", "expectedStrategyAccountId": ACCOUNT,
        "expectedProgramVersionId": VERSION, "expectedOwnerAddress": OWNER,
        "maximumCapitalUsdcUnits": "2000000",
        "maximumSingleOrderUsdcUnits": "2000000",
        "maximumDailyLossUsdcUnits": "2000000",
        "authorityExpiresAt": EXPIRY,
        "instrument": {"instrument_version_id": "pair-v1", "venue_id": "uniswap",
            "native_instrument_id": "0x" + "c" * 40, "product_kind": "spot",
            "base_asset_unit_id": ARBITRUM_WETH_UNIT_ID,
            "quote_asset_unit_id": ARBITRUM_USDC_UNIT_ID,
            "settlement_asset_unit_id": ARBITRUM_USDC_UNIT_ID,
            "base_decimals": 18, "quote_decimals": 6, "settlement_decimals": 6,
            "size_decimals": 18, "contract_multiplier": "1",
            "price_rule": "uniswap_v3_quoter_v2_exact_input_v1",
            "lot_step": "0.000000000000000001", "margin_model": "not_applicable",
            "funding_model": "not_applicable",
            "effective_at": datetime.now(timezone.utc).isoformat(),
            "registry_hash": "d" * 64}, "financePolicy": policy(max_usdc)})


EXPIRY = int(time.time() * 1000) + 60_000


def context(*, subject: str = "magic:user-a", max_usdc: str = "2000000",
            grant_id: str = PREFLIGHT_GRANT_ID) -> ActivationContext:
    limits = {"schemaVersion": 1, "strategyAccountId": ACCOUNT,
        "assignmentId": ASSIGNMENT, "programVersionId": VERSION,
        "contentHash": "a" * 64, "policyHash": FROZEN_HASH,
        "venueAccountId": "venue-a", "ownerAddress": OWNER,
        "maxUsdcUnits": max_usdc, "maxWethUnits": "1000000000000000000",
        "minWethOutUnits": "1", "minUsdcOutUnits": "1"}
    return ActivationContext.model_validate({"strategyAccountId": ACCOUNT,
        "customerSubject": subject, "assignmentId": ASSIGNMENT,
        "programVersionId": VERSION, "contentHash": limits["contentHash"],
        "ownerAddress": OWNER, "venue": "uniswap", "venueAccountId": "venue-a",
        "sourceAccountId": "arbitrum:42161:wallet:" + OWNER,
        "policyHash": FROZEN_HASH, "policyJson": "{}", "limitsJson": limits,
        "authorityExpiresAt": EXPIRY,
        "executionGrantId": grant_id, "financialAuthority": "identity_only"})


def test_operator_preflight_accepts_exact_owned_capped_pair():
    assert validate_provision(request(), context())["maxUsdcUnits"] == "2000000"


def test_one_shot_order_cannot_exceed_declared_daily_loss_envelope():
    item = request().model_copy(update={"maximum_daily_loss_usdc_units": "1000000"})
    with pytest.raises(FinanceError):
        validate_provision(item, context())


@pytest.mark.parametrize("changed", [
    {"subject": "magic:other"}, {"grant_id": "other-grant"},
    {"max_usdc": "1000000"},
])
def test_operator_preflight_rejects_changed_owner_authority_or_cap(changed):
    with pytest.raises(FinanceError):
        validate_provision(request(), context(**changed))
