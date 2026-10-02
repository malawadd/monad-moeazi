"""Pure fixture topology resolver.  This module intentionally has no network client."""
from __future__ import annotations

from typing import Protocol


class ArtifactReader(Protocol):
    def read(self, artifact_id: str) -> dict: ...


class FixtureArtifactReader:
    def __init__(self, observations: dict[str, dict]): self._observations = observations
    def read(self, artifact_id: str) -> dict:
        if artifact_id not in self._observations: raise ValueError("Missing local fixture observation")
        return dict(self._observations[artifact_id])


def resolve_topology(reader: ArtifactReader, artifact_id: str) -> tuple[str, dict]:
    value = reader.read(artifact_id)
    kind = value.get("topology", "direct")
    runtime = value.get("runtimeHash")
    if not runtime: return "unknown", {"reason": "runtime_missing"}
    slots = value.get("slots", {})
    if kind == "direct" and not any(slots.values()): return "direct", value
    if kind == "transparent" and slots.get("implementation") and slots.get("admin") and not slots.get("beacon"):
        return "transparent", value
    if kind == "uups" and slots.get("implementation") and value.get("proxiableEvidence") and not slots.get("beacon"):
        return "uups", value
    if kind == "beacon" and slots.get("beacon") and value.get("beaconImplementation"):
        return "beacon", value
    return "unknown", {"reason": "topology_ambiguous", "slotDigest": value.get("slotDigest", "")}
