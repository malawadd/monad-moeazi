from datetime import datetime, timezone
import pytest
from pydantic import ValidationError
from moeazi_agent.mandate_policy_compilation_contracts import CompiledAutomationPolicyV1
from moeazi_agent.mandate_policy_consent_contracts import PolicyConsentChallenge
from moeazi_agent.mandate_policy_scenarios import _mandate
from moeazi_agent.mandate_policy_compiler import CompilationBlocked, compile_mandate
from moeazi_agent.mandate_policy_registry import raw

def test_typed_policy_rejects_unknown_float_and_bad_bounds():
    values={"allowedMarkets":("BTC-PERP",),"allowedVenues":("hyperliquid",),"maxOrderUsd":25000000,"maxDailyVolumeUsd":250000000,"maxLeverage":5000000,"maxExposureUsd":100000000,"maxDailyLossUsd":50000000,"maxDailyDrawdownPct":8000000,"maxSlippageBps":75,"maxAnalysisAgeMs":120000,"minConfidence":650000,"minConsensus":600000,"cooldownSeconds":60,"maxConcurrentPositions":3,"requireStopLoss":True,"requireTakeProfit":False,"dailyCreditBudget":10000,"policy_hash":"a"*64}
    assert CompiledAutomationPolicyV1(**values).max_order_usd==25000000
    with pytest.raises(ValidationError): CompiledAutomationPolicyV1(**values,unknown=1)
    with pytest.raises(ValidationError): CompiledAutomationPolicyV1(**{**values,"maxOrderUsd":1.2})
def test_challenge_rejects_more_than_ten_minutes():
    base={"scope_hash":"a"*64,"tenant_fingerprint":"tenant:x","user_fingerprint":"user:x","account_fingerprint":"account:x","confirmer_fingerprint":"user:x","mandate_hash":"b"*64,"revision":1,"policy_hash":"c"*64,"profile_hash":"d"*64,"map_hash":"e"*64,"coverage_hash":"f"*64,"test_hash":"1"*64,"compiler_version":"mandate-policy-compiler-v1","schema_version":"mandate-spec-v1","registry_hash":"2"*64,"diff_hash":"3"*64,"request_hash":"4"*64,"idempotency_hash":"5"*64,"nonce_hash":"6"*64,"binding_hash":"7"*64,"issued_at":datetime(2026,1,1,tzinfo=timezone.utc),"expires_at":datetime(2026,1,1,0,11,tzinfo=timezone.utc),"kind":"standard"}
    with pytest.raises(ValidationError): PolicyConsentChallenge(**base)
def test_registry_bounds_drive_real_compiler_cases_and_hashes():
    now=datetime(2026,1,1,tzinfo=timezone.utc); compiled=compile_mandate(_mandate(now))
    assert any(item["caseKind"]=="deny" for item in compiled.manifest["cases"])
    lower=raw()["bounds"]["maxOrderUsd"][0]
    with pytest.raises(CompilationBlocked):
        from moeazi_agent.mandate_policy_compiler import _check_value
        _check_value("maxOrderUsd",lower-1,"usd_micros")
    import copy
    from moeazi_agent.mandate_policy_canonical import digest
    changed=copy.deepcopy(raw()); changed["bounds"]["maxOrderUsd"][0]+=1
    assert digest({key:value for key,value in changed.items() if key!="selfHash"}) != raw()["selfHash"]
