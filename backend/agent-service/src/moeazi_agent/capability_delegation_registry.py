"""Checked-in configuration and synthetic fixture grants for Feature 08."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from importlib.resources import files

from .capability_delegation_canonical import digest
from .capability_delegation_contracts import CapabilityScope, GrantSpec


def _reject_duplicate(pairs):
    value = {}
    for key, item in pairs:
        if key in value: raise ValueError("duplicate registry key")
        value[key] = item
    return value


def raw() -> dict:
    value = json.loads(files("moeazi_agent").joinpath("capability_delegation_registry.json").read_text("utf-8"),
                       object_pairs_hook=_reject_duplicate)
    expected = {"schemaVersion", "registryVersion", "matrixVersion", "decisionTtlSeconds", "maxOverlapNative",
                "maxOverlapSeconds", "grantActionMatrix", "safeLanes", "reasonCodes", "prohibited"}
    if set(value) != expected or value["schemaVersion"] != 1: raise ValueError("capability registry shape invalid")
    if value["safeLanes"] != sorted(set(value["safeLanes"])) or value["reasonCodes"] != sorted(set(value["reasonCodes"])):
        raise ValueError("registry lists must be sorted")
    if value["decisionTtlSeconds"] < 1 or value["decisionTtlSeconds"] > 600: raise ValueError("unsafe decision TTL")
    if value["prohibited"] != {"chainZero": True, "maxUint256": True, "implicitRenewal": True, "wildcardScope": True}:
        raise ValueError("registry prohibition changed")
    types = {"eip7702_root", "session_module", "venue_delegate", "operational_credential", "erc20_allowance", "permit2_allowance"}
    if set(value["grantActionMatrix"]) != types or any(actions != sorted(set(actions)) for actions in value["grantActionMatrix"].values()):
        raise ValueError("registry grant action matrix is incomplete")
    return value


def registry_hash() -> str: return digest(raw())


def scope() -> CapabilityScope:
    return CapabilityScope(tenant_id="tenant:fixture", account_id="account:fixture",
        owner_provider="particle_fixture", owner_fingerprint="owner:particle-fixture",
        chain_id=42161, venue="fixture_venue", scope_key="scope:fixture")


def _grant(now: datetime, grant_id: str, kind: str, parents: list[str], **extra) -> GrantSpec:
    body = {"grant_id": grant_id, "version": 1, "grant_type": kind, "scope": scope(),
        "target_fingerprint": extra.pop("target_fingerprint", "target:fixture"),
        "certified_code_hash": extra.pop("certified_code_hash", digest({"code": kind})),
        "selectors": extra.pop("selectors", ["selector:trade"]), "actions": extra.pop("actions", ["action:use"]),
        "token": "token:usdc", "instrument": "instrument:eth", "market": "market:eth-usdc",
        "recipient": "recipient:venue", "per_call_native": 50, "daily_native": 100,
        "cumulative_native": 200, "gas_native": 10, "effective_from": now - timedelta(minutes=1),
        "effective_until": None if kind == "eip7702_root" else now + timedelta(minutes=5),
        "nonce_domain": "nonce:fixture", "parent_hashes": parents, "policy_revision": "policy:fixture-v1",
        "certification_revision": "certification:fixture-v1", "revocation_method": extra.pop("revocation_method", "disable_module"),
        "replacement_group": extra.pop("replacement_group", None), **extra}
    if kind == "eip7702_root": body["revocation_method"] = "zero_target"
    if kind == "erc20_allowance": body["certified_code_hash"] = None; body["revocation_method"] = "set_allowance_zero"
    if kind == "permit2_allowance": body["certified_code_hash"] = None; body["revocation_method"] = "permit2_lockdown"
    if kind == "venue_delegate": body["certified_code_hash"] = None; body["revocation_method"] = "venue_revoke"
    if kind == "operational_credential": body["certified_code_hash"] = None; body["revocation_method"] = "credential_disable"
    return GrantSpec(**body, grant_hash=digest(body))


def fixture_grants(now: datetime) -> list[GrantSpec]:
    root = _grant(now, "grant:root", "eip7702_root", [])
    module = _grant(now, "grant:module", "session_module", [root.grant_hash])
    allowance = _grant(now, "grant:allowance", "erc20_allowance", [module.grant_hash])
    permit = _grant(now, "grant:permit2", "permit2_allowance", [allowance.grant_hash])
    venue = _grant(now, "grant:venue", "venue_delegate", [module.grant_hash])
    credential = _grant(now, "grant:credential", "operational_credential", [module.grant_hash])
    values = [root, module, allowance, permit, venue, credential]
    if len({item.grant_hash for item in values}) != len(values): raise ValueError("duplicate grant hash")
    return values


def verify_registry() -> None:
    raw(); fixture_grants(datetime(2026, 1, 1, tzinfo=timezone.utc))
