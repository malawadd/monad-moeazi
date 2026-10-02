"""Q2 replay of unaltered runtime capture; a clock-stepped sample stays excluded."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from moeazi_agent.native_observations import (
    hyperliquid_book_observation, hyperliquid_perp_instrument,
    hyperliquid_spot_instrument,
)
from moeazi_agent.observation_replay import replay_observations


ROOT = Path(__file__).resolve().parents[2] / ".data"


def captured(directory, name):
    payload_path = ROOT / directory / f"{name}.json"
    sidecar_path = ROOT / directory / f"{name}.meta.json"
    if not payload_path.is_file() or not sidecar_path.is_file():
        pytest.skip("unaltered runtime native capture is absent")
    payload = payload_path.read_bytes()
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert hashlib.sha256(payload).hexdigest() == sidecar["sha256"]
    assert sidecar["sourceKind"] == "recorded_native"
    assert sidecar["rightsScope"] == "internal_qualification_only"
    return payload, sidecar


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_runtime_perp_recording_has_stable_capture_clock_and_admits_snapshot_only():
    metadata, prior = captured("q2-capture", "perp-meta")
    payload, sidecar = captured("q2-runtime-capture", "perp-book")
    requested, received = instant(sidecar["requestedAt"]), instant(sidecar["receivedAt"])
    wall_ms = (received - requested).total_seconds() * 1000
    assert abs(wall_ms - sidecar["durationMs"]) < 50
    assert sidecar["captureClock"].endswith("no correction")
    coin = json.loads(payload)["coin"]
    instrument = hyperliquid_perp_instrument(metadata, coin,
        effective_at=instant(prior["receivedAt"]),
        base_asset_unit_id="registry:BTC:8",
        quote_asset_unit_id="registry:USDC:6",
        settlement_asset_unit_id="registry:USDC:6", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, contract_multiplier="1",
        margin_model="registry:perp-cross-v1", funding_model="registry:funding-v1")
    observation = hyperliquid_book_observation(payload, instrument,
        received_at=received, source_rights_ref=sidecar["rightsScope"])
    assert observation.event_at <= observation.received_at
    assert 0 <= (received - observation.event_at).total_seconds() < 2
    assert observation.event_at == datetime.fromtimestamp(
        json.loads(payload)["time"] / 1000, tz=timezone.utc)
    snapshot = replay_observations([instrument], [observation], received,
        max_age_ms=120_000)
    assert len(snapshot.accepted_observation_hashes) == 1
    assert snapshot.excluded == () and snapshot.has_gap is False
    assert observation.finality == "not_applicable"
    assert observation.sequence is None and observation.continuity == "snapshot_only"


def test_runtime_spot_sample_records_clock_step_and_is_not_positive_qualification():
    payload, sidecar = captured("q2-runtime-capture", "spot-book")
    assert json.loads(payload)["coin"] == sidecar["requestBody"]["coin"]
    wall_ms = (instant(sidecar["receivedAt"]) -
               instant(sidecar["requestedAt"])).total_seconds() * 1000
    assert abs(wall_ms - sidecar["durationMs"]) > 1_000


def test_stable_interval_spot_still_quarantines_future_provider_time():
    metadata, prior = captured("q2-capture", "spot-meta")
    payload, sidecar = captured("q2-runtime-spot-capture", "spot-book")
    requested, received = instant(sidecar["requestedAt"]), instant(sidecar["receivedAt"])
    wall_ms = (received - requested).total_seconds() * 1000
    assert abs(wall_ms - sidecar["durationMs"]) < 50
    instrument = hyperliquid_spot_instrument(metadata,
        json.loads(payload)["coin"], effective_at=instant(prior["receivedAt"]))
    observation = hyperliquid_book_observation(payload, instrument,
        received_at=received, source_rights_ref=sidecar["rightsScope"])
    assert (observation.event_at - observation.received_at).total_seconds() > 1
    replay = replay_observations([instrument], [observation],
        observation.event_at, max_age_ms=120_000)
    assert replay.accepted_observation_hashes == ()
    assert {row.reason for row in replay.excluded} == {"event_after_availability"}
