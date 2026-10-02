"""A stopped Magic assignment sends one vault stop and waits for finalized state."""
from types import SimpleNamespace

import pytest

from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent import managed_vault_stop_api as stop


@pytest.mark.asyncio
async def test_magic_vault_stop_claims_once_then_recovers_by_finalized_read(monkeypatch):
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id="account-a")
    monkeypatch.setattr(stop, "_subject", lambda *_: "magic-subject")

    async def viewer_scope(*_):
        return scope

    monkeypatch.setattr(stop, "_viewer_scope", viewer_scope)
    monkeypatch.setattr(stop, "get_settings", lambda: SimpleNamespace())
    owner = "0x56b6c8ef6e04fa995f835f56c009f01623af5963"
    vault = "0x" + "a" * 40
    state = {"stopState": None, "stopped": False, "sends": 0, "claims": 0}
    context = {"customerSubject": "magic-subject", "strategyAccountId": "account-a",
        "assignmentId": "assignment-a", "mandateId": "mandate-a",
        "vaultAddress": vault, "ownerAddress": owner,
        "executorAddress": "0x" + "b" * 40, "codeHash": "0x" + "c" * 64,
        "programHash": "d" * 64, "policyHash": "e" * 64,
        "capitalUnits": "1000000", "maxBuyUnits": "500000",
        "expiresAt": 1_800_000_000_000}

    async def convex(_settings, operation, payload):
        assert payload["mandateId"] == "mandate-a"
        if operation == "context":
            assert payload["subject"] == "magic-subject"
            return {**context, "stopState": state["stopState"]}
        if operation == "claim":
            state["claims"] += 1
            state["stopState"] = "claimed"
            return {"claimed": True}
        if operation == "outcome":
            state["stopState"] = payload["state"]
            return {"state": payload["state"]}
        raise AssertionError(operation)

    async def sidecar(_settings, path, payload, **_kwargs):
        if path == "managed-vault-read":
            assert payload["vaultAddress"] == vault
            return {"vaultAddress": vault, "ownerAddress": owner,
                "stopped": state["stopped"], "finalizedBlockNumber": "123",
                "finalizedBlockHash": "0x" + "f" * 64}
        if path == "managed-vault-stop-readiness":
            return {"ready": True}
        if path == "managed-vault-stop":
            state["sends"] += 1
            return {"status": "submitted", "transactionHash": "0x" + "1" * 64}
        raise AssertionError(path)

    monkeypatch.setattr(stop, "_convex", convex)
    monkeypatch.setattr(stop, "vault_sidecar", sidecar)
    body = stop.VaultStopRequest.model_validate({
        "mandateId": "mandate-a", "assignmentId": "assignment-a"})
    args = {"authorization": "Bearer test", "x_moeazi_subject": "magic-subject"}
    first = await stop.stop_magic_vault(body, None, **args)
    assert first["status"] == "pending"
    assert state["claims"] == 1 and state["sends"] == 1
    retry = await stop.stop_magic_vault(body, None, **args)
    assert retry["status"] == "pending"
    assert state["claims"] == 1 and state["sends"] == 1
    state["stopped"] = True
    final = await stop.stop_magic_vault(body, None, **args)
    assert final["status"] == "confirmed"
    assert final["onChainStopConfirmed"] is True
    assert state["sends"] == 1
