from datetime import datetime, timezone

import pytest

from moeazi_agent.asset_journal_registry import raw
from moeazi_agent.asset_journal_scenarios import evaluate_fixture, scenario_registry

NOW = datetime(2026, 8, 14, tzinfo=timezone.utc)


def test_frozen_corpus_closes_per_exact_unit_without_authority():
    assert raw()["prohibited"]["externalNetwork"] is True and raw()["prohibited"]["redisJournal"] is True
    outcomes = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64) for item in scenario_registry()]
    assert len(outcomes) >= 40 and all(item["invariantVerdict"] == "pass" for item in outcomes)
    assert all(item["productOutcome"] == "unavailable" for item in outcomes)


def test_exact_amount_rejects_float_scientific_zero_and_overflow():
    from moeazi_agent.asset_journal_canonical import exact_amount
    for value in ("0", "01", "1e2", "1.0", "-1", str(2**256)):
        with pytest.raises(ValueError): exact_amount(value)
