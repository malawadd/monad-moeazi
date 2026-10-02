"""Fixed-seed local evaluator benchmark; it makes no connection or provider call."""
from __future__ import annotations
import argparse, statistics, sys, time
from datetime import datetime, timezone
sys.path.insert(0, "agent-service/src")
from moeazi_agent.usage_rights_scenarios import evaluate_fixture, scenario_registry

parser = argparse.ArgumentParser(); parser.add_argument("--warmup", type=int, default=1000); parser.add_argument("--iterations", type=int, default=10000); parser.add_argument("--max-p95-ms", type=float, default=10); args = parser.parse_args()
rows = scenario_registry(); now = datetime(2026, 9, 7, tzinfo=timezone.utc)
for index in range(args.warmup): evaluate_fixture(rows[index % len(rows)]["id"], "observe", now, "operator:fixture", f"{index:064x}")
samples = []
for index in range(args.iterations):
    start = time.perf_counter(); evaluate_fixture(rows[index % len(rows)]["id"], "observe", now, "operator:fixture", f"{index:064x}"); samples.append((time.perf_counter() - start) * 1000)
p95 = statistics.quantiles(samples, n=100)[94]; print(f"usage-rights benchmark p95_ms={p95:.3f} iterations={args.iterations}")
if p95 > args.max_p95_ms: raise SystemExit("usage-rights benchmark exceeded p95 ceiling")
