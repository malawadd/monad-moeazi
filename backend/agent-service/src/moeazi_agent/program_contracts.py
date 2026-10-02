"""Frozen managed-program contracts; parsing does not authorize runtime dispatch."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .controller_contracts import (
    ControllerRef, require_customer_mode, require_managed_program_binding,
    version_content_hash,
)


class TradingProgramVersion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    programId: str = Field(min_length=1)
    version: int = Field(ge=1)
    sourceStrategyAccountId: str = Field(min_length=1)
    teamVersionId: str = Field(min_length=1)
    modelConfigurationId: str = Field(min_length=1)
    policyId: str = Field(min_length=1)
    strategyArtifactHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    adapterProfileHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    runtimeCompatibility: str = Field(pattern=r"^[a-zA-Z0-9._-]{1,80}$")
    teamConfigJson: str
    modelConfigurationJson: str
    policyJson: str
    teamConfigHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    modelConfigurationHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    policyHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    contentHash: str = Field(pattern=r"^[a-f0-9]{64}$")

    def manifest(self) -> dict:
        return {"schemaVersion": 1, "controllerKind": "managed_program",
            "programId": self.programId, "version": self.version,
            "sourceStrategyAccountId": self.sourceStrategyAccountId,
            "teamVersionId": self.teamVersionId,
            "modelConfigurationId": self.modelConfigurationId,
            "policyId": self.policyId,
            "strategyArtifactHash": self.strategyArtifactHash,
            "adapterProfileHash": self.adapterProfileHash,
            "runtimeCompatibility": self.runtimeCompatibility,
            "teamConfigHash": self.teamConfigHash,
            "modelConfigurationHash": self.modelConfigurationHash,
            "policyHash": self.policyHash}

    @model_validator(mode="after")
    def verify_frozen_content(self):
        for label, content, digest in (
            ("team", self.teamConfigJson, self.teamConfigHash),
            ("model", self.modelConfigurationJson, self.modelConfigurationHash),
            ("policy", self.policyJson, self.policyHash),
        ):
            if version_content_hash({"content": content}) != digest:
                raise ValueError(f"Frozen {label} content hash mismatch")
        if version_content_hash(self.manifest()) != self.contentHash:
            raise ValueError("Program version hash mismatch")
        return self


class ProgramAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    assignmentId: str = Field(min_length=1)
    strategyAccountId: str = Field(min_length=1)
    programVersionId: str = Field(min_length=1)
    status: Literal["paused", "active", "revoked"]
    source: Literal["explicit", "migration"]
    controllerMode: Literal["shadow", "autopilot"] = "shadow"
    controllerRef: ControllerRef | None = None

    @model_validator(mode="after")
    def verify_identity(self):
        ref = self.controllerRef
        if ref and (ref.environment != "live" or ref.controllerKind != "managed_program"
                    or ref.strategyAccountId != self.strategyAccountId
                    or ref.controllerId != self.assignmentId
                    or ref.controllerVersionId != self.programVersionId):
            raise ValueError("Assignment controller binding mismatch")
        if self.status == "active" and ref is None:
            raise ValueError("Active assignment requires its frozen controller")
        return self


def require_managed_program_runtime(job: dict, context: dict):
    """Verify dispatch/completion provenance against the current active assignment."""
    managed = context.get("managedProgram") or {}
    raw_assignment = managed.get("assignment") or {}
    raw_version = managed.get("version") or {}
    if not context.get("controllerRef") or not context.get("profile"):
        raise ValueError("Managed program runtime context is unavailable")
    version = TradingProgramVersion.model_validate({
        key: raw_version.get(key) for key in TradingProgramVersion.model_fields
    })
    assignment = ProgramAssignment.model_validate({
        "assignmentId": raw_assignment.get("assignmentId"),
        "strategyAccountId": raw_assignment.get("strategyAccountId"),
        "programVersionId": str(raw_assignment.get("programVersionId", "")),
        "status": raw_assignment.get("status"), "source": raw_assignment.get("source"),
        "controllerMode": raw_assignment.get("controllerMode", "shadow"),
        "controllerRef": context["controllerRef"],
    })
    if assignment.status != "active" or assignment.source != "explicit":
        raise ValueError("Managed assignment is not active and explicitly owned")
    if version.contentHash != context["controllerRef"].get("contentHash"):
        raise ValueError("Managed program version hash changed")
    ref = require_managed_program_binding(
        job, context["controllerRef"], assignment_id=assignment.assignmentId,
        program_version_id=assignment.programVersionId, content_hash=version.contentHash,
    )
    mode = require_customer_mode(job, context["profile"].get("authorityMode"))
    if mode != assignment.controllerMode:
        raise ValueError("Managed assignment mode changed")
    return assignment, version, ref, mode


class ExperimentSpecIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    createdBySubject: str = Field(min_length=1)
    controllerKind: Literal["customer_team", "managed_program"]
    controllerVersionId: str = Field(min_length=1)
    contentHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    environment: Literal["experiment"]
    specJson: str
