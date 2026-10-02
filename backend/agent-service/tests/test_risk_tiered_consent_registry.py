from moeazi_agent.risk_tiered_consent_registry import field_directions,source_ids,tier_cap
def test_registry_has_closed_sources_fields_and_decreasing_lifetimes():
    assert len(source_ids())==9 and set(field_directions())
    assert tier_cap("ordinary")>tier_cap("elevated")>tier_cap("high")
