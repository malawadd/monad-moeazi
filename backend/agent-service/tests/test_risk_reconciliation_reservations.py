import asyncio

import pytest

from moeazi_agent.risk_reconciliation_reservations import key, reserve
from moeazi_agent.risk_reconciliation_scenarios import evaluate_fixture
from moeazi_agent.risk_reconciliation_canonical import digest
from moeazi_agent.risk_reconciliation_storage import RiskReconciliationRepository
from datetime import datetime, timezone


class FakeRedis:
    def __init__(self): self.values = {}; self.totals = {}

    async def eval(self, _script, _keys, request_key, total_key, delta, ceiling, _ttl, payload):
        if request_key in self.values: return self.values[request_key]
        value = self.totals.get(total_key, 0)
        if value + int(delta) > int(ceiling): return "CONFLICT"
        self.totals[total_key] = value + int(delta); self.values[request_key] = payload
        return payload


def test_reservation_namespace_is_test_center_only():
    value = key("operator", "run-abc", "a" * 64)
    assert value.startswith("moeazi:test-center:risk-reservations:v1:") and "a" * 64 in value


def test_fixture_redis_retry_is_exact_and_scope_partitioned():
    result = evaluate_fixture("complete-fresh-snapshot", "observe",
        datetime(2026, 8, 14, tzinfo=timezone.utc), "operator", "a" * 64)
    reservation = result["_reservation"]; redis = FakeRedis()
    async def exercise():
        first = await reserve(redis, "operator", "run", reservation, 100, 30)
        assert await reserve(redis, "operator", "run", reservation, 100, 30) == first
    asyncio.run(exercise())
    assert key("operator", "run", digest(reservation.scope)) != key("operator", "run", "b" * 64)


def test_immutable_rows_reconstruct_uncertain_capacity_holds():
    result = evaluate_fixture("complete-fresh-snapshot", "observe",
        datetime(2026, 8, 14, tzinfo=timezone.utc), "operator", "a" * 64)
    reservation = result["_reservation"]
    held = RiskReconciliationRepository.reconstruct_reservations([reservation])
    assert held[reservation.reservation_id].reservation_hash == reservation.reservation_hash
