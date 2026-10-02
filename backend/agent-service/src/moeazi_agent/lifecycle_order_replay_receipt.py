"""Recheck a stored Q4 receipt immediately before possible submission."""
from __future__ import annotations

import json
from hashlib import sha256
from fractions import Fraction

from sqlalchemy import text

from .finance_contracts import FinanceError, ReservationComponent, db_native_int, native_int
from .lifecycle_contracts import ExecutionEvent, TradeIntent
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_run_contracts import SimulationRunManifest
from .observation_contracts import MarketObservation, canonical_hash


def _reservation_key(receipt: ReplaySizingReceipt) -> str:
    scope = receipt.scope
    raw = ":".join(("moeazi-replay-reservation-v1", scope.environment,
        scope.scope_id, scope.strategy_account_id, receipt.run_id,
        receipt.request_id))
    return sha256(raw.encode("utf-8")).hexdigest()


async def check_replay_start_receipt(conn, params: dict, prepared: dict,
                                     payload: dict, intent: TradeIntent,
                                     manifest: SimulationRunManifest,
                                     account: dict, run: dict, reservation: dict,
                                     context: ReplayDecisionContext | None,
                                     selected_book: MarketObservation
                                     ) -> ReplaySizingReceipt:
    row = (await conn.execute(text("""
        SELECT receipt_json FROM finance_calculation_receipts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND receipt_hash=:hash
    """), {**params, "hash": prepared["calculation_receipt_hash"]})).mappings().first()
    if row is None:
        raise FinanceError("replay submission has no stored calculation receipt")
    receipt = ReplaySizingReceipt.model_validate_json(json.dumps(row["receipt_json"]))
    key = _reservation_key(receipt)
    if context is None or receipt.decision_hash != context.decision_hash or \
            receipt.scope != manifest.scope or receipt.run_id != manifest.run_id or \
            receipt.manifest_hash != manifest.manifest_hash or \
            receipt.receipt_hash != intent.calculation_receipt_hash or \
            receipt.receipt_hash != prepared["calculation_receipt_hash"] or \
            receipt.action != intent.action or receipt.side != intent.side or \
            receipt.instrument_version_id != intent.instrument_version_id or \
            receipt.instrument_registry_hash != intent.instrument_registry_hash or \
            receipt.evidence_snapshot_hash != intent.evidence_snapshot_hash or \
            receipt.selected_observation_hash != canonical_hash(
                selected_book.model_dump(mode="json")) or \
            receipt.account_snapshot_hash != account["observation_snapshot_hash"] or \
            receipt.policy_hash != manifest.policy_hash or \
            receipt.policy_version != manifest.policy_version or \
            receipt.replay_cursor_at != run["replay_cursor_at"] or \
            receipt.desired_quantity_units != intent.desired_quantity_units or \
            receipt.target_exposure_units != intent.target_exposure_units or \
            native_int(receipt.account_revision) + 1 != reservation["admitted_revision"] or \
            reservation["reservation_id"] != key or \
            reservation["idempotency_key"] != key or \
            receipt.order_ordinal != prepared["order_ordinal"] or \
            native_int(receipt.quantity_units) != db_native_int(prepared["quantity_units"]):
        raise FinanceError("replay submission receipt differs from current order")
    rows = (await conn.execute(text("""
        SELECT capacity_key,asset_unit_id,registry_hash,location_id,units
        FROM finance_reservation_components
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
          AND reservation_id=:reservation_id ORDER BY ordinal
    """), {**params, "reservation_id": key})).mappings().all()
    components = tuple(ReservationComponent(capacity_key=row["capacity_key"],
        asset_unit_id=row["asset_unit_id"], registry_hash=row["registry_hash"],
        location_id=row["location_id"], units=str(db_native_int(row["units"])))
        for row in rows)
    if components != receipt.components or \
            payload.get("receiptCodeVersion") != receipt.code_version or \
            payload.get("reservationComponents") != [part.model_dump(mode="json")
                for part in receipt.components] or \
            payload.get("riskNotionalUnits") != receipt.risk_notional_units or \
            payload.get("targetExposureUnits") != receipt.target_exposure_units or \
            payload.get("feeBudgetQuoteUnits") != receipt.fee_budget_quote_units or \
            payload.get("quantityUnits") != receipt.quantity_units or \
            payload.get("locationId") != receipt.location_id or \
            payload.get("quantityAssetUnitId") != receipt.base_asset_unit_id or \
            payload.get("quantityRegistryHash") != receipt.base_registry_hash or \
            payload.get("quoteAssetUnitId") != receipt.quote_asset_unit_id or \
            payload.get("quoteRegistryHash") != receipt.quote_registry_hash or \
            payload.get("priceNumerator") != receipt.price_numerator or \
            payload.get("priceDenominator") != receipt.price_denominator or \
            payload.get("quantityKind") != receipt.quantity_kind or \
            payload.get("contractSizeUnitId") != receipt.contract_size_unit_id or \
            payload.get("contractSizeUnits") != receipt.contract_size_units or \
            payload.get("settlementAssetUnitId") != receipt.settlement_asset_unit_id or \
            payload.get("settlementRegistryHash") != receipt.settlement_registry_hash or \
            payload.get("notionalUnits") != receipt.notional_units:
        raise FinanceError("prepared replay payload differs from exact held receipt")
    if receipt.code_version == "replay-sizing-v2" and (
            receipt.execution_envelope is None or
            payload.get("executionEnvelopeHash") !=
                receipt.execution_envelope.envelope_hash):
        raise FinanceError("prepared causal payload lacks its held envelope")
    return receipt


