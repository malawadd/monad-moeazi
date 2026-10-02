import time
from datetime import datetime, timezone

from moeazi_agent.recovery_evaluator import evaluate_recovery_fixture
from moeazi_agent.test_center import load_json


def test_recovery_evaluator_p95_is_below_ten_ms_locally():
    fixture = load_json("recovery_scenarios.json")["scenarios"][0]
    now = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
    samples = []
    for _ in range(80):
        started = time.perf_counter_ns(); evaluate_recovery_fixture(fixture, now)
        samples.append((time.perf_counter_ns() - started) / 1_000_000)
    samples.sort(); p95 = samples[int(len(samples) * 0.95) - 1]
    assert p95 < 10, f"recovery evaluator p95 was {p95:.3f} ms"
