from moeazi_agent.mandate_policy_diff import semantic_diff
def test_every_registry_shape_has_directed_or_unknown_reason():
    before={"allowedMarkets":("BTC-PERP",),"maxOrderUsd":2,"minConfidence":2,"requireStopLoss":True,"cadence":"daily","effectiveAt":2,"expiresAt":2}
    after={"allowedMarkets":("BTC-PERP","ETH-PERP"),"maxOrderUsd":1,"minConfidence":1,"requireStopLoss":False,"cadence":"hourly","effectiveAt":1,"expiresAt":3}
    assert semantic_diff(before,after)["aggregate"]=="mixed"
    assert semantic_diff({"future":1},{"future":2})["aggregate"]=="unknown"
