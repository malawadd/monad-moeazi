"""Independent Q3 input-boundary tests; no financial writer or external service."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import (
    FinanceScope, ReserveCommand, ReservationComponent, JournalPosting,
    JournalCommand, native_int, semantic_request_hash, source_event_digest,
)
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)


NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
HASH = "a" * 64
LIVE = FinanceScope(environment="live", scope_id="live", strategy_account_id="acct-a")
EXPERIMENT = FinanceScope(environment="experiment", scope_id="run-a",
                          strategy_account_id="acct-a")


def controller(account="acct-a", environment="live"):
    return ControllerRef(schemaVersion=1, environment=environment,
        strategyAccountId=account, controllerKind="customer_team",
        controllerId="deployment-a", controllerVersionId="team-version-a",
        contentHash=HASH)


def reserve(**changes):
    fields = dict(scope=LIVE, controller_ref=controller(),
        controller_mode="approval_required", expected_revision=4, writer_epoch=2,
        authority_epoch=3, authority_fingerprint=HASH,
        idempotency_key="intent-a", request_hash=HASH,
        intent_id="intent-a", purpose="trade", policy_version="policy-a",
        policy_hash=HASH,
        snapshot_hash=HASH, calculation_receipt_hash=HASH,
        components=(ReservationComponent(capacity_key="USDC:wallet",
            asset_unit_id="USDC:6", registry_hash=HASH,
            location_id="wallet-a", units="70000000"),),
        expires_at=NOW + timedelta(minutes=5))
    fields.update(changes)
    provisional = ReserveCommand.model_construct(**fields)
    fields["request_hash"] = semantic_request_hash("reserve", provisional)
    return ReserveCommand(**fields)


def snapshot(**changes):
    fields = dict(scope=LIVE, snapshot_hash=HASH, source_account_id="native-acct-a",
        origin="native_verified", status="accepted", event_at=NOW - timedelta(seconds=2),
        available_at=NOW, received_at=NOW, cutoff_at=NOW,
        finality_at=NOW, finality="confirmed", has_gap=False, has_reorg=False,
        balances_complete=True, positions_complete=True,
        rights_ref="account-observation-authority", source_event_hash=HASH,
        source_payload_hash=HASH, registry_hash=HASH, policy_version="policy-a",
        observed_balances=(ObservedBalance(asset_unit_id="USDC:6", location_id="wallet-a",
            book="wallet", units="100000000", registry_hash=HASH),),
        observed_positions=())
    return AccountObservationSnapshotRef(**(fields | changes))


@pytest.mark.parametrize("bad", ["1.0", "1e6", "+1", "01", "-0", "--1", "", 1, 1.5])
def test_native_amount_requires_bounded_canonical_integer_string(bad):
    with pytest.raises(ValueError):
        native_int(bad)
    assert native_int("100000000") == 100_000_000
    assert native_int("-1200000000000000") == -1_200_000_000_000_000


def test_finance_scope_and_controller_must_match_account_and_environment():
    with pytest.raises(ValidationError):
        FinanceScope(environment="live", scope_id="run-a", strategy_account_id="acct-a")
    with pytest.raises(ValidationError):
        FinanceScope(environment="experiment", scope_id="live", strategy_account_id="acct-a")
    with pytest.raises(ValidationError):
        reserve(controller_ref=controller(account="acct-b"))
    with pytest.raises(ValidationError):
        reserve(scope=EXPERIMENT)
    with pytest.raises(ValidationError):
        reserve(scope=EXPERIMENT, controller_ref=controller(environment="experiment"),
                controller_mode="autopilot")


def test_reservation_preserves_full_controller_identity_on_roundtrip():
    command = reserve()
    parsed = ReserveCommand.model_validate_json(command.model_dump_json())
    assert parsed == command
    assert parsed.scope.strategy_account_id == parsed.controller_ref.strategyAccountId
    assert parsed.controller_mode == "approval_required"
    assert parsed.components[0].units == "70000000"


@pytest.mark.parametrize("value", ["0", "-1", "1.5", 1.5])
def test_reservation_component_requires_positive_exact_units(value):
    with pytest.raises(ValidationError):
        reserve(components=(ReservationComponent(capacity_key="USDC:wallet",
            asset_unit_id="USDC:6", registry_hash=HASH,
            location_id="wallet-a", units=value),))


def test_finance_snapshot_rejects_synthetic_live_and_lookahead():
    with pytest.raises(ValidationError):
        snapshot(origin="recorded_fixture")
    with pytest.raises(ValidationError):
        snapshot(available_at=NOW + timedelta(milliseconds=1))
    with pytest.raises(ValidationError):
        snapshot(event_at=NOW + timedelta(milliseconds=1))
    with pytest.raises(ValidationError):
        snapshot(cutoff_at=datetime(2026, 9, 30, 12))
    admitted = snapshot()
    assert AccountObservationSnapshotRef.model_validate_json(
        admitted.model_dump_json()) == admitted


def test_finance_snapshot_rejects_duplicate_balance_identity():
    row = snapshot().observed_balances[0]
    with pytest.raises(ValidationError):
        snapshot(observed_balances=(row, row))


def test_journal_preserves_exact_postings_and_rejects_zero_leg():
    postings = (JournalPosting(asset_unit_id="USDC:6", registry_hash=HASH,
        location_id="wallet-a",
        book="wallet", units="-250000000"),
        JournalPosting(asset_unit_id="USDC:6", registry_hash=HASH,
            location_id="counterparty",
            book="external", units="250000000"))
    fields = dict(scope=LIVE, expected_revision=1, writer_epoch=2,
        idempotency_key="fill-a", request_hash=HASH, source_owner="venue-a",
        source_stream="fills", source_event_id="fill-a", source_revision="1",
        source_event_hash=HASH, source_payload_hash=HASH, kind="fill",
        observed_at=NOW, postings=postings)
    fields["source_event_hash"] = source_event_digest(JournalCommand.model_construct(**fields))
    fields["request_hash"] = semantic_request_hash("journal", JournalCommand.model_construct(**fields))
    command = JournalCommand(**fields)
    assert JournalCommand.model_validate_json(command.model_dump_json()) == command
    with pytest.raises(ValidationError):
        JournalCommand.model_validate(command.model_dump() | {
            "postings": [{**postings[0].model_dump(), "units": "-250000000"},
                         {**postings[1].model_dump(), "units": "0"}]})
