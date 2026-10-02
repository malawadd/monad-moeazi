from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from temporalio.client import WorkflowExecutionStatus

from moeazi_agent import managed_schedule_status_api
from moeazi_agent.managed_schedule_status_api import recent_check


@pytest.mark.asyncio
async def test_recent_check_reports_actual_skipped_workflow_outcome():
    started = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)

    class Handle:
        async def describe(self):
            return SimpleNamespace(status=WorkflowExecutionStatus.COMPLETED)

        async def result(self):
            return {"status": "skipped"}

    temporal = SimpleNamespace(get_workflow_handle=lambda _id: Handle())
    action = SimpleNamespace(started_at=started,
        action=SimpleNamespace(workflow_id="schedule-check-one"))
    result = await recent_check(temporal, "WETH-USDC", action)
    assert result == {"market": "WETH-USDC", "workflowId": "schedule-check-one",
        "startedAt": started.isoformat(), "status": "skipped", "reason": None}


@pytest.mark.asyncio
async def test_lite_provider_health_exposes_only_availability(monkeypatch):
    managed_schedule_status_api._provider_health = None

    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def get(self, _url, headers):
            assert headers["Authorization"] == "Bearer private-key"
            return SimpleNamespace(is_success=True,
                json=lambda: {"is_available": False, "balance_infos": [{"total_balance": "0"}]})

    monkeypatch.setattr(managed_schedule_status_api.httpx, "AsyncClient",
        lambda **_kwargs: Client())
    settings = SimpleNamespace(deepseek_api_key=SimpleNamespace(
        get_secret_value=lambda: "private-key"))
    assert await managed_schedule_status_api.lite_provider_health(settings, ("deepseek",)) == "unavailable"
    assert managed_schedule_status_api._provider_health[2] == "unavailable"


@pytest.mark.asyncio
async def test_mobile_health_checks_released_lite_routes_not_dormant_providers(monkeypatch):
    managed_schedule_status_api._provider_health = None
    context = {"modelConfiguration": {"routes": {"routes": [
        {"slot": "specialist_default", "provider": "openrouter"},
        {"slot": "role:technical_trend", "provider": "openrouter"},
        {"slot": "critic", "provider": "deepseek"},
    ]}}}
    providers = managed_schedule_status_api.lite_route_providers(context)
    assert providers == ("openrouter",)

    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def get(self, url, headers):
            assert url == "https://openrouter.ai/api/v1/key"
            assert headers["Authorization"] == "Bearer test-router-key"
            return SimpleNamespace(is_success=True, status_code=200,
                json=lambda: {"data": {"limit_remaining": 0.49}})

    monkeypatch.setattr(managed_schedule_status_api.httpx, "AsyncClient",
        lambda **_kwargs: Client())
    settings = SimpleNamespace(openrouter_api_key=SimpleNamespace(
        get_secret_value=lambda: "test-router-key"))
    assert await managed_schedule_status_api.lite_provider_health(settings, providers) == "available"
