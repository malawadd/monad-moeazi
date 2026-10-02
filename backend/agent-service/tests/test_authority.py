from moeazi_agent.authority import AuthorityInputs, effective_authority, normalize_authority


def test_legacy_insights_normalizes_to_shadow():
    assert normalize_authority("insights") == "shadow"


def test_runtime_authority_uses_the_lowest_ceiling():
    assert effective_authority(AuthorityInputs(
        deployment_ceiling="approval_required",
        user_mode="autopilot",
        policy_live_allowed=True,
        credits_available=True,
        system_healthy=True,
    )) == "approval_required"


def test_unhealthy_or_exhausted_runtime_falls_to_shadow():
    assert effective_authority(AuthorityInputs(
        deployment_ceiling="autopilot",
        user_mode="autopilot",
        policy_live_allowed=True,
        credits_available=False,
        system_healthy=True,
    )) == "shadow"
