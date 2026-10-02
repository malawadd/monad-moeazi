import asyncio
import statistics
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.config import get_settings
from moeazi_agent.operational_secret_contracts import digest
from moeazi_agent.operational_secret_evaluator import envelope_metadata
from moeazi_agent.operational_secret_fake_vault import FakeVault
from moeazi_agent.operational_secret_operations import build_access_request, build_descriptor
from moeazi_agent.operational_secret_storage import OperationalSecretRepository

SCHEMA = "operational_secret_bench_20260810"


async def main() -> None:
    engine = create_async_engine(get_settings().postgres_dsn,
        connect_args={"server_settings": {"search_path": f"{SCHEMA},public"}})
    repository = OperationalSecretRepository(engine)
    samples = []
    for index in range(40):
        now, expires = datetime.now(timezone.utc), datetime.now(timezone.utc) + timedelta(minutes=2)
        descriptor = build_descriptor(seed=f"bench-{index}",
            tenant_scope="tenant_aaaaaaaaaaaaaaaa:account_bbbbbbbbbbbbbbbb",
            class_id="internal_service_auth", source_owner="platform")
        vault = FakeVault(environment="test", frozen_lease=True, development_gates_closed=True,
            fixture_id="osc-bench-v1", fake_keks={1: bytes.fromhex("11" * 32)})
        handle = vault.store_fixture(descriptor, b"fixture-benchmark", expires)
        request = build_access_request(descriptor=descriptor, purpose="service_auth",
            consumer_id="service_auth_boundary", consumer_version="v1",
            capability="authenticate_service", aad_hash=digest(envelope_metadata(descriptor, expires)),
            idempotency_key=f"bench:access:{index}", requested_at=now)
        started = time.perf_counter_ns()
        await vault.access(handle, request, repository, lambda value: len(value), now)
        samples.append((time.perf_counter_ns() - started) / 1_000_000)
    samples.sort()
    p95 = samples[int(len(samples) * 0.95) - 1]
    print(f"receipt_access_ms median={statistics.median(samples):.3f} "
          f"p95={p95:.3f} max={max(samples):.3f} n={len(samples)}")
    if p95 >= 100:
        raise RuntimeError("Receipt persistence p95 threshold missed")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
