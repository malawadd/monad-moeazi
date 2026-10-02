"""Owned-process local Q4 harness; identity is explicitly a synthetic HTTP fixture."""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from secrets import token_urlsafe
import subprocess
import sys
from threading import Thread
from uuid import uuid4

from sqlalchemy.engine import make_url


ROOT = Path(__file__).resolve().parents[2]


class IdentityFixture:
    def __init__(self, subject: str, context: dict):
        self.subject = subject
        self.context = context
        self.secret = token_urlsafe(36)
        self.calls = 0
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                fixture.calls += 1
                status, result = 403, {"error": "fixture identity denied"}
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 4096:
                        raise ValueError("request size")
                    body = json.loads(self.rfile.read(size))
                    expected = {"command": "getSimulationAuthorityContext", "payload": {
                        "subject": fixture.subject,
                        "experimentSpecId": fixture.context["scope"]["scopeId"]}}
                    if self.path == "/simulation-worker" and \
                            self.headers.get("Authorization") == f"Bearer {fixture.secret}" and \
                            body == expected:
                        status, result = 200, fixture.context
                except (ValueError, TypeError, KeyError):
                    pass
                raw = json.dumps(result).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_port}/simulation-worker"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


class SimulationProcess:
    """Runs the actual worker entrypoint with only its dedicated environment."""
    def __init__(self, identity: IdentityFixture):
        checkpoint = ROOT / ".data" / "q4-simulation-db.json"
        record = json.loads(checkpoint.read_text(encoding="utf-8"))
        url = make_url(record["dsn"])
        if (url.drivername, url.host, url.port, url.database, url.username) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930",
            "moeazi_q4_sim_20260930"):
            raise RuntimeError("Process harness permits only root's disposable Q4 login")
        self.environment = {
            "PYTHONPATH": str(ROOT / "agent-service" / "src"), "PYTHONUNBUFFERED": "1",
            "TRADING_SIMULATION_ENABLED": "true",
            "TRADING_SIMULATION_POSTGRES_DSN": record["dsn"],
            "TRADING_SIMULATION_CONVEX_IDENTITY_URL": identity.url,
            "TRADING_SIMULATION_IDENTITY_SECRET": identity.secret,
            "TRADING_SIMULATION_TEMPORAL_ADDRESS": "127.0.0.1:7233",
            "TRADING_SIMULATION_TEMPORAL_NAMESPACE": "default",
            "TRADING_SIMULATION_MAX_CONCURRENT_ACTIVITIES": "1",
        }
        for key in ("SystemRoot", "WINDIR"):
            if key in os.environ:
                self.environment[key] = os.environ[key]
        self.log_path = ROOT / ".data" / f"q4-process-{uuid4().hex}.log"
        self.process = None
        self._log = None

    def start(self):
        if self.process is not None and self.process.poll() is None:
            raise RuntimeError("Harness worker is already running")
        self._log = self.log_path.open("ab")
        try:
            self.process = subprocess.Popen(
                [sys.executable, "-m", "moeazi_agent.simulation_worker"], cwd=ROOT,
                env=self.environment, stdin=subprocess.DEVNULL,
                stdout=self._log, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:
            self._log.close()
            self._log = None
            raise
        return self.process.pid

    def check_alive(self):
        if self.process is None or self.process.poll() is not None:
            raise RuntimeError("Owned Q4 worker exited; inspect its ignored local log")

    def crash(self):
        if self.process is not None and self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)
        if self._log is not None:
            self._log.close()
            self._log = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *args):
        self.crash()
