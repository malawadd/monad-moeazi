"""Independent Q4 checkpoint reconstruction ancestry and source tests."""
from datetime import timedelta

import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)
from moeazi_agent.lifecycle_checkpoint_oracle import reconstruct_replay_account
from test_stage2_finance_contracts import NOW, snapshot
from test_stage2_observation_replay import instrument
from test_stage3_event_economics_oracle import sourced
from test_stage3_position_math_oracle import fill, order


def baseline(definition, request):
    original = snapshot()
    return AccountObservationSnapshotRef.model_validate(
        original.model_dump(mode="python") | {
            "scope": request.scope, "origin": "recorded_fixture",
            "rights_ref": "internal_qualification_only",
            "finality": "admitted_final",
            "event_at": NOW - timedelta(seconds=2),
            "finality_at": NOW, "available_at": NOW,
            "received_at": NOW, "cutoff_at": NOW,
            "observed_balances": (ObservedBalance(
                asset_unit_id=definition.quote_asset_unit_id,
                location_id=request.location_id, book="wallet",
                units="100000000000", registry_hash=definition.registry_hash),),
        })


def example():
    definition = instrument()
    request = order(definition, 1, "spot_buy", "buy", 10_000_000)
    source = sourced(fill(request, 1, 10_000_000, 25_000, 2_500_000))
    return definition, request, source


def reconstruct(opening, source, request, definition):
    return reconstruct_replay_account(opening, (source,), (request,),
                                      (definition,), {definition.instrument_version_id: 0})


def test_checkpoint_reconstructs_spot_from_opening_and_source_facts():
    definition, request, source = example()
    result = reconstruct(baseline(definition, request), source, request, definition)
    assert result.balances[(definition.base_asset_unit_id,
        definition.registry_hash, request.location_id, "wallet")] == 10_000_000
    assert result.balances[(definition.quote_asset_unit_id,
        definition.registry_hash, request.location_id, "wallet")] == 97_497_500_000
    assert result.economic_count == result.source_count == 1
    assert len({result.source_root, result.journal_root, result.position_root}) == 3


def test_checkpoint_cannot_bootstrap_from_another_simulation_checkpoint():
    definition, request, source = example()
    opening = baseline(definition, request)
    derivative = AccountObservationSnapshotRef.model_validate(
        opening.model_dump(mode="python") | {
            "origin": "simulation_derived",
            "rights_ref": "local_simulation_fixture_only"})
    with pytest.raises(FinanceError, match="baseline|opening|derived|provenance"):
        reconstruct(derivative, source, request, definition)


def test_checkpoint_cannot_replay_source_fact_before_opening_cutoff():
    definition, request, source = example()
    opening = baseline(definition, request)
    late_opening = AccountObservationSnapshotRef.model_validate(
        opening.model_dump(mode="python") | {
            "cutoff_at": source.simulation_cursor_at + timedelta(seconds=1)})
    with pytest.raises(FinanceError, match="baseline|opening|cutoff|chronology"):
        reconstruct(late_opening, source, request, definition)


def test_checkpoint_rejects_duplicate_source_economics_and_scope_spoof():
    definition, request, source = example()
    opening = baseline(definition, request)
    with pytest.raises(FinanceError, match="duplicate"):
        reconstruct_replay_account(opening, (source, source), (request,),
            (definition,), {definition.instrument_version_id: 0})
    changed_scope = opening.scope.model_copy(update={"scope_id": "foreign"})
    foreign = AccountObservationSnapshotRef.model_validate(
        opening.model_dump(mode="python") | {"scope": changed_scope})
    with pytest.raises(FinanceError, match="cross-account"):
        reconstruct(foreign, source, request, definition)
