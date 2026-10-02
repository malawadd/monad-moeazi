"""Turn one verified, finalized Magic-owned spot vault read into finance evidence."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Literal

from pydantic import ConfigDict, Field

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceScope, StrictFinanceModel, _utc, native_int
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_MANAGED_VAULT_RIGHTS,
    ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
    AccountObservationSnapshotRef, ObservedBalance,
    arbitrum_managed_pair_registry_hash, arbitrum_managed_vault_event_hash,
)


_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_HASH = re.compile(r"^0x[0-9a-fA-F]{64}$")


class ManagedVaultRead(StrictFinanceModel):
    """Exact sidecar response; unknown or omitted evidence fails closed."""

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    schema_version: Literal["managed-spot-vault-read-v1"] = Field(alias="schemaVersion")
    chain_id: Literal[42161] = Field(alias="chainId")
    vault_address: str = Field(alias="vaultAddress")
    owner_address: str = Field(alias="ownerAddress")
    executor_address: str = Field(alias="executorAddress")
    program_hash: str = Field(alias="programHash")
    policy_hash: str = Field(alias="policyHash")
    capital_units: str = Field(alias="capitalUnits")
    max_buy_units: str = Field(alias="maxBuyUnits")
    expires_at: int = Field(alias="expiresAt")
    funded: Literal[True]
    stopped: bool
    vault_usdc_units: str = Field(alias="vaultUsdcUnits")
    vault_weth_units: str = Field(alias="vaultWethUnits")
    owner_usdc_units: str = Field(alias="ownerUsdcUnits")
    owner_eth_wei: str = Field(alias="ownerEthWei")
    finalized_block_number: str = Field(alias="finalizedBlockNumber")
    finalized_block_hash: str = Field(alias="finalizedBlockHash")
    finalized_block_timestamp: str = Field(alias="finalizedBlockTimestamp")
    code_hash: str = Field(alias="codeHash")


def _address(value: str) -> str:
    if not isinstance(value, str) or not _ADDRESS.fullmatch(value):
        raise ValueError("Managed vault address is malformed")
    return value.lower()


def _hash(value: str) -> str:
    if not isinstance(value, str) or not _HASH.fullmatch(value):
        raise ValueError("Managed vault hash is malformed")
    return value.lower()


def build_managed_vault_snapshot(
    read_payload: dict, *, scope: FinanceScope, expected_vault: str,
    expected_owner: str, expected_executor: str, expected_program_hash: str,
    expected_policy_hash: str, expected_code_hash: str, capital_units: str,
    max_buy_units: str, mandate_expires_at: int, policy_version: str,
    received_at: datetime,
) -> AccountObservationSnapshotRef:
    """Count only committed USDC/WETH at this vault, never owner-wallet funds."""
    if scope.environment != "live" or scope.scope_id != "live":
        raise ValueError("Managed vault observations require live finance scope")
    if not policy_version or len(policy_version) > 128:
        raise ValueError("A bounded finance policy version is required")
    captured_at = _utc(received_at)
    read = ManagedVaultRead.model_validate(read_payload)
    vault = _address(expected_vault)
    owner = _address(expected_owner)
    executor = _address(expected_executor)
    if (_address(read.vault_address) != vault or _address(read.owner_address) != owner
            or _address(read.executor_address) != executor
            or _hash(read.program_hash) != _hash(expected_program_hash)
            or _hash(read.policy_hash) != _hash(expected_policy_hash)
            or _hash(read.code_hash) != _hash(expected_code_hash)
            or read.capital_units != capital_units or read.max_buy_units != max_buy_units
            or read.expires_at != mandate_expires_at):
        raise ValueError("Finalized vault differs from Magic owner, executor or mandate")
    native_int(capital_units, positive=True)
    native_int(max_buy_units, positive=True)
    if int(max_buy_units) > int(capital_units):
        raise ValueError("Managed vault order cap exceeds committed capital")
    for units in (read.vault_usdc_units, read.vault_weth_units,
                  read.owner_usdc_units, read.owner_eth_wei):
        native_int(units, nonnegative=True)
    block_number = native_int(read.finalized_block_number, positive=True)
    block_timestamp = native_int(read.finalized_block_timestamp, positive=True)
    block_hash = _hash(read.finalized_block_hash)
    event_at = datetime.fromtimestamp(block_timestamp, tz=timezone.utc)
    if event_at > captured_at:
        raise ValueError("Finalized vault block is later than its receive time")
    source_account_id = f"arbitrum:42161:vault:{vault}"
    registry = arbitrum_managed_pair_registry_hash()
    encoded = json.dumps(read_payload, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False)
    payload_hash = hashlib.sha256(("moeazi-arbitrum-vault-payload-v1\n" + encoded).encode()).hexdigest()
    provisional = AccountObservationSnapshotRef(
        scope=scope, snapshot_hash="0" * 64, source_account_id=source_account_id,
        origin="native_verified", status="accepted", event_at=event_at,
        available_at=captured_at, received_at=captured_at, cutoff_at=captured_at,
        finality_at=captured_at, finality="admitted_final", has_gap=False,
        has_reorg=False, balances_complete=True, positions_complete=False,
        rights_ref=ARBITRUM_MANAGED_VAULT_RIGHTS,
        source_event_hash=arbitrum_managed_vault_event_hash(source_account_id,
            str(block_number), block_hash, event_at),
        source_payload_hash=payload_hash, registry_hash=registry,
        policy_version=policy_version, coverage_scope=ARBITRUM_MANAGED_PAIR_COVERAGE,
        source_block_number=str(block_number), source_block_hash=block_hash,
        observed_balances=(
            ObservedBalance(asset_unit_id=ARBITRUM_USDC_UNIT_ID,
                location_id=source_account_id, book="wallet",
                units=read.vault_usdc_units, registry_hash=registry),
            ObservedBalance(asset_unit_id=ARBITRUM_WETH_UNIT_ID,
                location_id=source_account_id, book="wallet",
                units=read.vault_weth_units, registry_hash=registry),
        ), observed_positions=(),
    )
    snapshot = provisional.model_copy(update={
        "snapshot_hash": account_snapshot_hash(provisional),
    })
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
        raise ValueError("Managed vault snapshot digest did not close")
    return snapshot
