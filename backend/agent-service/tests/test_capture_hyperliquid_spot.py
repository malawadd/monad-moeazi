"""Offline tests for the explicitly opt-in public spot capture CLI."""
from datetime import datetime, timedelta, timezone
import hashlib
import json

import pytest

from moeazi_agent import capture_hyperliquid_spot as capture


COIN = "BTC/USDC"
DSN = "postgresql+asyncpg://127.0.0.1/local-db"


def metadata_bytes():
    return json.dumps({"tokens": [
        {"index": 1, "tokenId": "0xbtc", "weiDecimals": 8, "szDecimals": 2},
        {"index": 2, "tokenId": "0xusdc", "weiDecimals": 6, "szDecimals": 6},
    ], "universe": [{"index": 0, "name": COIN, "tokens": [1, 2], "isCanonical": True}]
    }, separators=(",", ":")).encode()


def book_bytes(event_at):
    millis = int(event_at.timestamp() * 1000)
    return json.dumps({"coin": COIN, "time": millis, "levels": [
        [{"px": "100.00", "sz": "1.00"}], [{"px": "101.00", "sz": "1.00"}],
    ]}, separators=(",", ":")).encode()


class FakeResponse:
    def __init__(self, content, status_code=200):
        self.content, self.status_code = content, status_code


class FakeClient:
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, *, content, headers):
        assert url == capture.INFO_URL
        assert headers == {"Content-Type": "application/json"}
        self.requests.append(content)
        return self.responses.pop(0)


def _clock(monkeypatch, start):
    moments = [start + timedelta(seconds=index) for index in range(8)]
    iterator = iter(moments)
    monkeypatch.setattr(capture, "_now", lambda: next(iterator))


