"""Focused tests for the durable V3 quote contract and live scoped binder."""
from datetime import datetime, timezone
import hashlib
import json

import pytest

from moeazi_agent.arbitrum_managed_pair_observation import build_arbitrum_managed_pair_snapshot
from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.finance_market_evidence import resolve_sizing_request
from moeazi_agent.finance_observation_contracts import (
    ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
)
from moeazi_agent.finance_policy import SizingPolicy, SizingRequest
from moeazi_agent.finance_uniswap_quote import (
    USDC, WETH, UniswapV3Quote, quote_evidence_hash, validate_sidecar_quote,
)
from moeazi_agent.observation_contracts import InstrumentVersion


OWNER = "0x1111111111111111111111111111111111111111"
BLOCK_HASH = "0x" + "ab" * 32
POOL = "0x2222222222222222222222222222222222222222"


def payload(*, token_in=USDC, token_out=WETH, amount_in="50000000",
            amount_out="25000000000000000", block_number="123456",
            router="0xE592427A0AEce92De3Edee1F18E0157C05861564",
            quoter="0x61fFE014bA17989E743c5F6cB21bF9697530B21e"):
    minimum = str(int(amount_out) * 9900 // 10000)
    return {
        "schemaVersion": "arbitrum-v3-quote-v1", "chainId": 42161,
        "venue": "uniswap", "router": router, "quoter": quoter, "pool": POOL,
        "tokenIn": token_in, "tokenOut": token_out, "feeTier": 3000,
        "amountIn": amount_in, "amountOut": amount_out,
        "minimumAmountOut": minimum, "slippageBps": 100,
        "sourceBlock": {"number": block_number, "hash": BLOCK_HASH,
            "timestamp": "1790900000", "finality": "finalized"},
        "sqrtPriceX96After": "79228162514264337593543950336",
        "initializedTicksCrossed": "1", "gasEstimate": "135000",
    }


def policy(instrument):
    body = dict(policy_version="uniswap-live-v1",
        instrument_version_id=instrument.instrument_version_id,
        max_quantity_units="1000000000000000000", min_quantity_units="1",
        quantity_step_units="1", max_gross_notional_units="1000000000000",
        max_directional_notional_units="1000000000000", initial_margin_bps=0,
        fee_ceiling_units="0", exit_buffer_units="0",
        max_observation_age_seconds=3600, max_reservation_seconds=60,
        approved_live=True)
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False).encode()
    digest = hashlib.sha256(b"moeazi-finance-policy-v1\n" + encoded).hexdigest()
    return SizingPolicy(**body, policy_hash=digest)


def instrument():
    return InstrumentVersion(instrument_version_id="uniswap:arbitrum:usdc-weth-3000:v1",
        venue_id="uniswap", native_instrument_id=POOL, product_kind="spot",
        base_asset_unit_id=ARBITRUM_WETH_UNIT_ID,
        quote_asset_unit_id=ARBITRUM_USDC_UNIT_ID,
        settlement_asset_unit_id=ARBITRUM_USDC_UNIT_ID,
        base_decimals=18, quote_decimals=6, settlement_decimals=6,
        size_decimals=18, contract_multiplier="1",
        price_rule="uniswap_v3_quoter_v2_exact_input_v1",
        lot_step="0.000000000000000001", margin_model="not_applicable",
        funding_model="not_applicable", effective_at=datetime.fromtimestamp(
            1790899900, tz=timezone.utc), registry_hash="b" * 64)


class _Rows:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows


