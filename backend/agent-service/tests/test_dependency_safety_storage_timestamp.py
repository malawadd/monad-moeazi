from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent.dependency_safety_contracts import DependencyStatus
from moeazi_agent.dependency_safety_storage import DependencySafetyRepository


@pytest.mark.asyncio
async def test_incident_transition_binds_datetime_for_timestamp_column():
    observed_at = datetime(2026, 10, 3, 12, 15, tzinfo=timezone.utc)
    scope = SimpleNamespace(key="account:one", model_dump=lambda mode: {
        "kind": "account", "key": "account:one"})
    receipt = SimpleNamespace(receipt_id="receipt-one", dependency_id="credits",
        scope=scope, canonical_hash="hash-one", observed_at=observed_at,
        status=DependencyStatus.UNKNOWN)

    class Connection:
        def __init__(self):
            self.calls = []

        async def execute(self, statement, params):
            self.calls.append((str(statement), params))
            if len(self.calls) == 1:
                return SimpleNamespace(first=lambda: SimpleNamespace(receipt_id="receipt-one"))
            return SimpleNamespace(first=lambda: None)

    conn = Connection()
    await DependencySafetyRepository._save_incident_observation(conn, receipt, True)
    assert conn.calls[-1][1]["observed_at"] is observed_at
    assert '"observed_at": "2026-10-03T12:15:00+00:00"' in conn.calls[-1][1]["payload"]
