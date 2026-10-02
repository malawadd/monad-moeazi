import os, subprocess, sys
from pathlib import Path

SCRIPT=Path("agent-service/tests/operator_qualification_postgres_benchmark.py")
def test_benchmark_is_opt_in_and_uses_40_samples_with_deterministic_p95_index():
    source=SCRIPT.read_text(encoding="utf8")
    assert 'os.environ.get("TEST_DATABASE_URL")' in source and "range(40)" in source and "sorted(values)[37]" in source
    env={key:value for key,value in os.environ.items() if key!="TEST_DATABASE_URL"}
    result=subprocess.run([sys.executable,str(SCRIPT)],env=env,capture_output=True,text=True,check=False)
    assert result.returncode and "TEST_DATABASE_URL is required" in result.stderr
