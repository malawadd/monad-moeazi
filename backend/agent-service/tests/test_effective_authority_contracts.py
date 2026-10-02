from datetime import datetime, timezone
import pytest
from moeazi_agent.effective_authority_canonical import CanonicalError, json_loads_strict
from moeazi_agent.effective_authority_scenarios import _request, _gate

def test_canonical_rejects_float_duplicate_and_bad_gate_hash():
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1.2}')
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1,"x":2}')
    with pytest.raises(ValueError): _gate("risk",_request(),1).model_copy(update={"result_hash":"0"*64}).__class__(**_gate("risk",_request(),1).model_dump()|{"result_hash":"0"*64})
def test_scope_is_exact_and_utc_millis_only():
    with pytest.raises(ValueError): _request().scope.__class__(**_request().scope.model_dump()|{"scope_hash":"0"*64})
    assert datetime(2026,1,1,tzinfo=timezone.utc).microsecond == 0
