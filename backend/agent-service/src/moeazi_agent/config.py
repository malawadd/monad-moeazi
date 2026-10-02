from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"
    service_name: str = "moeazi-agent-service"
    api_host: str = "0.0.0.0"
    api_port: int = 8100
    worker_shared_secret: SecretStr = SecretStr("local-only-change-me")
    convex_worker_url: str = "http://host.docker.internal:3000/worker"
    convex_gateway_credential_url: str = ""
    gateway_credential_secret: SecretStr = SecretStr("")
    temporal_address: str = "temporal:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "moeazi-analysis"
    postgres_dsn: str = "postgresql+asyncpg://postgres:postgres@timescaledb:5432/moeazi"
    redis_url: str = "redis://redis:6379/0"
    otel_exporter_otlp_endpoint: str = ""

    openai_api_key: SecretStr = SecretStr("")
    deepseek_api_key: SecretStr = SecretStr("")
    openrouter_api_key: SecretStr = SecretStr("")
    deepseek_base_url: str = "https://api.deepseek.com"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_http_referer: str = "https://moeazi.com"
    openrouter_app_title: str = "Moeazi"
    openai_specialist_model: str = "gpt-5.4-mini"
    openai_synthesis_model: str = "gpt-5.6-sol"
    deepseek_specialist_model: str = "deepseek-v4-flash"
    deepseek_synthesis_model: str = "deepseek-v4-pro"
    provider_timeout_seconds: float = 45.0
    provider_max_concurrency: int = Field(default=40, ge=1, le=500)
    provider_retries: int = Field(default=2, ge=0, le=5)
    provider_mode: str = "balanced"
    byok_enabled: bool = True
    byok_secret_backend: str = "local"
    byok_aws_kms_key_id: str = ""
    byok_aws_region: str = "us-east-1"
    trace_body_retention_days: int = Field(default=7, ge=1, le=30)
    evaluation_trace_retention_days: int = Field(default=90, ge=1, le=365)
    evaluation_task_queue: str = "moeazi-evaluations"
    evaluation_global_budget_usd: float = Field(default=0.10, ge=0, le=10_000)
    evaluation_operator_subjects: str = ""
    deepseek_thinking_enabled: bool = False
    specialist_max_output_tokens: int = Field(default=700, ge=128, le=4_096)
    synthesis_max_output_tokens: int = Field(default=1_200, ge=256, le=8_192)
    evidence_max_items: int = Field(default=8, ge=1, le=30)
    evidence_max_chars_per_item: int = Field(default=700, ge=100, le=4_000)
    scheduled_analysis_enabled: bool = False
    agent_dev_controls_enabled: bool = True
    agent_manual_guard_default: bool = True
    agent_lite_mode_default: bool = True
    dev_starter_credits: int = Field(default=100, ge=0, le=100_000)
    dev_lite_account_runs_per_day: int = Field(default=4, ge=1, le=100)
    dev_lite_global_runs_per_day: int = Field(default=8, ge=1, le=1_000)
    dev_lite_provider_budget_usd: float = Field(default=0.10, ge=0, le=100)

    quicknode_stream_url: str = ""
    cryptopanic_api_key: SecretStr = SecretStr("")
    x_bearer_token: SecretStr = SecretStr("")
    uniswap_api_key: SecretStr = SecretStr("")
    uniswap_api_url: str = "https://trade-api.gateway.uniswap.org/v1"
    master_key: SecretStr = SecretStr("")
    live_execution_enabled: bool = False
    managed_vault_execution_enabled: bool = False
    managed_vault_execution_secret: SecretStr = SecretStr("")
    managed_vault_auto_policy_max_usdc_units: int = Field(default=0, ge=0, le=1_000_000_000_000)
    managed_vault_internal_test_address: str = Field(default="",
        pattern=r"^(?:|0x[a-f0-9]{40})$")
    dependency_safety_mode: str = Field(default="observe", pattern=r"^(observe|enforce)$")
    agent_test_center_enabled: bool = False
    test_center_operator_subjects: str = ""
    test_center_bind_host: str = "127.0.0.1"
    test_center_external_network_enabled: bool = False
    test_center_repository_sha: str = ""
    mainnet_venue_setup_enabled: bool = False
    arbitrum_rpc_url: str = ""
    certified_venues: str = ""
    execution_gateway_url: str = "http://execution-gateway:8200"
    execution_sidecar_url: str = "http://execution-sidecar:8300"
    agent_api_url: str = "http://api:8100"
    hyperliquid_api_url: str = "https://api.hyperliquid.xyz/info"
    lighter_api_url: str = "https://mainnet.zklighter.elliot.ai"
    orderly_api_url: str = "https://api.orderly.org"
    ostium_rpc_url: str = ""
    routing_timeout_seconds: float = Field(default=8, ge=1, le=30)
    routing_preview_cache_seconds: int = Field(default=10, ge=1, le=60)
    routing_market_cache_seconds: int = Field(default=300, ge=30, le=3600)
    hyperliquid_taker_fee_bps: float = Field(default=4.5, ge=0, le=100)
    orderly_taker_fee_bps: float = Field(default=6, ge=0, le=100)
    orderly_proxy_spread_bps: float = Field(default=2, ge=0, le=100)
    gmx_position_fee_bps: float = Field(default=6, ge=0, le=100)
    gmx_proxy_spread_bps: float = Field(default=4, ge=0, le=100)
    ostium_proxy_spread_bps: float = Field(default=6, ge=0, le=100)

    @property
    def certified_venue_set(self) -> frozenset[str]:
        return frozenset(item.strip().lower() for item in self.certified_venues.split(",") if item.strip())

    @property
    def evaluation_operator_set(self) -> frozenset[str]:
        return frozenset(
            item.strip() for item in self.evaluation_operator_subjects.split(",") if item.strip()
        )

    @property
    def test_center_operator_set(self) -> frozenset[str]:
        return frozenset(
            item.strip() for item in self.test_center_operator_subjects.split(",") if item.strip()
        )

    @model_validator(mode="after")
    def live_execution_requires_safety_enforcement(self):
        if self.live_execution_enabled and self.dependency_safety_mode != "enforce":
            raise ValueError("LIVE_EXECUTION_ENABLED requires DEPENDENCY_SAFETY_MODE=enforce")
        if self.agent_test_center_enabled:
            safe_environment = self.environment.lower() in {"local", "development", "test"}
            if not safe_environment or self.live_execution_enabled or self.mainnet_venue_setup_enabled:
                raise ValueError("Test Center requires an explicit local/test environment with live gates closed")
            if self.certified_venue_set or self.test_center_external_network_enabled:
                raise ValueError("Test Center rejects certified venues and external network access")
            if self.test_center_bind_host not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("Test Center must be configured loopback-only")
            if not self.test_center_operator_set:
                raise ValueError("Test Center requires an explicit operator allowlist")
            if not __import__("re").fullmatch(r"[a-f0-9]{40}", self.test_center_repository_sha):
                raise ValueError("Test Center requires a frozen repository SHA")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
