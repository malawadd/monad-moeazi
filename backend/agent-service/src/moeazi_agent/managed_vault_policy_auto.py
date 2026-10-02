"""Compile the bounded internal Magic-vault finance policy from a frozen mandate."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import json

from .finance_contracts import FinanceError, native_int
from .finance_native_activation_contracts import exact_pair_policy
from .finance_native_vault_contracts import VaultFinanceContext
from .finance_observation_contracts import ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID
from .finance_policy import SizingPolicy, _digest
from .observation_contracts import InstrumentVersion


# The reviewed Arbitrum USDC/WETH 0.3% pool is the only automatic prototype route.
_INSTRUMENT = {
    "instrument_version_id": "uniswap:42161:usdc-weth:3000:managed-vault-v1",
    "venue_id": "uniswap",
    "native_instrument_id": "0xc473e2aee3441bf9240be85eb122abb059a3b57c",
    "product_kind": "spot",
    "base_asset_unit_id": ARBITRUM_WETH_UNIT_ID,
    "quote_asset_unit_id": ARBITRUM_USDC_UNIT_ID,
    "settlement_asset_unit_id": ARBITRUM_USDC_UNIT_ID,
    "base_decimals": 18,
    "quote_decimals": 6,
    "settlement_decimals": 6,
    "size_decimals": 18,
    "contract_multiplier": "1",
    "price_rule": "uniswap_v3_quoter_v2_exact_input_v1",
    "lot_step": "0.000000000000000001",
    "margin_model": "not_applicable",
    "funding_model": "not_applicable",
    "effective_at": "2026-10-02T22:05:50.742Z",
    "registry_hash": "de1f23ee7d2e73f43cc41ec6ad6d19fdaad371c09f1118395525f3a77cda67a5",
}


def _usdc_units(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise FinanceError("frozen program risk amount is invalid")
    try:
        decimal = Decimal(str(value))
    except InvalidOperation as error:
        raise FinanceError("frozen program risk amount is invalid") from error
    if not decimal.is_finite() or decimal <= 0:
        raise FinanceError("frozen program risk amount is invalid")
    return int(decimal * 1_000_000)


def compile_managed_vault_policy(context: VaultFinanceContext, *,
        maximum_auto_capital_units: int) -> tuple[InstrumentVersion, SizingPolicy]:
    """The operator cap and frozen program can only reduce committed capital."""
    capital = native_int(context.capital_units, positive=True)
    buy = native_int(context.max_buy_units, positive=True)
    if maximum_auto_capital_units <= 0 or capital > maximum_auto_capital_units or buy > capital:
        raise FinanceError("Magic vault exceeds the configured automatic finance cap")
    try:
        raw = json.loads(context.policy_json) if isinstance(context.policy_json, str) else context.policy_json
    except (TypeError, ValueError) as error:
        raise FinanceError("frozen program policy is invalid") from error
    if not isinstance(raw, dict) or raw.get("allowedVenues") != ["uniswap"] \
            or not isinstance(raw.get("allowedMarkets"), list) \
            or not any(market in {"WETH-USDC", "ETH-USDC", "ETH/USDC", "WETH/USDC"}
                       for market in raw["allowedMarkets"]) \
            or raw.get("requireStopLoss") is not False \
            or raw.get("requireTakeProfit") is not False \
            or raw.get("maxLeverage") != 1 \
            or raw.get("maxConcurrentPositions") != 1 \
            or type(raw.get("maxSlippageBps")) is not int \
            or not 0 <= raw["maxSlippageBps"] <= 75:
        raise FinanceError("frozen program is not the bounded internal spot route")
    gross = min(buy, capital, *(_usdc_units(raw[key]) for key in (
        "maxOrderUsd", "maxDailyVolumeUsd", "maxExposureUsd", "maxDailyLossUsd")))
    if gross <= 0:
        raise FinanceError("frozen program has no positive finance capacity")
    instrument = InstrumentVersion.model_validate(_INSTRUMENT)
    body = {
        "policy_version": f"magic-vault-{context.mandate_id}-v1",
        "instrument_version_id": instrument.instrument_version_id,
        "max_quantity_units": "1000000000000000000",
        "min_quantity_units": "1",
        "quantity_step_units": "1",
        "max_gross_notional_units": str(gross),
        "max_directional_notional_units": str(gross),
        "initial_margin_bps": 0,
        "fee_ceiling_units": "0",
        "exit_buffer_units": "0",
        "max_observation_age_seconds": 3600,
        "max_reservation_seconds": 120,
        "approved_live": True,
    }
    policy = SizingPolicy.model_validate({**body,
        "policy_hash": _digest("moeazi-finance-policy-v1", body)})
    if not exact_pair_policy(policy, instrument.model_dump(mode="json"),
                             instrument.registry_hash):
        raise FinanceError("automatic policy is not the reviewed Arbitrum pair")
    return instrument, policy
