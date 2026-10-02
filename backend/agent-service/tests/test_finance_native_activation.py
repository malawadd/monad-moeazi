"""Mock-only coverage for the managed-program native account activation seam."""
from datetime import datetime, timezone
import hashlib
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from moeazi_agent import finance_native_activation_api as activation
from moeazi_agent import finance_routes
from moeazi_agent.finance_native_activation_contracts import (
    ActivationContext, ActivationRequest, exact_pair_policy, validate_grant,
)
from moeazi_agent.finance_observation_contracts import ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID
from moeazi_agent.finance_policy import SizingPolicy
from moeazi_agent.observation_contracts import InstrumentVersion


OWNER = "0x1111111111111111111111111111111111111111"
GRANT_ID = "grant-route-0001"
CONTEXT_POLICY_HASH = "a" * 64
GRANT_POLICY_HASH = "0x" + "b" * 64


def context_payload(*, authority_ms: int):
    limits = {"schemaVersion": 1, "strategyAccountId": "strategy-internal",
        "assignmentId": "assignment-01", "programVersionId": "program-version-01",
        "contentHash": "c" * 64, "policyHash": CONTEXT_POLICY_HASH,
        "venueAccountId": "venue-account-01", "ownerAddress": OWNER,
        "maxUsdcUnits": "1000000", "maxWethUnits": "1000000",
        "minWethOutUnits": "10", "minUsdcOutUnits": "10"}
    return {"strategyAccountId": "strategy-internal", "assignmentId": "assignment-01",
        "customerSubject": "internal-subject",
        "programVersionId": "program-version-01", "contentHash": "c" * 64,
        "ownerAddress": OWNER, "venue": "uniswap", "venueAccountId": "venue-account-01",
        "sourceAccountId": f"arbitrum:42161:wallet:{OWNER}", "policyHash": CONTEXT_POLICY_HASH,
        "policyJson": "{}", "limitsJson": json.dumps(limits), "authorityExpiresAt": authority_ms,
        "executionGrantId": GRANT_ID, "financialAuthority": "identity_only"}


def grant_read(scope: str, *, changes: dict | None = None):
    buy = scope == "buy"
    grant = {"grantId": GRANT_ID, "scope": scope, "state": "active", "owner": OWNER,
        "strategyAccountId": "strategy-internal", "assignmentId": "assignment-01",
        "frozenPolicyHash": "0x" + CONTEXT_POLICY_HASH,
        "sessionAddress": "0x2222222222222222222222222222222222222222",
        "policyHash": GRANT_POLICY_HASH, "expiresAt": 1_900_000_000,
        "review": {"chainId": 42161, "router": "0xe592427a0aece92de3edee1f18e0157c05861564",
            "tokenIn": "0xaf88d065e77c8cc2239327c5edb3a432268e5831" if buy else
                "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
            "tokenOut": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" if buy else
                "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
            "feeTier": 3000, "recipient": OWNER, "maximumInputUnits": "1000000",
            "minimumOutputUnits": "10", "earliestDeadline": 1_899_000_000,
            "latestDeadline": 1_900_000_000, "maxCalls": 1, "callValueWei": "0"}}
    if changes:
        grant.update(changes)
    return {"grant": grant, "operation": None, "consumed": False}


def make_policy():
    body = dict(policy_version="explicit-uniswap-live-v1",
        instrument_version_id="uniswap:arbitrum:usdc-weth-3000:v1",
        max_quantity_units="1000000000000000000", min_quantity_units="1",
        quantity_step_units="1", max_gross_notional_units="1000000000000",
        max_directional_notional_units="1000000000000", initial_margin_bps=0,
        fee_ceiling_units="0", exit_buffer_units="0", max_observation_age_seconds=3600,
        max_reservation_seconds=60, approved_live=True)
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    policy_hash = hashlib.sha256(b"moeazi-finance-policy-v1\n" + canonical).hexdigest()
    return SizingPolicy(**body, policy_hash=policy_hash)


