import os, subprocess, sys
from pathlib import Path


HARNESS=Path("agent-service/tests/risk_tiered_consent_repository_harness.py")
BENCHMARK=Path("agent-service/tests/risk_tiered_consent_postgres_benchmark.py")


def test_repository_scripts_are_opt_in_portable_and_exercise_real_writes():
    harness=HARNESS.read_text(encoding="utf8"); benchmark=BENCHMARK.read_text(encoding="utf8")
    assert 'os.environ.get("POSTGRES_DSN")' in harness and "create_async_engine" in harness
    assert 'Path(__file__).resolve().parents[1]' in harness and "DROP SCHEMA IF EXISTS" in harness
    assert "range(40)" in benchmark and "sorted(samples)[37]" in benchmark and "p95>=100" in benchmark
    env={key:value for key,value in os.environ.items() if key not in {"POSTGRES_DSN","TEST_DATABASE_URL"}}
    for script in (HARNESS,BENCHMARK):
        result=subprocess.run([sys.executable,str(script)],env=env,capture_output=True,text=True,check=False)
        assert result.returncode and "POSTGRES_DSN or TEST_DATABASE_URL is required" in result.stderr
