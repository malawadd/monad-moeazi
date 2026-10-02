from moeazi_agent.policy_draft import draft_from_text


def test_natural_language_produces_typed_diff_without_activation():
    policy, diff = draft_from_text(
        "Trade BTC and ETH only on Hyperliquid and GMX. Maximum order $500, leverage 3x, slippage 40 bps."
    )
    assert policy["allowedMarkets"] == ["BTC-PERP", "ETH-PERP"]
    assert policy["allowedVenues"] == ["gmx", "hyperliquid"]
    assert policy["maxOrderUsd"] == 500
    assert policy["maxLeverage"] == 3
    assert any(item["field"] == "maxOrderUsd" for item in diff)
