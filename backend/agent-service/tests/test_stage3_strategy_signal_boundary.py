"""Replay strategy emits evidence-bound research drafts, never permits."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_strategy import (
    ReplayStrategyDraft, ReplayStrategyRule, evaluate_replay_strategy,
)
from moeazi_agent.observation_replay import replay_observations
from test_stage2_observation_replay import NOW, book, instrument
from test_stage3_lifecycle_contracts import seal
from test_stage3_run_contracts import manifest, scenario


def admitted(event_id="signal-a", **changes):
    return book(event_id=event_id, source_kind="documented_example",
        source_rights_ref="documentation_example_only", **changes)


def signal_case(rows, evidence_rows=None, definition=None):
    definition = definition or instrument()
    evidence = replay_observations((definition,), evidence_rows or rows, NOW, 5_000)
    frozen = scenario(dataset_hash=simulation_dataset_hash(tuple(rows)),
        simulation_cursor_at=NOW, simulation_end_at=NOW + timedelta(seconds=2),
        evidence_cutoff_at=NOW, fee_rules=(), funding_rules=(), outcome_rules=())
    rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1", "rule_hash",
        dict(schema_version=1, instrument_version_id=definition.instrument_version_id,
             action="spot_buy", side="buy", trigger="ask_lte",
             threshold_price_quote_per_base="25001", desired_quantity_units="10000000",
             horizon_seconds=30, rationale_summary="Recorded ask is inside limit"))
    run = manifest(strategy_artifact_hash=rule.rule_hash,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash, scenario=frozen)
    return definition, evidence, rule, run


def test_accepted_precutoff_book_yields_nonauthorizing_deterministic_draft():
    rows = (admitted(),)
    definition, evidence, rule, run = signal_case(rows)
    assert evidence.accepted_observation_hashes and not evidence.has_gap
    first = evaluate_replay_strategy(run, definition, rows, evidence, rule)
    second = evaluate_replay_strategy(run, definition, rows, evidence, rule)
    assert first == second
    assert first.non_authorizing is True and first.action == "spot_buy"
    assert first.desired_quantity_units == "10000000"
    assert first.evidence_snapshot_hash == evidence.snapshot_hash
    assert "permit_hash" not in ReplayStrategyDraft.model_fields
    assert "reservation_id" not in ReplayStrategyDraft.model_fields


def test_selected_newer_book_absent_from_accepted_evidence_is_rejected():
    first, selected = admitted("signal-a"), admitted("signal-b",
        event_at=NOW - timedelta(seconds=1))
    rows = (first, selected)
    definition, evidence, rule, run = signal_case(rows, evidence_rows=(first,))
    assert len(evidence.accepted_observation_hashes) == 1
    with pytest.raises(ValueError, match="outside accepted"):
        evaluate_replay_strategy(run, definition, rows, evidence, rule)


@pytest.mark.parametrize("change", [
    {"instrument_version_id": "foreign-instrument"},
    {"source_id": "foreign-venue"},
])
def test_changed_source_or_instrument_cannot_reuse_prior_evidence(change):
    original = admitted()
    definition, evidence, rule, run = signal_case((original,))
    forged = original.model_copy(update=change)
    revised = scenario(dataset_hash=simulation_dataset_hash((forged,)),
        simulation_cursor_at=NOW, simulation_end_at=NOW + timedelta(seconds=2),
        evidence_cutoff_at=NOW, fee_rules=(), funding_rules=(), outcome_rules=())
    forged_run = manifest(strategy_artifact_hash=rule.rule_hash,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash, scenario=revised)
    with pytest.raises(ValueError):
        evaluate_replay_strategy(forged_run, definition, (forged,), evidence, rule)


@pytest.mark.parametrize("field,value", [("schema_version", True),
                                          ("non_authorizing", 1)])
def test_draft_rejects_scalar_coercion_even_with_recomputed_hash(field, value):
    rows = (admitted(),)
    definition, evidence, rule, run = signal_case(rows)
    draft = evaluate_replay_strategy(run, definition, rows, evidence, rule)
    with pytest.raises(ValueError):
        seal(ReplayStrategyDraft, "moeazi-replay-strategy-draft-v1", "draft_hash",
             draft.model_dump(mode="python", exclude={"draft_hash"}) | {field: value})