def make_instrument(native_id: str):
    return InstrumentVersion(instrument_version_id="uniswap:arbitrum:usdc-weth-3000:v1",
        venue_id="uniswap", native_instrument_id=native_id, product_kind="spot",
        base_asset_unit_id=ARBITRUM_WETH_UNIT_ID, quote_asset_unit_id=ARBITRUM_USDC_UNIT_ID,
        settlement_asset_unit_id=ARBITRUM_USDC_UNIT_ID, base_decimals=18, quote_decimals=6,
        settlement_decimals=6, size_decimals=18, contract_multiplier="1",
        price_rule="uniswap_v3_quoter_v2_exact_input_v1",
        lot_step="0.000000000000000001", margin_model="not_applicable",
        funding_model="not_applicable", effective_at=datetime.now(timezone.utc),
        registry_hash="d" * 64)


def settings():
    return SimpleNamespace(worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "route-secret"),
        convex_worker_url="http://convex.local/worker", execution_sidecar_url="http://sidecar.local",
        routing_timeout_seconds=5)


def sidecar_account(now: int):
    return {"chainId": 42161, "account": OWNER, "blockNumber": "123456",
        "blockHash": "0x" + "d" * 64, "blockTimestamp": str(now - 10),
        "accountMode": "kernel-7702", "balances": {"USDC": "2500000", "WETH": "0"},
        "trackedPairComplete": True, "balancesComplete": False, "positionsComplete": False,
        "source": "arbitrum_finalized_rpc"}


def finance_account_states(stored, policy):
    calls = 0

    async def read(_finance, _scope):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"revision": 0, "source_account_id": None, "policy_version": None,
                "policy_hash": None, "admission_state": "stopped",
                "reconciliation_state": "unknown", "observation_snapshot_hash": None,
                "authority_epoch": 0}
        return {"revision": 1, "source_account_id": f"arbitrum:42161:wallet:{OWNER}",
            "policy_version": policy.policy_version, "policy_hash": policy.policy_hash,
            "admission_state": "stopped", "reconciliation_state": "clean",
            "observation_snapshot_hash": stored[0].snapshot_hash, "authority_epoch": 0}

    return read


class FakeFinance:
    engine = object()

    def __init__(self, *, reconcile_status="clean"):
        self.reconcile_status = reconcile_status
        self.reconciles = []
        self.stop_calls = []

    async def acquire_writer_epoch(self, scope, writer_id):
        assert scope.environment == "live" and writer_id == "native-uniswap-activation-v1"
        return 3

    async def reconcile_account(self, command, *, bootstrap):
        self.reconciles.append((command, bootstrap))
        return {"revision": 1, "status": self.reconcile_status,
                "reason": "test_blocker" if self.reconcile_status != "clean" else "matched"}

    async def set_account_stop(self, scope, epoch, revision, *, stopped,
                               idempotency_key, request_hash):
        self.stop_calls.append((stopped, revision, idempotency_key))
        return {"revision": 2 if not stopped else 3,
            "state": "stopped" if stopped else "open", "authorityEpoch": 7}


def set_test_settings(monkeypatch):
    monkeypatch.setattr(activation, "get_settings", settings)
    monkeypatch.setattr(finance_routes, "get_settings", settings)


def test_grant_validator_requires_matching_unconsumed_context_and_pair():
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    context = ActivationContext.model_validate(context_payload(authority_ms=now_ms + 60_000))
    assert validate_grant(grant_read("buy"), scope="buy", grant_id=GRANT_ID,
        owner=OWNER, context=context) == ("b" * 64, 1_900_000_000)
    invalid = [
        grant_read("buy", changes={"assignmentId": "other-assignment"}),
        grant_read("buy", changes={"frozenPolicyHash": "0x" + "f" * 64}),
        grant_read("buy", changes={"owner": "0x3333333333333333333333333333333333333333"}),
        grant_read("buy", changes={"state": "awaiting-owner"}),
    ]
    for read in invalid:
        with pytest.raises(ValueError):
            validate_grant(read, scope="buy", grant_id=GRANT_ID, owner=OWNER, context=context)
    with pytest.raises(ValueError):
        validate_grant({**grant_read("buy"), "consumed": True}, scope="buy",
            grant_id=GRANT_ID, owner=OWNER, context=context)


