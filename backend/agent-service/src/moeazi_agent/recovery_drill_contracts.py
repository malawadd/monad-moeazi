from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .recovery_contracts import Hash, RecoveryModel, Sha40


class RecoveryDrillPlan(RecoveryModel):
    plan_id: str = Field(pattern=r"^rdp_[a-f0-9]{48}$")
    scenario_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")
    fixture_hash: Hash
    repository_revision: Sha40
    registry_hash: Hash
    control_hash: Hash
    frozen_at: datetime
    network_policy: Literal["deny_all"] = "deny_all"
    cost_ceiling_microusd: Literal[0] = 0
    canonical_hash: Hash


class RecoveryDrillReceipt(RecoveryModel):
    drill_id: str = Field(pattern=r"^rdr_[a-f0-9]{48}$")
    fixture_hash: Hash
    repository_revision: Sha40
    artifact_hashes: list[Hash] = Field(min_length=5, max_length=40)
    invariant_verdict: Literal["pass", "fail"]
    measured_rpo_seconds: int | None = Field(default=None, ge=0, le=2_592_000)
    measured_rto_ms: int = Field(ge=0, le=86_400_000)
    outbound_attempt_count: Literal[0] = 0
    production_write_count: Literal[0] = 0
    canonical_hash: Hash
