from datetime import datetime,timezone
from moeazi_agent.product_eligibility_scenarios import scenario_registry,evaluate_fixture,NOW
from moeazi_agent.product_eligibility_registry import members
def test_closed_ninety_case_fixture_corpus_is_safe():
 results=[evaluate_fixture(x["id"],"observe",NOW,"operator:fixture","a"*64) for x in scenario_registry()]
 assert len(results)==90 and {x["requestedOperation"] for x in results}==set(members("operations"))
 assert all(x["fixtureOnly"] and x["notLegalAdvice"] and x["productOutcome"]=="unavailable" and not x["operationPerformed"] for x in results)
def test_operation_and_venue_are_exact_not_reusable():
 rows=scenario_registry()
 assert len({(x["operation"],x["venue"]) for x in rows})>=42