def test_grant_validator_rejects_bounds_larger_than_owned_permission():
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    context = ActivationContext.model_validate(context_payload(authority_ms=now_ms + 60_000))
    over_cap = grant_read("buy")
    over_cap["grant"]["review"]["maximumInputUnits"] = "1000001"
    with pytest.raises(ValueError, match="venue permission bounds"):
        validate_grant(over_cap, scope="buy", grant_id=GRANT_ID, owner=OWNER, context=context)
    under_floor = grant_read("exit")
    under_floor["grant"]["review"]["minimumOutputUnits"] = "9"
    with pytest.raises(ValueError, match="venue permission bounds"):
        validate_grant(under_floor, scope="exit", grant_id=GRANT_ID,
            owner=OWNER, context=context)
    different_owner = context_payload(authority_ms=now_ms + 60_000)
    limits = json.loads(different_owner["limitsJson"])
    limits["ownerAddress"] = "0x3333333333333333333333333333333333333333"
    different_owner["limitsJson"] = json.dumps(limits)
    with pytest.raises(ValueError, match="venue permission limits"):
        validate_grant(grant_read("buy"), scope="buy", grant_id=GRANT_ID,
            owner=OWNER, context=ActivationContext.model_validate(different_owner))


def test_live_finance_policy_requires_pool_address_identity():
    sizing_policy = make_policy()
    exact = make_instrument("0x3333333333333333333333333333333333333333")
    wrong = make_instrument("USDC/WETH:3000")
    assert exact_pair_policy(sizing_policy, exact.model_dump(mode="json"), exact.registry_hash)
    assert not exact_pair_policy(sizing_policy, wrong.model_dump(mode="json"), wrong.registry_hash)


@pytest.mark.asyncio
async def test_activation_persists_pair_snapshot_reconciles_and_publishes_exact_receipt(monkeypatch):
    set_test_settings(monkeypatch)
    finance = FakeFinance()
    stored = []
    policy = make_policy()
    monkeypatch.setattr(activation, "AccountObservationRepository", lambda _: SimpleNamespace(
        store_native_snapshot=lambda snapshot: _append(stored, snapshot)))
    monkeypatch.setattr(activation, "_account_state", finance_account_states(stored, policy))
    monkeypatch.setattr(activation, "_registered_policy", lambda *_: _resolved(policy))
    now = int(datetime.now(timezone.utc).timestamp())
    expiry_ms = (now + 300) * 1000
    context = context_payload(authority_ms=expiry_ms)
    receipt_payloads = []
    calls = []

    async def fake_post(url, payload, secret, timeout):
        calls.append((url, payload, secret))
        if url.endswith("/native-finance-activation/context"):
            return context
        if url.endswith("/internal/uniswap/account"):
            return sidecar_account(now)
        if url.endswith("/internal/uniswap/scoped-grant/read"):
            return grant_read(payload["scope"])
        if url.endswith("/native-finance-activation/receipt"):
            receipt_payloads.append(payload)
            return {"receiptId": "receipt-01", "receiptHash": "e" * 64,
                    "expiresAt": payload["expiresAt"]}
        raise AssertionError(url)

    monkeypatch.setattr(activation, "_post_json", fake_post)
    app_request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(finance=finance)))
    response = await activation.activate_managed_program_finance(
        ActivationRequest.model_validate({"assignmentId": "assignment-01",
                                          "executionGrantId": GRANT_ID}),
        app_request, "Bearer route-secret", "internal-subject")
    assert response["status"] == "ready" and response["executionQualified"] is False
    assert response["sourceAccountId"] == f"arbitrum:42161:wallet:{OWNER}"
    assert response["financePolicyHash"] == policy.policy_hash
    assert response["executionGrantHash"] == "b" * 64
    assert response["activationReceiptHash"] == "e" * 64
    assert len(stored) == 1 and stored[0].coverage_scope == "arbitrum_usdc_weth_spot"
    assert len(finance.reconciles) == 1 and finance.reconciles[0][1] is True
    assert len(finance.stop_calls) == 1 and finance.stop_calls[0][:2] == (False, 1)
    assert len(receipt_payloads) == 1
    assert receipt_payloads[0]["executionGrantHash"] == "b" * 64
    assert receipt_payloads[0]["financeSnapshotHash"] == stored[0].snapshot_hash
    assert receipt_payloads[0]["expiresAt"] == expiry_ms
    assert all(secret == "route-secret" for _, _, secret in calls)
    assert {url.rsplit("/", 1)[-1] for url, _, _ in calls} == {
        "context", "account", "read", "receipt"}