async def check_replay_preparation_receipt(conn, params: dict,
        receipt_json: dict, receipt_hash: str, intent: TradeIntent,
        manifest: SimulationRunManifest, account: dict, run: dict,
        reservation: dict, context: ReplayDecisionContext | None,
        selected_book: MarketObservation, order_ordinal: int
        ) -> ReplaySizingReceipt:
    receipt = ReplaySizingReceipt.model_validate_json(json.dumps(receipt_json))
    key = _reservation_key(receipt)
    if context is None or receipt.decision_hash != context.decision_hash or \
            receipt.scope != manifest.scope or receipt.run_id != intent.run_id or \
            receipt.manifest_hash != manifest.manifest_hash or \
            receipt.receipt_hash != receipt_hash or \
            receipt.action != intent.action or receipt.side != intent.side or \
            receipt.instrument_version_id != intent.instrument_version_id or \
            receipt.instrument_registry_hash != intent.instrument_registry_hash or \
            receipt.evidence_snapshot_hash != intent.evidence_snapshot_hash or \
            receipt.selected_observation_hash != canonical_hash(
                selected_book.model_dump(mode="json")) or \
            receipt.account_snapshot_hash != account["observation_snapshot_hash"] or \
            receipt.policy_hash != manifest.policy_hash or \
            receipt.policy_version != manifest.policy_version or \
            receipt.order_ordinal != order_ordinal or \
            receipt.replay_cursor_at != run["replay_cursor_at"] or \
            receipt.desired_quantity_units != intent.desired_quantity_units or \
            receipt.target_exposure_units != intent.target_exposure_units or \
            native_int(receipt.account_revision) + 1 != reservation["admitted_revision"] or \
            reservation["reservation_id"] != key or \
            reservation["idempotency_key"] != key:
        raise FinanceError("replay sizing receipt differs from durable entry")
    rows = (await conn.execute(text("""
        SELECT capacity_key,asset_unit_id,registry_hash,location_id,units
        FROM finance_reservation_components
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
          AND reservation_id=:reservation_id ORDER BY ordinal
    """), {**params, "reservation_id": key})).mappings().all()
    held = tuple(ReservationComponent(capacity_key=row["capacity_key"],
        asset_unit_id=row["asset_unit_id"], registry_hash=row["registry_hash"],
        location_id=row["location_id"], units=str(db_native_int(row["units"])))
        for row in rows)
    if held != receipt.components:
        raise FinanceError("reservation components differ from replay receipt")
    return receipt


