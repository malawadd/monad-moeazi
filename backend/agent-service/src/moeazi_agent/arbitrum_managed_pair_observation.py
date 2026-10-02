"""Convert the sidecar's finalized Arbitrum USDC/WETH read to finance evidence."""
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
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_MANAGED_PAIR_RIGHTS,
    ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
    AccountObservationSnapshotRef, ObservedBalance,
    arbitrum_managed_pair_event_hash, arbitrum_managed_pair_registry_hash,
)


_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_BLOCK_HASH = re.compile(r"^0x[0-9a-fA-F]{64}$")


class _PairBalances(StrictFinanceModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    usdc: str = Field(alias="USDC")
    weth: str = Field(alias="WETH")


class _SidecarAccountRead(StrictFinanceModel):
    """Exact response schema from `readUniswapAccount`; drift fails closed."""

    model_config = ConfigDict(extra="forbid", strict=True)

    chain_id: Literal[42161] = Field(alias="chainId")
    account: str
    block_number: str = Field(alias="blockNumber")
    block_hash: str = Field(alias="blockHash")
    block_timestamp: str = Field(alias="blockTimestamp")
    account_mode: Literal["kernel-7702", "other"] = Field(alias="accountMode")
    balances: _PairBalances
    tracked_pair_complete: Literal[True] = Field(alias="trackedPairComplete")
    balances_complete: Literal[False] = Field(alias="balancesComplete")
    positions_complete: Literal[False] = Field(alias="positionsComplete")
    source: Literal["arbitrum_finalized_rpc"]


def build_arbitrum_managed_pair_snapshot(
    read_payload: dict,
    *,
    scope: FinanceScope,
    expected_account: str,
    policy_version: str,
    received_at: datetime,
) -> AccountObservationSnapshotRef:
    """Build an accepted snapshot complete only for direct USDC/WETH wallet balances.

    The sidecar pins code and both ERC-20 `balanceOf` calls to one finalized
    Arbitrum block. Other wallet assets and all positions remain explicitly
    outside this snapshot's declared coverage scope.
    """
    owner = _normalized_address(expected_account)
    if scope.environment != "live" or scope.scope_id != "live":
        raise ValueError("The managed Arbitrum pair source requires live finance scope")
    if not policy_version or len(policy_version) > 128:
        raise ValueError("A bounded finance policy version is required")
    captured_at = _utc(received_at)
    source = _SidecarAccountRead.model_validate(read_payload)
    if _normalized_address(source.account) != owner:
        raise ValueError("Arbitrum account response differs from the configured owner")
    if source.account != owner:
        raise ValueError("Arbitrum sidecar must return a normalized account address")

    block_number = native_int(source.block_number, positive=True)
    block_timestamp = native_int(source.block_timestamp, positive=True)
    block_hash = source.block_hash.lower()
    if not _BLOCK_HASH.fullmatch(source.block_hash):
        raise ValueError("Arbitrum finalized block hash is malformed")
    event_at = datetime.fromtimestamp(block_timestamp, tz=timezone.utc)
    if event_at > captured_at:
        raise ValueError("Arbitrum finalized block is later than its receive time")

    for units in (source.balances.usdc, source.balances.weth):
        native_int(units, nonnegative=True)
    source_account_id = f"arbitrum:42161:wallet:{owner}"
    registry = arbitrum_managed_pair_registry_hash()
    payload_hash = _digest("moeazi-arbitrum-account-payload-v1", read_payload)
    event_hash = arbitrum_managed_pair_event_hash(
        source_account_id, str(block_number), block_hash, event_at)
    provisional = AccountObservationSnapshotRef(
        scope=scope,
        snapshot_hash="0" * 64,
        source_account_id=source_account_id,
        origin="native_verified",
        status="accepted",
        event_at=event_at,
        available_at=captured_at,
        received_at=captured_at,
        cutoff_at=captured_at,
        finality_at=captured_at,
        finality="admitted_final",
        has_gap=False,
        has_reorg=False,
        balances_complete=True,
        positions_complete=False,
        rights_ref=ARBITRUM_MANAGED_PAIR_RIGHTS,
        source_event_hash=event_hash,
        source_payload_hash=payload_hash,
        registry_hash=registry,
        policy_version=policy_version,
        coverage_scope=ARBITRUM_MANAGED_PAIR_COVERAGE,
        source_block_number=str(block_number),
        source_block_hash=block_hash,
        observed_balances=(
            ObservedBalance(asset_unit_id=ARBITRUM_USDC_UNIT_ID,
                location_id=source_account_id, book="wallet",
                units=source.balances.usdc, registry_hash=registry),
            ObservedBalance(asset_unit_id=ARBITRUM_WETH_UNIT_ID,
                location_id=source_account_id, book="wallet",
                units=source.balances.weth, registry_hash=registry),
        ),
        observed_positions=(),
    )
    snapshot = provisional.model_copy(update={
        "snapshot_hash": account_snapshot_hash(provisional),
    })
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
        raise ValueError("Arbitrum account snapshot digest did not close")
    return snapshot


def _normalized_address(value: str) -> str:
    if not isinstance(value, str) or not _ADDRESS.fullmatch(value):
        raise ValueError("Arbitrum account must be an exact 0x address")
    return value.lower()


def _digest(domain: str, value: dict) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False)
    return hashlib.sha256((domain + "\n" + encoded).encode("utf-8")).hexdigest()
