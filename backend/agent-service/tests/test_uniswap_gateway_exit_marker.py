"""The gateway accepts stopped sells only through the separate reduce-only proof."""
import pytest
from fastapi import HTTPException

from moeazi_agent import execution_api as gateway


REQUEST = gateway.UniswapFinanceVerificationRequest(
    strategyAccountId="account-a", intentId="intent-a", clientId="command-a",
    grantId="grant-a", assignmentId="assignment-a", normalizedPayloadHash="a" * 64)


@pytest.mark.asyncio
async def test_stopped_exit_uses_immutable_marker_and_owner_close_context(monkeypatch):
    class Finance:
        async def verify_possible_submission(self, *_args, **_kwargs):
            return None

    marker = {"attemptId": "attempt-a", "action": "spot_sell",
              "customerSubject": "owner-subject", "frozenProgramPolicyHash": "0x" + "b" * 64}

    async def exit_marker(_finance, scope, **fields):
        assert scope.strategy_account_id == "account-a"
        assert fields["grant_id"] == "grant-a"
        return marker

    async def close_context(value, **fields):
        assert value == marker and fields["assignment_id"] == "assignment-a"
        return {"grantId": "grant-a", "assignmentId": "assignment-a",
                "frozenProgramPolicyHash": "0x" + "b" * 64}

    monkeypatch.setattr(gateway, "finance_repository", Finance())
    monkeypatch.setattr(gateway, "verify_stopped_uniswap_exit_submission", exit_marker)
    monkeypatch.setattr(gateway, "verify_stopped_managed_uniswap_exit", close_context)
    result = await gateway.verify_uniswap_submission(REQUEST,
        "Bearer " + gateway.settings.worker_shared_secret.get_secret_value())
    assert result["attemptId"] == "attempt-a" and result["grantId"] == "grant-a"


@pytest.mark.asyncio
async def test_stopped_exit_without_current_owner_close_context_is_denied(monkeypatch):
    class Finance:
        async def verify_possible_submission(self, *_args, **_kwargs):
            return None

    async def exit_marker(*_args, **_kwargs):
        return {"attemptId": "attempt-a", "action": "spot_sell"}

    async def denied(*_args, **_kwargs):
        return None

    monkeypatch.setattr(gateway, "finance_repository", Finance())
    monkeypatch.setattr(gateway, "verify_stopped_uniswap_exit_submission", exit_marker)
    monkeypatch.setattr(gateway, "verify_stopped_managed_uniswap_exit", denied)
    with pytest.raises(HTTPException) as caught:
        await gateway.verify_uniswap_submission(REQUEST,
            "Bearer " + gateway.settings.worker_shared_secret.get_secret_value())
    assert caught.value.status_code == 409
