from __future__ import annotations

import base64
import json
from types import SimpleNamespace

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException
from pydantic import SecretStr

from moeazi_agent import hyperliquid_credentials_api as api
from moeazi_agent.credentials import LocalMasterKeyWrapper
from moeazi_agent import venue_setup_api


class FakeRedis:
    def __init__(self):
        self.values = {}

    async def set(self, key, value, ex, nx):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def getdel(self, key):
        return self.values.pop(key, None)


class FakeConvex:
    def __init__(self, context):
        self.context = context
        self.commands = []

    async def command(self, name, **payload):
        self.commands.append((name, payload))
        if name == "getHyperliquidBindingContext":
            return self.context
        if name == "registerHyperliquidCredentialBinding":
            return {"credentialId": "credential-a", "venueAccountId": "venue-account-a"}
        raise AssertionError(name)


class FakeRequest:
    def __init__(self, redis):
        self.app = SimpleNamespace(state=SimpleNamespace(redis=redis))


def fixture(monkeypatch, *, target_kind="master"):
    master = Account.create()
    api_wallet = Account.create()
    target = master.address if target_kind == "master" else Account.create().address
    convex = FakeConvex({
        "attemptId": "attempt-a", "strategyAccountId": "strategy-a", "accountWalletId": "wallet-a",
        "venue": "hyperliquid", "state": "verifying", "authorityMode": "approval",
        "ownerAddress": master.address.lower(),
        "uaAddress": Account.create().address.lower(),
    })
    monkeypatch.setattr(api, "settings", SimpleNamespace(
        worker_shared_secret=SecretStr("worker-secret"), mainnet_venue_setup_enabled=True,
    ))
    monkeypatch.setattr(api, "ConvexWorkerClient", lambda _settings: convex)
    redis = FakeRedis()
    request = FakeRequest(redis)
    return master, api_wallet, target, convex, redis, request


