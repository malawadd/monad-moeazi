"""Curated semantic mutations mutate only copied fixture state."""
from __future__ import annotations
from copy import deepcopy
from .safety_assurance_canonical import digest
def apply(case,mutation):
 value=deepcopy(case); before=digest(value); fixture=value.setdefault("fixture",{})
 field=mutation["field"]
 fixture[field]=mutation["value"]
 try: after=digest(value)
 except ValueError: after=digest({"case":case["id"],"field":field,"rejected":True})
 if before==after: raise ValueError("assurance_mutation_no_semantic_change")
 return value,after
