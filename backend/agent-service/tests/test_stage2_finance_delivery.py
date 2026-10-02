"""Independent Q3 bounded outbox transport fault tests, with no Convex calls."""
import json
from pathlib import Path

import pytest

from moeazi_agent.finance_delivery import deliver_finance_outbox
from moeazi_agent.finance_projection import projection_hash


GOLDEN = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "stage2FinanceProjection.json"


def event(event_id="finance-event-a"):
    payload = json.loads(GOLDEN.read_text(encoding="utf-8"))
    return dict(eventId=event_id, payloadHash=projection_hash(payload), payload=payload,
                **{key: payload[key] for key in
                   ("environment", "scopeId", "strategyAccountId", "accountRevision")})


class Repository:
    def __init__(self, events, ack_result=True):
        self.events = list(events)
        self.acked = set()
        self.claims = []
        self.ack_calls = []
        self.ack_result = ack_result

    async def claim_outbox(self, limit=20, lease_seconds=30):
        self.claims.append((limit, lease_seconds))
        return [item for item in self.events if item["eventId"] not in self.acked][:limit]

    async def ack_outbox(self, event_id, payload_hash):
        self.ack_calls.append((event_id, payload_hash))
        if isinstance(self.ack_result, Exception):
            raise self.ack_result
        if self.ack_result is True:
            self.acked.add(event_id)
        return self.ack_result


class Publisher:
    def __init__(self):
        self.remote = {}
        self.calls = []
        self.lose_first_response = False
        self.fixed_response = None

    async def command(self, command, **payload):
        assert command == "projectCurrentFinance"
        self.calls.append(payload)
        if self.fixed_response is not None:
            return self.fixed_response
        event_id, digest = payload["eventId"], payload["payloadHash"]
        assert projection_hash(payload["projection"]) == digest
        prior = self.remote.get(event_id)
        if prior is not None:
            assert prior == digest
            return {"applied": False, "reason": "duplicate"}
        self.remote[event_id] = digest
        if self.lose_first_response:
            self.lose_first_response = False
            raise TimeoutError("response lost after remote commit")
        return {"applied": True, "reason": "created"}


@pytest.mark.asyncio
async def test_remote_commit_then_lost_response_redelivers_same_event_and_hash():
    row = event()
    repository, publisher = Repository([row]), Publisher()
    publisher.lose_first_response = True
    first = await deliver_finance_outbox(repository, publisher)
    assert first["acknowledged"] == 0 and first["claimed"] == 1
    assert first["events"][0]["status"] == "retained"
    assert repository.acked == set() and len(publisher.remote) == 1
    assert len(publisher.calls) == 1  # no retry within a batch
    second = await deliver_finance_outbox(repository, publisher)
    assert second["events"][0]["reason"] == "duplicate"
    assert second["acknowledged"] == 1
    assert publisher.calls[0] == publisher.calls[1]
    assert repository.ack_calls == [(row["eventId"], row["payloadHash"])]
    assert row["payload"]["holds"] == event()["payload"]["holds"]


@pytest.mark.asyncio
@pytest.mark.parametrize("receipt", [
    {}, {"applied": True, "reason": "duplicate"},
    {"applied": False, "reason": "created"},
])
async def test_malformed_remote_receipt_retains_outbox(receipt):
    repository, publisher = Repository([event()]), Publisher()
    publisher.fixed_response = receipt
    result = await deliver_finance_outbox(repository, publisher)
    assert result["acknowledged"] == 0
    assert result["events"][0]["reason"] == "unconfirmed_projection_receipt"
    assert repository.ack_calls == [] and repository.acked == set()


@pytest.mark.asyncio
@pytest.mark.parametrize("ack", [False, None, RuntimeError("local ack failed")])
async def test_false_missing_or_failed_ack_retains_same_stored_payload(ack):
    row = event()
    repository, publisher = Repository([row], ack_result=ack), Publisher()
    first = await deliver_finance_outbox(repository, publisher)
    assert first["acknowledged"] == 0 and repository.acked == set()
    repository.ack_result = True
    second = await deliver_finance_outbox(repository, publisher)
    assert second["acknowledged"] == 1
    assert second["events"][0]["reason"] == "duplicate"
    assert publisher.calls[0] == publisher.calls[1]
    assert repository.acked == {row["eventId"]}


@pytest.mark.asyncio
async def test_stored_hash_mismatch_never_publishes_and_stale_projection_acks():
    corrupt = event("corrupt")
    corrupt["payloadHash"] = "b" * 64
    stale = event("stale")
    repository, publisher = Repository([corrupt, stale]), Publisher()
    publisher.fixed_response = {"applied": False, "reason": "stale_revision"}
    result = await deliver_finance_outbox(repository, publisher, limit=2)
    assert result["claimed"] == 2 and result["acknowledged"] == 1
    assert result["events"][0]["reason"] == "stored_payload_hash_mismatch"
    assert repository.acked == {"stale"}
    assert [call["eventId"] for call in publisher.calls] == ["stale"]


@pytest.mark.asyncio
async def test_batch_is_bounded_without_polling_or_intra_call_retry():
    repository = Repository([event("a"), event("b"), event("c")])
    publisher = Publisher()
    result = await deliver_finance_outbox(repository, publisher, limit=2)
    assert result["claimed"] == 2 and result["acknowledged"] == 2
    assert repository.claims == [(2, 30)]
    assert [call["eventId"] for call in publisher.calls] == ["a", "b"]
    with pytest.raises(ValueError):
        await deliver_finance_outbox(repository, publisher, limit=0)
