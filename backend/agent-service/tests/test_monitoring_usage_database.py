"""Run with MOEAZI_TEST_POSTGRES_DSN against a disposable local Timescale database."""

import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.tracing import TraceRepository
from moeazi_agent.monitoring_api import _unattributed_usage


def test_legacy_usage_is_account_remainder_without_double_counting():
    base = {"day": "2026-09-29", "provider": "local", "model": "fixture",
            "credential_source": "platform", "calls": 3, "successful_calls": 2,
            "input_tokens": 30, "cached_input_tokens": 0, "output_tokens": 20,
            "provider_cost_microusd": 300, "platform_credits": 9, "latency_ms": 300}
    team = {**base, "calls": 2, "successful_calls": 1, "input_tokens": 20,
            "output_tokens": 10, "provider_cost_microusd": 200,
            "platform_credits": 6, "latency_ms": 200}
    rows = _unattributed_usage([base], [team])
    assert rows[0]["calls"] == 1
    assert rows[0]["provider_cost_microusd"] == 100
    assert rows[0]["team_id"] is None


def test_usage_summary_date_cutoff_executes_against_postgres():
    dsn = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not dsn:
        pytest.skip("Set MOEAZI_TEST_POSTGRES_DSN for the database regression test")

    async def check():
        engine = create_async_engine(dsn)
        try:
            rows = await TraceRepository(engine).usage_summary(f"regression-{uuid4()}", 7)
            assert rows == []
        finally:
            await engine.dispose()

    asyncio.run(check())
