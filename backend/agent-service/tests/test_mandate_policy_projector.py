from moeazi_agent.mandate_policy_projection import project
def test_projection_is_advisory_and_never_a_mandate():
    result=project("weekend news event cap")
    assert result["advisoryOnly"] is True and result["clauses"][0]["status"]=="unsupported"
    assert not ({"mandate","policy","consent","activation"}&set(result))
