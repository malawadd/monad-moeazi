"""Independent semantic checks for simulation-ceiling permit and event wires."""
import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.lifecycle_contracts import ExecutionPermit
from moeazi_agent.lifecycle_events import ExecutionEvent


H = "a" * 64
T = datetime(2026, 1, 1, tzinfo=timezone.utc)
SCOPE = FinanceScope(environment="experiment", scope_id="spec-a",
                     strategy_account_id="account-a")
CONTROLLER = ControllerRef(schemaVersion=1, environment="experiment",
    strategyAccountId="account-a", controllerKind="customer_team",
    controllerId="spec-a", controllerVersionId="version-a", contentHash=H)


def seal(model, domain, field, body):
    canonical = model.model_construct(**body).model_dump(mode="json",
                                                        exclude={field})
    digest = hashlib.sha256((domain + "\n" + json.dumps(canonical,
        sort_keys=True, separators=(",", ":"), ensure_ascii=False)).encode()).hexdigest()
    return model.model_validate({**body, field: digest})


def permit(**changes):
    body = dict(schema_version=1, scope=SCOPE, controller_ref=CONTROLLER,
        controller_mode="shadow", run_id="run-a", run_manifest_hash=H,
        intent_id="intent-a", intent_hash=H, order_id="order-a", order_ordinal=1,
        client_id="client-a", attempt_id="attempt-a", reservation_id="reserve-a",
        normalized_payload_hash=H, instrument_version_id="btc-spot-v1",
        instrument_registry_hash=H, action="spot_buy", side="buy",
        quantity_kind="asset_native", contract_size_unit_id=None,
        contract_size_units=None, quantity_asset_unit_id="BTC:8",
        quantity_registry_hash=H, quote_asset_unit_id="USDC:6",
        quote_registry_hash=H, settlement_asset_unit_id="USDC:6",
        settlement_registry_hash=H, quantity_units="10000000", location_id="wallet",
        account_revision=5, writer_epoch=2, authority_epoch=3, policy_hash=H,
        evidence_snapshot_hash=H, approval_receipt_hash=None,
        issued_at_cursor=T, valid_until_cursor=T + timedelta(minutes=1),
        transport="simulated")
    return seal(ExecutionPermit, "moeazi-execution-permit-v1",
                "permit_hash", body | changes)


def event(**changes):
    body = dict(schema_version=1, scope=SCOPE, run_id="run-a",
        run_manifest_hash=H, scenario_hash=H,
        simulation_model_version="fixture-v1", dataset_hash=H,
        instrument_version_id="btc-spot-v1", order_id="order-a", order_ordinal=1,
        client_id="client-a", attempt_id="attempt-a", permit_hash=H,
        source_stream="fixture-book", source_event_id="fill-1",
        source_revision="1", sequence=1, kind="fill",
        quantity_kind="asset_native", contract_size_unit_id=None,
        contract_size_units=None, event_at=T,
        available_at=T + timedelta(milliseconds=1),
        simulation_cursor_at=T + timedelta(milliseconds=2),
        fill_quantity_units="10000000", cumulative_filled_units="10000000",
        price_numerator="2500000000", price_denominator="10000000",
        fee_asset_unit_id="USDC:6", fee_registry_hash=H,
        fee_units="2500000", funding_asset_unit_id=None,
        funding_registry_hash=None, funding_units=None,
        protection_order_id=None, observation_hash=H, source_payload_hash=H)
    body.update(changes)
    body["observation_source_kind"] = changes.get("observation_source_kind",
        "synthetic_fault" if body["kind"] == "fill" else None)
    return seal(ExecutionEvent, "moeazi-execution-event-v1",
                "event_hash", body)


def test_valid_experiment_permit_and_fill_have_stable_hashes():
    first = permit()
    assert first.permit_hash == permit().permit_hash
    assert first.transport == "simulated" and first.scope.environment == "experiment"
    fill = event()
    assert fill.event_hash == event().event_hash
    assert fill.fill_quantity_units == "10000000"


@pytest.mark.parametrize("changed", [
    {"scope": FinanceScope(environment="live", scope_id="live",
                           strategy_account_id="account-a")},
    {"controller_mode": "approval_required", "approval_receipt_hash": None},
    {"valid_until_cursor": T},
    {"transport": "native"},
    {"quantity_units": "010000000"},
    {"action": "spot_buy", "side": "sell"},
    {"action": "spot_buy", "quantity_kind": "contracts",
     "contract_size_unit_id": "BTC:8", "contract_size_units": "1000000"},
])
def test_permit_refuses_conflicting_or_excess_authority(changed):
    with pytest.raises(ValueError):
        permit(**changed)


def test_approval_permit_requires_receipt_and_retains_its_exact_identity():
    approved = permit(controller_mode="approval_required", approval_receipt_hash="b" * 64)
    assert approved.approval_receipt_hash == "b" * 64
    assert approved.permit_hash != permit().permit_hash
    with pytest.raises(ValueError):
        ExecutionPermit.model_validate(approved.model_dump() |
            {"approval_receipt_hash": "c" * 64})


@pytest.mark.parametrize("changed", [
    {"scope": FinanceScope(environment="live", scope_id="live",
                           strategy_account_id="account-a")},
    {"event_at": T + timedelta(seconds=1)},
    {"fill_quantity_units": "0"},
    {"fee_registry_hash": None},
    {"kind": "funding", "funding_asset_unit_id": None},
    {"quantity_kind": "asset_native", "contract_size_unit_id": "BTC:8",
     "contract_size_units": "1000000"},
])
def test_event_refuses_unbound_time_amount_or_unit(changed):
    with pytest.raises(ValueError):
        event(**changed)


def test_old_event_hash_cannot_be_reused_with_changed_economics():
    original = event()
    with pytest.raises(ValueError):
        ExecutionEvent.model_validate(original.model_dump() |
            {"fill_quantity_units": "20000000"})
    with pytest.raises(ValueError):
        ExecutionEvent.model_validate(original.model_dump() |
            {"observation_source_kind": "recorded_native"})