def verify_spot_replay_preflight(receipt: ReplaySizingReceipt,
                                 manifest: SimulationRunManifest,
                                 events: tuple[ExecutionEvent, ...]) -> None:
    """Bound every possible frozen spot fill before recording possible submission."""
    if receipt.manifest_hash != manifest.manifest_hash or \
            receipt.quantity_kind != "asset_native" or receipt.action not in {
                "spot_buy", "spot_sell"}:
        raise FinanceError("spot replay preflight requires a spot receipt")
    fees: dict[tuple[str, str], int] = {}
    spent = 0
    for event in events:
        if event.scope != receipt.scope or event.run_id != receipt.run_id or \
                event.run_manifest_hash != receipt.manifest_hash or \
                event.instrument_version_id != receipt.instrument_version_id or \
                event.order_ordinal != receipt.order_ordinal or \
                event.quantity_kind != receipt.quantity_kind:
            raise FinanceError("preflight source differs from held replay receipt")
        if event.kind != "fill":
            continue
        if event.fee_units is not None:
            if not event.fee_asset_unit_id or not event.fee_registry_hash:
                raise FinanceError("preflight fee lacks an exact asset registration")
            key = event.fee_asset_unit_id, event.fee_registry_hash
            fees[key] = fees.get(key, 0) + native_int(event.fee_units,
                                                       nonnegative=True)
        if receipt.action == "spot_buy":
            paid = Fraction(native_int(event.fill_quantity_units or "0", positive=True) *
                native_int(event.price_numerator or "0", positive=True),
                native_int(event.price_denominator or "0", positive=True))
            spent += -(-paid.numerator // paid.denominator)
    if spent > native_int(receipt.notional_units, positive=True):
        raise FinanceError("future spot fill exceeds admitted executable notional")
    budgets: dict[tuple[str, str], int] = {
        (receipt.quote_asset_unit_id, receipt.quote_registry_hash):
            native_int(receipt.fee_budget_quote_units, nonnegative=True)}
    for rule in manifest.scenario.fee_rules:
        if rule.order_ordinal == receipt.order_ordinal:
            key = rule.asset_unit_id, rule.registry_hash
            budgets[key] = budgets.get(key, 0) + native_int(rule.units,
                                                             nonnegative=True)
    held = {(part.asset_unit_id, part.registry_hash): native_int(part.units)
            for part in receipt.components}
    for key, units in fees.items():
        if units > budgets.get(key, 0) or units > held.get(key, 0):
            raise FinanceError("simulated fee exceeds exact held asset budget")
    quote = receipt.quote_asset_unit_id, receipt.quote_registry_hash
    if receipt.action == "spot_buy" and spent + fees.get(quote, 0) > \
            held.get(quote, 0):
        raise FinanceError("simulated spot cost exceeds reserved quote capacity")


async def check_causal_position_anchor(conn, params: dict,
        receipt: ReplaySizingReceipt) -> None:
    """A reduction may dispatch only from its exact issuance position."""
    if receipt.code_version != "replay-sizing-v2" or \
            receipt.position_state_hash is None:
        return
    row = (await conn.execute(text("""
        SELECT arithmetic_state_json,arithmetic_state_hash,revision
        FROM simulation_positions WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND instrument_version_id=:instrument
          AND location_id=:location FOR UPDATE
    """), {**params, "instrument": receipt.instrument_version_id,
           "location": receipt.location_id})).mappings().first()
    if row is None or row["arithmetic_state_hash"] != \
            receipt.position_state_hash or row["revision"] != \
            receipt.position_revision or row["arithmetic_state_json"] is None:
        raise FinanceError("causal position changed before reduce-only dispatch")
    state = PositionArithmeticState.model_validate_json(
        json.dumps(row["arithmetic_state_json"]))
    if state != receipt.position_state:
        raise FinanceError("causal position body differs from frozen receipt")
