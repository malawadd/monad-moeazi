from datetime import datetime, timezone
import pytest
from pydantic import ValidationError
from moeazi_agent.operator_qualification_canonical import canonical_json, digest, json_loads_strict
from moeazi_agent.operator_qualification_scope_contracts import QualificationScope, FrozenQualificationManifest

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def scope_body(): return {"tenant_fingerprint":"tenant:test","scope_id":"scope:test","environment":"local"}
def test_canonical_json_is_stable_and_rejects_float_duplicate_and_non_utc():
    assert canonical_json({"b":1,"a":"x"})==b'{"a":"x","b":1}'
    assert digest({"a":1})==digest({"a":1})
    for value in ({"x":1.0},{"at":datetime(2026,1,1)}, {"at":NOW.replace(tzinfo=None)}):
        with pytest.raises(ValueError): canonical_json(value)
    for raw in ('{"a":1,"a":2}','{"a":1.2}'):
        with pytest.raises(ValueError): json_loads_strict(raw)

def test_strict_frozen_scope_and_sorted_manifest_constraints():
    body=scope_body(); scope=QualificationScope(**body,scope_hash=digest(body))
    with pytest.raises(ValidationError): QualificationScope(**body,scope_hash=scope.scope_hash,unexpected="no")
    with pytest.raises(ValidationError): scope.scope_id="scope:other"
    hashes=["a"*64,"b"*64]; manifest={"scope_hash":scope.scope_hash,"registry_hash":"c"*64,"policy_hash":"d"*64,"artifact_hashes":hashes}
    assert FrozenQualificationManifest(**manifest,manifest_hash=digest(manifest)).artifact_hashes==hashes
    manifest["artifact_hashes"]=list(reversed(hashes))
    with pytest.raises(ValidationError): FrozenQualificationManifest(**manifest,manifest_hash=digest(manifest))
