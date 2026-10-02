"""Frozen local-only policy and fixture inventory for Feature 35."""
from __future__ import annotations
from .decision_memory_canonical import digest

POLICY = {"version": "decision-memory-local-v1", "topK": 5, "tokenCeiling": 2048,
          "minimumSupport": 1, "tokenizer": "fixture-tokenizer-v1", "chainId": 42161}


def scenarios() -> tuple[dict, ...]:
    kinds = ("mature", "pending", "disputed", "corrected", "low-quality", "abstention")
    return tuple({"id": f"decision-memory-{index:03d}", "operation": "retrieve_memory_bundle",
                  "kind": kinds[(index - 1) % len(kinds)]} for index in range(1, 97))


def mutations() -> tuple[str, ...]:
    return tuple(f"decision-memory-mutation-{index:03d}" for index in range(1, 257))


def registry_hash() -> str:
    return digest({"policy": POLICY, "scenarios": scenarios(), "mutations": mutations()})
