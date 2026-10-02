"""Independent consistency checks for the bounded local graph."""
from __future__ import annotations
from .safety_assurance_canonical import digest
def verify(graph):
 cases=graph["cases"]; mutations=graph["mutations"]
 if not 1<=len(cases)<=40 or len(mutations)!=96 or len({x["id"] for x in cases})!=len(cases): raise ValueError("assurance_graph_cardinality")
 critical=[x for x in mutations if x["critical"] and x["disposition"]=="non_equivalent"]
 if any(not x["killed"] for x in critical): raise ValueError("assurance_critical_survivor")
 if graph["killRateBps"]<8500 or graph["unmappedCount"] or graph["staleCount"]: raise ValueError("assurance_coverage_blocked")
 expected=digest({"registry":graph["registryHash"],"source":graph["sourceRoot"],"cases":[x["resultHash"] for x in cases],"mutations":[x["resultHash"] for x in mutations],"verdict":graph["verdict"].verdict_hash})
 if expected!=graph["rootHash"]: raise ValueError("assurance_root_invalid")
 return graph
