"""Pure identity and exposure checks used by Q4 replay sizing."""
from __future__ import annotations

from fractions import Fraction

from .finance_contracts import FinanceError, native_int
from .finance_observation_contracts import AccountObservationSnapshotRef
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .observation_contracts import InstrumentVersion


def location(snapshot: AccountObservationSnapshotRef,
             instrument: InstrumentVersion) -> tuple[str, dict[str, str]]:
    rows = snapshot.observed_balances
    keys = [(row.asset_unit_id, row.location_id, row.book) for row in rows]
    if len(keys) != len(set(keys)):
        raise FinanceError("replay snapshot repeats an asset/book identity")
    eligible = []
    for place in {row.location_id for row in rows}:
        wallet = {row.asset_unit_id: row.registry_hash for row in rows
                  if row.location_id == place and row.book == "wallet"}
        collateral = {row.asset_unit_id: row.registry_hash for row in rows
                      if row.location_id == place and row.book == "collateral"}
        if instrument.product_kind == "spot":
            if instrument.base_asset_unit_id in wallet and \
                    instrument.quote_asset_unit_id in wallet:
                eligible.append((place, wallet))
        elif instrument.base_asset_unit_id in wallet and \
                instrument.settlement_asset_unit_id in wallet and \
                instrument.settlement_asset_unit_id in collateral and \
                wallet[instrument.settlement_asset_unit_id] == \
                collateral[instrument.settlement_asset_unit_id]:
            eligible.append((place, wallet))
    if len(eligible) != 1:
        raise FinanceError("replay account has no unique registered trading location")
    return eligible[0]


def validated_positions(snapshot: AccountObservationSnapshotRef,
                        positions: tuple[PositionArithmeticState, ...],
                        instrument: InstrumentVersion, place: str,
                        manifest: SimulationRunManifest) -> PositionArithmeticState | None:
    if len({(row.instrument_version_id, row.location_id) for row in positions}) \
            != len(positions):
        raise FinanceError("replay position identity is duplicated")
    matching = None
    for state in positions:
        state = PositionArithmeticState.model_validate_json(state.model_dump_json())
        if state.scope != manifest.scope or state.run_id != manifest.run_id:
            raise FinanceError("replay position crosses the frozen run")
        if state.instrument_version_id == instrument.instrument_version_id and \
                state.location_id == place:
            if state.instrument_registry_hash != instrument.registry_hash or \
                    state.base_asset_unit_id != instrument.base_asset_unit_id or \
                    state.settlement_asset_unit_id != instrument.settlement_asset_unit_id or \
                    (state.quantity_kind == "contracts") != (
                        instrument.product_kind == "perpetual"):
                raise FinanceError("position instrument registry differs")
            matching = state
        elif native_int(state.signed_quantity_units) or \
                native_int(state.collateral_units) or \
                native_int(state.margin_reserved_units):
            raise FinanceError("another position has unvalued exposure")
    observed = [row for row in snapshot.observed_positions
                if native_int(row.signed_contracts) or native_int(row.margin_units)]
    if instrument.product_kind == "spot" and observed:
        raise FinanceError("spot sizing cannot value a perpetual position")
    if instrument.product_kind == "perpetual":
        if len(observed) > 1 or any(row.instrument_version_id !=
                instrument.instrument_version_id or row.location_id != place or
                row.instrument_registry_hash != instrument.registry_hash
                for row in observed):
            raise FinanceError("account snapshot has an unvalued position")
        if observed and (matching is None or
                observed[0].signed_contracts != matching.signed_quantity_units or
                observed[0].margin_units != matching.margin_reserved_units or
                observed[0].contract_size_unit_id != matching.contract_size_unit_id or
                observed[0].collateral_asset_unit_id !=
                    matching.settlement_asset_unit_id):
            raise FinanceError("replay position differs from admitted account snapshot")
        if not observed and matching is not None and \
                native_int(matching.signed_quantity_units):
            raise FinanceError("position state has no admitted account observation")
    return matching


def registered_wallet(snapshot: AccountObservationSnapshotRef,
                      place: str, allowed_assets: set[str],
                      *, collateral_asset: str | None) -> dict[str, tuple[str, int]]:
    wallet = {row.asset_unit_id: (row.registry_hash, native_int(row.units))
              for row in snapshot.observed_balances
              if row.location_id == place and row.book == "wallet"}
    for row in snapshot.observed_balances:
        units = native_int(row.units)
        if not units:
            continue
        if row.location_id != place or row.book not in {"wallet", "collateral"} or \
                row.book == "wallet" and row.asset_unit_id not in allowed_assets or \
                row.book == "collateral" and row.asset_unit_id != collateral_asset:
            raise FinanceError("account has unvalued or encumbered assets")
    return wallet


def pending_exposure(pending: tuple[ReplaySizingReceipt, ...],
                     manifest: SimulationRunManifest,
                     instrument: InstrumentVersion, place: str,
                     mark_per_base: Fraction, contract_size: int,
                     action: str, side: str) -> tuple[int, int]:
    opening_notional = 0
    reducing_quantity = 0
    for row in pending:
        row = ReplaySizingReceipt.model_validate_json(row.model_dump_json())
        if row.scope != manifest.scope or row.run_id != manifest.run_id or \
                row.instrument_version_id != \
                instrument.instrument_version_id or row.instrument_registry_hash != \
                instrument.registry_hash or row.location_id != place:
            raise FinanceError("pending replay obligation cannot be valued")
        quantity = native_int(row.quantity_units, positive=True)
        if instrument.product_kind == "perpetual":
            opening = row.action in {"perp_open", "perp_increase"}
            requesting_open = action in {"perp_open", "perp_increase"}
            if opening != requesting_open or row.side != side:
                raise FinanceError("pending perpetual direction is unresolved")
        if row.action in {"spot_buy", "perp_open", "perp_increase"}:
            marked = mark_per_base * quantity * (
                contract_size if row.quantity_kind == "contracts" else 1)
            ceiling = -(-marked.numerator // marked.denominator)
            opening_notional += max(native_int(row.notional_units), ceiling)
        else:
            reducing_quantity += quantity
    return opening_notional, reducing_quantity
