"""Checked-in corpus inventory; callers cannot submit analytical paths."""
from .analytical_diversity_canonical import digest
KINDS=("supported","sparse","lineage","duplicate","common_wrong","simpson","failure","noise")
def scenarios(): return tuple({"id":f"analytical-diversity-{n:03d}","operation":"issue_diversity_report","family":KINDS[(n-1)%len(KINDS)]} for n in range(1,97))
def mutations(): return tuple(f"analytical-diversity-mutation-{n:03d}" for n in range(1,257))
def registry_hash(): return digest({"version":"analytical-diversity-local-v1","scenarios":scenarios(),"mutations":mutations()})
