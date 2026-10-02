"""Metadata-only future workflow contract. It is intentionally not registered."""
from __future__ import annotations

from dataclasses import dataclass

from .execution_artifact_contracts import digest


@dataclass(frozen=True)
class RequalificationCommand:
    scope_key: str
    drift_hash: str
    proposed_spec_hash: str
    reviewer_ids: tuple[str, str]
    idempotency_key: str

    def request_hash(self) -> str:
        if len(set(self.reviewer_ids)) != 2:
            raise ValueError("Requalification needs distinct local reviewer fixtures")
        return digest({"scope": self.scope_key, "drift": self.drift_hash,
            "spec": self.proposed_spec_hash, "reviewers": list(self.reviewer_ids),
            "idempotency": self.idempotency_key})
