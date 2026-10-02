"""Worker import/config boundaries, without connecting to any external service."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from moeazi_agent import simulation_worker
from test_stage3_simulation_runtime_config import config


@pytest.mark.asyncio
async def test_disabled_worker_cannot_create_database_or_network_clients(monkeypatch):
    calls = []

    def forbidden(*args, **kwargs):
        calls.append("unexpected")
        raise AssertionError("Disabled worker constructed a service client")

    monkeypatch.setattr(simulation_worker, "FinanceRepository", forbidden)
    monkeypatch.setattr(simulation_worker, "SimulationProductClient", forbidden)
    with pytest.raises(RuntimeError, match="worker is disabled"):
        await simulation_worker.run(config())
    assert calls == []


def test_fresh_worker_import_has_no_analyst_provider_or_signer_modules():
    script = """
import json,sys
import moeazi_agent.simulation_worker
forbidden={'moeazi_agent.config','moeazi_agent.convex','moeazi_agent.providers',
 'moeazi_agent.venues','moeazi_agent.execution_workflow','moeazi_agent.temporal_app'}
print(json.dumps(sorted(forbidden.intersection(sys.modules))))
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True,
                            text=True, check=True, timeout=20)
    assert json.loads(result.stdout) == []


def test_worker_overlay_cannot_inherit_shared_provider_or_wallet_environment():
    # Read the committed launch definition without rendering secrets or starting
    # Compose. This boundary test is not a runtime network-isolation certificate.
    root = Path(__file__).resolve().parents[2]
    source = (root / "docker-compose.simulation.yml").read_text(encoding="utf-8")
    body = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))
    assert "env_file:" not in body and "<<:" not in body
    environment = body.split("    environment:\n", 1)[1].split("    depends_on:", 1)[0]
    names = {line.strip().split(":", 1)[0] for line in environment.splitlines() if line.strip()}
    assert names == {"TRADING_SIMULATION_ENABLED", "TRADING_SIMULATION_POSTGRES_DSN",
        "TRADING_SIMULATION_CONVEX_IDENTITY_URL", "TRADING_SIMULATION_IDENTITY_SECRET",
        "TRADING_SIMULATION_TEMPORAL_ADDRESS", "TRADING_SIMULATION_TEMPORAL_NAMESPACE",
        "TRADING_SIMULATION_MAX_CONCURRENT_ACTIVITIES"}
    assert "TRADING_SIMULATION_ENABLED:-false" in body
    assert "TRADING_SIMULATION_POSTGRES_DSN:-}" in body
    assert "timescaledb:5432/moeazi" not in body
    assert "${WORKER_SHARED_SECRET" not in body
    assert "read_only: true" in body and "cap_drop: [ALL]" in body
