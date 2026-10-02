from unittest.mock import AsyncMock, patch
import pytest
from moeazi_agent.mobile_connector_workflow import connector_call, TERMINAL


@pytest.mark.asyncio
async def test_connector_transport_sends_operation_id_only():
    response = AsyncMock()
    response.raise_for_status = lambda: None
    response.json = lambda: {"status": "uncertain"}
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = response
    with patch("moeazi_agent.mobile_connector_workflow.httpx.AsyncClient", return_value=client):
        result = await connector_call("reconcile", "operation-fixture-001")
    assert result["status"] == "uncertain"
    assert client.post.call_args.kwargs["json"] == {"operationId": "operation-fixture-001"}
    assert "uncertain" not in TERMINAL
    assert "needs_attention" not in TERMINAL
