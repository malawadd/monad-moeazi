"""Exact subject and sorted leaf lineage contracts for local fixtures."""
from __future__ import annotations
from typing import Literal
from pydantic import Field, model_validator
from .usage_rights_scope_contracts import Frozen, UsageRightsScope
from .usage_rights_canonical import digest
from .usage_rights_registry import limit


class UsageSubjectLeaf(Frozen):
    leaf_id: str = Field(pattern=r"^leaf:[a-z0-9-]{3,64}$")
    subject_class: str
    revision: int = Field(ge=1)
    subject_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class UsageSubjectSpec(Frozen):
    scope: UsageRightsScope
    subject_id: str = Field(pattern=r"^subject:[a-z0-9-]{3,64}$")
    subject_class: Literal["raw", "derived", "mixed", "model"]
    revision: int = Field(ge=1)
    leaves: tuple[UsageSubjectLeaf, ...]
    lineage_nodes: tuple[str, ...] = ()
    lineage_edges: tuple[tuple[str, str], ...] = ()
    subject_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        ids = tuple(item.leaf_id for item in self.leaves)
        if not ids or len(ids) > limit("maxLineageLeaves") or ids != tuple(sorted(set(ids))):
            raise ValueError("lineage_leaves_invalid")
        if self.subject_class == "raw" and (len(self.leaves) != 1 or self.lineage_edges):
            raise ValueError("raw_subject_requires_one_leaf")
        nodes = self.lineage_nodes or tuple(item.leaf_id for item in self.leaves)
        if nodes != tuple(sorted(set(nodes))) or len(nodes) > limit("maxLineageLeaves"):
            raise ValueError("lineage_nodes_invalid")
        if self.lineage_edges != tuple(sorted(set(self.lineage_edges))):
            raise ValueError("lineage_edges_invalid")
        if any(parent not in nodes or child not in nodes or parent == child for parent, child in self.lineage_edges):
            raise ValueError("lineage_edge_invalid")
        children = {child for _, child in self.lineage_edges}
        roots = set(nodes) - children
        if self.lineage_edges and self.subject_id not in roots:
            raise ValueError("lineage_root_invalid")
        graph = {node: [] for node in nodes}
        for parent, child in self.lineage_edges: graph[parent].append(child)
        visiting, visited = set(), set()
        def visit(node):
            if node in visiting: raise ValueError("lineage_cycle")
            if node not in visited:
                visiting.add(node)
                for child in graph[node]: visit(child)
                visiting.remove(node); visited.add(node)
        for node in nodes: visit(node)
        if self.subject_hash != digest(self.model_dump(exclude={"subject_hash"}, mode="python")):
            raise ValueError("subject_hash_mismatch")
        return self
