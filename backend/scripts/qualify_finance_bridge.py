"""Opt-in dev outbox integration with simulated response loss after real publication."""
import argparse
import asyncio
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlparse

from sqlalchemy import text

from moeazi_agent.config import Settings
from moeazi_agent.convex import ConvexWorkerClient
from moeazi_agent.finance_contracts import FinanceScope, _digest
from moeazi_agent.finance_delivery import deliver_finance_outbox
from moeazi_agent.finance_repository import FinanceRepository


ROOT = Path(__file__).resolve().parents[1]
DSN = "postgresql+asyncpg://postgres:postgres@127.0.0.1:15432/moeazi_q3_bridge_20260930"


class LoseFirstResponse:
    def __init__(self, publisher):
        self.publisher = publisher
        self.receipt = None
        self.publication_seconds = None

    async def command(self, command, **payload):
        started = time.monotonic()
        self.receipt = await self.publisher.command(command, **payload)
        self.publication_seconds = time.monotonic() - started
        if self.receipt.get("applied") is not True:
            raise RuntimeError("first publication did not create or advance projection")
        raise ConnectionError("qualification response loss after remote commit")


async def qualify(prior):
    assert prior["deployment"] == "outgoing-spider-101"
    assert prior["origin"] == "test_environment_observed"
    assert prior["tag"].startswith("q1-") and prior["tag"][3:].isdigit()
    subject = f"architecture-test:{prior['tag']}:1"
    account_id = prior["records"]["accounts"][1]
    # Read only the running service's existing configuration in memory. Never log it.
    raw = subprocess.run(["docker", "inspect", "moeazi-agents-api-1",
        "--format", "{{json .Config.Env}}"], capture_output=True, text=True, check=True)
    env = dict(item.split("=", 1) for item in json.loads(raw.stdout) if "=" in item)
    worker_url = env["CONVEX_WORKER_URL"]
    parsed = urlparse(worker_url)
    assert parsed.scheme == "https" and parsed.hostname == "outgoing-spider-101.convex.site"
    settings = Settings(_env_file=None, worker_shared_secret=env["WORKER_SHARED_SECRET"],
                        convex_worker_url=worker_url, postgres_dsn=DSN)
    publisher = ConvexWorkerClient(settings)
    repository = FinanceRepository(DSN)
    tag = f"q3-bridge-{time.time_ns()}"
    report = {"tag": tag, "origin": "test_environment_observed",
        "database": "moeazi_q3_bridge_20260930", "deployment": prior["deployment"],
        "limitations": "Synthetic unfunded stopped account, unknown balances; no native or financial bootstrap certificate."}
    try:
        context = await publisher.command("getViewerFinanceScope", subject=subject, environment="live")
        assert context["scope"]["strategyAccountId"] == account_id
        scope = FinanceScope(environment="live", scope_id="live", strategy_account_id=account_id)
        epoch = await repository.acquire_writer_epoch(scope, "root-bridge-qualifier", 60)
        state = await repository.read_account_risk_snapshot(scope)
        stop = await repository.set_account_stop(scope, epoch, int(state["accountRevision"]),
            stopped=True, idempotency_key=tag, request_hash=_digest(
                "moeazi-finance-command-v1:set-stop", {"scope": scope.model_dump(), "stopped": True}))
        commit_confirmed = time.monotonic()
        assert stop["state"] == "stopped"
        lost = LoseFirstResponse(publisher)
        started = time.monotonic()
        first = await deliver_finance_outbox(repository, lost, limit=1)
        assert first["claimed"] == 1 and first["acknowledged"] == 0
        assert lost.receipt["applied"] is True
        report["publicationRoundTripSeconds"] = lost.publication_seconds
        report["publicationAfterCommitConfirmationSeconds"] = time.monotonic() - commit_confirmed
        async with repository.engine.begin() as conn:
            row = (await conn.execute(text("""
                SELECT event_id,payload_hash,payload,published_at FROM finance_outbox
                WHERE event_id=:id
            """), {"id": first["events"][0]["eventId"]})).mappings().one()
            assert row["published_at"] is None
            before = dict(row)
            # Fault injection only in this dedicated DB: expire the delivery lease.
            await conn.execute(text("""
                UPDATE finance_outbox SET claimed_until=clock_timestamp()-interval '1 second'
                WHERE event_id=:id
            """), {"id": row["event_id"]})
        second = await deliver_finance_outbox(repository, publisher, limit=1)
        assert second["acknowledged"] == 1
        assert second["events"][0]["reason"] == "duplicate"
        assert second["events"][0]["eventId"] == before["event_id"]
        async with repository.engine.connect() as conn:
            after = (await conn.execute(text("""
                SELECT payload_hash,payload,published_at FROM finance_outbox WHERE event_id=:id
            """), {"id": before["event_id"]})).mappings().one()
            assert after["published_at"] is not None
            assert after["payload_hash"] == before["payload_hash"] and after["payload"] == before["payload"]
        product_read = subprocess.run(["node", str(ROOT / "node_modules/convex/bin/main.js"),
            "run", "financeProjection:getCurrent", json.dumps({"environment": "live"}),
            "--deployment-name", prior["deployment"], "--codegen", "disable", "--typecheck", "disable",
            "--identity", json.dumps({"subject": subject})],
            capture_output=True, text=True, timeout=60, check=True)
        current = json.loads(product_read.stdout)
        assert current["projection"] == before["payload"]
        assert current["payloadHash"] == before["payload_hash"]
        assert current["authority"] == "display_only"
        report.update(result="pass", first=first, second=second,
            elapsedMonotonicSeconds=time.monotonic()-started, projection=before["payload"],
            payloadHash=before["payload_hash"])
        path = ROOT / ".data" / f"{tag}.json"
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"result": "pass", "output": str(path)}))
    finally:
        await publisher.client.aclose()
        await repository.engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-authorized-dev-check", action="store_true")
    parser.add_argument("--q1-evidence", type=Path)
    args = parser.parse_args()
    if not args.run_authorized_dev_check or not args.q1_evidence:
        parser.print_help()
    else:
        try:
            asyncio.run(qualify(json.loads(args.q1_evidence.read_text(encoding="utf-8"))))
        except Exception as error:
            print(json.dumps({"result": "fail", "errorType": type(error).__name__}))
            raise SystemExit(1) from None
