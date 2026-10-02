"""Exact, cross-language stable current-state projection for the outbox."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json

from .finance_contracts import FinanceError, db_native_int


def utc_millis(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise FinanceError("projection timestamp lacks timezone")
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z")


def projection_hash(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=False, allow_nan=False)
    return sha256(("moeazi-finance-projection-v1\n" + raw).encode()).hexdigest()


def projection_payload(account: dict, balances: list[dict], holds: list[dict],
                       capacity: list[dict], as_of: datetime) -> dict:
    scope = {key: account[key] for key in
             ("environment", "scope_id", "strategy_account_id")}
    balance_rows = [{"assetUnitId": row["asset_unit_id"],
                     "registryHash": row["registry_hash"],
                     "locationId": row["location_id"], "book": row["book"],
                     "units": str(db_native_int(row["units"])) }
                    for row in balances if row["book"] != "external"]
    balance_rows.sort(key=lambda row: (row["assetUnitId"], row["locationId"], row["book"]))
    hold_rows = [{"reservationId": row["reservation_id"],
                  "capacityKey": row["capacity_key"],
                  "assetUnitId": row["asset_unit_id"],
                  "locationId": row["location_id"],
                  "units": str(db_native_int(row["units"])),
                  "status": row["status"]} for row in holds]
    hold_rows.sort(key=lambda row: (row["reservationId"], row["capacityKey"],
                                    row["assetUnitId"], row["locationId"]))
    held_by_key: dict[str, int] = {}
    for row in hold_rows:
        held_by_key[row["capacityKey"]] = held_by_key.get(row["capacityKey"], 0) + int(row["units"])
    capacity_rows = []
    for row in capacity:
        held = held_by_key.get(row["capacity_key"], 0)
        limit = db_native_int(row["limit_units"])
        if limit < 0:
            raise FinanceError("database capacity limit is negative")
        capacity_rows.append({"capacityKey": row["capacity_key"],
                              "assetUnitId": row["asset_unit_id"],
                              "locationId": row["location_id"],
                              "availableUnits": str(limit - held),
                              "heldUnits": str(held)})
    capacity_rows.sort(key=lambda row: (row["capacityKey"], row["assetUnitId"],
                                        row["locationId"]))
    return {"schemaVersion": 1, "environment": scope["environment"],
            "scopeId": scope["scope_id"], "strategyAccountId": scope["strategy_account_id"],
            "accountRevision": str(account["revision"]),
            "writerEpoch": str(account["writer_epoch"]),
            "authorityEpoch": str(account["authority_epoch"]),
            "reconciliationState": account["reconciliation_state"],
            "reconciliationReason": account["reconciliation_reason"],
            "observationSnapshotHash": account["observation_snapshot_hash"],
            "observedAt": (utc_millis(account["observed_at"])
                           if account["observed_at"] is not None else None),
            "asOf": utc_millis(as_of), "balances": balance_rows,
            "holds": hold_rows, "capacity": capacity_rows}