async def issue_challenge(master, api_wallet, target, request, *, target_kind="master"):
    return await api.create_binding_challenge(
        api.BindingChallengeRequest(
            attempt_id="attempt-a", master_address=master.address, target_kind=target_kind,
            target_address=target, api_wallet_address=api_wallet.address,
        ),
        request,
        "Bearer worker-secret",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("target_kind", ["master", "subaccount"])
async def test_binding_verifies_owner_agent_scope_and_stores_only_ciphertext(monkeypatch, target_kind):
    master, api_wallet, target, convex, redis, request = fixture(monkeypatch, target_kind=target_kind)
    challenge = await issue_challenge(master, api_wallet, target, request, target_kind=target_kind)
    owner_signature = Account.sign_message(
        encode_defunct(text=challenge["message"]), private_key=master.key,
    ).signature.hex()

    async def fake_info(_client, kind, user):
        if kind == "extraAgents":
            return [{"address": api_wallet.address, "validUntil": 4_000_000_000_000}]
        if user.lower() == api_wallet.address.lower():
            return {"role": "agent", "data": {"user": master.address}}
        if target_kind == "master":
            return {"role": "user"}
        return {"role": "subAccount", "data": {"master": master.address}}

    monkeypatch.setattr(api, "info_query", fake_info)
    monkeypatch.setattr(api, "encrypt_credential", lambda _secret, _context: ("ciphertext-only", "test-kms"))
    result = await api.register_credential(
        api.CredentialRegistrationRequest(
            attempt_id="attempt-a", challenge_id=challenge["challengeId"], owner_signature=owner_signature,
            api_wallet_private_key=SecretStr(api_wallet.key.hex()),
        ), request, "Bearer worker-secret",
    )

    assert result["status"] == "authorization_required"
    assert result["routingEnabled"] is False
    name, payload = convex.commands[-1]
    assert name == "registerHyperliquidCredentialBinding"
    assert payload["encryptedEnvelope"] == "ciphertext-only"
    assert payload["apiWalletAddress"] == api_wallet.address.lower()
    assert api_wallet.key.hex() not in json.dumps(payload)
    assert payload["ownerSignature"] == owner_signature
    assert "bindingReceiptJson" not in payload
    assert not redis.values


@pytest.mark.asyncio
async def test_binding_refuses_unverified_info_or_replayed_challenge(monkeypatch):
    master, api_wallet, target, convex, _redis, request = fixture(monkeypatch)
    challenge = await issue_challenge(master, api_wallet, target, request)
    owner_signature = Account.sign_message(
        encode_defunct(text=challenge["message"]), private_key=master.key,
    ).signature.hex()

    async def fake_info(_client, kind, _user):
        return {"role": "missing"} if kind == "userRole" else []

    monkeypatch.setattr(api, "info_query", fake_info)
    monkeypatch.setattr(api, "encrypt_credential", lambda *_args: ("ciphertext", "kms"))
    body = api.CredentialRegistrationRequest(
        attempt_id="attempt-a", challenge_id=challenge["challengeId"], owner_signature=owner_signature,
        api_wallet_private_key=SecretStr(api_wallet.key.hex()),
    )
    with pytest.raises(HTTPException, match="API wallet is not registered"):
        await api.register_credential(body, request, "Bearer worker-secret")
    assert not any(name == "registerHyperliquidCredentialBinding" for name, _ in convex.commands)
    with pytest.raises(HTTPException, match="expired or was already used"):
        await api.register_credential(body, request, "Bearer worker-secret")


@pytest.mark.asyncio
async def test_binding_requires_current_verifying_authority_attempt(monkeypatch):
    master, api_wallet, target, convex, _redis, request = fixture(monkeypatch)
    convex.context["state"] = "ready"
    with pytest.raises(HTTPException, match="current Approval or Autopilot"):
        await issue_challenge(master, api_wallet, target, request)
    assert not any(name == "registerHyperliquidCredentialBinding" for name, _ in convex.commands)


@pytest.mark.asyncio
async def test_binding_rejects_a_challenge_from_another_setup_attempt(monkeypatch):
    master, api_wallet, target, convex, _redis, request = fixture(monkeypatch)
    challenge = await issue_challenge(master, api_wallet, target, request)
    signature = Account.sign_message(
        encode_defunct(text=challenge["message"]), private_key=master.key,
    ).signature.hex()
    with pytest.raises(HTTPException, match="different setup attempt"):
        await api.register_credential(api.CredentialRegistrationRequest(
            attempt_id="attempt-b", challenge_id=challenge["challengeId"],
            owner_signature=signature, api_wallet_private_key=SecretStr(api_wallet.key.hex()),
        ), request, "Bearer worker-secret")
    assert not any(name == "registerHyperliquidCredentialBinding" for name, _ in convex.commands)


@pytest.mark.asyncio
async def test_worker_verified_boolean_cannot_finalize_venue(monkeypatch):
    monkeypatch.setattr(venue_setup_api, "settings", SimpleNamespace(
        worker_shared_secret=SecretStr("worker-secret"),
    ))

    class Handle:
        def __init__(self):
            self.signals = []

        async def signal(self, *args):
            self.signals.append(args)

    handle = Handle()
    http_request = SimpleNamespace(app=SimpleNamespace(
        state=SimpleNamespace(temporal=SimpleNamespace(
            get_workflow_handle=lambda _workflow_id: handle,
        )),
    ))
    with pytest.raises(HTTPException, match="not venue proof"):
        await venue_setup_api.verification(
            "workflow-a", venue_setup_api.VerificationRequest(verified=True, finalization={"ready": True}),
            http_request, "Bearer worker-secret",
        )
    assert handle.signals == []

    result = await venue_setup_api.verification(
        "workflow-a", venue_setup_api.VerificationRequest(verified=False, error="Info mismatch"),
        http_request, "Bearer worker-secret",
    )
    assert result["status"] == "verification_recorded"
    assert len(handle.signals) == 1


def test_local_envelope_is_ciphertext_scoped_to_hyperliquid_credential_context(monkeypatch):
    key = base64.urlsafe_b64encode(bytes.fromhex("11" * 32)).decode()
    monkeypatch.setattr(api, "settings", SimpleNamespace(
        byok_secret_backend="local", environment="test", master_key=SecretStr(key),
    ))
    context = "venue-credential:v1:strategy-a:hyperliquid:0x4444444444444444444444444444444444444444"
    secret = bytes.fromhex("22" * 32)
    envelope, key_ref = api.encrypt_credential(secret, context)
    assert key_ref == "local-master"
    assert envelope != secret.hex()
    assert LocalMasterKeyWrapper(key).unwrap(envelope, context.encode()) == secret


def test_private_key_intake_is_mounted_only_on_the_execution_gateway():
    from moeazi_agent.api import app as agent_app
    from moeazi_agent.execution_api import app as execution_app

    paths = {"/v1/venues/hyperliquid/binding-challenge", "/v1/venues/hyperliquid/credentials"}
    assert paths.issubset(execution_app.openapi()["paths"])
    assert paths.isdisjoint(agent_app.openapi()["paths"])
