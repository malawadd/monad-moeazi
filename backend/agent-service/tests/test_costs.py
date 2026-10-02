from moeazi_agent.costs import Usage, deepseek_cost, tier_estimate


def test_focus_estimate_is_bounded_and_upfront():
    estimate = tier_estimate("focus")

    assert estimate["totalCalls"] == 7
    assert estimate["estimatedTotalTokens"] == 23_900
    assert estimate["estimatedCostUsd"] == 0.005843
    assert estimate["maximumCostUsd"] == 0.009234


def test_deepseek_cost_applies_cache_hit_discount():
    cost = deepseek_cost(
        "deepseek-v4-flash",
        Usage(input_tokens=1_000_000, cached_input_tokens=500_000, output_tokens=100_000),
    )

    assert cost == 0.0994
