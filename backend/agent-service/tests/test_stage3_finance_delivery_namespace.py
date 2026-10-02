"""A correct content hash cannot launder a projection across SQL namespaces."""
import pytest

from moeazi_agent.finance_delivery import deliver_finance_outbox
from moeazi_agent.finance_projection import projection_hash
from test_stage2_finance_delivery import Repository, Publisher, event


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("environment", "live"), ("scopeId", "another-experiment"),
    ("strategyAccountId", "another-account"), ("accountRevision", "999999"),
])
async def test_rehashed_wrong_namespace_is_retained_without_publication(field, value):
    row = event()
    row["payload"][field] = value
    row["payloadHash"] = projection_hash(row["payload"])
    repository, publisher = Repository([row]), Publisher()
    result = await deliver_finance_outbox(repository, publisher)
    assert result["events"][0]["reason"] == "stored_namespace_mismatch"
    assert result["acknowledged"] == 0 and not publisher.calls and not repository.ack_calls
