"""Bind spot sizing to stored market evidence and reconciled account inventory."""
from __future__ import annotations

from fractions import Fraction
import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, db_native_int, native_int
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_USDC_UNIT_ID,
    ARBITRUM_WETH_UNIT_ID, account_snapshot_from_row,
    require_current_live_native_snapshot, snapshot_coverage_is_complete,
)
from .finance_uniswap_quote import (
    UNISWAP_V3_PRICE_RULE, USDC, WETH, load_uniswap_quote, quote_evidence_hash,
)
from .finance_policy import SizingPolicy, SizingRequest, SizingReceipt
from .observation_contracts import EvidenceSnapshot, InstrumentVersion, MarketObservation, canonical_hash


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


async def resolve_sizing_request(conn, scope: FinanceScope, account: dict,
                                 policy: SizingPolicy, requested: SizingRequest) -> SizingRequest:
    """Resolve one spot instrument; this is evidence binding, not spend authorization."""
    if requested.action not in {"spot_buy", "spot_sell"}:
        raise FinanceError("only spot evidence binding is supported")
    if scope.environment not in {"experiment", "live"}:
        raise FinanceError("spot evidence scope is unsupported")
    if account["reconciliation_state"] != "clean" or not account["observation_snapshot_hash"] \
            or account["policy_version"] != policy.policy_version \
            or account["policy_hash"] != policy.policy_hash:
        raise FinanceError("account observation or policy is not reconciled")
    if requested.instrument_version_id != policy.instrument_version_id:
        raise FinanceError("sizing instrument differs from registered policy")
    now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    if scope.environment == "live":
        return await _resolve_live_uniswap_sizing_request(
            conn, scope, account, policy, requested, now)
    price_row = (await conn.execute(text("""
        SELECT * FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
    """), {"hash": requested.price_snapshot_hash})).mappings().first()
    if not price_row:
        raise FinanceError("market evidence snapshot is missing")
    evidence = EvidenceSnapshot.model_validate({
        "schema_version": 1, "snapshot_hash": price_row["snapshot_hash"],
        "cutoff_at": price_row["cutoff_at"],
        "instrument_version_ids": tuple(price_row["instrument_version_ids"]),
        "accepted_observation_hashes": tuple(price_row["accepted_observation_hashes"]),
        "excluded": tuple(price_row["excluded"]),
        "source_rights_refs": tuple(price_row["source_rights_refs"]),
        "has_gap": price_row["has_gap"],
    })
    if canonical_hash(evidence.model_dump(mode="json", exclude={"snapshot_hash"})) \
            != evidence.snapshot_hash or evidence.has_gap or evidence.cutoff_at > now \
            or len(evidence.accepted_observation_hashes) != 1 \
            or evidence.instrument_version_ids != (policy.instrument_version_id,) \
            or evidence.source_rights_refs != ("internal_qualification_only",):
        raise FinanceError("market evidence is incomplete, altered, or unavailable")
    if (now - evidence.cutoff_at).total_seconds() > policy.max_observation_age_seconds:
        raise FinanceError("market evidence is stale")
    native = (await conn.execute(text("""
        SELECT * FROM observation_market_events WHERE observation_hash=:hash
    """), {"hash": evidence.accepted_observation_hashes[0]})).mappings().first()
    registry = (await conn.execute(text("""
        SELECT * FROM observation_instrument_versions WHERE instrument_version_id=:id
    """), {"id": policy.instrument_version_id})).mappings().first()
    if not native or not registry:
        raise FinanceError("market observation or instrument version is missing")
    instrument = InstrumentVersion.model_validate(registry["manifest"])
    observation = MarketObservation.model_validate(native["normalized_body"])
    if instrument.product_kind != "spot" or instrument.contract_multiplier != "1" \
            or instrument.instrument_version_id != registry["instrument_version_id"] \
            or instrument.registry_hash != registry["registry_hash"] \
            or observation.instrument_version_id != instrument.instrument_version_id \
            or observation.source_id != instrument.venue_id \
            or observation.source_kind != "recorded_native" \
            or observation.source_rights_ref != "internal_qualification_only" \
            or observation.continuity != "snapshot_only" \
            or observation.finality != "not_applicable" \
            or observation.available_at > evidence.cutoff_at \
            or observation.event_at > evidence.cutoff_at \
            or canonical_hash(observation.model_dump(mode="json")) != native["observation_hash"] \
            or native["raw_payload_hash"] != observation.raw_payload_hash:
        raise FinanceError("market observation cannot support exact spot sizing")
    if (now - observation.event_at).total_seconds() > policy.max_observation_age_seconds:
        raise FinanceError("market book is stale")
    if instrument.price_rule != "hyperliquid_spot_significant_figures_v1" \
            or instrument.venue_id != "hyperliquid":
        raise FinanceError("native spot price rule is unsupported")
    native_step = Fraction(instrument.lot_step) * 10 ** instrument.base_decimals
    if native_step.denominator != 1 or native_int(policy.quantity_step_units) % native_step.numerator:
        raise FinanceError("policy quantity step differs from native instrument")
    if instrument.min_size is not None:
        native_minimum = Fraction(instrument.min_size) * 10 ** instrument.base_decimals
        if native_minimum.denominator != 1 \
                or native_int(policy.min_quantity_units) < native_minimum.numerator:
            raise FinanceError("policy minimum is below native instrument minimum")

    account_row = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
    """), {"hash": account["observation_snapshot_hash"]})).mappings().first()
    if not account_row:
        raise FinanceError("reconciled account observation is missing")
    snapshot = account_snapshot_from_row(account_row)
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash or snapshot.scope != scope \
            or snapshot.status != "accepted" or snapshot.finality != "admitted_final" \
            or snapshot.has_gap or snapshot.has_reorg or not snapshot.balances_complete \
            or not snapshot.positions_complete or snapshot.observed_positions \
            or snapshot.source_account_id != account["source_account_id"]:
        raise FinanceError("account evidence cannot prove spot inventory")
    base, quote = instrument.base_asset_unit_id, instrument.quote_asset_unit_id
    if base == quote or instrument.settlement_asset_unit_id != quote:
        raise FinanceError("spot asset units are ambiguous")
    registered = {(row.asset_unit_id, row.location_id, row.book): row.registry_hash
                  for row in snapshot.observed_balances}
    base_registry = registered.get((base, requested.location_id, "wallet"))
    quote_registry = registered.get((quote, requested.location_id, "wallet"))
    if not base_registry or not quote_registry:
        raise FinanceError("account snapshot lacks explicit base and quote unit registrations")
    balances = (await conn.execute(text("""
        SELECT asset_unit_id,registry_hash,location_id,book,units FROM finance_balances
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), _scope(scope))).mappings().all()
    positions = (await conn.execute(text("""
        SELECT instrument_version_id FROM finance_positions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), _scope(scope))).first()
    if positions:
        raise FinanceError("perpetual position exposure is not valued by spot binder")
    base_units = 0
    for row in balances:
        amount = db_native_int(row["units"])
        if row["book"] not in {"wallet", "collateral", "transit", "liability"}:
            continue
        if row["book"] != "wallet" and amount:
            raise FinanceError("encumbered account balance is not valued by spot binder")
        if row["asset_unit_id"] not in {base, quote} and amount:
            raise FinanceError("another asset has unvalued account exposure")
        expected_registry = registered.get((row["asset_unit_id"], row["location_id"], row["book"]))
        if amount and expected_registry != row["registry_hash"]:
            raise FinanceError("ledger asset registry differs from admitted account observation")
        if row["asset_unit_id"] == base and row["book"] == "wallet":
            base_units += amount
    if base_units < 0:
        raise FinanceError("spot base inventory cannot be negative")
    bid = Fraction(observation.bids[0].price_quote_per_base)
    ask = Fraction(observation.asks[0].price_quote_per_base)
    scale = Fraction(10 ** instrument.quote_decimals, 10 ** instrument.base_decimals)
    trade_price = (ask if requested.action == "spot_buy" else bid) * scale
    exposure_price = ask * scale  # conservative mark for existing long spot inventory
    existing_notional = (base_units * exposure_price.numerator + exposure_price.denominator - 1) \
        // exposure_price.denominator
    pending = (await conn.execute(text("""
        SELECT r.calculation_receipt_hash,c.receipt_json FROM finance_reservations r
        JOIN finance_calculation_receipts c ON c.environment=r.environment
          AND c.scope_id=r.scope_id AND c.strategy_account_id=r.strategy_account_id
          AND c.receipt_hash=r.calculation_receipt_hash
        WHERE r.environment=:environment AND r.scope_id=:scope_id
          AND r.strategy_account_id=:strategy_account_id AND r.purpose='trade'
          AND r.status IN ('reserved','submitted','uncertain')
    """), _scope(scope))).mappings().all()
    for row in pending:
        receipt = SizingReceipt.model_validate_json(json.dumps(row["receipt_json"]))
        previous = receipt.request
        if receipt.receipt_hash != row["calculation_receipt_hash"] \
                or previous.instrument_version_id != instrument.instrument_version_id \
                or previous.quantity_asset_unit_id != base \
                or previous.quote_asset_unit_id != quote \
                or previous.location_id != requested.location_id:
            raise FinanceError("pending trade exposure cannot be valued for this instrument")
        if previous.action == "spot_buy":
            pending_units = native_int(receipt.quantity_units, positive=True)
            current_value = (pending_units * exposure_price.numerator
                             + exposure_price.denominator - 1) // exposure_price.denominator
            existing_notional += max(current_value, native_int(receipt.notional_units,
                                                                 positive=True))
        elif previous.action != "spot_sell":
            raise FinanceError("pending non-spot exposure blocks new sizing")
    authoritative = requested.model_copy(update={
        "instrument_version_id": instrument.instrument_version_id,
        "quantity_asset_unit_id": base, "quantity_registry_hash": base_registry,
        "quote_asset_unit_id": quote, "quote_registry_hash": quote_registry,
        "quote_per_quantity_numerator": str(trade_price.numerator),
        "quote_per_quantity_denominator": str(trade_price.denominator),
        "price_snapshot_hash": evidence.snapshot_hash,
        "account_snapshot_hash": snapshot.snapshot_hash,
        "existing_gross_notional_units": str(existing_notional),
        "existing_directional_notional_units": str(existing_notional),
    })
    authoritative = SizingRequest.model_validate(authoritative.model_dump(mode="python"))
    if authoritative != requested:
        raise FinanceError("caller sizing values differ from admitted market/account evidence")
    return authoritative


async def _resolve_live_uniswap_sizing_request(conn, scope: FinanceScope, account: dict,
        policy: SizingPolicy, requested: SizingRequest, now) -> SizingRequest:
    """Bind the first live route only: exact finalized USDC/WETH V3 pair evidence."""
    if scope.scope_id != "live" or not policy.approved_live:
        raise FinanceError("live Uniswap sizing requires its exact approved live scope")
    registry = (await conn.execute(text("""
        SELECT * FROM observation_instrument_versions WHERE instrument_version_id=:id
    """), {"id": policy.instrument_version_id})).mappings().first()
    if not registry:
        raise FinanceError("Uniswap instrument version is missing")
    instrument = InstrumentVersion.model_validate(registry["manifest"])
    if instrument.registry_hash != registry["registry_hash"] \
            or instrument.instrument_version_id != policy.instrument_version_id \
            or instrument.venue_id != "uniswap" or instrument.product_kind != "spot" \
            or instrument.price_rule != UNISWAP_V3_PRICE_RULE \
            or instrument.base_asset_unit_id != ARBITRUM_WETH_UNIT_ID \
            or instrument.quote_asset_unit_id != ARBITRUM_USDC_UNIT_ID \
            or instrument.settlement_asset_unit_id != ARBITRUM_USDC_UNIT_ID \
            or (instrument.base_decimals, instrument.quote_decimals,
                instrument.settlement_decimals) != (18, 6, 6) \
            or instrument.contract_multiplier != "1":
        raise FinanceError("registered instrument is not the exact Arbitrum WETH/USDC V3 spot pair")
    if requested.account_snapshot_hash != account["observation_snapshot_hash"]:
        raise FinanceError("request does not bind the current scoped pair account snapshot")
    account_row = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
          AND environment='live' AND scope_id='live'
          AND strategy_account_id=:strategy_account_id
    """), {"hash": account["observation_snapshot_hash"],
           "strategy_account_id": scope.strategy_account_id})).mappings().first()
    if not account_row:
        raise FinanceError("scoped pair account snapshot is missing")
    snapshot = account_snapshot_from_row(account_row)
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash \
            or snapshot.scope != scope or snapshot.status != "accepted" \
            or snapshot.coverage_scope != ARBITRUM_MANAGED_PAIR_COVERAGE \
            or snapshot.source_account_id != account["source_account_id"] \
            or not snapshot_coverage_is_complete(snapshot):
        raise FinanceError("account evidence is outside exact managed-pair coverage")
    require_current_live_native_snapshot(snapshot, scope=scope,
        source_account_id=account["source_account_id"],
        policy_version=policy.policy_version, now=now,
        max_age_seconds=policy.max_observation_age_seconds)
    if requested.location_id != snapshot.source_account_id:
        raise FinanceError("sizing location must be the exact observed wallet")

    quote = await load_uniswap_quote(conn, requested.price_snapshot_hash)
    if quote.venue != "uniswap" or quote.chain_id != 42161 \
            or quote.pool != instrument.native_instrument_id.lower() \
            or quote.event_at > now or native_int(quote.source_block.number) < native_int(snapshot.source_block_number) \
            or (native_int(quote.source_block.number) == native_int(snapshot.source_block_number)
                and quote.source_block.hash != snapshot.source_block_hash) \
            or (now - quote.event_at).total_seconds() > policy.max_observation_age_seconds:
        raise FinanceError("stored Uniswap quote is stale or predates the scoped account snapshot")
    desired = native_int(requested.desired_quantity_units, positive=True)
    if requested.action == "spot_buy":
        if (quote.token_in, quote.token_out) != (USDC, WETH) \
                or int(quote.minimum_amount_out) != desired:
            raise FinanceError("buy quote must be USDC-to-WETH for the exact requested output")
    elif (quote.token_in, quote.token_out) != (WETH, USDC) \
            or int(quote.amount_in) != desired:
        raise FinanceError("sell quote must be WETH-to-USDC for the exact requested input")
    if quote_evidence_hash(quote) != requested.price_snapshot_hash:
        raise FinanceError("stored Uniswap quote hash differs from the request")

    native_step = Fraction(instrument.lot_step) * 10 ** instrument.base_decimals
    if native_step.denominator != 1 or native_int(policy.quantity_step_units) % native_step.numerator:
        raise FinanceError("policy quantity step differs from native Uniswap token precision")
    if instrument.min_size is not None:
        native_minimum = Fraction(instrument.min_size) * 10 ** instrument.base_decimals
        if native_minimum.denominator != 1 \
                or native_int(policy.min_quantity_units) < native_minimum.numerator:
            raise FinanceError("policy minimum is below the registered Uniswap minimum")

    base, quote_asset = instrument.base_asset_unit_id, instrument.quote_asset_unit_id
    registered = {(row.asset_unit_id, row.location_id, row.book): row.registry_hash
                  for row in snapshot.observed_balances}
    base_registry = registered.get((base, requested.location_id, "wallet"))
    quote_registry = registered.get((quote_asset, requested.location_id, "wallet"))
    if not base_registry or not quote_registry:
        raise FinanceError("pair snapshot lacks exact WETH and USDC wallet registrations")
    balances = (await conn.execute(text("""
        SELECT asset_unit_id,registry_hash,location_id,book,units FROM finance_balances
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), _scope(scope))).mappings().all()
    positions = (await conn.execute(text("""
        SELECT instrument_version_id FROM finance_positions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
    """), _scope(scope))).first()
    if positions:
        raise FinanceError("position exposure is outside managed spot coverage")
    base_units = 0
    for row in balances:
        amount = db_native_int(row["units"])
        if row["book"] not in {"wallet", "collateral", "transit", "liability"}:
            continue
        if row["book"] != "wallet" and amount:
            raise FinanceError("encumbered balance is outside managed spot coverage")
        if row["asset_unit_id"] not in {base, quote_asset} and amount:
            raise FinanceError("another asset has unvalued live exposure")
        expected = registered.get((row["asset_unit_id"], row["location_id"], row["book"]))
        if amount and expected != row["registry_hash"]:
            raise FinanceError("ledger asset registry differs from pair account evidence")
        if row["asset_unit_id"] == base and row["location_id"] == requested.location_id \
                and row["book"] == "wallet":
            base_units += amount
    if base_units < 0:
        raise FinanceError("managed WETH inventory cannot be negative")

    price_numerator, price_denominator = quote.quote_per_raw_base_unit
    trade_price = Fraction(price_numerator, price_denominator)
    exposure_price = trade_price
    existing_notional = (base_units * exposure_price.numerator
                         + exposure_price.denominator - 1) // exposure_price.denominator
    pending = (await conn.execute(text("""
        SELECT r.calculation_receipt_hash,c.receipt_json FROM finance_reservations r
        JOIN finance_calculation_receipts c ON c.environment=r.environment
          AND c.scope_id=r.scope_id AND c.strategy_account_id=r.strategy_account_id
          AND c.receipt_hash=r.calculation_receipt_hash
        WHERE r.environment=:environment AND r.scope_id=:scope_id
          AND r.strategy_account_id=:strategy_account_id AND r.purpose='trade'
          AND r.status IN ('reserved','submitted','uncertain')
    """), _scope(scope))).mappings().all()
    for row in pending:
        receipt = SizingReceipt.model_validate_json(json.dumps(row["receipt_json"]))
        previous = receipt.request
        if receipt.receipt_hash != row["calculation_receipt_hash"] \
                or previous.instrument_version_id != instrument.instrument_version_id \
                or previous.quantity_asset_unit_id != base \
                or previous.quote_asset_unit_id != quote_asset \
                or previous.location_id != requested.location_id:
            raise FinanceError("pending live trade exposure cannot be valued for this pair")
        if previous.action == "spot_buy":
            units = native_int(receipt.quantity_units, positive=True)
            current_value = (units * exposure_price.numerator
                             + exposure_price.denominator - 1) // exposure_price.denominator
            existing_notional += max(current_value, native_int(receipt.notional_units,
                                                                 positive=True))
        elif previous.action != "spot_sell":
            raise FinanceError("pending non-spot exposure blocks Uniswap sizing")

    authoritative = requested.model_copy(update={
        "quantity_asset_unit_id": base, "quantity_registry_hash": base_registry,
        "quote_asset_unit_id": quote_asset, "quote_registry_hash": quote_registry,
        "quote_per_quantity_numerator": str(trade_price.numerator),
        "quote_per_quantity_denominator": str(trade_price.denominator),
        "price_snapshot_hash": quote_evidence_hash(quote),
        "account_snapshot_hash": snapshot.snapshot_hash,
        "existing_gross_notional_units": str(existing_notional),
        "existing_directional_notional_units": str(existing_notional),
    })
    return SizingRequest.model_validate(authoritative.model_dump(mode="python"))
