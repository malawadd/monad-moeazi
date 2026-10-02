"""Canonical account-observation DTOs shared by observation and finance owners."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import re
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import (
    FinanceError, FinanceScope, StrictFinanceModel, _hash, _utc, native_int,
)


ARBITRUM_USDC_UNIT_ID = "arbitrum:42161:erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831:6:v1"
ARBITRUM_WETH_UNIT_ID = "arbitrum:42161:erc20:0x82af49447d8a07e3bd95bd0d56f35241523fbab1:18:v1"
ARBITRUM_MANAGED_PAIR_COVERAGE = "arbitrum_usdc_weth_spot"
ARBITRUM_MANAGED_PAIR_RIGHTS = "arbitrum_finalized_rpc:usdc_weth_managed_pair_v1"
ARBITRUM_MANAGED_VAULT_RIGHTS = "arbitrum_finalized_rpc:magic_owned_spot_vault_v1"


def arbitrum_managed_pair_registry_hash() -> str:
    body = {
        "chainId": 42161,
        "coverage": ARBITRUM_MANAGED_PAIR_COVERAGE,
        "assets": [
            {"unitId": ARBITRUM_USDC_UNIT_ID,
             "contract": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "decimals": 6},
            {"unitId": ARBITRUM_WETH_UNIT_ID,
             "contract": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "decimals": 18},
        ],
    }
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("moeazi-finance-asset-registry-v1\n" + encoded).encode()).hexdigest()


def arbitrum_managed_pair_event_hash(
    source_account_id: str, block_number: str, block_hash: str, event_at: datetime,
) -> str:
    account = source_account_id.split(":")[-1]
    body = {"account": account, "chainId": 42161,
            "blockNumber": block_number, "blockHash": block_hash,
            "blockTimestamp": str(int(event_at.timestamp())),
            "coverage": ARBITRUM_MANAGED_PAIR_COVERAGE}
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("moeazi-arbitrum-finalized-account-event-v1\n" + encoded).encode()).hexdigest()


def arbitrum_managed_vault_event_hash(
    source_account_id: str, block_number: str, block_hash: str, event_at: datetime,
) -> str:
    body = {"sourceAccountId": source_account_id, "chainId": 42161,
            "blockNumber": block_number, "blockHash": block_hash,
            "blockTimestamp": str(int(event_at.timestamp())),
            "coverage": ARBITRUM_MANAGED_PAIR_COVERAGE}
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("moeazi-arbitrum-finalized-vault-event-v1\n" + encoded).encode()).hexdigest()


class ObservedBalance(StrictFinanceModel):
    asset_unit_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)
    book: Literal["wallet", "collateral", "transit", "liability"]
    units: str
    registry_hash: str

    @field_validator("units")
    @classmethod
    def valid_units(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @field_validator("registry_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)


class ObservedPosition(StrictFinanceModel):
    instrument_version_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)
    instrument_registry_hash: str
    contract_size_unit_id: str = Field(min_length=1)
    signed_contracts: str
    collateral_asset_unit_id: str = Field(min_length=1)
    margin_units: str
    funding_event_ids: tuple[str, ...]
    fee_event_ids: tuple[str, ...]

    @field_validator("signed_contracts")
    @classmethod
    def contracts_valid(cls, value: str) -> str:
        native_int(value)
        return value

    @field_validator("margin_units")
    @classmethod
    def margin_valid(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @field_validator("instrument_registry_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)


class AccountObservationSnapshotRef(StrictFinanceModel):
    scope: FinanceScope
    snapshot_hash: str
    source_account_id: str = Field(min_length=1)
    origin: Literal["native_verified", "recorded_fixture", "simulation_derived"]
    status: Literal["accepted", "quarantined", "incomplete"]
    event_at: datetime
    available_at: datetime
    received_at: datetime
    cutoff_at: datetime
    finality_at: datetime | None
    finality: str = Field(min_length=1)
    has_gap: bool
    has_reorg: bool
    balances_complete: bool
    positions_complete: bool
    rights_ref: str = Field(min_length=1)
    source_event_hash: str
    source_payload_hash: str
    registry_hash: str
    policy_version: str = Field(min_length=1)
    # `balances_complete` and `positions_complete` are interpreted only within
    # this explicit coverage scope. The managed pair deliberately excludes every
    # other wallet asset and all positions.
    coverage_scope: Literal["full_account", "arbitrum_usdc_weth_spot"] = "full_account"
    source_block_number: str | None = None
    source_block_hash: str | None = None
    observed_balances: tuple[ObservedBalance, ...]
    observed_positions: tuple[ObservedPosition, ...]

    @field_validator("snapshot_hash", "source_event_hash", "source_payload_hash", "registry_hash")
    @classmethod
    def hashes_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("event_at", "available_at", "received_at", "cutoff_at", "finality_at")
    @classmethod
    def time_valid(cls, value: datetime | None) -> datetime | None:
        return _utc(value) if value is not None else None

    @model_validator(mode="after")
    def validate_record(self):
        if self.scope.environment == "live" and self.origin != "native_verified":
            raise FinanceError("synthetic evidence cannot bootstrap live finance")
        if self.origin == "simulation_derived" and (
                self.scope.environment != "experiment" or
                self.rights_ref != "local_simulation_fixture_only" or
                self.status != "accepted" or self.finality != "admitted_final" or
                self.finality_at is None or not self.balances_complete or
                not self.positions_complete or self.has_gap or self.has_reorg):
            raise FinanceError("derived observation lacks simulation-only finality")
        if not (self.event_at <= self.available_at <= self.received_at <= self.cutoff_at):
            raise FinanceError("observation time order is invalid")
        if self.finality_at is not None and not (
                self.event_at <= self.finality_at <= self.cutoff_at):
            raise FinanceError("observation finality is outside the cutoff")
        if self.coverage_scope == ARBITRUM_MANAGED_PAIR_COVERAGE:
            self._validate_managed_pair_coverage()
        elif self.source_block_number is not None or self.source_block_hash is not None:
            if self.source_block_number is None or self.source_block_hash is None:
                raise FinanceError("source block number and hash must be paired")
            native_int(self.source_block_number, positive=True)
            if not re.fullmatch(r"0x[0-9a-f]{64}", self.source_block_hash):
                raise FinanceError("source block hash must be normalized EVM hash")
        keys = [(row.asset_unit_id, row.location_id, row.book)
                for row in self.observed_balances]
        if len(keys) != len(set(keys)):
            raise FinanceError("duplicate observed balance identity")
        positions = [(row.instrument_version_id, row.location_id)
                     for row in self.observed_positions]
        if len(positions) != len(set(positions)):
            raise FinanceError("duplicate observed position identity")
        return self

    def _validate_managed_pair_coverage(self) -> None:
        source = self.source_account_id.split(":")
        account = source[-1] if len(source) == 4 else ""
        if self.scope.environment != "live" or len(source) != 4 \
                or source[:2] != ["arbitrum", "42161"] \
                or source[2] not in {"wallet", "vault"} \
                or not re.fullmatch(r"0x[0-9a-f]{40}", account):
            raise FinanceError("managed USDC/WETH coverage requires an exact Arbitrum source")
        rights = (ARBITRUM_MANAGED_VAULT_RIGHTS if source[2] == "vault"
                  else ARBITRUM_MANAGED_PAIR_RIGHTS)
        if self.origin != "native_verified" or self.status != "accepted" \
                or self.rights_ref != rights \
                or self.finality != "admitted_final" or self.finality_at is None \
                or self.has_gap or self.has_reorg:
            raise FinanceError("managed USDC/WETH coverage lacks finalized native source evidence")
        if self.source_block_number is None or self.source_block_hash is None:
            raise FinanceError("managed USDC/WETH coverage requires a finalized block reference")
        native_int(self.source_block_number, positive=True)
        if not re.fullmatch(r"0x[0-9a-f]{64}", self.source_block_hash):
            raise FinanceError("managed USDC/WETH finalized block hash is malformed")
        event_hash = (arbitrum_managed_vault_event_hash if source[2] == "vault"
                      else arbitrum_managed_pair_event_hash)
        if self.event_at.microsecond != 0 or self.source_event_hash != event_hash(
                self.source_account_id, self.source_block_number,
                self.source_block_hash, self.event_at):
            raise FinanceError("managed USDC/WETH source event does not bind its finalized block")
        if not self.balances_complete or self.positions_complete or self.observed_positions:
            raise FinanceError("managed USDC/WETH coverage scope is misstated")
        if self.registry_hash != arbitrum_managed_pair_registry_hash():
            raise FinanceError("managed USDC/WETH asset registry does not match")
        expected_assets = {ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID}
        if {row.asset_unit_id for row in self.observed_balances} != expected_assets \
                or any(row.location_id != self.source_account_id or row.book != "wallet" \
                       or row.registry_hash != self.registry_hash
                       for row in self.observed_balances):
            raise FinanceError("managed USDC/WETH snapshot must contain exactly the pair wallet balances")


def snapshot_coverage_is_complete(snapshot: AccountObservationSnapshotRef) -> bool:
    """Return true only when the snapshot is complete for its declared scope."""
    if snapshot.coverage_scope == "full_account":
        return snapshot.balances_complete and snapshot.positions_complete
    return snapshot.coverage_scope == ARBITRUM_MANAGED_PAIR_COVERAGE \
        and snapshot.balances_complete and not snapshot.positions_complete \
        and not snapshot.observed_positions


def account_snapshot_from_row(row) -> AccountObservationSnapshotRef:
    """Decode SQL JSONB arrays without relaxing strict wire validation."""
    body = dict(row)
    body.pop("created_at", None)
    body.setdefault("coverage_scope", "full_account")
    body.setdefault("source_block_number", None)
    body.setdefault("source_block_hash", None)
    body["scope"] = {"environment": body.pop("environment"),
                     "scope_id": body.pop("scope_id"),
                     "strategy_account_id": body.pop("strategy_account_id")}
    body["observed_balances"] = tuple(body["observed_balances"])
    body["observed_positions"] = tuple({**position,
        "funding_event_ids": tuple(position["funding_event_ids"]),
        "fee_event_ids": tuple(position["fee_event_ids"])}
        for position in body["observed_positions"])
    return AccountObservationSnapshotRef.model_validate(body)


def require_current_live_native_snapshot(
    snapshot: AccountObservationSnapshotRef, *, scope: FinanceScope,
    source_account_id: str, policy_version: str, now: datetime,
    max_age_seconds: int,
) -> AccountObservationSnapshotRef:
    """Enforce the common current-native contract before live financial use.

    This validates an already sourced snapshot. It does not establish source
    authenticity or provide an ingestion path; the native adapter must do that.
    """
    now = _utc(now)
    if scope.environment != "live" or snapshot.scope != scope:
        raise FinanceError("live account snapshot scope does not match")
    if snapshot.source_account_id != source_account_id:
        raise FinanceError("live account snapshot source changed")
    if snapshot.origin != "native_verified" or snapshot.rights_ref in {
            "internal_qualification_only", "local_simulation_fixture_only"}:
        raise FinanceError("live financial use requires native account evidence")
    if snapshot.status != "accepted" or snapshot.finality != "admitted_final" \
            or snapshot.finality_at is None or snapshot.has_gap or snapshot.has_reorg \
            or not snapshot_coverage_is_complete(snapshot):
        raise FinanceError("live account snapshot is not final and complete")
    if snapshot.policy_version != policy_version:
        raise FinanceError("live account snapshot policy version changed")
    if type(max_age_seconds) is not int or max_age_seconds <= 0:
        raise FinanceError("live account snapshot age policy is invalid")
    if any(value > now for value in (
            snapshot.event_at, snapshot.available_at, snapshot.received_at,
            snapshot.cutoff_at, snapshot.finality_at)) \
            or (now - snapshot.event_at).total_seconds() > max_age_seconds:
        raise FinanceError("live account snapshot is stale or from the future")
    return snapshot
