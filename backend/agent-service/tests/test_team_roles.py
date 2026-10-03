import pytest

from moeazi_agent.roles import ROLES, assignments_for_configuration


def selections(enabled=6):
    return [{"id": role.name, "enabled": index < enabled,
        "horizon": role.horizon, "instructions": "Inspect conflicting liquidity evidence."}
        for index, role in enumerate(ROLES)]


def test_saved_focus_uses_selected_roles_horizons_and_instructions():
    config = selections()
    config[1]["horizon"] = "hours"
    result = assignments_for_configuration("focus", config)
    assert len(result) == 6
    assert result[1].role.name == "liquidity"
    assert result[1].role.horizon == "hours"
    assert result[1].instructions == "Inspect conflicting liquidity evidence."


def test_saved_tier_cannot_drop_required_role():
    config = selections()
    config[1]["enabled"] = False
    config[6]["enabled"] = True
    with pytest.raises(ValueError, match="critical"):
        assignments_for_configuration("focus", config)


def test_saved_tier_rejects_duplicate_identity():
    config = selections()
    config[-1]["id"] = "liquidity"
    with pytest.raises(ValueError, match="identities"):
        assignments_for_configuration("focus", config)
