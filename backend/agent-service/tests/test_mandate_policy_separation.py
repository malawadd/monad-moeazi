from pathlib import Path
ROOT=Path(__file__).parents[2]
def test_feature16_17_19_and_product_paths_cannot_supply_fixture_consent():
    source=(ROOT/"agent-service/src/moeazi_agent/mandate_policy_evaluator.py").read_text()
    assert "safety_change" not in source and "qualification" not in source and "effective_authority" not in source
    assert "mandate_policy" not in (ROOT/"convex/helpers/agentPolicy.ts").read_text()
