"""Explicit minimal configuration for the non-live simulation worker."""
from __future__ import annotations

from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

from .finance_contracts import FinanceError, FinanceScope, _digest


SIMULATION_QUEUE = "moeazi-trading-simulation-v1"
SIMULATION_WORKFLOW = "MoeaziSimulationSupervisorV1"


class SimulationWorkerConfig(BaseSettings):
    # No shared .env file, model routing, signer or venue credential configuration.
    model_config = SettingsConfigDict(env_prefix="TRADING_SIMULATION_", env_file=None,
                                     extra="forbid", hide_input_in_errors=True)
    enabled: bool = False
    postgres_dsn: SecretStr
    convex_identity_url: str
    identity_secret: SecretStr
    temporal_address: str = "127.0.0.1:7233"
    temporal_namespace: str = "default"
    max_concurrent_activities: int = Field(default=2, ge=1, le=8)

    @field_validator("postgres_dsn")
    @classmethod
    def database_driver(cls, value: SecretStr) -> SecretStr:
        try:
            parsed = make_url(value.get_secret_value())
            if parsed.drivername != "postgresql+asyncpg" or not parsed.database:
                raise ValueError("wrong driver")
        except Exception:
            raise ValueError("Simulation requires an explicit async PostgreSQL database") from None
        return value

    @field_validator("convex_identity_url")
    @classmethod
    def worker_endpoint(cls, value: str) -> str:
        parsed = urlparse(value)
        local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed.username or parsed.password or parsed.query or parsed.fragment \
                or parsed.path != "/simulation-worker" or not parsed.hostname \
                or (parsed.scheme != "https" and not (local and parsed.scheme == "http")):
            raise ValueError("Simulation requires the explicit HTTPS worker endpoint")
        return value

    @field_validator("identity_secret")
    @classmethod
    def worker_secret_present(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("Simulation worker authentication needs at least 32 characters")
        return value


def simulation_workflow_id(scope: FinanceScope, run_id: str) -> str:
    if scope.environment != "experiment" or not run_id or len(run_id) > 256:
        raise FinanceError("Simulation workflow requires a bounded experimental run")
    digest = _digest("moeazi-simulation-workflow-v1", {
        "scope": scope.model_dump(), "runId": run_id})
    return f"simulation-v1:{digest}"
