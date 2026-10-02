"""Bounded financial outbox delivery; PostgreSQL remains the financial authority."""
from __future__ import annotations

from typing import Protocol

from .finance_projection import projection_hash


class FinancialOutbox(Protocol):
    async def claim_outbox(self, limit: int = 20, lease_seconds: int = 30) -> list[dict]: ...

    async def ack_outbox(self, event_id: str, payload_hash: str) -> bool: ...


class ProjectionPublisher(Protocol):
    async def command(self, command: str, **payload) -> dict: ...


async def deliver_finance_outbox(
    repository: FinancialOutbox, publisher: ProjectionPublisher, *, limit: int = 20,
) -> dict:
    """Deliver one bounded batch, never poll Convex or retry within a batch.

    The repository commits claims before returning. Every network call is outside
    the account transaction. An ambiguous response or failed acknowledgement leaves
    the stored event for a later lease; the same payload/hash will be redelivered.
    This function does not run itself in the background or grant trading authority.
    """
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Financial delivery batch limit must be between 1 and 100")
    events = await repository.claim_outbox(limit=limit, lease_seconds=30)
    results: list[dict] = []
    for event in events:
        event_id = event["eventId"]
        digest = event["payloadHash"]
        payload = event["payload"]
        if not isinstance(payload, dict) or any(
            event.get(field) is None or payload.get(field) != event[field]
            for field in ("environment", "scopeId", "strategyAccountId", "accountRevision")
        ):
            results.append({"eventId": event_id, "status": "retained",
                            "reason": "stored_namespace_mismatch"})
            continue
        if projection_hash(payload) != digest:
            results.append({"eventId": event_id, "status": "retained",
                            "reason": "stored_payload_hash_mismatch"})
            continue
        try:
            response = await publisher.command("projectCurrentFinance",
                eventId=event_id, payloadHash=digest, projection=payload)
            valid = isinstance(response, dict) and (
                response.get("applied") is True
                and response.get("reason") in {"created", "updated"}
                or response.get("applied") is False
                and response.get("reason") in {"duplicate", "stale_revision"}
            )
            if not valid:
                results.append({"eventId": event_id, "status": "retained",
                                "reason": "unconfirmed_projection_receipt"})
                continue
            if await repository.ack_outbox(event_id, digest) is not True:
                results.append({"eventId": event_id, "status": "retained",
                                "reason": "unconfirmed_local_acknowledgement"})
                continue
        except Exception:
            # The remote may already have committed. Never replace its event ID,
            # release financial holds, or acknowledge an uncertain publication.
            results.append({"eventId": event_id, "status": "retained",
                            "reason": "delivery_or_acknowledgement_uncertain"})
            continue
        results.append({"eventId": event_id, "status": "acknowledged",
                        "reason": response["reason"]})
    return {"claimed": len(events),
            "acknowledged": sum(row["status"] == "acknowledged" for row in results),
            "events": results}
