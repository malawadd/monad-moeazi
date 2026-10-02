import pytest

from moeazi_agent.credits import billable_credits, estimated_credits
from moeazi_agent.roles import assignments_for_tier, required_synthesis_steps


def test_tier_call_topology():
    focus = assignments_for_tier("focus")
    pro = assignments_for_tier("pro")
    maximum = assignments_for_tier("max")
    assert len(focus) == 6
    assert len(pro) == 16
    assert len(maximum) == 30
    assert {item.provider for item in focus} == {"openai", "deepseek"}
    assert required_synthesis_steps("max")[-1] == "arbiter"


def test_credits_reserve_more_than_partial_success_settlement():
    reservation = estimated_credits("pro")
    settlement = billable_credits(successful_specialists=12, successful_syntheses=1)
    assert reservation > settlement
    assert settlement == 43


def test_unknown_tier_is_rejected():
    with pytest.raises(ValueError):
        assignments_for_tier("ultra")
