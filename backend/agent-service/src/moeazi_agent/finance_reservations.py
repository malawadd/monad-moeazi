"""Account-serialized experiment risk and withdrawal reservations."""
from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
import json

from sqlalchemy import text

from .finance_contracts import (
    FinanceError, FinanceScope, ReservationComponent, ReserveCommand,
    db_native_int, native_int,
)
from .finance_policy import SizingReceipt, size_intent
from .finance_receipts import withdrawal_receipt
from .finance_market_evidence import resolve_sizing_request
from .finance_live_authority import require_live_finance_authority


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


class FinanceReservationMixin:
    async def _receipt_components(self, conn, command: ReserveCommand,
                                  account: dict, policy) -> tuple[ReservationComponent, ...]:
        row = (await conn.execute(text("""
            SELECT receipt_json,account_revision,observation_snapshot_hash,
              policy_version,policy_hash,authority_class
            FROM finance_calculation_receipts WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND receipt_hash=:hash
        """), {**_scope(command.scope),
               "hash": command.calculation_receipt_hash})).mappings().first()
        expected_authority = "live_native" if command.scope.environment == "live" else "experiment_only"
        if row is None or row["authority_class"] != expected_authority \
                or row["account_revision"] != account["revision"] \
                or row["observation_snapshot_hash"] != command.snapshot_hash \
                or row["policy_version"] != command.policy_version \
                or row["policy_hash"] != command.policy_hash:
            raise FinanceError("calculation receipt is stale or unavailable")
        body = row["receipt_json"]
        if command.purpose == "trade":
            receipt = SizingReceipt.model_validate_json(json.dumps(body))
            if receipt.receipt_hash != command.calculation_receipt_hash \
                    or size_intent(policy, receipt.request, account["revision"]) != receipt:
                raise FinanceError("trade calculation receipt cannot be reproduced")
            await resolve_sizing_request(conn, command.scope, account, policy,
                                         receipt.request)
            components = receipt.components
        else:
            if body.get("kind") != "withdrawal":
                raise FinanceError("withdrawal requires its own calculation receipt")
            expected = withdrawal_receipt(policy,
                asset_unit_id=body["assetUnitId"], registry_hash=body["registryHash"],
                location_id=body["locationId"], amount_units=body["amountUnits"],
                snapshot_hash=command.snapshot_hash,
                account_revision=account["revision"])
            if body != expected or body["receipt_hash"] != command.calculation_receipt_hash:
                raise FinanceError("withdrawal calculation receipt cannot be reproduced")
            components = tuple(ReservationComponent.model_validate(item)
                               for item in body["components"])
        if tuple(command.components) != tuple(components):
            raise FinanceError("reservation amounts differ from calculation receipt")
        return components

    async def _capacity_check(self, conn, scope: FinanceScope,
                              components: tuple[ReservationComponent, ...]) -> None:
        requested: dict[str, int] = defaultdict(int)
        identities: dict[str, tuple[str, str, str]] = {}
        for item in components:
            if item.capacity_key != f"asset:{item.asset_unit_id}:{item.location_id}":
                raise FinanceError("capacity pool identity is not canonical")
            identity = item.asset_unit_id, item.registry_hash, item.location_id
            if item.capacity_key in identities and identities[item.capacity_key] != identity:
                raise FinanceError("capacity pool aliases conflict")
            identities[item.capacity_key] = identity
            requested[item.capacity_key] += native_int(item.units, positive=True)
        for key, amount in requested.items():
            row = (await conn.execute(text("""
                SELECT cap.asset_unit_id,cap.registry_hash,cap.location_id,
                  cap.limit_units,coalesce((SELECT sum(c.units)
                    FROM finance_reservation_components c
                    JOIN finance_reservations r USING
                      (environment,scope_id,strategy_account_id,reservation_id)
                    WHERE c.environment=cap.environment AND c.scope_id=cap.scope_id
                      AND c.strategy_account_id=cap.strategy_account_id
                      AND c.capacity_key=cap.capacity_key
                      AND r.status IN ('reserved','submitted','uncertain')),0) AS held
                FROM finance_capacity cap WHERE cap.environment=:environment
                  AND cap.scope_id=:scope_id AND cap.strategy_account_id=:strategy_account_id
                  AND cap.capacity_key=:key
            """), {**_scope(scope), "key": key})).mappings().first()
            if row is None or (row["asset_unit_id"], row["registry_hash"],
                               row["location_id"]) != identities[key]:
                raise FinanceError("reservation capacity is not reconciled")
            if amount + db_native_int(row["held"]) > db_native_int(row["limit_units"]):
                raise FinanceError("account capacity would be over-reserved")

    async def reserve_intent(self, command: ReserveCommand) -> dict:
        command = ReserveCommand.model_validate(command.model_dump())
        scope = command.scope
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            prior = await self._claim(conn, scope, "reserve", command.idempotency_key,
                                      command.request_hash)
            if prior:
                return {"reservationId": prior["result_id"],
                        "revision": prior["account_revision"], "status": "reserved"}
            now = await self._writer(conn, account, command.writer_epoch)
            self._revision(account, command.expected_revision)
            if account["authority_epoch"] != command.authority_epoch \
                    or account["admission_state"] != "open":
                raise FinanceError("financial admission is stopped or authority changed")
            view = await self._read_state(conn, scope, account, now)
            if view["reconciliation_state"] != "clean" \
                    or account["observation_snapshot_hash"] != command.snapshot_hash:
                raise FinanceError("account observation is unknown, stale, or changed")
            policy = await self._receipt_policy(conn, scope, command.policy_version)
            if account["policy_version"] != policy.policy_version \
                    or account["policy_hash"] != command.policy_hash \
                    or policy.policy_hash != command.policy_hash:
                raise FinanceError("financial policy changed")
            await require_live_finance_authority(conn, scope, account, policy, now)
            seconds = (command.expires_at - now).total_seconds()
            if seconds <= 0 or seconds > policy.max_reservation_seconds:
                raise FinanceError("reservation expiry exceeds policy")
            components = await self._receipt_components(conn, command, account, policy)
            await self._capacity_check(conn, scope, components)
            reservation_id = sha256(("finance-reservation-v1:" + scope.environment + ":"
                + scope.scope_id + ":" + scope.strategy_account_id + ":"
                + command.idempotency_key).encode()).hexdigest()
            revision = account["revision"] + 1
            await conn.execute(text("""
                INSERT INTO finance_reservations(environment,scope_id,strategy_account_id,
                  reservation_id,idempotency_key,request_hash,intent_id,purpose,controller_ref,
                  controller_mode,snapshot_hash,policy_version,policy_hash,writer_epoch,
                  authority_epoch,authority_fingerprint,calculation_receipt_hash,
                  admitted_revision,status,expires_at)
                VALUES(:environment,:scope_id,:strategy_account_id,:id,:key,:request_hash,
                  :intent,:purpose,CAST(:controller AS jsonb),:mode,:snapshot,:policy,
                  :policy_hash,:writer,:authority,:fingerprint,:receipt,:revision,
                  'reserved',:expires)
            """), {**_scope(scope), "id": reservation_id,
                   "key": command.idempotency_key, "request_hash": command.request_hash,
                   "intent": command.intent_id, "purpose": command.purpose,
                   "controller": json.dumps(command.controller_ref.model_dump(),
                                            sort_keys=True, separators=(",", ":")),
                   "mode": command.controller_mode, "snapshot": command.snapshot_hash,
                   "policy": command.policy_version, "policy_hash": command.policy_hash,
                   "writer": command.writer_epoch, "authority": command.authority_epoch,
                   "fingerprint": command.authority_fingerprint,
                   "receipt": command.calculation_receipt_hash,
                   "revision": revision, "expires": command.expires_at})
            for ordinal, item in enumerate(components, 1):
                await conn.execute(text("""
                    INSERT INTO finance_reservation_components(environment,scope_id,
                      strategy_account_id,reservation_id,ordinal,capacity_key,asset_unit_id,
                      registry_hash,location_id,units)
                    VALUES(:environment,:scope_id,:strategy_account_id,:id,:ordinal,
                      :key,:asset,:registry,:location,:units)
                """), {**_scope(scope), "id": reservation_id, "ordinal": ordinal,
                       "key": item.capacity_key, "asset": item.asset_unit_id,
                       "registry": item.registry_hash,
                       "location": item.location_id, "units": item.units})
            updated = await self._advance(conn, scope, command.writer_epoch, account)
            await self._insert_claim(conn, scope, "reserve", command.idempotency_key,
                                     command.request_hash, reservation_id, revision)
            await self._outbox(conn, scope, updated)
            return {"reservationId": reservation_id, "revision": revision,
                    "status": "reserved"}
