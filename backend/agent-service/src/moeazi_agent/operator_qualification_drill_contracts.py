"""Immutable drill observations. These receipts describe no executable action."""
from __future__ import annotations
from datetime import datetime
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .operator_qualification_canonical import HASH, ID, digest, normal

class _DrillModel(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value): normal(value); return value

class DrillScenarioVersion(_DrillModel):
    scope_hash: str; scenario_id: str = Field(pattern=ID); version: str = Field(pattern=ID); scenario_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash,self.scenario_hash)) or self.scenario_hash != digest(self.model_dump(exclude={"scenario_hash"})): raise ValueError("scenario invalid")
        return self

class DrillEvaluationRubric(_DrillModel):
    scope_hash: str; scenario_hash: str; version: str = Field(pattern=ID); rubric_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash,self.scenario_hash,self.rubric_hash)) or self.rubric_hash != digest(self.model_dump(exclude={"rubric_hash"})): raise ValueError("rubric invalid")
        return self

class DrillActionReceipt(_DrillModel):
    scope_hash: str; attempt_hash: str; sequence: int = Field(ge=1, le=100); action_code: str = Field(pattern=ID)
    adapter: str = Field(pattern=ID); occurred_at: datetime; predecessor_hash: str | None = None; action_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes=[self.scope_hash,self.attempt_hash,self.action_hash]+([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in hashes) or self.action_hash != digest(self.model_dump(exclude={"action_hash"})): raise ValueError("action invalid")
        return self

class DrillAttempt(_DrillModel):
    scope_hash: str; principal_hash: str; scenario_hash: str; scenario_id: str = Field(pattern=ID); rubric_hash: str; nonce: str = Field(pattern=ID)
    started_at: datetime; finished_at: datetime; action_hashes: list[str]; attempt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.action_hashes != sorted(set(self.action_hashes)) or not all(HASH.fullmatch(x) for x in self.action_hashes+[self.scope_hash,self.principal_hash,self.scenario_hash,self.rubric_hash,self.attempt_hash]) or self.attempt_hash != digest(self.model_dump(exclude={"attempt_hash"})): raise ValueError("attempt invalid")
        return self

class MachineOracleReceipt(_DrillModel):
    scope_hash: str; attempt_hash: str; rubric_hash: str; score: int = Field(ge=0, le=10_000); outcome: str = Field(pattern=ID)
    reason_codes: list[str] = Field(max_length=30); oracle_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or not all(HASH.fullmatch(x) for x in (self.scope_hash,self.attempt_hash,self.rubric_hash,self.oracle_hash)) or self.oracle_hash != digest(self.model_dump(exclude={"oracle_hash"})): raise ValueError("oracle invalid")
        return self
