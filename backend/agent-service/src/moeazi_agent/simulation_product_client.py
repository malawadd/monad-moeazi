"""Entry identity only: no analyst, provider, billing or execution client methods."""
from __future__ import annotations

import httpx

from .finance_contracts import FinanceError
from .simulation_runtime_config import SimulationWorkerConfig


class SimulationProductClient:
    def __init__(self, settings: SimulationWorkerConfig):
        self._url = settings.convex_identity_url
        self._client = httpx.AsyncClient(timeout=10, follow_redirects=False,
            headers={"Authorization": f"Bearer {settings.identity_secret.get_secret_value()}"})

    async def command(self, command: str, **payload) -> dict | None:
        if command != "getSimulationAuthorityContext" or set(payload) != {"subject", "experimentSpecId"}:
            raise FinanceError("Simulation worker may only request current experiment identity")
        response = await self._client.post(self._url, json={"command": command, "payload": payload})
        if not response.is_success:
            raise FinanceError("Current simulation authority is unavailable")
        result = response.json()
        if not isinstance(result, dict) or result.get("error"):
            raise FinanceError("Current simulation authority is unavailable")
        return result

    async def aclose(self) -> None:
        await self._client.aclose()
