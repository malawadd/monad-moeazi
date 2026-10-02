"""Two-phase, disposable-DB proof that Redis restart cannot erase a finance hold.

Run prepare, restart local Redis externally with workers stopped, then run verify.
Neither phase connects to or controls Redis. The checkpoint contains no DSN.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.finance_repository import FinanceRepository
from test_stage2_finance_postgres_reservations import reserve_command
from test_stage2_finance_postgres_sizing import setup_spot_account


ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT = ROOT / ".data" / "q3-redis-restart-checkpoint.json"
RESULT = ROOT / ".data" / "q3-redis-restart-result.json"


def qualification_dsn():
    raw = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not raw:
        raise RuntimeError("Set MOEAZI_TEST_POSTGRES_DSN to the disposable Q3 DB")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q3_20260930"
    ):
        raise RuntimeError("Refusing any database other than disposable loopback Q3")
    return raw


async def financial_state(engine, scope, asset_unit_id, reservation_id):
    args = scope.model_dump()
    async with engine.connect() as conn:
        account = (await conn.execute(text("""
            SELECT revision,writer_epoch,authority_epoch,admission_state,
                   reconciliation_state,observation_snapshot_hash,
                   policy_version,policy_hash FROM finance_accounts
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), args)).mappings().one()
        balance = (await conn.execute(text("""
            SELECT units FROM finance_balances
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
              AND asset_unit_id=:asset AND location_id='wallet' AND book='wallet'
        """), {**args, "asset": asset_unit_id})).scalar_one()
        capacity = (await conn.execute(text("""
            SELECT limit_units FROM finance_capacity
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
              AND asset_unit_id=:asset AND location_id='wallet'
        """), {**args, "asset": asset_unit_id})).scalar_one()
        held = (await conn.execute(text("""
            SELECT r.status,c.units FROM finance_reservations r
            JOIN finance_reservation_components c USING
              (environment,scope_id,strategy_account_id,reservation_id)
            WHERE r.environment=:environment AND r.scope_id=:scope_id
              AND r.strategy_account_id=:strategy_account_id
              AND r.reservation_id=:reservation AND c.asset_unit_id=:asset
        """), {**args, "reservation": reservation_id,
                "asset": asset_unit_id})).mappings().one()
        outbox = (await conn.execute(text("""
            SELECT count(*) AS total,
                   max(account_revision) AS latest_revision
            FROM finance_outbox WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
        """), args)).mappings().one()
        latest = (await conn.execute(text("""
            SELECT event_id,payload_hash FROM finance_outbox
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
              AND account_revision=:revision
        """), {**args, "revision": outbox["latest_revision"]})).mappings().one()
    return {
        "revision": str(account["revision"]),
        "writerEpoch": str(account["writer_epoch"]),
        "authorityEpoch": str(account["authority_epoch"]),
        "admissionState": account["admission_state"],
        "reconciliationState": account["reconciliation_state"],
        "observationSnapshotHash": account["observation_snapshot_hash"],
        "policyVersion": account["policy_version"],
        "policyHash": account["policy_hash"],
        "balanceUnits": str(int(balance)),
        "capacityLimitUnits": str(int(capacity)),
        "reservationStatus": held["status"],
        "heldUnits": str(int(held["units"])),
        "outboxCount": outbox["total"],
        "outboxRevision": str(outbox["latest_revision"]),
        "outboxEventId": latest["event_id"],
        "outboxPayloadHash": latest["payload_hash"],
    }


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n",
                    encoding="utf-8")


async def prepare(engine):
    if CHECKPOINT.exists():
        raise RuntimeError("Checkpoint exists; use verify or retire it explicitly")
    identity = uuid4().hex
    repo, scope, epoch, instrument, snapshot, _, policy, opened = \
        await setup_spot_account(engine, identity)
    epoch = await repo.acquire_writer_epoch(scope, "stage2-verifier", 300)
    asset = instrument.quote_asset_unit_id
    receipt = await repo.prepare_experiment_withdrawal_receipt(scope, epoch,
        opened["revision"], policy.policy_version, asset, "wallet", "70")
    command = await reserve_command(engine, scope, epoch, opened,
        policy, snapshot, receipt, purpose="withdrawal", team="owner",
        intent=f"redis-restart-hold-{identity}", revision=opened["revision"])
    reserved = await repo.reserve_intent(command)
    assert reserved["status"] == "reserved"
    state = await financial_state(engine, scope, asset, reserved["reservationId"])
    assert (state["balanceUnits"], state["heldUnits"],
            state["capacityLimitUnits"], state["revision"],
            state["outboxCount"]) == ("100", "70", "100", "3", 3)
    view = await repo.read_withdrawable_balance(scope, asset, "wallet")
    assert view["status"] == "available" and view["units"] == "30", view
    save(CHECKPOINT, {"scope": scope.model_dump(), "assetUnitId": asset,
        "reservationId": reserved["reservationId"], "state": state,
        "withdrawableUnits": view["units"]})
    print(json.dumps({"phase": "prepared", "checkpoint": str(CHECKPOINT),
                      "state": state}, sort_keys=True))


async def verify(engine):
    saved = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    scope = FinanceScope.model_validate(saved["scope"])
    asset = saved["assetUnitId"]
    reservation = saved["reservationId"]
    # A new repository object and connection pool reconstruct only from SQL.
    repo = FinanceRepository(engine)
    before = await financial_state(engine, scope, asset, reservation)
    assert before == saved["state"], (before, saved["state"])
    view = await repo.read_withdrawable_balance(scope, asset, "wallet")
    assert view["status"] == "available" and view["units"] == "30", view
    epoch = await repo.acquire_writer_epoch(scope, "stage2-verifier", 300)
    receipt = await repo.prepare_experiment_withdrawal_receipt(scope, epoch,
        int(before["revision"]), before["policyVersion"], asset, "wallet", "40")
    command = await reserve_command(engine, scope, epoch,
        {"authorityEpoch": int(before["authorityEpoch"])},
        type("PolicyRef", (), {"policy_version": before["policyVersion"],
                               "policy_hash": before["policyHash"]})(),
        type("SnapshotRef", (), {"snapshot_hash":
                                 before["observationSnapshotHash"]})(),
        receipt, purpose="withdrawal", team="owner",
        intent=f"redis-restart-overreserve-{reservation}",
        revision=int(before["revision"]))
    try:
        await repo.reserve_intent(command)
    except FinanceError as exc:
        if "over-reserved" not in str(exc):
            raise AssertionError(f"Expected capacity denial; got {exc}") from exc
    else:
        raise AssertionError("Over-reservation was admitted")
    after = await financial_state(engine, scope, asset, reservation)
    # Renewing a lease may advance its epoch after a long pause; economics cannot.
    assert {k: v for k, v in after.items() if k != "writerEpoch"} == {
        k: v for k, v in before.items() if k != "writerEpoch"}, (after, before)
    result = {"phase": "verified", "checkpoint": str(CHECKPOINT),
              "result": "pass", "holdRetained": True,
              "capacityDenial": "over-reserved", "state": after}
    save(RESULT, result)
    print(json.dumps(result, sort_keys=True))


async def main(phase):
    engine = create_async_engine(qualification_dsn(), pool_pre_ping=True)
    try:
        if phase == "prepare":
            await prepare(engine)
        else:
            await verify(engine)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "verify"))
    asyncio.run(main(parser.parse_args().phase))
