from __future__ import annotations
from dataclasses import dataclass,field
from .evidence_event_canonical import digest
@dataclass(frozen=True)
class EvidenceFixtureScope:
    operator_test_id:str; synthetic_tenant_ref:str; synthetic_account_ref:str; scope_kind:str; chain_id:int; market_id:str
    def __post_init__(self):
        if self.scope_kind not in {"public_market_fixture","strategy_account_fixture"} or self.chain_id!=42161: raise ValueError("evidence_scope_invalid")
    @property
    def scope_hash(self): return digest(self.__dict__)
@dataclass(frozen=True)
class SelectedFeature03Context:
    run_id:str; operator_test_id:str; scope_hash:str; invariant_verdict:str="pass"; fixture_only:bool=True; product_outcome:str="unavailable"; accepted_as_event_authority:bool=False; status:str="requires_revalidation"
    def __post_init__(self):
        if self.invariant_verdict!="pass" or not self.fixture_only or self.product_outcome!="unavailable" or self.accepted_as_event_authority: raise ValueError("evidence_feature03_context_invalid")
    @property
    def context_hash(self): return digest(self.__dict__)
@dataclass(frozen=True)
class FixtureAdapterManifest:
    source_id:str; source_family:str; schema_version:str="v1"; origin:str="checked_in_fixture"; operation:str="read_fixture"; network_enabled:bool=False; credential_ref:None=None; maximum_cost_microusd:int=0
    def __post_init__(self):
        if self.network_enabled or self.credential_ref is not None or self.maximum_cost_microusd: raise ValueError("evidence_adapter_boundary")
    @property
    def manifest_hash(self): return digest(self.__dict__)
@dataclass(frozen=True)
class FixtureEvidenceQuery:
    manifest_hash:str; scope_hash:str; role:str; horizon:str; query_hash:str=field(init=False)
    def __post_init__(self): object.__setattr__(self,"query_hash",digest({k:v for k,v in self.__dict__.items() if k!="query_hash"}))
