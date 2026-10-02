"""Independent no-lookahead oracle for frozen, nonauthorizing replay decisions."""
from datetime import timedelta

import pytest

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_strategy import evaluate_replay_strategy
from moeazi_agent.observation_contracts import canonical_hash
from moeazi_agent.observation_replay import replay_observations
from test_stage2_observation_replay import NOW
from test_stage3_run_contracts import manifest, scenario
from test_stage3_strategy_signal_boundary import admitted, signal_case


def decision_case():
    first = admitted("decision-first", event_at=NOW - timedelta(seconds=2),
                     available_at=NOW, received_at=NOW)
    late = admitted("decision-late", event_at=NOW - timedelta(milliseconds=500),
                    available_at=NOW + timedelta(seconds=1),
                    received_at=NOW + timedelta(seconds=1))
    rows = (first, late)
    definition, initial, rule, _ = signal_case(rows, evidence_rows=(first,))
    frozen = scenario(dataset_hash=simulation_dataset_hash(rows),
        evidence_cutoff_at=NOW, simulation_cursor_at=NOW,
        simulation_end_at=NOW + timedelta(seconds=2),
        fee_rules=(), funding_rules=(), outcome_rules=())
    run = manifest(strategy_artifact_hash=rule.rule_hash,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=initial.snapshot_hash, scenario=frozen)
    later = replay_observations((definition,), rows, NOW + timedelta(seconds=1), 5_000)
    return run, definition, rows, initial, later, rule


def test_late_book_stays_in_frozen_corpus_but_cannot_influence_initial_decision():
    run, definition, rows, initial, later, rule = decision_case()
    assert len(initial.accepted_observation_hashes) == 1
    assert len(later.accepted_observation_hashes) == 2
    context, selected = build_replay_decision(run, rows, NOW, initial,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=run.account_snapshot_hash)
    assert selected == rows[0]
    assert context.dataset_prefix_count == 1
    assert context.evidence_snapshot_hash == initial.snapshot_hash
    assert evaluate_replay_strategy(run, definition, rows, initial, rule,
                                   context).observation_hash == canonical_hash(
                                       rows[0].model_dump(mode="json"))

    later_context, later_selected = build_replay_decision(run, rows,
        NOW + timedelta(seconds=1), later,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=run.account_snapshot_hash)
    assert later_selected == rows[1]
    assert later_context.dataset_prefix_count == 2
    assert later_context.decision_hash != context.decision_hash
    assert evaluate_replay_strategy(run, definition, rows, later, rule,
                                   later_context).observation_hash == canonical_hash(
                                       rows[1].model_dump(mode="json"))


def test_late_decision_requires_fresh_evidence_for_newest_available_book():
    run, definition, rows, initial, later, rule = decision_case()
    incomplete_later = replay_observations((definition,), (rows[0],),
        NOW + timedelta(seconds=1), 5_000)
    with pytest.raises(FinanceError, match="outside accepted evidence"):
        build_replay_decision(run, rows, NOW + timedelta(seconds=1), incomplete_later,
            instrument_version_id=definition.instrument_version_id,
            account_snapshot_hash=run.account_snapshot_hash)
    context, _ = build_replay_decision(run, rows, NOW + timedelta(seconds=1), later,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=run.account_snapshot_hash)
    with pytest.raises(FinanceError, match="decision context differs"):
        evaluate_replay_strategy(run, definition, rows, later, rule,
            context.model_copy(update={"dataset_prefix_count": 1}))
    with pytest.raises(FinanceError):
        build_replay_decision(run, rows, NOW + timedelta(seconds=3), later,
            instrument_version_id=definition.instrument_version_id,
            account_snapshot_hash=run.account_snapshot_hash)
