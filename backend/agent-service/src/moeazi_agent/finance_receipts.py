"""Experiment-only deterministic calculation receipts; never live permits."""
from __future__ import annotations

from hashlib import sha256
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, native_int
from .finance_market_evidence import resolve_sizing_request
from .finance_live_authority import require_live_finance_authority
from .finance_policy import SizingPolicy, SizingRequest, size_intent


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


def withdrawal_receipt(policy: SizingPolicy, *, asset_unit_id: str,
                       registry_hash: str, location_id: str, amount_units: str,
                       snapshot_hash: str, account_revision: int) -> dict:
    amount = native_int(amount_units, positive=True)
    fee = native_int(policy.fee_ceiling_units, nonnegative=True)
    if fee != 0:
        raise FinanceError("withdrawal fee asset is not specified by this policy")
    body = {"kind": "withdrawal", "policyVersion": policy.policy_version,
            "policyHash": policy.policy_hash, "snapshotHash": snapshot_hash,
            "accountRevision": str(account_revision),
            "assetUnitId": asset_unit_id, "registryHash": registry_hash,
            "locationId": location_id, "amountUnits": str(amount),
            "components": [{"capacity_key": f"asset:{asset_unit_id}:{location_id}",
                            "asset_unit_id": asset_unit_id, "registry_hash": registry_hash,
                            "location_id": location_id, "units": str(amount + fee)}]}
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {**body, "receipt_hash": sha256(("moeazi-finance-withdrawal-v1\n"
                                            + raw).encode()).hexdigest()}


class FinanceReceiptMixin:
    async def _receipt_policy(self, conn, scope: FinanceScope,
                              policy_version: str) -> SizingPolicy:
        row = (await conn.execute(text("""
            SELECT policy_json,policy_hash FROM finance_policy_versions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND policy_version=:version
        """), {**_scope(scope), "version": policy_version})).mappings().first()
        if row is None:
            raise FinanceError("financial sizing policy is unavailable")
        policy = SizingPolicy.model_validate(row["policy_json"])
        if policy.policy_hash != row["policy_hash"]:
            raise FinanceError("stored financial policy hash differs")
        return policy

    async def _store_receipt(self, conn, scope: FinanceScope, account: dict,
                             policy: SizingPolicy, receipt: dict, digest: str) -> None:
        old = (await conn.execute(text("""
            SELECT receipt_json,account_revision,observation_snapshot_hash,
              policy_version,policy_hash FROM finance_calculation_receipts
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND receipt_hash=:hash
        """), {**_scope(scope), "hash": digest})).mappings().first()
        if old is not None:
            if old["receipt_json"] != receipt or old["account_revision"] != account["revision"]:
                raise FinanceError("calculation receipt hash collision or stale replay")
            return
        await conn.execute(text("""
            INSERT INTO finance_calculation_receipts(environment,scope_id,strategy_account_id,
              receipt_hash,account_revision,observation_snapshot_hash,policy_version,
              policy_hash,receipt_json,authority_class)
            VALUES(:environment,:scope_id,:strategy_account_id,:hash,:revision,
              :snapshot,:policy,:policy_hash,CAST(:body AS jsonb),:authority_class)
        """), {**_scope(scope), "hash": digest, "revision": account["revision"],
               "snapshot": account["observation_snapshot_hash"],
               "policy": policy.policy_version, "policy_hash": policy.policy_hash,
               "body": json.dumps(receipt, sort_keys=True, separators=(",", ":"),
                                  ensure_ascii=False),
               "authority_class": "live_native" if scope.environment == "live"
                                  else "experiment_only"})

    async def _prepare(self, conn, scope: FinanceScope, writer_epoch: int,
                       expected_revision: int, policy_version: str) -> tuple[dict, SizingPolicy]:
        account = await self._lock(conn, scope)
        await self._writer(conn, account, writer_epoch)
        self._revision(account, expected_revision)
        view = await self._read_state(conn, scope, account, await self._db_now(conn))
        if view["reconciliation_state"] != "clean" or account["admission_state"] != "open":
            raise FinanceError("financial account is not clean and admitted")
        policy = await self._receipt_policy(conn, scope, policy_version)
        if account["policy_hash"] != policy.policy_hash:
            raise FinanceError("financial policy changed")
        await require_live_finance_authority(conn, scope, account, policy,
                                             await self._db_now(conn))
        return account, policy

    async def prepare_experiment_sizing_receipt(
        self, scope: FinanceScope, writer_epoch: int, expected_revision: int,
        policy_version: str, request: SizingRequest,
    ) -> dict:
        async with self.engine.begin() as conn:
            account, policy = await self._prepare(conn, scope, writer_epoch,
                                                  expected_revision, policy_version)
            authoritative = await resolve_sizing_request(conn, scope, account, policy, request)
            receipt = size_intent(policy, authoritative, account["revision"])
            body = receipt.model_dump(mode="json")
            await self._store_receipt(conn, scope, account, policy, body,
                                      receipt.receipt_hash)
            return {**body, "authorityClass": "live_native" if scope.environment == "live"
                    else "experiment_only"}

    async def prepare_experiment_withdrawal_receipt(
        self, scope: FinanceScope, writer_epoch: int, expected_revision: int,
        policy_version: str, asset_unit_id: str, location_id: str, amount_units: str,
    ) -> dict:
        async with self.engine.begin() as conn:
            account, policy = await self._prepare(conn, scope, writer_epoch,
                                                  expected_revision, policy_version)
            row = (await conn.execute(text("""
                SELECT asset_unit_id,registry_hash,location_id FROM finance_capacity
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND asset_unit_id=:asset
                  AND location_id=:location
            """), {**_scope(scope), "asset": asset_unit_id,
                   "location": location_id})).mappings().first()
            if row is None:
                raise FinanceError("withdrawal asset/location has no reconciled capacity")
            receipt = withdrawal_receipt(policy, asset_unit_id=asset_unit_id,
                registry_hash=row["registry_hash"], location_id=location_id,
                amount_units=amount_units,
                snapshot_hash=account["observation_snapshot_hash"],
                account_revision=account["revision"])
            await self._store_receipt(conn, scope, account, policy, receipt,
                                      receipt["receipt_hash"])
            return {**receipt, "authorityClass": "live_native" if scope.environment == "live"
                    else "experiment_only"}
