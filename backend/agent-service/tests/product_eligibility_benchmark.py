"""Fixed-seed local evaluator benchmark; no connection or provider call."""
from __future__ import annotations
import argparse, statistics, sys, time
from datetime import datetime, timezone
sys.path.insert(0, "agent-service/src")
from moeazi_agent.product_eligibility_scenarios import NOW, evaluate_fixture, _pack
from moeazi_agent.product_eligibility_evaluator import evaluate

parser = argparse.ArgumentParser(); parser.add_argument("--warmup", type=int, default=1000); parser.add_argument("--iterations", type=int, default=10000); parser.add_argument("--max-p95-ms", type=float, default=5); args = parser.parse_args()
item=evaluate_fixture("eligibility-001", "observe", NOW, "operator:fixture", "a" * 64)["_artifacts"]
request=item["request"]; pack=_pack(request.scope,request.product,request.venue.venue,request.operation,NOW)
for _ in range(args.warmup): evaluate(pack,request,NOW)
samples=[]
for index in range(args.iterations):
    started=time.perf_counter(); evaluate(pack,request,NOW); samples.append((time.perf_counter()-started)*1000)
p95=statistics.quantiles(samples,n=100)[94]; print(f"product-eligibility benchmark p95_ms={p95:.3f} iterations={args.iterations}")
if p95>=args.max_p95_ms: raise SystemExit("product-eligibility benchmark exceeded p95 ceiling")
