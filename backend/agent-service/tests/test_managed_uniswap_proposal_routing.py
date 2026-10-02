from moeazi_agent.contracts import MarketSynthesis
from moeazi_agent.proposal_routing import proposal_from_synthesis


def _synthesis(score: float, market: str = "WETH-USDC"):
    return MarketSynthesis.model_construct(
        analysis_id="analysis-one", market=market, consensus=score,
        confidence=0.9,
    )


def test_managed_uniswap_spot_abstains_from_short_and_unknown_pair():
    policy = {"allowedVenues": ["uniswap"], "maxOrderUsd": 10, "maxLeverage": 20}
    assert proposal_from_synthesis(_synthesis(-0.8), [], "account-a", policy) is None
    assert proposal_from_synthesis(_synthesis(0.8, "BTC-PERP"), [], "account-a", policy) is None


def test_managed_uniswap_buy_has_no_leverage_and_explicit_pair():
    policy = {"allowedVenues": ["uniswap"], "maxOrderUsd": 10, "maxLeverage": 20}
    proposal = proposal_from_synthesis(_synthesis(0.8),
        [{"evidence": [{"id": "source-one"}]}], "account-a", policy)
    assert proposal is not None
    assert proposal.side == "long"
    assert proposal.leverage == 1
    assert proposal.candidate_venues == ["uniswap"]
    assert proposal.evidence_ids == ["source-one"]


def test_funded_half_usdc_mandate_caps_the_proposal_before_finance():
    policy = {"allowedVenues": ["uniswap"], "maxOrderUsd": 1, "maxLeverage": 1}
    proposal = proposal_from_synthesis(_synthesis(0.8),
        [{"evidence": [{"id": "source-one"}]}], "account-a", policy, "500000")
    assert proposal is not None
    assert proposal.size_usd == 0.5
    assert proposal_from_synthesis(_synthesis(0.8), [], "account-a",
        policy, "0") is None
