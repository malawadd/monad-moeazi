"""Checked-in Feature 36 corpus inventory; no caller supplied measurement data."""
from .promotion_canonical import digest
KINDS=("eligible","noninferior","reject","underpowered","uncertain","drift","boundary","missing-cost","demote","kill","rollback-block","corrected")
def scenarios(): return tuple({"id":f"promotion-{i:03d}","operation":"issue_promotion_decision","kind":KINDS[(i-1)%len(KINDS)]} for i in range(1,97))
def mutations(): return tuple(f"promotion-mutation-{i:03d}" for i in range(1,257))
def registry_hash(): return digest({"version":"promotion-local-v1","scenarios":scenarios(),"mutations":mutations()})
