from datetime import datetime, timedelta, timezone
import pytest
from pydantic import ValidationError
from moeazi_agent.operator_qualification_canonical import digest
from moeazi_agent.operator_qualification_evaluator import decide
from moeazi_agent.operator_qualification_review_contracts import ReviewerCalibrationReceipt
from moeazi_agent.operator_qualification_scenarios import evaluate_fixture
from moeazi_agent.operator_qualification_scope_contracts import SyntheticWorkforcePrincipal

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def bundle(): return evaluate_fixture("qualification-pass-independent-review","observe",NOW,"operator:test","a"*64)["_artifacts"]
def candidate():
    body={"person_fingerprint":"person:candidate","account_fingerprint":"account:candidate","principal_kind":"human","trust":"synthetic_untrusted"}
    return SyntheticWorkforcePrincipal(**body,principal_hash=digest(body))

def test_kappa_cross_multiplication_boundary_and_below():
    value=bundle(); body=value["calibration"].model_dump(exclude={"calibration_hash"}); body["kappa_numerator"]=6; body["calibration_hash"]=digest(body)
    with pytest.raises(ValidationError): ReviewerCalibrationReceipt(**body)
    assert value["calibration"].kappa_numerator*10==value["calibration"].kappa_denominator*7

def test_stale_and_mismatched_review_bindings_block_fixture():
    value=bundle()
    stale=value["calibration"].model_copy(update={"calibrated_at":NOW-timedelta(days=31)})
    decision,_=decide(value["scope"].scope_hash,candidate(),value["role"],value["training"],value["attempt"],value["oracle"],stale,value["review"],value["manifest"],NOW)
    assert decision.outcome=="blocked"
    self_review=value["review"].model_copy(update={"reviewer_principal_hash":candidate().principal_hash,"reviewer_person_fingerprint":"person:candidate"})
    decision,_=decide(value["scope"].scope_hash,candidate(),value["role"],value["training"],value["attempt"],value["oracle"],value["calibration"],self_review,value["manifest"],NOW)
    assert decision.outcome=="blocked"
    service=candidate().model_copy(update={"principal_kind":"service"})
    decision,_=decide(value["scope"].scope_hash,service,value["role"],value["training"],value["attempt"],value["oracle"],value["calibration"],value["review"],value["manifest"],NOW)
    assert decision.outcome=="blocked"
