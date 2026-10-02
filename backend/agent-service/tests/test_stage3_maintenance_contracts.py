"""Maintenance authority binds one close command to exact unresolved exposure."""
import pytest

from moeazi_agent.lifecycle_maintenance_contracts import (
    MaintenanceObligationRef, MaintenanceReductionReceipt, maintenance_order_id,
)
from test_stage3_lifecycle_contracts import CONTROLLER, H, SCOPE, permit, seal


def receipt(**changes):
    command_id = changes.get("command_id", "close-1")
    command_hash = changes.get("command_hash", H)
    body = dict(schema_version=1, scope=SCOPE, controller_ref=CONTROLLER,
        run_id="run-a", manifest_hash=H, command_id=command_id,
        command_hash=command_hash,
        maintenance_order_id=maintenance_order_id(SCOPE, "run-a", command_id,
                                                  command_hash),
        order_ordinal=2,
        instrument_version_id="btc-spot-v1", location_id="wallet",
        anchor_protection_order_id="protect-a",
        obligations=({"protection_order_id": "protect-a", "intended_hash": H,
                      "originating_event_hash": H},
                     {"protection_order_id": "protect-b", "intended_hash": H,
                      "originating_event_hash": H}),
        account_snapshot_hash=H, account_revision=8, authority_epoch=3,
        position_state_hash=H,
        position_revision=4, signed_exposure_units="10000000",
        reduction_action="spot_sell", side="sell", quantity_units="5000000",
        decision_hash=H, sizing_receipt_hash=H, reservation_id="reserve-1",
        intent_id="intent-1", intent_hash=H, execution_envelope_hash=H)
    body.update(changes)
    body["obligations"] = tuple(MaintenanceObligationRef.model_validate(row)
                                for row in body["obligations"])
    return seal(MaintenanceReductionReceipt,
                "moeazi-maintenance-reduction-v1", "receipt_hash",
                body)


def test_exact_close_command_derives_distinct_retry_order_id():
    first = receipt()
    second = receipt(command_id="close-2")
    assert first.maintenance_order_id != second.maintenance_order_id
    assert first.anchor_protection_order_id == second.anchor_protection_order_id
    assert first.quantity_units == "5000000"


@pytest.mark.parametrize("change", [
    {"maintenance_order_id": H},
    {"signed_exposure_units": "-10000000"},
    {"quantity_units": "10000001"},
    {"obligations": ({"protection_order_id": "protect-b", "intended_hash": H,
                      "originating_event_hash": H},
                     {"protection_order_id": "protect-a", "intended_hash": H,
                      "originating_event_hash": H})},
])
def test_ambiguous_or_increasing_maintenance_receipt_rejected(change):
    with pytest.raises(ValueError):
        receipt(**change)


def test_changed_content_cannot_reuse_receipt_hash():
    original = receipt()
    with pytest.raises(ValueError):
        MaintenanceReductionReceipt.model_validate({
            **original.model_dump(mode="json"), "quantity_units": "1000000"})


def test_typed_maintenance_hash_alone_cannot_authorize_an_order():
    with pytest.raises(ValueError):
        permit(maintenance_receipt_hash=H)
