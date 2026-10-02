"""Checked-in synthetic registry loader; it has no adapter or network dependency."""
from __future__ import annotations

import json
from importlib.resources import files

from .instrument_lifecycle_contracts import (AssetIdentity, InstrumentDefinitionVersion,
    NativeInstrumentIdentity, digest)


def raw() -> dict:
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value: raise ValueError("instrument registry contains a duplicate JSON key")
            value[key] = item
        return value
    return json.loads(files("moeazi_agent").joinpath("instrument_lifecycle_registry.json").read_text(encoding="utf-8"),
        object_pairs_hook=unique_pairs)


def registry_hash() -> str:
    value = raw()
    return digest({key: value[key] for key in value if key != "registryHash"})


def definitions() -> list[InstrumentDefinitionVersion]:
    return [InstrumentDefinitionVersion.model_validate(item) for item in raw()["definitions"]]


def verify_registry() -> None:
    value = raw()
    if value.get("registryHash") != registry_hash(): raise ValueError("instrument registry hash mismatch")
    identities = [NativeInstrumentIdentity.model_validate(item) for item in value.get("identities", [])]
    assets = [AssetIdentity.model_validate(item) for item in value.get("assets", [])]
    values = definitions()
    if not identities or not assets: raise ValueError("instrument registry has no identity closure")
    if len({item.identity_hash for item in identities}) != len(identities):
        raise ValueError("duplicate native identity")
    if len({item.asset_id for item in assets}) != len(assets): raise ValueError("duplicate asset identity")
    identity_hashes, asset_hashes = {item.identity_hash for item in identities}, {item.asset_hash for item in assets}
    for item in values:
        identity = next((identity for identity in identities if identity.identity_hash == item.identity_hash), None)
        role_hashes = {role.asset_hash for role in item.asset_roles}
        if not identity or item.kind != identity.kind or not role_hashes.issubset(asset_hashes):
            raise ValueError("instrument definition reference is not closed")
    keys = [(item.stable_id, item.version) for item in values]
    if len(keys) != len(set(keys)): raise ValueError("duplicate stable definition version")
    for stable_id in {item.stable_id for item in values}:
        chain = sorted((item for item in values if item.stable_id == stable_id), key=lambda item: item.version)
        if chain[0].version != 1 or chain[0].predecessor_hash is not None:
            raise ValueError("instrument definition version root is invalid")
        for previous, current in zip(chain, chain[1:]):
            if current.version != previous.version + 1 or current.predecessor_hash != previous.definition_hash:
                raise ValueError("instrument definition version chain is broken")
    expected_states = {"active", "paused", "halted", "reduce_only", "expiring", "delisting",
        "settled", "delisted", "unknown", "disputed", "rebaseline_required"}
    matrix = value.get("operationMatrix")
    if value.get("matrixVersion") != "instrument-lifecycle-local-v1" or set(matrix or {}) != expected_states:
        raise ValueError("unknown lifecycle operation matrix")
    for state, lanes in matrix.items():
        if set(lanes) != {"new", "safe"} or any(not isinstance(item, str) for item in lanes["new"] + lanes["safe"]):
            raise ValueError(f"invalid lifecycle operation matrix state: {state}")


def by_identity(identity_hash: str) -> list[InstrumentDefinitionVersion]:
    return [item for item in definitions() if item.identity_hash == identity_hash]


def operation_lanes(status: str) -> dict[str, list[str]]:
    return raw()["operationMatrix"].get(status, {"new": [], "safe": []})