@pytest.mark.asyncio
async def test_activation_blocks_without_registered_policy_before_finance_reconciliation(monkeypatch):
    set_test_settings(monkeypatch)
    finance = FakeFinance()
    initial_state = {"revision": 0, "source_account_id": None, "policy_version": None,
        "policy_hash": None, "admission_state": "stopped", "reconciliation_state": "unknown",
        "observation_snapshot_hash": None, "authority_epoch": 0}
    monkeypatch.setattr(activation, "_account_state", lambda *_: _resolved(initial_state))

    async def no_policy(*_):
        raise LookupError("approved_live_finance_policy_missing")

    monkeypatch.setattr(activation, "_registered_policy", no_policy)
    now = int(datetime.now(timezone.utc).timestamp())

    async def fake_post(url, payload, *_):
        if url.endswith("/native-finance-activation/context"):
            return context_payload(authority_ms=(now + 300) * 1000)
        if url.endswith("/internal/uniswap/account"):
            return sidecar_account(now)
        if url.endswith("/internal/uniswap/scoped-grant/read"):
            return grant_read(payload["scope"])
        raise AssertionError("A blocked bootstrap must not publish a receipt")

    monkeypatch.setattr(activation, "_post_json", fake_post)
    app_request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(finance=finance)))
    with pytest.raises(HTTPException) as caught:
        await activation.activate_managed_program_finance(
            ActivationRequest.model_validate({"assignmentId": "assignment-01",
                                              "executionGrantId": GRANT_ID}),
            app_request, "Bearer route-secret", "internal-subject")
    assert getattr(caught.value, "detail", {}).get("reason") == "approved_live_finance_policy_missing"
    assert finance.reconciles == [] and finance.stop_calls == []


@pytest.mark.asyncio
async def test_receipt_publication_failure_stops_finance_admission(monkeypatch):
    set_test_settings(monkeypatch)
    finance = FakeFinance()
    stored = []
    policy = make_policy()
    monkeypatch.setattr(activation, "AccountObservationRepository", lambda _: SimpleNamespace(
        store_native_snapshot=lambda snapshot: _append(stored, snapshot)))
    monkeypatch.setattr(activation, "_account_state", finance_account_states(stored, policy))
    monkeypatch.setattr(activation, "_registered_policy", lambda *_: _resolved(policy))
    now = int(datetime.now(timezone.utc).timestamp())

    async def fake_post(url, payload, *_):
        if url.endswith("/native-finance-activation/context"):
            return context_payload(authority_ms=(now + 300) * 1000)
        if url.endswith("/internal/uniswap/account"):
            return sidecar_account(now)
        if url.endswith("/internal/uniswap/scoped-grant/read"):
            return grant_read(payload["scope"])
        if url.endswith("/native-finance-activation/receipt"):
            raise RuntimeError("receipt endpoint unavailable")
        raise AssertionError(url)

    monkeypatch.setattr(activation, "_post_json", fake_post)
    app_request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(finance=finance)))
    with pytest.raises(HTTPException) as caught:
        await activation.activate_managed_program_finance(
            ActivationRequest.model_validate({"assignmentId": "assignment-01",
                                              "executionGrantId": GRANT_ID}),
            app_request, "Bearer route-secret", "internal-subject")
    assert caught.value.status_code == 503
    assert [item[0] for item in finance.stop_calls] == [False, True]


async def _append(target, value):
    target.append(value)
    return value.snapshot_hash


async def _resolved(value):
    return value
