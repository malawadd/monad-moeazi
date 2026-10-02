"""Q2 proof using local recorded responses, distinct from synthetic fault fixtures."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from moeazi_agent.native_observations import (
    hyperliquid_book_observation, hyperliquid_perp_instrument,
    hyperliquid_spot_instrument,
)
from moeazi_agent.observation_replay import replay_observations


CAPTURE = Path(__file__).resolve().parents[2] / ".data" / "q2-capture"
NAMES = ("spot-meta", "perp-meta", "spot-book", "perp-book")


def read_capture(name):
    payload_path = CAPTURE / f"{name}.json"
    sidecar_path = CAPTURE / f"{name}.meta.json"
    if not payload_path.is_file() or not sidecar_path.is_file():
        pytest.skip("recorded native Q2 capture absent; synthetic fixtures cannot certify it")
    payload = payload_path.read_bytes()
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert hashlib.sha256(payload).hexdigest() == sidecar["sha256"]
    assert sidecar["bytes"] == len(payload)
    assert sidecar["sourceKind"] == "recorded_native"
    assert sidecar["rightsScope"] == "internal_qualification_only"
    received = datetime.fromisoformat(sidecar["receivedAt"].replace("Z", "+00:00"))
    requested = datetime.fromisoformat(sidecar["requestedAt"].replace("Z", "+00:00"))
    assert requested <= received
    return payload, sidecar, received


def parse_pair():
    spot_meta, _, spot_effective = read_capture("spot-meta")
    perp_meta, _, perp_effective = read_capture("perp-meta")
    spot_book, spot_sidecar, spot_received = read_capture("spot-book")
    perp_book, perp_sidecar, perp_received = read_capture("perp-book")
    spot_coin = json.loads(spot_book)["coin"]
    perp_coin = json.loads(perp_book)["coin"]
    spot = hyperliquid_spot_instrument(spot_meta, spot_coin, effective_at=spot_effective)
    perp = hyperliquid_perp_instrument(perp_meta, perp_coin,
        effective_at=perp_effective, base_asset_unit_id="registry:BTC:8",
        quote_asset_unit_id="registry:USDC:6",
        settlement_asset_unit_id="registry:USDC:6", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, contract_multiplier="1",
        margin_model="registry:perp-cross-v1", funding_model="registry:funding-v1")
    spot_observation = hyperliquid_book_observation(spot_book, spot,
        received_at=spot_received, source_rights_ref=spot_sidecar["rightsScope"])
    perp_observation = hyperliquid_book_observation(perp_book, perp,
        received_at=perp_received, source_rights_ref=perp_sidecar["rightsScope"])
    return (spot, perp), (spot_observation, perp_observation), (spot_book, perp_book)


def test_recorded_native_payloads_preserve_units_time_and_no_finality_claim():
    instruments, observations, payloads = parse_pair()
    assert {row.product_kind for row in instruments} == {"spot", "perpetual"}
    assert instruments[0].base_asset_unit_id.startswith("hyperliquid:spot_token:")
    assert instruments[1].base_asset_unit_id == "registry:BTC:8"
    for observation, payload in zip(observations, payloads):
        source = json.loads(payload)
        assert observation.source_kind == "recorded_native"
        assert observation.event_at == datetime.fromtimestamp(source["time"] / 1000,
            tz=timezone.utc)
        assert observation.available_at == observation.received_at
        assert observation.sequence is None and observation.continuity == "snapshot_only"
        assert observation.finality == "not_applicable" and observation.block_number is None
        assert observation.raw_payload_hash == hashlib.sha256(payload).hexdigest()
        assert observation.bids[0].price_quote_per_base == source["levels"][0][0]["px"]
        assert observation.asks[0].size_base == source["levels"][1][0]["sz"]


def test_recorded_native_clock_skew_is_quarantined_order_independently():
    instruments, observations, _ = parse_pair()
    cutoff = max(row.event_at for row in observations) + timedelta(milliseconds=1)
    first = replay_observations(instruments, observations, cutoff, max_age_ms=120_000)
    second = replay_observations(reversed(instruments), reversed(observations),
        cutoff, max_age_ms=120_000)
    assert first.snapshot_hash == second.snapshot_hash
    assert first.accepted_observation_hashes == ()
    assert {row.reason for row in first.excluded} == {"event_after_availability"}
    assert first.has_gap is False
    early = replay_observations(instruments, observations,
        min(row.available_at for row in observations) - timedelta(milliseconds=1),
        max_age_ms=120_000)
    assert early.accepted_observation_hashes == ()
    assert {row.reason for row in early.excluded} == {"event_after_cutoff"}
