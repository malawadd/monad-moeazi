"""Q3 exact native sizing examples; a receipt alone does not prove source authority."""
import hashlib
import json

import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_policy import SizingPolicy, SizingRequest, size_intent


HASH = "a" * 64


def policy(**overrides):
    body = dict(policy_version="q3-test-v1", instrument_version_id="spot:BTC/USDC:v1",
        max_quantity_units="100000000", min_quantity_units="1",
        quantity_step_units="1", max_gross_notional_units="25000000000",
        max_directional_notional_units="25000000000", initial_margin_bps=1000,
        fee_ceiling_units="1000000", exit_buffer_units="0",
        max_observation_age_seconds=30, max_reservation_seconds=60,
        approved_live=False)
    body.update(overrides)
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False).encode()
    digest = hashlib.sha256(b"moeazi-finance-policy-v1\n" + canonical).hexdigest()
    return SizingPolicy(**body, policy_hash=digest)


def request(action="spot_sell", **overrides):
    body = dict(action=action, instrument_version_id="spot:BTC/USDC:v1",
        desired_quantity_units="100000000", quantity_asset_unit_id="BTC:8",
        quantity_registry_hash=HASH, quote_asset_unit_id="USDC:6",
        quote_registry_hash=HASH, location_id="wallet",
        quote_per_quantity_numerator="25000000000",
        quote_per_quantity_denominator="100000000", price_snapshot_hash=HASH,
        account_snapshot_hash=HASH, existing_gross_notional_units="25000000000",
        existing_directional_notional_units="25000000000")
    body.update(overrides)
    return SizingRequest(**body)


def test_full_cap_spot_sale_requires_inventory_and_fee_holds():
    receipt = size_intent(policy(), request(), account_revision=7)
    assert receipt.quantity_units == "100000000"
    assert receipt.notional_units == "25000000000"
    assert {(item.asset_unit_id, item.units) for item in receipt.components} == {
        ("BTC:8", "100000000"), ("USDC:6", "1000000")}
    assert receipt.request == request()
    with pytest.raises(FinanceError, match="cap reached"):
        size_intent(policy(), request("spot_buy"), account_revision=7)
    with pytest.raises(FinanceError, match="cap reached"):
        size_intent(policy(), request("perp_open"), account_revision=7)


def test_exact_ratio_rounds_cost_up_and_never_uses_float():
    receipt = size_intent(policy(max_gross_notional_units="25000000001",
        max_directional_notional_units="25000000001"), request("spot_buy",
        desired_quantity_units="1", quote_per_quantity_numerator="3",
        quote_per_quantity_denominator="2",
        existing_gross_notional_units="0",
        existing_directional_notional_units="0"), account_revision=7)
    assert receipt.notional_units == "2"
    assert receipt.components[0].units == "1000002"
    with pytest.raises(Exception):
        request(quote_per_quantity_numerator=1.5)
