import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def save_connector_history(dsn: str, event: dict) -> None:
    # Explicit allowlist, never generic raw-provider persistence.
    if event.get("kind") not in {"purchase", "activation", "withdrawal"}:
        raise ValueError("Invalid connector history")
    pins = [{"id": str(pin["id"]), "version": str(pin["version"])} for pin in event["providerPins"]]
    engine = create_async_engine(dsn, pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("""
                INSERT INTO mobile_connector_history(operation_id, kind, status, observed_at, provider_pins)
                VALUES (:id, :kind, :status, :time, CAST(:pins AS jsonb))
                ON CONFLICT DO NOTHING
            """), {"id": event["operationId"], "kind": event["kind"], "status": event["status"],
                   "time": int(event["observedAt"]), "pins": json.dumps(pins)})
    finally:
        await engine.dispose()