def test_cli_defaults_to_no_network_and_enforces_snapshot_bound(monkeypatch, capsys):
    def forbidden(*args, **kwargs):
        raise AssertionError("dry-run must not capture")

    monkeypatch.setattr(capture, "capture_spot", forbidden)
    assert capture.main(["--coin", COIN, "--count", "2"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "dry_run" and result["networkRequests"] == 3
    assert result["databaseAccess"] is False
    with pytest.raises(SystemExit):
        capture.main(["--coin", COIN, "--count", "11"])
    with pytest.raises(ValueError):
        capture._validate_local_dsn("postgresql+asyncpg://db.example/local-db")


def test_cli_reads_dsn_environment_only_for_ingest(monkeypatch, capsys):
    real_dsn_reader = capture._ingest_dsn_from_environment
    monkeypatch.delenv(capture.DSN_ENV, raising=False)
    def forbidden_dsn_read():
        raise AssertionError("DSN environment must not be read without --ingest")

    async def no_ingest_capture(*args, **kwargs):
        assert kwargs.get("ingest_dsn") is None
        return {"status": "captured"}

    monkeypatch.setattr(capture, "_ingest_dsn_from_environment", forbidden_dsn_read)
    monkeypatch.setattr(capture, "capture_spot", no_ingest_capture)
    assert capture.main(["--coin", COIN, "--count", "1"]) == 0
    assert capture.main(["--coin", COIN, "--count", "1", "--capture"]) == 0
    with pytest.raises(SystemExit):
        capture.main(["--coin", COIN, "--count", "1", "--ingest"])

    monkeypatch.setattr(capture, "_ingest_dsn_from_environment", real_dsn_reader)
    monkeypatch.setenv(capture.DSN_ENV, DSN)
    calls = []

    async def fake_capture(*args, **kwargs):
        calls.append(kwargs.get("ingest_dsn"))
        return {"status": "captured"}

    monkeypatch.setattr(capture, "capture_spot", fake_capture)
    assert capture.main(["--coin", COIN, "--count", "1", "--capture", "--ingest"]) == 0
    assert calls == [DSN]
    assert DSN not in capsys.readouterr().out


@pytest.mark.asyncio
async def test_capture_preserves_exact_bytes_clocks_and_ingests_admitted_rows(monkeypatch, tmp_path):
    start = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
    _clock(monkeypatch, start)
    metadata = metadata_bytes()
    books = [book_bytes(start + timedelta(seconds=2.5)),
             book_bytes(start + timedelta(seconds=4.5))]
    client = FakeClient([FakeResponse(metadata), *(FakeResponse(row) for row in books)])
    factory_options = []

    def client_factory(**kwargs):
        factory_options.append(kwargs)
        return client

    class Engine:
        def __init__(self):
            self.disposed = False

        async def dispose(self):
            self.disposed = True

    engine = Engine()
    class Repository:
        def __init__(self, received_engine):
            assert received_engine is engine
            self.registered = None
            self.ingested = []

        async def register_instrument(self, instrument):
            self.registered = instrument
            return instrument

        async def ingest_market_observation(self, instrument, observation, **kwargs):
            assert instrument == self.registered
            assert hashlib.sha256(kwargs["raw_payload_bytes"]).hexdigest() == observation.raw_payload_hash
            assert kwargs["raw_payload_ref"].startswith("local-file:")
            assert kwargs["policy_version"] == capture.POLICY
            self.ingested.append(observation)
            return f"admitted-{len(self.ingested)}"

    repositories = []
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    def repository_factory(received_engine):
        repository = Repository(received_engine)
        repositories.append(repository)
        return repository

    result = await capture.capture_spot(COIN, 2, ingest_dsn=DSN,
        capture_root=tmp_path / "capture", client_factory=client_factory,
        engine_factory=lambda dsn, **kwargs: (assert_local_dsn(dsn, kwargs, engine)),
        repository_factory=repository_factory, sleep_fn=fake_sleep)
    directory = tmp_path / "capture"
    assert result["status"] == "captured"
    assert result["instrumentVersionId"].startswith("hyperliquid:spot:0:")
    assert result["admittedHashes"] == ["admitted-1", "admitted-2"]
    assert result["acceptedHashes"]
    assert result["databaseIngested"] is True
    assert len(client.requests) == 3 and len(repositories[0].ingested) == 2
    assert delays == [capture.BOOK_REQUEST_INTERVAL_SECONDS]
    assert factory_options == [{"timeout": 15, "follow_redirects": False, "trust_env": False}]
    assert (directory / "spot-meta.response.bin").read_bytes() == metadata
    for index, expected in enumerate(books, start=1):
        stem = f"book-{index:02d}"
        assert (directory / f"{stem}.response.bin").read_bytes() == expected
        sidecar = json.loads((directory / f"{stem}.meta.json").read_text())
        assert sidecar["sha256"] == hashlib.sha256(expected).hexdigest()
        assert sidecar["requestedAt"] <= sidecar["receivedAt"]
    assert json.loads((directory / "spot-meta.request.bin").read_bytes()) == {"type": "spotMeta"}
    assert engine.disposed is True


def assert_local_dsn(dsn, kwargs, engine):
    assert dsn == DSN and kwargs == {"pool_pre_ping": True}
    return engine


@pytest.mark.asyncio
async def test_future_book_time_is_reported_and_never_ingested(monkeypatch, tmp_path):
    start = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
    _clock(monkeypatch, start)
    client = FakeClient([FakeResponse(metadata_bytes()),
                         FakeResponse(book_bytes(start + timedelta(seconds=10)))])
    engine_calls = []
    result = await capture.capture_spot(COIN, 1, ingest_dsn=DSN,
        capture_root=tmp_path / "capture", client_factory=lambda **kwargs: client,
        engine_factory=lambda *args, **kwargs: engine_calls.append((args, kwargs)))
    assert result["status"] == "rejected"
    assert result["admittedHashes"] == [] and engine_calls == []
    assert result["rejected"] == [{"index": 1, "reason": "replay_rejected",
                                   "details": ["event_after_cutoff"]}]


def test_compose_capture_ingest_uses_service_dsn_and_persistent_mount(monkeypatch, tmp_path):
    monkeypatch.setattr(capture, "_inside_container", lambda: True)
    monkeypatch.setattr(capture, "_is_mounted_data_root", lambda _path: True)
    capture._validate_local_dsn("postgresql+asyncpg://application@timescaledb:5432/moeazi")
    for username in ("moeazi_simulation_local", "moeazi_simulation_writer"):
        with pytest.raises(ValueError, match="application-scoped"):
            capture._validate_local_dsn(
                f"postgresql+asyncpg://{username}@timescaledb:5432/moeazi")

    data_root = tmp_path / ".data"
    data_root.mkdir()
    monkeypatch.setenv(capture.DATA_ROOT_ENV, str(data_root))
    directory = capture._new_directory(None)
    response = directory / "book-01.response.bin"
    response.write_bytes(b"saved response")
    assert directory.parent == data_root / "hyperliquid-spot-captures"
    assert capture._raw_ref(response) == (
        f"local-file:.data/hyperliquid-spot-captures/{directory.name}/book-01.response.bin")
    monkeypatch.setattr(capture, "_is_mounted_data_root", lambda _path: False)
    with pytest.raises(ValueError, match="explicit mounted"):
        capture._configured_data_root()

    monkeypatch.setattr(capture, "_inside_container", lambda: False)
    with pytest.raises(ValueError, match="local PostgreSQL"):
        capture._validate_local_dsn("postgresql+asyncpg://application@timescaledb:5432/moeazi")
