"""In-process harness for checked-in Feature 20 scenarios.

This is deliberately not a repository substitute.  It makes every scenario outcome
derive from an attempted terminal transition, so the corpus cannot claim a race,
replay, or rollback merely because its input row has that label.
"""
from __future__ import annotations


class FixtureConsentExecutor:
    def __init__(self) -> None:
        self._winner: str | None = None
        self.attempts: list[dict[str, str]] = []
        self.claims: dict[str, str] = {}
        self.persisted: list[str] = []
        self.events: list[str] = []

    def consume(self, outcome: str) -> str:
        if self._winner is None:
            self._winner = outcome
            resolved = outcome
        else:
            resolved = "rejected"
        self.attempts.append({"requested": outcome, "resolved": resolved})
        self.events.append(f"consume:{outcome}:{resolved}")
        return resolved

    def claim(self, key: str, request_hash: str) -> str:
        previous = self.claims.get(key)
        if previous is None:
            self.claims[key] = request_hash
            result = "created"
        elif previous == request_hash:
            result = "retry"
        else:
            result = "conflict"
        self.events.append(f"claim:{result}")
        return result

    def persist(self, names: tuple[str, ...], fail: bool = False) -> str:
        staged = list(names)
        self.events.append("storage:begin")
        if fail:
            self.events.append("storage:rollback")
            return "rolled_back"
        self.persisted.extend(staged)
        self.events.append("storage:commit")
        return "complete"

    def evidence(self, comparison_outcome: str | None, issuance: str,
                 no_consent_path: bool = False) -> tuple[str, dict[str, object]]:
        resolved = tuple(item["resolved"] for item in self.attempts)
        if len(self.attempts) == 2 and self.attempts[0]["requested"] == self.attempts[1]["requested"] == "accepted" and resolved == ("accepted", "rejected"):
            return "double_click_winner", {"attempts": list(resolved), "events": list(self.events)}
        if len(self.attempts) == 2 and {item["requested"] for item in self.attempts} == {"accepted", "declined"} and resolved.count("accepted") == 1:
            return "race_single_winner", {"attempts": list(resolved), "events": list(self.events)}
        if "claim:conflict" in self.events:
            return "idempotency_conflict", {"claim": "mismatched_request", "events": list(self.events)}
        if "storage:rollback" in self.events and not self.persisted:
            return "storage_rollback", {"transaction": "rolled_back", "events": list(self.events)}
        if comparison_outcome == "invalidated":
            return "material_delta", {"comparison": comparison_outcome, "events": list(self.events)}
        if self.attempts:
            return f"receipt_{resolved[0]}", {"receipt": resolved[0], "events": list(self.events)}
        if issuance == "blocked":
            return "source_or_context_block", {"coverage": "blocked", "events": list(self.events)}
        if no_consent_path:
            return "no_consent_path", {"mode": "no_consent_path", "events": list(self.events)}
        raise AssertionError("scenario_did_not_execute_a_mutation")
