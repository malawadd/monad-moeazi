import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .evaluation_contracts import ForecastPoint
from .evaluation_engine import HORIZON_SECONDS, brier_score


class EvaluationOutcomeRepository:
    def __init__(self, dsn_or_engine: str | AsyncEngine):
        self.engine = (
            create_async_engine(dsn_or_engine, pool_pre_ping=True)
            if isinstance(dsn_or_engine, str) else dsn_or_engine
        )

    async def record_run_artifacts(
        self, run: dict, market: str, start_price: float, observed_at: datetime,
    ) -> None:
        async with self.engine.begin() as conn:
            for raw in run.get("output", {}).get("forecasts", []):
                forecast = ForecastPoint.model_validate(raw)
                await conn.execute(text("""
                    INSERT INTO evaluation_forecast_outcomes
                      (outcome_id, experiment_id, run_id, subject_id, market, horizon,
                       forecast, start_price, due_at)
                    VALUES (:id, :experiment, :run, :subject, :market, :horizon,
                      CAST(:forecast AS jsonb), :price, :due)
                    ON CONFLICT (outcome_id) DO NOTHING
                """), {
                    "id": f"{run['run_id']}:{forecast.horizon}",
                    "experiment": run["experiment_id"], "run": run["run_id"],
                    "subject": run["subject_id"], "market": market,
                    "horizon": forecast.horizon, "forecast": forecast.model_dump_json(),
                    "price": start_price,
                    "due": observed_at + timedelta(seconds=HORIZON_SECONDS[forecast.horizon]),
                })
            for item in run.get("strategy_results", []):
                if item.get("status") != "open":
                    continue
                side = item["side"]
                entry = float(item["entryPrice"])
                stop_pct = float(item["stopLossPct"]) / 100
                take_pct = float(item["takeProfitPct"]) / 100
                await conn.execute(text("""
                    INSERT INTO evaluation_simulated_fills
                      (fill_id, experiment_id, run_id, subject_id, strategy_mode, market,
                       side, notional_usd, leverage, entry_price, fees_usd, slippage_usd,
                       stop_price, take_price, funding_rate_hourly, maximum_hold_at,
                       status, opened_at)
                    VALUES (:id, :experiment, :run, :subject, :mode, :market, :side,
                      :notional, :leverage, :entry, :fees, :slippage, :stop, :take,
                      :funding, :maximum_hold, 'open', :opened)
                    ON CONFLICT (fill_id) DO NOTHING
                """), {
                    "id": str(uuid4()), "experiment": run["experiment_id"],
                    "run": run["run_id"], "subject": run["subject_id"],
                    "mode": item["mode"], "market": market, "side": side,
                    "notional": item["notionalUsd"], "leverage": item["leverage"],
                    "entry": entry, "fees": item["feesUsd"], "slippage": item["slippageUsd"],
                    "stop": entry * (1 - stop_pct if side == "long" else 1 + stop_pct),
                    "take": entry * (1 + take_pct if side == "long" else 1 - take_pct),
                    "funding": item.get("fundingRateHourly", 0),
                    "maximum_hold": observed_at + timedelta(seconds=item["maximumHoldSeconds"]),
                    "opened": observed_at,
                })

    async def due_outcomes(self, limit: int = 500) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT * FROM evaluation_forecast_outcomes
                WHERE settled_at IS NULL AND due_at <= now()
                ORDER BY due_at LIMIT :limit
            """), {"limit": limit})
            return [dict(row._mapping) for row in rows]

    async def open_fills(self, limit: int = 500) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT * FROM evaluation_simulated_fills
                WHERE status = 'open' ORDER BY opened_at LIMIT :limit
            """), {"limit": limit})
            return [dict(row._mapping) for row in rows]

    async def settle_outcome(self, row: dict, end_price: float) -> None:
        change_bps = (end_price / float(row["start_price"]) - 1) * 10_000
        actual = "flat" if abs(change_bps) <= 10 else "up" if change_bps > 0 else "down"
        score = brier_score(ForecastPoint.model_validate(row["forecast"]), actual)
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                UPDATE evaluation_forecast_outcomes SET end_price = :price,
                  actual_direction = :actual, brier_score = :score, settled_at = now()
                WHERE outcome_id = :id AND settled_at IS NULL
            """), {"id": row["outcome_id"], "price": end_price, "actual": actual, "score": score})

    async def settle_fill(self, row: dict, exit_price: float, reason: str) -> None:
        now = datetime.now(timezone.utc)
        notional = float(row["notional_usd"])
        direction = 1 if row["side"] == "long" else -1
        gross = notional * (exit_price / float(row["entry_price"]) - 1) * direction
        hours = max(0, (now - row["opened_at"]).total_seconds() / 3_600)
        funding = notional * float(row["funding_rate_hourly"]) * hours * direction
        exit_cost = float(row["fees_usd"]) + float(row["slippage_usd"])
        pnl = gross - float(row["fees_usd"]) - float(row["slippage_usd"]) - exit_cost - funding
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                UPDATE evaluation_simulated_fills SET exit_price = :price,
                  fees_usd = fees_usd + :fees, slippage_usd = slippage_usd + :slippage,
                  funding_usd = :funding, pnl_usd = :pnl, status = :status,
                  closed_at = :closed WHERE fill_id = :id AND status = 'open'
            """), {
                "id": row["fill_id"], "price": exit_price,
                "fees": row["fees_usd"], "slippage": row["slippage_usd"],
                "funding": funding, "pnl": pnl, "status": f"closed_{reason}", "closed": now,
            })

    async def artifacts(self, experiment_id: str) -> dict:
        async with self.engine.connect() as conn:
            outcomes = await conn.execute(text("""
                SELECT subject_id, market, horizon, forecast, start_price, end_price,
                       actual_direction, brier_score, due_at, settled_at
                FROM evaluation_forecast_outcomes WHERE experiment_id = :id
                ORDER BY due_at DESC LIMIT 500
            """), {"id": experiment_id})
            fills = await conn.execute(text("""
                SELECT subject_id, strategy_mode, market, side, notional_usd, leverage,
                       entry_price, exit_price, fees_usd, slippage_usd, funding_usd,
                       pnl_usd, status, opened_at, closed_at
                FROM evaluation_simulated_fills WHERE experiment_id = :id
                ORDER BY opened_at DESC LIMIT 500
            """), {"id": experiment_id})
            return {
                "outcomes": [dict(row._mapping) for row in outcomes],
                "fills": [dict(row._mapping) for row in fills],
            }
