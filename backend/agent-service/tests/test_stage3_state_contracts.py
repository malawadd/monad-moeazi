"""Independent state contradictions; DTO validity is not durable lifecycle proof."""
from datetime import datetime, timezone

import pytest

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.lifecycle_state import (
    EntryAuthorityReceipt, PositionProtectionState, ReconciliationResult,
    RunAdvanceResult,
)
from test_stage3_lifecycle_contracts import CONTROLLER, H, SCOPE


def controller_for(spec_id, account="account-a"):
    return ControllerRef.model_validate(CONTROLLER.model_dump() | {
        "controllerId": spec_id, "strategyAccountId": account})


def position(**changes):
    body = dict(schema_version=1, scope=SCOPE, run_id="run-a",
        instrument_version_id="spot-v1", originating_controller_ref=CONTROLLER,
        management_controller_ref=CONTROLLER, quantity_kind="asset_native",
        signed_exposure_units="10000000", attributed_filled_units="10000000",
        cost_basis_numerator="2500000000", cost_basis_denominator="1",
        collateral_asset_unit_id=None, collateral_units="0",
        intended_protection_hash=H, requested_protection_order_id=None,
        confirmed_protection_event_hash=None,
        rejected_protection_event_hash=None,
        reconciliation_state="awaiting_events", pending_obligations=True,
        reason="filled exposure needs protection", revision=1)
    return PositionProtectionState.model_validate(body | changes)


def receipt(**changes):
    body = dict(schema_version=1, scope=SCOPE, run_id="run-a",
        controller_ref=CONTROLLER, controller_mode="shadow",
        created_by_subject="alice", experiment_request_hash=H,
        authority_fingerprint=H,
        checked_at=datetime(2026, 9, 30, tzinfo=timezone.utc))
    return EntryAuthorityReceipt.model_validate(body | changes)


def reconciliation(**changes):
    body = dict(schema_version=1, scope=SCOPE, run_id="run-a",
        order_id="order-a", source_event_hashes=(H,),
        cumulative_filled_units="10000000", outstanding_units="10000000",
        terminal_event_hash=None, protection_event_hash=None,
        journal_transaction_ids=("journal-a",), account_snapshot_hash=H,
        retained_capacity_units="2500000000", exposure_uncertain=True,
        unsupported_mechanics=(), state="awaiting_evidence",
        reason="unfilled remainder unresolved")
    return ReconciliationResult.model_validate(body | changes)


def advance(**changes):
    body = dict(schema_version=1, run_id="run-a", status="awaiting_protection",
        cursor_sequence=2, pending_obligations=True, next_action="await_signal",
        projection_revision=3, next_wake_delay_ms=1000)
    return RunAdvanceResult.model_validate(body | changes)


def test_partial_position_stays_obligated_without_confirmed_protection():
    assert position().signed_exposure_units == "10000000"
    with pytest.raises(ValueError):
        position(pending_obligations=False)
    with pytest.raises(ValueError):
        position(confirmed_protection_event_hash=H,
                 rejected_protection_event_hash=H,
                 requested_protection_order_id="protect-a")
    with pytest.raises(ValueError):
        position(confirmed_protection_event_hash=H)


@pytest.mark.parametrize("changed", [
    {"scope": FinanceScope(environment="live", scope_id="live",
                           strategy_account_id="account-a")},
    {"management_controller_ref": controller_for("spec-b")},
    {"originating_controller_ref": controller_for("spec-b")},
    {"management_controller_ref": controller_for("spec-a", "account-b")},
])
def test_position_cannot_cross_experiment_or_account(changed):
    with pytest.raises(ValueError):
        position(**changed)


@pytest.mark.parametrize("changed", [
    {"scope": FinanceScope(environment="live", scope_id="live",
                           strategy_account_id="account-a")},
    {"controller_ref": controller_for("spec-b")},
    {"controller_ref": controller_for("spec-a", "account-b")},
])
def test_entry_receipt_cannot_claim_foreign_or_live_identity(changed):
    with pytest.raises(ValueError):
        receipt(**changed)


def test_uncertain_or_unsupported_reconciliation_is_never_clean():
    assert reconciliation().state == "awaiting_evidence"
    with pytest.raises(ValueError):
        reconciliation(state="clean", reason=None)
    with pytest.raises(ValueError):
        reconciliation(exposure_uncertain=False, state="clean",
                       unsupported_mechanics=("inverse_perp",), reason=None)
    with pytest.raises(ValueError):
        reconciliation(reason=None)


def test_run_only_completes_flat_without_obligations_or_wake_timer():
    assert advance().next_action == "await_signal"
    with pytest.raises(ValueError):
        advance(next_action="completed")
    with pytest.raises(ValueError):
        advance(status="completed_flat", next_action="completed",
                pending_obligations=True, next_wake_delay_ms=None)
    terminal = advance(status="completed_flat", next_action="completed",
                       pending_obligations=False, next_wake_delay_ms=None)
    assert terminal.status == "completed_flat"
