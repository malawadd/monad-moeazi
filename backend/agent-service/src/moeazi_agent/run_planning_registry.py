"""Versioned local-only tier/rate fixtures; never consult product routing."""
from .run_planning_canonical import digest
TIERS={"focus":6,"pro":16,"max":32}
def obligations(tier):
 count=TIERS.get(tier)
 if not count: raise ValueError("run_planning_tier")
 return tuple({"ordinal":i,"role":f"specialist-{i:02d}","stage":"analysis" if i<count-2 else "synthesis","family":f"family-{i%4}","critical":i<2} for i in range(1,count+1))
def routes(tier):
 return tuple({"ordinal":item["ordinal"],"route":"fixture-route-%02d"%item["ordinal"],"provider":"fixture","model":"local","inputTokens":100,"outputTokens":50,"credits":1,"costMicrousd":100} for item in obligations(tier))
def policy(): return {"version":"run-planning-v1","materialityBps":25,"maximumAgeSeconds":3600,"tiers":TIERS}
def registry_hash(): return digest({"policy":policy(),"routes":{tier:routes(tier) for tier in TIERS}})
def mutations(): return tuple(f"run-planning-mutation-{i:03d}" for i in range(1,257))
def scenarios():
 kinds=("duplicate","quiet","material","correction","stale","unknown","gap","backstop","risk","budget","conflict","storm")
 return tuple({"id":f"run-planning-{i:03d}","operation":"plan_fixture","kind":kind,"tier":("focus","pro","max")[i%3]} for i,kind in enumerate(kinds,1))
