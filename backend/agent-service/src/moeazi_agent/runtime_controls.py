from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict
from redis.asyncio import Redis

from .config import Settings


RUNTIME_KEY = "moeazi:runtime-controls:v1"
CONFIRMATION = "DISABLE SAFEGUARD"


class RuntimeControls(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manual_guard: bool
    lite_mode: bool
    version: int
    updated_at: str
    updated_by: str


class RuntimeControlUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manual_guard: bool | None = None
    lite_mode: bool | None = None
    expected_version: int | None = None
    confirmation: str | None = None
    updated_by: str = "agent-lab"


class RuntimeControlStore:
    def __init__(self, redis: Redis, settings: Settings):
        self.redis = redis
        self.settings = settings

    def defaults(self) -> RuntimeControls:
        return RuntimeControls(
            manual_guard=self.settings.agent_manual_guard_default,
            lite_mode=self.settings.agent_lite_mode_default,
            version=1,
            updated_at=datetime.now(timezone.utc).isoformat(),
            updated_by="safe-defaults",
        )

    async def get(self) -> RuntimeControls:
        try:
            raw = await self.redis.get(RUNTIME_KEY)
        except Exception:
            return self.defaults()
        if not raw:
            return self.defaults()
        try:
            value = raw.decode() if isinstance(raw, bytes) else raw
            return RuntimeControls.model_validate_json(value)
        except Exception:
            return self.defaults()

    async def update(self, request: RuntimeControlUpdate) -> RuntimeControls:
        if not self.settings.agent_dev_controls_enabled:
            raise RuntimeError("Development runtime controls are disabled")
        current = await self.get()
        if request.expected_version is not None and request.expected_version != current.version:
            raise RuntimeError("Runtime controls changed; refresh before trying again")
        manual = current.manual_guard if request.manual_guard is None else request.manual_guard
        lite = current.lite_mode if request.lite_mode is None else request.lite_mode
        relaxing = (current.manual_guard and not manual) or (current.lite_mode and not lite)
        if relaxing and request.confirmation != CONFIRMATION:
            raise RuntimeError(f'Type "{CONFIRMATION}" to disable a safeguard')
        next_value = RuntimeControls(
            manual_guard=manual,
            lite_mode=lite,
            version=current.version + 1,
            updated_at=datetime.now(timezone.utc).isoformat(),
            updated_by=request.updated_by[:80],
        )
        await self.redis.set(RUNTIME_KEY, next_value.model_dump_json())
        return next_value

    async def reset(self, updated_by: str = "agent-lab") -> RuntimeControls:
        current = await self.get()
        value = self.defaults().model_copy(update={
            "version": current.version + 1,
            "updated_by": updated_by[:80],
        })
        await self.redis.set(RUNTIME_KEY, value.model_dump_json())
        return value

    def response(self, controls: RuntimeControls) -> dict:
        return {
            **controls.model_dump(mode="json"),
            "enabled": self.settings.agent_dev_controls_enabled,
            "limits": {
                "specialistCalls": 2,
                "synthesisCalls": 0,
                "activeMarkets": 1,
                "minimumCadenceMinutes": 15,
                "accountRunsPerDay": self.settings.dev_lite_account_runs_per_day,
                "globalRunsPerDay": self.settings.dev_lite_global_runs_per_day,
                "providerBudgetUsd": self.settings.dev_lite_provider_budget_usd,
                "maxEvidenceItems": 3,
                "maxEvidenceChars": 300,
                "maxOutputTokens": 250,
                "providerRetries": 0,
                "providerConcurrency": 1,
            },
        }

    async def dashboard_response(self, controls: RuntimeControls) -> dict:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            runs, spend, latest = await self.redis.mget(
                f"moeazi:lite-runs:global:{day}",
                f"moeazi:lite-provider-microusd:{day}",
                "moeazi:latest-run-metrics",
            )
        except Exception:
            runs, spend, latest = 0, 0, None
        try:
            latest_value = RuntimeRunMetrics.model_validate_json(latest) if latest else None
        except Exception:
            latest_value = None
        return {
            **self.response(controls),
            "usage": {
                "globalRunsToday": int(runs or 0),
                "providerSpendUsd": int(spend or 0) / 1_000_000,
                "latestRun": latest_value.model_dump(mode="json") if latest_value else None,
            },
        }

    async def record_run_metrics(self, metrics: "RuntimeRunMetrics") -> None:
        await self.redis.setex("moeazi:latest-run-metrics", 86_400, metrics.model_dump_json())

    async def reserve_lite_run(self, account_id: str | None, estimated_cost_usd: float = 0.01) -> None:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        account = account_id or "platform-public"
        account_key = f"moeazi:lite-runs:account:{day}:{account}"
        global_key = f"moeazi:lite-runs:global:{day}"
        budget_key = f"moeazi:lite-provider-microusd:{day}"
        estimated_microusd = max(0, int(estimated_cost_usd * 1_000_000))
        budget_microusd = int(self.settings.dev_lite_provider_budget_usd * 1_000_000)
        script = """
        local account = tonumber(redis.call('GET', KEYS[1]) or '0')
        local global = tonumber(redis.call('GET', KEYS[2]) or '0')
        local spend = tonumber(redis.call('GET', KEYS[3]) or '0')
        if account >= tonumber(ARGV[1]) then return -1 end
        if global >= tonumber(ARGV[2]) then return -2 end
        if spend + tonumber(ARGV[3]) > tonumber(ARGV[4]) then return -3 end
        redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 172800)
        redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 172800)
        redis.call('INCRBY', KEYS[3], ARGV[3]); redis.call('EXPIRE', KEYS[3], 172800)
        return 1
        """
        result = await self.redis.eval(
            script, 3, account_key, global_key, budget_key,
            self.settings.dev_lite_account_runs_per_day,
            self.settings.dev_lite_global_runs_per_day,
            estimated_microusd,
            budget_microusd,
        )
        if result == -1:
            raise RuntimeError("Lite Mode daily account analysis limit reached")
        if result == -2:
            raise RuntimeError("Lite Mode daily platform analysis limit reached")
        if result == -3:
            raise RuntimeError("Lite Mode daily provider budget reached")


class RuntimeRunMetrics(BaseModel):
    provider_calls: int
    successful_calls: int
    estimated_cost_usd: float
    convex_operations: int
    completed_at: str
