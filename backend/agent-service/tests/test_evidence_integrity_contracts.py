import pytest
from moeazi_agent.evidence_integrity_canonical import digest,load
from moeazi_agent.evidence_integrity_definition_contracts import IntegrityScope,SelectedIntegrityContext
def test_canonical_rejects_duplicate_and_floats():
 with pytest.raises(ValueError): load('{"a":1,"a":2}')
 with pytest.raises(ValueError): load('{"a":1.2}')
 assert len(digest({"a":1}))==64
def test_scope_and_explicit_context_are_strict():
 scope=IntegrityScope("tenant","account","ETH-USD","market_data","intraday")
 assert len(scope.scope_hash)==64
 with pytest.raises(ValueError): IntegrityScope("tenant","account","ETH-USD","market_data","intraday",1)
 context=SelectedIntegrityContext(tuple((x,"run-1") for x in sorted(("evidence-lifecycle-boundary","external-usage-rights","evidence-event-fabric","claim-disagreement-ledger","specialist-source-value-attribution"))))
 assert len(context.context_hash)==64
