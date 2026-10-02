"""Opt-in local capture of public Hyperliquid spot books for replay research."""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import uuid

import httpx
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from .native_observations import hyperliquid_book_observation, hyperliquid_spot_instrument
from .observation_replay import replay_observations
from .observation_storage import ObservationRepository


INFO_URL = "https://api.hyperliquid.xyz/info"
RIGHTS = "internal_qualification_only"
POLICY = "q2_internal_research_v1"
MAX_COUNT = 10
DSN_ENV = "MOEAZI_CAPTURE_POSTGRES_DSN"
DATA_ROOT_ENV = "MOEAZI_CAPTURE_DATA_ROOT"  # existing mounted .data directory override
BOOK_REQUEST_INTERVAL_SECONDS = 1.0
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = PROJECT_ROOT / ".data" / "hyperliquid-spot-captures"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_bytes(value: dict) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("ascii")


def _save_sidecar(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _raw_ref(path: Path) -> str:
    configured_root = _configured_data_root()
    if configured_root is not None:
        try:
            value = path.resolve().relative_to(configured_root).as_posix()
        except ValueError:
            value = path.resolve().as_posix()
        else:
            return f"local-file:.data/{value}"
    try:
        value = path.resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        value = path.resolve().as_posix()
    return f"local-file:{value}"


def _inside_container() -> bool:
    return Path("/.dockerenv").exists()


def _is_mounted_data_root(path: Path) -> bool:
    return path.is_mount()


def _configured_data_root() -> Path | None:
    configured = os.environ.get(DATA_ROOT_ENV)
    if not configured:
        return None
    root = Path(configured).expanduser()
    if not root.is_absolute() or root.name != ".data" or not root.is_dir():
        raise ValueError(f"{DATA_ROOT_ENV} must point to an existing .data directory")
    root = root.resolve(strict=True)
    if _inside_container():
        if not _is_mounted_data_root(root):
            raise ValueError(f"{DATA_ROOT_ENV} must point to an explicit mounted .data directory")
    else:
        try:
            root.relative_to(PROJECT_ROOT.resolve())
        except ValueError as exc:
            raise ValueError(f"{DATA_ROOT_ENV} must stay inside the workspace") from exc
    return root


async def _exchange(client, directory: Path, stem: str, body: dict):
    request_bytes = _json_bytes(body)
    request_path = directory / f"{stem}.request.bin"
    response_path = directory / f"{stem}.response.bin"
    sidecar_path = directory / f"{stem}.meta.json"
    request_path.write_bytes(request_bytes)
    requested_at = _now()
    try:
        response = await client.post(INFO_URL, content=request_bytes,
            headers={"Content-Type": "application/json"})
    except httpx.HTTPError as exc:
        _save_sidecar(sidecar_path, {
            "endpoint": INFO_URL, "sourceKind": "recorded_native",
            "rightsScope": RIGHTS, "requestFile": request_path.name,
            "requestSha256": hashlib.sha256(request_bytes).hexdigest(),
            "requestBytes": len(request_bytes), "requestedAt": _stamp(requested_at),
            "failedAt": _stamp(_now()), "failureType": type(exc).__name__,
        })
        return None, None, None, None
    received_at = _now()
    response_bytes = response.content
    response_path.write_bytes(response_bytes)
    _save_sidecar(sidecar_path, {
        "endpoint": INFO_URL, "sourceKind": "recorded_native", "rightsScope": RIGHTS,
        "requestFile": request_path.name, "responseFile": response_path.name,
        "requestSha256": hashlib.sha256(request_bytes).hexdigest(),
        "sha256": hashlib.sha256(response_bytes).hexdigest(),
        "requestBytes": len(request_bytes), "bytes": len(response_bytes),
        "requestedAt": _stamp(requested_at), "receivedAt": _stamp(received_at),
        "statusCode": response.status_code,
    })
    return response_bytes, received_at, response.status_code, response_path


def _new_directory(capture_root: Path | None) -> Path:
    if capture_root is not None:
        directory = capture_root
    else:
        configured_root = _configured_data_root()
        base = (configured_root / "hyperliquid-spot-captures") if configured_root else DATA_ROOT
        directory = base / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    return directory


def _validate(coin: str, count: int) -> None:
    if not coin or len(coin) > 64 or not coin.isascii() or any(char.isspace() for char in coin):
        raise ValueError("--coin must be an exact ASCII native spot pair name")
    if type(count) is not int or not 1 <= count <= MAX_COUNT:
        raise ValueError(f"--count must be an integer from 1 to {MAX_COUNT}")


def _validate_local_dsn(dsn: str) -> None:
    try:
        parsed = make_url(dsn)
    except Exception as exc:
        raise ValueError("The capture DSN must select a local PostgreSQL database") from exc
    allowed_hosts = {"localhost", "127.0.0.1", "::1"}
    if _inside_container():
        allowed_hosts.add("timescaledb")
    if parsed.drivername != "postgresql+asyncpg" or parsed.host not in allowed_hosts \
            or not parsed.database:
        raise ValueError("The capture DSN must select a local PostgreSQL database")
    if (parsed.username or "").casefold() in {
            "moeazi_simulation_local", "moeazi_simulation_writer"}:
        raise ValueError("Native source ingestion requires the application-scoped PostgreSQL DSN")


async def capture_spot(coin: str, count: int, *, ingest_dsn: str | None = None,
                       capture_root: Path | None = None, client_factory=None,
                       engine_factory=None, repository_factory=None, sleep_fn=None) -> dict:
    """Capture fixed-host metadata/books; optional ingestion requires an explicit DSN."""
    _validate(coin, count)
    if ingest_dsn is not None:
        _validate_local_dsn(ingest_dsn)
    directory = _new_directory(capture_root)
    client_factory = client_factory or httpx.AsyncClient
    engine_factory = engine_factory or create_async_engine
    repository_factory = repository_factory or ObservationRepository
    sleep_fn = sleep_fn or asyncio.sleep
    rejections: list[dict] = []
    accepted: list[tuple[object, bytes, str]] = []

    try:
        async with client_factory(timeout=15, follow_redirects=False, trust_env=False) as client:
            metadata, metadata_at, status, _ = await _exchange(
                client, directory, "spot-meta", {"type": "spotMeta"})
            if status is None:
                return {"status": "rejected", "reason": "metadata_request_failed",
                        "captureDirectory": str(directory), "admittedHashes": [],
                        "rejected": [{"reason": "metadata_request_failed"}]}
            if status != 200:
                return {"status": "rejected", "reason": f"metadata_http_status_{status}",
                        "captureDirectory": str(directory), "admittedHashes": [],
                        "rejected": [{"reason": f"metadata_http_status_{status}"}]}
            try:
                instrument = hyperliquid_spot_instrument(metadata, coin, effective_at=metadata_at)
            except (ValueError, TypeError, KeyError):
                return {"status": "rejected", "reason": "invalid_spot_metadata",
                        "captureDirectory": str(directory), "admittedHashes": [],
                        "rejected": [{"reason": "invalid_spot_metadata"}]}

            for index in range(1, count + 1):
                if index > 1:
                    await sleep_fn(BOOK_REQUEST_INTERVAL_SECONDS)
                payload, received_at, status, response_path = await _exchange(
                    client, directory, f"book-{index:02d}", {"type": "l2Book", "coin": coin})
                if status is None:
                    rejections.append({"index": index, "reason": "book_request_failed"})
                    continue
                if status != 200:
                    rejections.append({"index": index, "reason": f"book_http_status_{status}"})
                    continue
                try:
                    observation = hyperliquid_book_observation(payload, instrument,
                        received_at=received_at, source_rights_ref=RIGHTS)
                except (ValueError, TypeError, KeyError):
                    rejections.append({"index": index, "reason": "invalid_book_payload"})
                    continue
                replay = replay_observations([instrument], [observation], received_at,
                                             max_age_ms=60_000)
                if not replay.accepted_observation_hashes:
                    reasons = sorted({row.reason for row in replay.excluded})
                    rejections.append({"index": index, "reason": "replay_rejected", "details": reasons})
                    continue
                accepted.append((observation, payload, _raw_ref(response_path)))
    except httpx.HTTPError:
        return {"status": "rejected", "reason": "public_info_client_failed",
                "captureDirectory": str(directory), "admittedHashes": [],
                "rejected": rejections + [{"reason": "public_info_client_failed"}]}

    accepted_hashes = sorted({hash_value for row in accepted for hash_value in
        replay_observations([instrument], [row[0]], row[0].received_at,
                            max_age_ms=60_000).accepted_observation_hashes})
    admitted_hashes: list[str] = []
    database_error = None
    if ingest_dsn is not None and accepted:
        engine = None
        try:
            engine = engine_factory(ingest_dsn, pool_pre_ping=True)
            repository = repository_factory(engine)
            registered = await repository.register_instrument(instrument)
            for observation, payload, raw_ref in accepted:
                admitted_hashes.append(await repository.ingest_market_observation(
                    registered, observation, raw_payload_bytes=payload,
                    raw_payload_ref=raw_ref, policy_version=POLICY))
        except Exception as exc:
            database_error = type(exc).__name__
        finally:
            if engine is not None:
                await engine.dispose()
    status = "captured_with_rejections" if rejections else "captured"
    if not accepted:
        status = "rejected"
    if database_error:
        status = "ingestion_failed"
    return {"status": status, "coin": coin, "requestedSnapshots": count,
            "captureDirectory": str(directory), "instrumentVersionId": instrument.instrument_version_id,
            "acceptedHashes": accepted_hashes, "admittedHashes": admitted_hashes,
            "databaseIngested": bool(ingest_dsn is not None and admitted_hashes and not database_error),
            "databaseErrorType": database_error, "rejected": rejections}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Capture public Hyperliquid spot books into ignored .data")
    parser.add_argument("--coin", required=True, help="exact native spot pair name from spot metadata")
    parser.add_argument("--count", required=True, type=int, help=f"book requests, 1..{MAX_COUNT}")
    parser.add_argument("--capture", action="store_true", help="opt into public HTTP requests")
    parser.add_argument("--ingest", action="store_true", help="store accepted observations in PostgreSQL")
    return parser


def _ingest_dsn_from_environment() -> str:
    dsn = os.environ.get(DSN_ENV)
    if not dsn:
        raise ValueError(f"Set {DSN_ENV} to an explicit local PostgreSQL DSN before --ingest")
    _validate_local_dsn(dsn)
    return dsn


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        _validate(args.coin, args.count)
    except ValueError as exc:
        parser.error(str(exc))
    if args.ingest and not args.capture:
        parser.error("--ingest requires --capture")
    ingest_dsn = None
    if args.ingest:
        try:
            ingest_dsn = _ingest_dsn_from_environment()
        except ValueError as exc:
            parser.error(str(exc))
    if not args.capture:
        print(json.dumps({"status": "dry_run", "coin": args.coin,
            "requestedSnapshots": args.count, "endpoint": INFO_URL,
            "networkRequests": args.count + 1, "databaseAccess": False}, sort_keys=True))
        return 0
    result = asyncio.run(capture_spot(args.coin, args.count,
        ingest_dsn=ingest_dsn))
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] in {"captured", "captured_with_rejections"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
