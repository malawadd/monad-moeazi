"""Pure, instrument-scoped Q4 sizing over frozen replay and account evidence."""
from __future__ import annotations

from collections import defaultdict
from fractions import Fraction

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, ReservationComponent, _digest, native_int
from .finance_observation_contracts import AccountObservationSnapshotRef
from .finance_policy import SizingPolicy
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_replay_finance_contracts import ReplayAction, ReplaySizingReceipt
from .lifecycle_replay_sizing_causal import causal_replay_receipt
from .lifecycle_replay_sizing_inputs import (
    location, pending_exposure, registered_wallet, validated_positions,
)
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_simulator import (
    CAUSAL_MODEL_HASH, MODEL_HASH, MODEL_VERSION,
)
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .observation_contracts import (
    EvidenceSnapshot, InstrumentVersion, MarketObservation, canonical_hash,
)


def _ceil(value: Fraction) -> int:
    if value < 0:
        raise FinanceError("replay sizing cannot ceil negative exposure")
    return -(-value.numerator // value.denominator)


def build_replay_sizing_receipt(
    manifest: SimulationRunManifest, decision: ReplayDecisionContext,
    policy: SizingPolicy, instrument: InstrumentVersion,
    selected_book: MarketObservation, accepted_evidence: EvidenceSnapshot,
    frozen_dataset: tuple[MarketObservation, ...],
    account_snapshot: AccountObservationSnapshotRef,
    positions: tuple[PositionArithmeticState, ...],
    pending_receipts: tuple[ReplaySizingReceipt, ...],
    *, request_id: str, action: ReplayAction, side: str,
    desired_quantity_units: str, order_ordinal: int,
    account_revision: int, position_revision: int | None = None,
) -> ReplaySizingReceipt:
    """Calculate a nonauthorizing hold recipe; SQL still fences capacity and state."""
    if position_revision is not None and \
            manifest.scenario.model_version != CAUSAL_MODEL_VERSION:
        raise FinanceError("legacy replay cannot bind a causal position revision")
    if not request_id or type(order_ordinal) is not int or order_ordinal <= 0 or \
            type(account_revision) is not int or account_revision < 0 or \
            manifest.scope.environment != "experiment" or \
            decision.scope != manifest.scope or decision.run_id != manifest.run_id or \
            decision.run_manifest_hash != manifest.manifest_hash or \
            decision.controller_ref != manifest.controller_ref or \
            decision.instrument_version_id != instrument.instrument_version_id or \
            decision.account_snapshot_hash != account_snapshot.snapshot_hash or \
            policy.policy_hash != manifest.policy_hash or \
            policy.policy_version != manifest.policy_version or \
            policy.instrument_version_id != instrument.instrument_version_id or \
            instrument.instrument_version_id not in manifest.instrument_version_ids or \
            account_snapshot.scope != manifest.scope or \
            account_snapshot_hash(account_snapshot) != account_snapshot.snapshot_hash or \
            account_snapshot.status != "accepted" or \
            account_snapshot.finality != "admitted_final" or \
            account_snapshot.has_gap or account_snapshot.has_reorg or \
            not account_snapshot.balances_complete or \
            not account_snapshot.positions_complete or \
            account_snapshot.cutoff_at > decision.cursor_at:
        raise FinanceError("replay sizing input lacks frozen financial provenance")
    if (manifest.scenario.model_version, manifest.scenario.model_hash) not in {
            (MODEL_VERSION, MODEL_HASH),
            (CAUSAL_MODEL_VERSION, CAUSAL_MODEL_HASH)} or \
            manifest.scenario.queue_model != "no_queue_estimate":
        raise FinanceError("replay sizing model is not qualified")
    recomputed, selected = build_replay_decision(manifest, frozen_dataset,
        decision.cursor_at, accepted_evidence,
        instrument_version_id=instrument.instrument_version_id,
        account_snapshot_hash=account_snapshot.snapshot_hash)
    if recomputed != decision or selected != selected_book:
        raise FinanceError("replay sizing book differs from accepted decision evidence")
    rights = {"recorded_native": "internal_qualification_only",
              "synthetic_fault": "local_simulation_fixture_only",
              "documented_example": "documentation_example_only"}
    if selected_book.instrument_version_id != instrument.instrument_version_id or \
            selected_book.source_id != instrument.venue_id or \
            selected_book.source_rights_ref != rights[selected_book.source_kind] or \
            selected_book.event_at > selected_book.available_at or \
            selected_book.available_at > decision.evidence_cutoff_at or \
            (decision.cursor_at - selected_book.event_at).total_seconds() * 1000 > \
            manifest.scenario.max_book_age_ms or \
            (decision.cursor_at - selected_book.event_at).total_seconds() < 0:
        raise FinanceError("replay sizing book is unavailable or stale")
    if action.startswith("spot_"):
        if instrument.product_kind != "spot" or instrument.contract_multiplier != "1" \
                or instrument.settlement_asset_unit_id != instrument.quote_asset_unit_id or \
                (action == "spot_buy" and side != "buy") or \
                (action == "spot_sell" and side != "sell"):
            raise FinanceError("replay spot action differs from frozen instrument")
        contract_size = 1
        quantity_kind = "asset_native"
    else:
        size = Fraction(instrument.contract_multiplier) * 10 ** instrument.base_decimals
        if instrument.product_kind != "perpetual" or \
                instrument.margin_model != "linear_v1" or \
                instrument.quote_asset_unit_id != instrument.settlement_asset_unit_id or \
                instrument.quote_decimals != instrument.settlement_decimals or \
                size.denominator != 1 or policy.initial_margin_bps <= 0 or \
                side not in {"buy", "sell"}:
            raise FinanceError("replay perpetual lacks a declared linear model")
        contract_size = size.numerator
        quantity_kind = "contracts"
    desired = native_int(desired_quantity_units, positive=True)
    step = native_int(policy.quantity_step_units, positive=True)
    native_step = Fraction(instrument.lot_step) * 10 ** instrument.base_decimals
    if native_step.denominator != 1 or (step * contract_size) % native_step.numerator:
        raise FinanceError("replay policy step differs from native lot")
    place, _ = location(account_snapshot, instrument)
    state = validated_positions(account_snapshot, positions, instrument,
                                place, manifest)
    fee_rules = tuple(row for row in manifest.scenario.fee_rules
                     if row.order_ordinal == order_ordinal and native_int(row.units) > 0)
    allowed_assets = {instrument.base_asset_unit_id,
                      instrument.quote_asset_unit_id,
                      instrument.settlement_asset_unit_id} | \
                     {row.asset_unit_id for row in fee_rules}
    wallet = registered_wallet(account_snapshot, place, allowed_assets,
        collateral_asset=instrument.settlement_asset_unit_id if
            quantity_kind == "contracts" else None)
    for fee in fee_rules:
        if wallet.get(fee.asset_unit_id, (None,))[0] != fee.registry_hash:
            raise FinanceError("explicit fee asset lacks registered wallet identity")
    base_registry = wallet.get(instrument.base_asset_unit_id, (None,))[0]
    quote_registry = wallet.get(instrument.quote_asset_unit_id, (None,))[0]
    settlement_registry = wallet.get(instrument.settlement_asset_unit_id, (None,))[0]
    if not base_registry or not quote_registry or not settlement_registry:
        raise FinanceError("replay asset registrations are incomplete")
    if state is not None and (
            state.base_registry_hash != base_registry or
            state.settlement_registry_hash != settlement_registry):
        raise FinanceError("position asset registry differs from account snapshot")
    if quantity_kind == "contracts":
        if wallet[instrument.base_asset_unit_id][1]:
            raise FinanceError("spot base inventory is unvalued by perpetual sizing")
        if state is not None and (
                state.contract_size_unit_id != instrument.base_asset_unit_id or
                state.contract_size_units != str(contract_size) or
                native_int(state.margin_reserved_units) != _ceil(
                    Fraction(native_int(state.open_cost_numerator),
                             native_int(state.open_cost_denominator, positive=True)) *
                    policy.initial_margin_bps / 10_000)):
            raise FinanceError("linear position multiplier or margin basis differs")
        collateral = [row for row in account_snapshot.observed_balances
                      if row.location_id == place and row.book == "collateral" and
                      row.asset_unit_id == instrument.settlement_asset_unit_id]
        if len(collateral) != 1 or collateral[0].registry_hash != settlement_registry or \
                state is not None and native_int(state.collateral_units) != \
                native_int(collateral[0].units):
            raise FinanceError("linear collateral identity differs from snapshot")
    scale = Fraction(10 ** instrument.quote_decimals, 10 ** instrument.base_decimals)
    ask = Fraction(selected_book.asks[0].price_quote_per_base) * scale
    bid = Fraction(selected_book.bids[0].price_quote_per_base) * scale
    price = ask if side == "buy" else bid
    mark = ask
    current_qty = native_int(state.signed_quantity_units) if state and \
        quantity_kind == "contracts" else wallet.get(instrument.base_asset_unit_id,
                                                      (None, 0))[1]
    if quantity_kind == "asset_native" and current_qty < 0:
        raise FinanceError("spot inventory cannot be short")
    pending_open, pending_reduce = pending_exposure(pending_receipts, manifest,
        instrument, place, mark, contract_size, action, side)
    current_notional = _ceil(mark * abs(current_qty) * contract_size)
    quantity = min(desired, native_int(policy.max_quantity_units, positive=True)) // step * step
    reducing = action in {"spot_sell", "perp_reduce", "perp_close"}
    if reducing:
        if quantity_kind == "contracts":
            if current_qty == 0 or (current_qty > 0) == (side == "buy"):
                raise FinanceError("perpetual reduction differs from open direction")
        available = abs(current_qty) - pending_reduce
        if action == "perp_close" and desired != available:
            raise FinanceError("perpetual close must request exact unheld exposure")
        quantity = min(quantity, available) // step * step
    else:
        if action == "perp_open" and current_qty or \
                action == "perp_increase" and (current_qty == 0 or
                    (current_qty > 0) != (side == "buy")):
            raise FinanceError("perpetual opening action differs from position")
        cap = min(native_int(policy.max_gross_notional_units),
                  native_int(policy.max_directional_notional_units))
        remaining = cap - current_notional - pending_open
        if remaining <= 0:
            raise FinanceError("instrument exposure cap is reached")
        quantity = min(quantity, int(Fraction(remaining, 1) /
                                     (mark * contract_size))) // step * step
    if quantity < native_int(policy.min_quantity_units, positive=True):
        raise FinanceError("replay quantity is below policy minimum")
    target_exposure = current_qty + (quantity if side == "buy" else -quantity)
    if instrument.min_size is not None and \
            quantity * contract_size < _ceil(Fraction(instrument.min_size) *
                                             10 ** instrument.base_decimals):
        raise FinanceError("replay quantity is below native instrument minimum")
    notional = _ceil(quantity * contract_size * price)
    risk_notional = _ceil(quantity * contract_size * mark)
    if not reducing and current_notional + pending_open + risk_notional > min(
            native_int(policy.max_gross_notional_units),
            native_int(policy.max_directional_notional_units)):
        raise FinanceError("replay notional exceeds the policy cap")
    fee_budget = native_int(policy.fee_ceiling_units, nonnegative=True)
    if fee_budget < _ceil(Fraction(risk_notional * manifest.scenario.fee_bps, 10_000)):
        raise FinanceError("quote fee ceiling cannot cover the scenario rate")
    exit_buffer = native_int(policy.exit_buffer_units, nonnegative=True)
    requirements: dict[tuple[str, str], int] = defaultdict(int)
    if action == "spot_buy":
        requirements[(instrument.quote_asset_unit_id, quote_registry)] += \
            notional + fee_budget + exit_buffer
    elif action == "spot_sell":
        requirements[(instrument.base_asset_unit_id, base_registry)] += quantity
        requirements[(instrument.quote_asset_unit_id, quote_registry)] += \
            fee_budget + exit_buffer
    else:
        margin = 0
        if not reducing:
            existing_cost = Fraction(native_int(state.open_cost_numerator),
                native_int(state.open_cost_denominator, positive=True)) if state \
                else Fraction(0)
            existing_margin = native_int(state.margin_reserved_units) if state else 0
            margin = _ceil((existing_cost + quantity * contract_size * mark) *
                           policy.initial_margin_bps / 10_000) - existing_margin
            if margin <= 0:
                raise FinanceError("new linear exposure has no margin requirement")
        requirements[(instrument.settlement_asset_unit_id, settlement_registry)] += \
            margin + fee_budget + exit_buffer
    for fee in fee_rules:
        requirements[(fee.asset_unit_id, fee.registry_hash)] += native_int(fee.units)
    components = tuple(ReservationComponent(
        capacity_key=f"asset:{asset}:{place}", asset_unit_id=asset,
        registry_hash=registry, location_id=place, units=str(amount))
        for (asset, registry), amount in sorted(requirements.items(),
            key=lambda row: (f"asset:{row[0][0]}:{place}", row[0][0], place))
        if amount > 0)
    if not components:
        raise FinanceError("replay action has no exact capacity component")
    body = dict(schema_version=1, code_version="replay-sizing-v1",
        valuation_scope="instrument_only", scope=manifest.scope,
        run_id=manifest.run_id, manifest_hash=manifest.manifest_hash,
        request_id=request_id, decision_hash=decision.decision_hash,
        evidence_snapshot_hash=decision.evidence_snapshot_hash,
        selected_observation_hash=canonical_hash(selected_book.model_dump(mode="json")),
        account_snapshot_hash=account_snapshot.snapshot_hash,
        account_revision=str(account_revision), policy_version=policy.policy_version,
        policy_hash=policy.policy_hash,
        instrument_version_id=instrument.instrument_version_id,
        instrument_registry_hash=instrument.registry_hash, action=action, side=side,
        quantity_kind=quantity_kind, order_ordinal=order_ordinal,
        replay_cursor_at=decision.cursor_at, location_id=place,
        base_asset_unit_id=instrument.base_asset_unit_id,
        base_registry_hash=base_registry,
        quote_asset_unit_id=instrument.quote_asset_unit_id,
        quote_registry_hash=quote_registry,
        settlement_asset_unit_id=instrument.settlement_asset_unit_id,
        settlement_registry_hash=settlement_registry,
        contract_size_unit_id=instrument.base_asset_unit_id if
            quantity_kind == "contracts" else None,
        contract_size_units=str(contract_size) if quantity_kind == "contracts" else None,
        price_numerator=str(price.numerator), price_denominator=str(price.denominator),
        desired_quantity_units=str(desired), quantity_units=str(quantity),
        target_exposure_units=str(target_exposure),
        notional_units=str(notional), risk_notional_units=str(risk_notional),
        fee_budget_quote_units=str(fee_budget),
        components=components)
    receipt_body = ReplaySizingReceipt.model_construct(**body).model_dump(
        mode="json", exclude={"receipt_hash"})
    receipt = ReplaySizingReceipt.model_validate({**body,
        "receipt_hash": _digest("moeazi-replay-sizing-v1", receipt_body)})
    if manifest.scenario.model_version == CAUSAL_MODEL_VERSION:
        return causal_replay_receipt(receipt, manifest, decision, policy,
            instrument, selected_book, state, current_qty, pending_open,
            position_revision=position_revision)
    return receipt
