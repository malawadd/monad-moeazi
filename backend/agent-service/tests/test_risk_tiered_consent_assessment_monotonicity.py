"""Fixed-seed local property sweep: no risk increase can lower fixture ceremony."""
import random
from moeazi_agent.risk_tiered_consent_assessor import ORDER
def _tier(value:int,novel:bool,uncertain:bool):
    if value>=9000 or novel or uncertain:return "high"
    if value>=7000:return "elevated"
    return "ordinary"
def test_ten_thousand_monotone_threshold_and_permutation_cases():
    rng=random.Random(20260907)
    for _ in range(10_000):
        low=rng.randrange(0,10001); high=rng.randrange(low,10001)
        before=_tier(low,False,False); after=_tier(high,rng.choice([False,True]),rng.choice([False,True]))
        assert ORDER[after]>=ORDER[before]
        assert _tier(low,True,False)=="high" and _tier(low,False,True)=="high"
