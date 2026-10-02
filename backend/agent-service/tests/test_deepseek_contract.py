import json
from datetime import timedelta

import pytest

from moeazi_agent.config import Settings
from moeazi_agent.contracts import utc_now
from moeazi_agent.providers import DeepSeekProvider, ProviderFailure
from moeazi_agent.roles import assignments_for_tier


class FakeResponse:
    def __init__(self, content: str, status_code: int = 200):
        self.content, self.status_code = content, status_code

    def raise_for_status(self):
        if self.status_code >= 400: raise RuntimeError(str(self.status_code))

    def json(self):
        return {
            "choices": [{"message": {"content": self.content}}],
            "usage": {"prompt_tokens": 120, "prompt_cache_hit_tokens": 20, "completion_tokens": 40},
        }


class FakeClient:
    def __init__(self, responses): self.responses, self.bodies = iter(responses), []
    async def post(self, *_args, **kwargs):
        self.bodies.append(kwargs.get("json"))
        return next(self.responses)


async def test_deepseek_retries_malformed_json_then_validates():
    settings = Settings(deepseek_api_key="test", provider_retries=1)
    provider = DeepSeekProvider(settings)
    valid = {
        "role": "technical_trend", "provider": "deepseek", "model": "recorded",
        "horizon": "hours", "stance": "bullish", "score": 0.4, "confidence": 0.7,
        "evidence": [], "risks": [], "expires_at": (utc_now() + timedelta(minutes=1)).isoformat(),
    }
    provider.client = FakeClient([FakeResponse("{"), FakeResponse(json.dumps(valid))])
    output = await provider.analyze(assignments_for_tier("focus")[0], "BTC-USD", "")
    assert output.value.provider == "deepseek"
    assert output.usage.input_tokens == 120
    assert provider.client.bodies[-1]["thinking"] == {"type": "disabled"}
    assert provider.client.bodies[-1]["max_tokens"] == 700


async def test_deepseek_empty_output_is_non_billable_failure():
    provider = DeepSeekProvider(Settings(deepseek_api_key="test", provider_retries=0))
    provider.client = FakeClient([FakeResponse("")])
    with pytest.raises(ProviderFailure, match="empty"):
        await provider.analyze(assignments_for_tier("focus")[1], "BTC-USD", "")
