"""Fail-closed economics preflight before a possible replay submission."""
from __future__ import annotations

import json
from datetime import timedelta
from fractions import Fraction

from sqlalchemy import text

from .finance_contracts import FinanceError, native_int
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_order_replay_receipt import verify_spot_replay_preflight
from .lifecycle_position_math import calculate_fill_effect, calculate_funding_effect
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_position_store import load_position_state
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .observation_contracts import InstrumentVersion


async def preflight_replay_order(repo, conn, params: dict,
        receipt: ReplaySizingReceipt, manifest: SimulationRunManifest,
        permit: ExecutionPermit, events: tuple[ExecutionEvent, ...]) -> None:
    if getattr(receipt, "code_version", None) == "replay-sizing-v2":
        envelope = receipt.execution_envelope
        if manifest.scenario.model_version != CAUSAL_MODEL_VERSION or \
                envelope is None or permit.execution_envelope != envelope or \
                envelope.selected_observation_hash != receipt.selected_observation_hash or \
                envelope.decision_hash != receipt.decision_hash or \
                envelope.time_in_force_cursor > manifest.scenario.simulation_end_at or \
                events:
            raise FinanceError("causal dispatch differs from its known held limits")
        if receipt.quantity_kind != "asset_native":
            raise FinanceError("causal linear source lacks anchored position state")
        return
    policy = manifest.protection_policy
    if policy is not None and permit.action in {"spot_buy", "perp_open",
                                               "perp_increase"}:
        duration = timedelta(seconds=policy.maximum_unprotected_seconds)
        if any(event.kind == "fill" and
               event.simulation_cursor_at + duration >
               manifest.scenario.simulation_end_at for event in events):
            raise FinanceError("modeled fill has no in-horizon protection deadline")
    if receipt.quantity_kind == "asset_native":
        verify_spot_replay_preflight(receipt, manifest, events)
        return
    if receipt.quantity_kind != "contracts" or \
            receipt.action not in {"perp_open", "perp_increase", "perp_reduce",
                                   "perp_close"}:
        raise FinanceError("replay preflight has an unsupported quantity kind")
    # A separate active order could change the position between this candidate's
    # modeled facts. Q4 currently admits the sequential linear-perp subset only.
    peers = (await conn.execute(text("""
        SELECT o.order_id FROM simulation_orders o JOIN finance_reservations r
          ON r.environment=o.environment AND r.scope_id=o.scope_id
          AND r.strategy_account_id=o.strategy_account_id
          AND r.reservation_id=o.reservation_id
        WHERE o.environment=:environment AND o.scope_id=:scope_id
          AND o.strategy_account_id=:strategy_account_id
          AND o.instrument_version_id=:instrument AND o.order_id<>:order_id
          AND r.status IN ('reserved','submitted','uncertain') LIMIT 1
    """), {**params, "instrument": permit.instrument_version_id,
           "order_id": permit.order_id})).mappings().first()
    if peers:
        raise FinanceError("linear replay has another unresolved instrument order")
    row = (await conn.execute(text("""
        SELECT manifest,registry_hash FROM observation_instrument_versions
        WHERE instrument_version_id=:instrument
    """), {"instrument": permit.instrument_version_id})).mappings().first()
    if row is None:
        raise FinanceError("linear replay instrument is unavailable")
    instrument = InstrumentVersion.model_validate_json(json.dumps(row["manifest"]))
    if instrument.registry_hash != row["registry_hash"] or \
            instrument.registry_hash != receipt.instrument_registry_hash or \
            instrument.margin_model != "linear_v1" or \
            instrument.product_kind != "perpetual" or \
            permit.quantity_kind != "contracts" or \
            permit.contract_size_units != receipt.contract_size_units or \
            permit.contract_size_unit_id != receipt.contract_size_unit_id or \
            permit.settlement_asset_unit_id != receipt.settlement_asset_unit_id or \
            permit.settlement_registry_hash != receipt.settlement_registry_hash:
        raise FinanceError("linear replay instrument or permit identity differs")
    policy = await repo.finance._receipt_policy(conn, permit.scope,
                                                 receipt.policy_version)
    if policy.policy_hash != receipt.policy_hash or policy.initial_margin_bps <= 0:
        raise FinanceError("linear replay margin policy changed")
    state, _ = await load_position_state(conn, permit, instrument)
    verify_linear_replay_preflight(receipt, manifest, permit, instrument,
        policy.initial_margin_bps, state, events)


