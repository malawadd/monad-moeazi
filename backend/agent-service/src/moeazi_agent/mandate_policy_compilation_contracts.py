"""Closed, versioned compile artifacts. No map or policy accepts arbitrary keys."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Hash=str
class Frozen(BaseModel): model_config=ConfigDict(extra="forbid",frozen=True,strict=True,populate_by_name=True)
class CompiledAutomationPolicyV1(Frozen):
    allowed_markets:tuple[Literal["BTC-PERP","ETH-PERP","LINK-PERP","SOL-PERP"],...]=Field(alias="allowedMarkets",min_length=1)
    allowed_venues:tuple[Literal["gmx","hyperliquid","lighter","orderly","ostium","uniswap"],...]=Field(alias="allowedVenues",min_length=1)
    max_order_usd:int=Field(alias="maxOrderUsd"); max_daily_volume_usd:int=Field(alias="maxDailyVolumeUsd"); max_leverage:int=Field(alias="maxLeverage"); max_exposure_usd:int=Field(alias="maxExposureUsd"); max_daily_loss_usd:int=Field(alias="maxDailyLossUsd"); max_daily_drawdown_pct:int=Field(alias="maxDailyDrawdownPct"); max_slippage_bps:int=Field(alias="maxSlippageBps"); max_analysis_age_ms:int=Field(alias="maxAnalysisAgeMs"); min_confidence:int=Field(alias="minConfidence"); min_consensus:int=Field(alias="minConsensus"); cooldown_seconds:int=Field(alias="cooldownSeconds"); max_concurrent_positions:int=Field(alias="maxConcurrentPositions"); require_stop_loss:bool=Field(alias="requireStopLoss"); require_take_profit:bool=Field(alias="requireTakeProfit"); daily_credit_budget:int=Field(alias="dailyCreditBudget")
    schema_version:Literal["compiled-automation-policy-v1"]="compiled-automation-policy-v1"; policy_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def _closed(self):
        if self.max_daily_loss_usd>self.max_exposure_usd or self.max_order_usd>self.max_daily_volume_usd: raise ValueError("cross_field_cap_contradiction")
        if tuple(sorted(set(self.allowed_markets)))!=self.allowed_markets or tuple(sorted(set(self.allowed_venues)))!=self.allowed_venues: raise ValueError("sets_must_be_sorted_unique")
        return self
class ProfilePolicyBinding(Frozen):
    allowed_authority_modes:tuple[Literal["shadow","approval_required","autopilot"],...]=Field(min_length=1); cadence:Literal["on_demand","hourly","daily"]; approval_required:bool; effective_at:datetime; expires_at:datetime|None; scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); schema_version:Literal["profile-policy-binding-v1"]="profile-policy-binding-v1"; binding_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def _time(self):
        if self.effective_at.tzinfo is None or self.effective_at.utcoffset()!=timezone.utc.utcoffset(self.effective_at) or (self.expires_at and self.expires_at<=self.effective_at): raise ValueError("invalid_utc_expiry")
        if tuple(sorted(set(self.allowed_authority_modes)))!=self.allowed_authority_modes: raise ValueError("modes_sorted_unique")
        return self
class ClauseMapping(Frozen): clause_id:str=Field(pattern=r"^clause:[a-z0-9-]{3,64}$"); field:str; operator:str; unit:str; output_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class FieldCoverage(Frozen): field:str; source:Literal["clause","explicit_default","scope"]; source_id:str; value_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class CoverageReceipt(Frozen): scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); mandate_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); coverage:tuple[FieldCoverage,...]; complete:Literal[True]; coverage_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class PolicyTestCase(Frozen): case_id:str; field:str; case_kind:Literal["lower","equal","upper","allow","deny","protective","profile","time","chain"]; verdict:Literal["pass","fail"]; case_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class PolicyTestManifest(Frozen): policy_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); binding_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); cases:tuple[PolicyTestCase,...]; manifest_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class PolicyTestReceipt(Frozen): manifest_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); verdict_hashes:tuple[Hash,...]; passed:Literal[True]; receipt_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class CompilationReceipt(Frozen): scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); mandate_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); predecessor_hash:Hash|None=None; policy_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); binding_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); map_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); coverage_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); test_manifest_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); test_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); compiler_version:Literal["mandate-policy-compiler-v1"]="mandate-policy-compiler-v1"; schema_version:Literal["mandate-spec-v1"]="mandate-spec-v1"; registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
