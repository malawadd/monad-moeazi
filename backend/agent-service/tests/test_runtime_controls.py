import pytest

from moeazi_agent.config import Settings
from moeazi_agent.runtime_controls import RuntimeControlStore, RuntimeControlUpdate


class FakeRedis:
    def __init__(self):
        self.value = None

    async def get(self, key):
        return self.value

    async def set(self, key, value):
        self.value = value


async def test_missing_runtime_state_uses_safe_development_defaults():
    store = RuntimeControlStore(FakeRedis(), Settings())
    controls = await store.get()
    assert controls.manual_guard is True
    assert controls.lite_mode is True


async def test_disabling_a_safeguard_requires_typed_confirmation():
    store = RuntimeControlStore(FakeRedis(), Settings())
    with pytest.raises(RuntimeError, match="DISABLE SAFEGUARD"):
        await store.update(RuntimeControlUpdate(manual_guard=False))
    controls = await store.update(RuntimeControlUpdate(
        manual_guard=False, confirmation="DISABLE SAFEGUARD",
    ))
    assert controls.manual_guard is False
    assert controls.lite_mode is True
