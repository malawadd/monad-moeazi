from dataclasses import dataclass
from typing import Literal


Authority = Literal["shadow", "approval_required", "autopilot"]
RANK = {"shadow": 0, "approval_required": 1, "autopilot": 2}


def normalize_authority(value: str) -> Authority:
    if value in {"insights", "shadow"}:
        return "shadow"
    if value in {"approval_required", "autopilot"}:
        return value
    raise ValueError(f"Unknown authority mode: {value}")


@dataclass(frozen=True)
class AuthorityInputs:
    deployment_ceiling: Authority
    user_mode: Authority
    policy_live_allowed: bool
    credits_available: bool
    system_healthy: bool


def effective_authority(inputs: AuthorityInputs) -> Authority:
    candidates = [inputs.deployment_ceiling, inputs.user_mode]
    if not inputs.policy_live_allowed or not inputs.credits_available or not inputs.system_healthy:
        candidates.append("shadow")
    return min(candidates, key=lambda item: RANK[item])