def verify_linear_replay_preflight(receipt: ReplaySizingReceipt,
        manifest: SimulationRunManifest, permit: ExecutionPermit,
        instrument: InstrumentVersion, margin_bps: int,
        state: PositionArithmeticState,
        events: tuple[ExecutionEvent, ...]) -> None:
    """Audit modeled exact wallet debits against this order's immutable hold."""
    budgets: dict[tuple[str, str], int] = {
        (receipt.quote_asset_unit_id, receipt.quote_registry_hash):
            native_int(receipt.fee_budget_quote_units, nonnegative=True)}
    for rule in manifest.scenario.fee_rules:
        if rule.order_ordinal == receipt.order_ordinal:
            key = rule.asset_unit_id, rule.registry_hash
            budgets[key] = budgets.get(key, 0) + native_int(rule.units,
                                                             nonnegative=True)
    held = {(part.asset_unit_id, part.registry_hash): native_int(part.units,
              positive=True) for part in receipt.components}
    fees: dict[tuple[str, str], int] = {}
    wallet_debits: dict[tuple[str, str], int] = {}
    modeled_notional = 0
    modeled_fills = 0
    for event in events:
        if event.scope != receipt.scope or event.run_id != receipt.run_id or \
                event.run_manifest_hash != receipt.manifest_hash or \
                event.order_id != permit.order_id or \
                event.instrument_version_id != receipt.instrument_version_id or \
                event.order_ordinal != receipt.order_ordinal or \
                event.quantity_kind != "contracts":
            raise FinanceError("linear replay source differs from held receipt")
        if event.kind == "fill":
            quantity = native_int(event.fill_quantity_units or "0", positive=True)
            modeled_fills += quantity
            price = Fraction(native_int(event.price_numerator or "0", positive=True),
                             native_int(event.price_denominator or "0", positive=True))
            notional = quantity * native_int(receipt.contract_size_units or "0",
                positive=True) * price
            modeled_notional += -(-notional.numerator // notional.denominator)
            effect = calculate_fill_effect(state, permit, event, instrument,
                                           margin_bps=margin_bps)
            if event.fee_units is not None:
                key = event.fee_asset_unit_id, event.fee_registry_hash
                if key[0] is None or key[1] is None:
                    raise FinanceError("linear replay fee has no asset registration")
                fees[key] = fees.get(key, 0) + native_int(event.fee_units,
                                                           nonnegative=True)
        elif event.kind == "funding":
            effect = calculate_funding_effect(state, event, instrument)
        else:
            continue
        for delta in effect.deltas:
            if delta.book == "wallet" and native_int(delta.units) < 0:
                key = delta.asset_unit_id, delta.registry_hash
                wallet_debits[key] = wallet_debits.get(key, 0) - native_int(delta.units)
        state = effect.new_state
    if modeled_fills > native_int(receipt.quantity_units, positive=True) or \
            receipt.action in {"perp_open", "perp_increase"} and \
            modeled_notional > native_int(receipt.risk_notional_units, positive=True):
        raise FinanceError("modeled linear fill exceeds admitted quantity or risk")
    if any(amount > budgets.get(key, 0) or amount > held.get(key, 0)
           for key, amount in fees.items()) or \
            any(amount > held.get(key, 0)
                for key, amount in wallet_debits.items()):
        raise FinanceError("modeled linear debit exceeds exact held capacity")
