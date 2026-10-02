"""Exact, independent synthetic review contracts; kappa is rational, never float."""
from __future__ import annotations
from datetime import datetime
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .operator_qualification_canonical import HASH, ID, digest, normal

class _ReviewModel(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value): normal(value); return value

class ReviewerCalibrationReceipt(_ReviewModel):
    scope_hash: str; rubric_hash: str; reviewer_person_hashes: list[str]; case_count: int = Field(ge=20, le=20)
    kappa_numerator: int; kappa_denominator: int = Field(gt=0); calibrated_at: datetime; calibration_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes=self.reviewer_person_hashes+[self.scope_hash,self.rubric_hash,self.calibration_hash]
        if self.reviewer_person_hashes != sorted(set(self.reviewer_person_hashes)) or len(self.reviewer_person_hashes)<2 or not all(HASH.fullmatch(x) for x in hashes) or self.kappa_numerator*10 < self.kappa_denominator*7 or self.calibration_hash != digest(self.model_dump(exclude={"calibration_hash"})): raise ValueError("calibration invalid")
        return self

class IndependentReviewAttestation(_ReviewModel):
    scope_hash: str; attempt_hash: str; oracle_hash: str; rubric_hash: str; calibration_hash: str
    reviewer_principal_hash: str; candidate_principal_hash: str; reviewer_person_fingerprint: str = Field(pattern=ID); candidate_person_fingerprint: str = Field(pattern=ID); decision: str = Field(pattern=r"^(pass|fail)$"); reviewed_at: datetime; review_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes=(self.scope_hash,self.attempt_hash,self.oracle_hash,self.rubric_hash,self.calibration_hash,self.reviewer_principal_hash,self.candidate_principal_hash,self.review_hash)
        if not all(HASH.fullmatch(x) for x in hashes) or self.review_hash != digest(self.model_dump(exclude={"review_hash"})): raise ValueError("review invalid")
        return self
