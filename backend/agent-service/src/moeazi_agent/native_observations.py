"""Hyperliquid public spot/perp recorded-response parsers; no network calls."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from .observation_contracts import (
    BookLevel, InstrumentVersion, MarketObservation, canonical_hash, utc,
)


def _plain_object(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _metadata_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _step(decimals: int) -> str:
    return "0." + "0" * (decimals - 1) + "1" if decimals else "1"


def hyperliquid_spot_instrument(
    metadata_bytes: bytes, native_pair: str, *, effective_at: datetime,
) -> InstrumentVersion:
    """Resolve a spot pair by native universe index and token IDs, never display symbol."""
    metadata = _plain_object(json.loads(metadata_bytes), "spot metadata")
    universe = metadata.get("universe")
    tokens = metadata.get("tokens")
    if not isinstance(universe, list) or not isinstance(tokens, list):
        raise ValueError("Spot universe and token registry are required")
    matches = [row for row in universe if isinstance(row, dict) and row.get("name") == native_pair]
    if len(matches) != 1:
        raise ValueError("Spot pair must resolve uniquely")
    pair = matches[0]
    if type(pair.get("index")) is not int or not isinstance(pair.get("tokens"), list) \
            or len(pair["tokens"]) != 2:
        raise ValueError("Spot pair has invalid native token indexes")
    resolved = []
    for token_index in pair["tokens"]:
        if type(token_index) is not int:
            raise ValueError("Spot token index must be an integer")
        found = [row for row in tokens if isinstance(row, dict) and row.get("index") == token_index]
        if len(found) != 1 or type(found[0].get("weiDecimals")) is not int \
                or type(found[0].get("szDecimals")) is not int \
                or not isinstance(found[0].get("tokenId"), str):
            raise ValueError("Spot token native unit metadata is incomplete")
        resolved.append(found[0])
    base, quote = resolved
    for row in resolved:
        if not 0 <= row["weiDecimals"] <= 36 or not 0 <= row["szDecimals"] <= 36:
            raise ValueError("Spot token decimals are invalid")
    registry_hash = canonical_hash({"pair": {key: pair.get(key) for key in
        ("index", "name", "tokens", "isCanonical")},
        "base": {key: base.get(key) for key in ("index", "tokenId", "weiDecimals", "szDecimals")},
        "quote": {key: quote.get(key) for key in ("index", "tokenId", "weiDecimals", "szDecimals")}})
    base_unit = f"hyperliquid:spot_token:{base['tokenId'].lower()}:{base['weiDecimals']}:v1"
    quote_unit = f"hyperliquid:spot_token:{quote['tokenId'].lower()}:{quote['weiDecimals']}:v1"
    return InstrumentVersion(
        instrument_version_id=f"hyperliquid:spot:{pair['index']}:{registry_hash}",
        venue_id="hyperliquid", native_instrument_id=native_pair, product_kind="spot",
        base_asset_unit_id=base_unit, quote_asset_unit_id=quote_unit,
        settlement_asset_unit_id=quote_unit, base_decimals=base["weiDecimals"],
        quote_decimals=quote["weiDecimals"], settlement_decimals=quote["weiDecimals"],
        size_decimals=base["szDecimals"], contract_multiplier="1",
        price_rule="hyperliquid_spot_significant_figures_v1",
        lot_step=_step(base["szDecimals"]),
        margin_model="not_applicable", funding_model="not_applicable",
        effective_at=utc(effective_at), registry_hash=registry_hash,
    )


def hyperliquid_perp_instrument(
    metadata_bytes: bytes, native_coin: str, *, effective_at: datetime,
    base_asset_unit_id: str, quote_asset_unit_id: str, settlement_asset_unit_id: str,
    base_decimals: int, quote_decimals: int, settlement_decimals: int,
    contract_multiplier: str, margin_model: str, funding_model: str,
) -> InstrumentVersion:
    """Perp collateral/asset units and multiplier must come from a separate registry."""
    metadata = json.loads(metadata_bytes)
    if not isinstance(metadata, list) or len(metadata) != 2:
        raise ValueError("Perp metadata/context pair is required")
    universe = _plain_object(metadata[0], "perp metadata").get("universe")
    if not isinstance(universe, list):
        raise ValueError("Perp universe is required")
    matches = [(index, row) for index, row in enumerate(universe)
               if isinstance(row, dict) and row.get("name") == native_coin and not row.get("isDelisted")]
    if len(matches) != 1:
        raise ValueError("Perp coin must resolve uniquely")
    index, row = matches[0]
    if type(row.get("szDecimals")) is not int or not 0 <= row["szDecimals"] <= 36:
        raise ValueError("Perp size decimals are invalid")
    registry_hash = canonical_hash({"index": index,
        "native": {key: row.get(key) for key in ("name", "szDecimals", "maxLeverage", "marginTableId")},
        "base_unit": base_asset_unit_id, "quote_unit": quote_asset_unit_id,
        "settlement_unit": settlement_asset_unit_id, "base_decimals": base_decimals,
        "quote_decimals": quote_decimals, "settlement_decimals": settlement_decimals,
        "contract_multiplier": contract_multiplier, "margin_model": margin_model,
        "funding_model": funding_model})
    size_decimals = row["szDecimals"]
    return InstrumentVersion(
        instrument_version_id=f"hyperliquid:perpetual:{index}:{registry_hash}",
        venue_id="hyperliquid", native_instrument_id=native_coin,
        product_kind="perpetual", base_asset_unit_id=base_asset_unit_id,
        quote_asset_unit_id=quote_asset_unit_id,
        settlement_asset_unit_id=settlement_asset_unit_id,
        base_decimals=base_decimals, quote_decimals=quote_decimals,
        settlement_decimals=settlement_decimals, size_decimals=size_decimals,
        contract_multiplier=contract_multiplier,
        price_rule="hyperliquid_perp_significant_figures_v1",
        lot_step=_step(size_decimals),
        margin_model=margin_model, funding_model=funding_model,
        effective_at=utc(effective_at), registry_hash=registry_hash,
    )


def hyperliquid_book_observation(
    payload_bytes: bytes, instrument: InstrumentVersion, *, received_at: datetime,
    source_rights_ref: str, source_kind: str = "recorded_native",
) -> MarketObservation:
    payload = _plain_object(json.loads(payload_bytes), "book")
    if payload.get("coin") != instrument.native_instrument_id:
        raise ValueError("Book native coin does not match instrument version")
    millis = payload.get("time")
    if type(millis) is not int or millis <= 0:
        raise ValueError("Book provider event time is required")
    levels = payload.get("levels")
    if not isinstance(levels, list) or len(levels) != 2 \
            or not all(isinstance(side, list) for side in levels):
        raise ValueError("Book requires native bid and ask sides")
    def side(rows: list) -> tuple[BookLevel, ...]:
        return tuple(BookLevel(price_quote_per_base=_plain_object(row, "level").get("px"),
                               size_base=row.get("sz")) for row in rows)
    event_at = datetime.fromtimestamp(millis / 1000, tz=timezone.utc)
    received = utc(received_at)
    return MarketObservation(
        instrument_version_id=instrument.instrument_version_id,
        source_id="hyperliquid", source_event_id=f"l2Book:{instrument.native_instrument_id}:{millis}",
        source_kind=source_kind, source_rights_ref=source_rights_ref,
        raw_payload_hash=_metadata_hash(payload_bytes), observation_kind="book_snapshot",
        event_at=event_at, available_at=received, received_at=received,
        sequence=None, continuity="snapshot_only", block_number=None, block_hash=None,
        finality="not_applicable", bids=side(levels[0]), asks=side(levels[1]),
    )