class _Result:
    def __init__(self, rows=(), scalar=None):
        self.rows, self.scalar = rows, scalar

    def mappings(self):
        return _Rows(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None

    def scalar_one(self):
        return self.scalar


class _Connection:
    def __init__(self, now, inst, snapshot, quote, balances):
        self.now, self.inst, self.snapshot = now, inst, snapshot
        self.quote, self.balances = quote, balances

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "SELECT clock_timestamp()" in sql:
            return _Result(scalar=self.now)
        if "FROM observation_instrument_versions" in sql:
            return _Result([{"manifest": self.inst.model_dump(mode="json"),
                             "registry_hash": self.inst.registry_hash}])
        if "FROM observation_account_snapshots" in sql:
            body = self.snapshot.model_dump(mode="python")
            body.update(environment="live", scope_id="live",
                        strategy_account_id=self.snapshot.scope.strategy_account_id)
            body.pop("scope")
            return _Result([body])
        if "FROM observation_uniswap_v3_quotes" in sql:
            return _Result([{"payload": self.quote.model_dump(mode="json", by_alias=True)}])
        if "FROM finance_balances" in sql:
            return _Result(self.balances)
        if "FROM finance_positions" in sql or "FROM finance_reservations" in sql:
            return _Result([])
        raise AssertionError(f"Unexpected query: {sql}")


def pair_snapshot(inst, now):
    block_timestamp = "1790900000"
    raw = {"chainId": 42161, "account": OWNER, "blockNumber": "123456",
        "blockHash": BLOCK_HASH, "blockTimestamp": block_timestamp,
        "accountMode": "other", "balances": {"USDC": "100000000", "WETH": "0"},
        "trackedPairComplete": True, "balancesComplete": False,
        "positionsComplete": False, "source": "arbitrum_finalized_rpc"}
    return build_arbitrum_managed_pair_snapshot(raw,
        scope=FinanceScope(environment="live", scope_id="live", strategy_account_id="internal"),
        expected_account=OWNER, policy_version="uniswap-live-v1", received_at=now)


def test_quote_contract_hash_and_raw_unit_ratio_are_exact_and_directional():
    quote = validate_sidecar_quote(payload(),
        received_at=datetime.fromtimestamp(1790900020, tz=timezone.utc))
    assert quote.quote_per_raw_base_unit == (50_000_000, 24_750_000_000_000_000)
    assert quote.evidence_scope == "single_finalized_block_exact_input_quote"
    same = validate_sidecar_quote(payload(router="0xe592427a0aece92de3edee1f18e0157c05861564",
        quoter="0x61ffe014ba17989e743c5f6cb21bf9697530b21e"),
        received_at=datetime.fromtimestamp(1790900020, tz=timezone.utc))
    assert quote_evidence_hash(quote) == quote_evidence_hash(same)
    sell = UniswapV3Quote.model_validate(payload(token_in=WETH, token_out=USDC,
        amount_in="25000000000000000", amount_out="50000000"))
    assert sell.quote_per_raw_base_unit == (49_500_000, 25_000_000_000_000_000)


@pytest.mark.parametrize("change", [
    {"chainId": 1}, {"feeTier": 500}, {"quoter": "0x" + "11" * 20},
    {"tokenIn": "0x" + "33" * 20},
    {"sourceBlock": {"number": "1", "hash": BLOCK_HASH,
                      "timestamp": "1790900000", "finality": "confirmed"}},
    {"minimumAmountOut": "1"},
])
def test_quote_contract_rejects_unapproved_route_or_weak_finality(change):
    body = payload() | change
    with pytest.raises(ValueError):
        UniswapV3Quote.model_validate(body)


@pytest.mark.asyncio
async def test_live_binder_uses_stored_quote_and_exact_scoped_pair_snapshot():
    now = datetime.fromtimestamp(1790900020, tz=timezone.utc)
    inst = instrument()
    sizing_policy = policy(inst)
    snapshot = pair_snapshot(inst, now)
    quote = validate_sidecar_quote(payload(), received_at=now)
    conn = _Connection(now, inst, snapshot, quote, [
        {"asset_unit_id": ARBITRUM_USDC_UNIT_ID, "registry_hash": snapshot.registry_hash,
         "location_id": snapshot.source_account_id, "book": "wallet", "units": "100000000"},
        {"asset_unit_id": ARBITRUM_WETH_UNIT_ID, "registry_hash": snapshot.registry_hash,
         "location_id": snapshot.source_account_id, "book": "wallet", "units": "0"},
    ])
    request = SizingRequest(action="spot_buy", instrument_version_id=inst.instrument_version_id,
        desired_quantity_units=quote.minimum_amount_out, quantity_asset_unit_id="caller-base",
        quantity_registry_hash="c" * 64, quote_asset_unit_id="caller-quote",
        quote_registry_hash="d" * 64, location_id=snapshot.source_account_id,
        quote_per_quantity_numerator="1", quote_per_quantity_denominator="1",
        price_snapshot_hash=quote_evidence_hash(quote),
        account_snapshot_hash=snapshot.snapshot_hash,
        existing_gross_notional_units="999999", existing_directional_notional_units="999999")
    actual = await resolve_sizing_request(conn, snapshot.scope, {
        "reconciliation_state": "clean", "observation_snapshot_hash": snapshot.snapshot_hash,
        "policy_version": sizing_policy.policy_version, "policy_hash": sizing_policy.policy_hash,
        "source_account_id": snapshot.source_account_id}, sizing_policy, request)
    assert actual.price_snapshot_hash == quote_evidence_hash(quote)
    assert actual.quote_per_quantity_numerator == "1"
    assert actual.quote_per_quantity_denominator == "495000000"
    assert actual.quantity_asset_unit_id == ARBITRUM_WETH_UNIT_ID
    assert actual.quote_asset_unit_id == ARBITRUM_USDC_UNIT_ID
    assert actual.existing_gross_notional_units == "0"
    assert actual.account_snapshot_hash == snapshot.snapshot_hash


@pytest.mark.asyncio
async def test_live_binder_rejects_quote_for_wrong_action_direction():
    now = datetime.fromtimestamp(1790900020, tz=timezone.utc)
    inst = instrument()
    sizing_policy = policy(inst)
    snapshot = pair_snapshot(inst, now)
    sell_quote = UniswapV3Quote.model_validate(payload(token_in=WETH, token_out=USDC,
        amount_in="25000000000000000", amount_out="50000000"))
    conn = _Connection(now, inst, snapshot, sell_quote, [])
    request = SizingRequest(action="spot_buy", instrument_version_id=inst.instrument_version_id,
        desired_quantity_units=sell_quote.amount_in, quantity_asset_unit_id=ARBITRUM_WETH_UNIT_ID,
        quantity_registry_hash="c" * 64, quote_asset_unit_id=ARBITRUM_USDC_UNIT_ID,
        quote_registry_hash="d" * 64, location_id=snapshot.source_account_id,
        quote_per_quantity_numerator="1", quote_per_quantity_denominator="1",
        price_snapshot_hash=quote_evidence_hash(sell_quote),
        account_snapshot_hash=snapshot.snapshot_hash,
        existing_gross_notional_units="0", existing_directional_notional_units="0")
    with pytest.raises(FinanceError, match="buy quote must be USDC-to-WETH"):
        await resolve_sizing_request(conn, snapshot.scope, {
            "reconciliation_state": "clean", "observation_snapshot_hash": snapshot.snapshot_hash,
            "policy_version": sizing_policy.policy_version, "policy_hash": sizing_policy.policy_hash,
            "source_account_id": snapshot.source_account_id}, sizing_policy, request)
