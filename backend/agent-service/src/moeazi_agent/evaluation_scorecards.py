import math
import statistics


def enrich_scorecards(
    scorecard_rows: list[dict], outcomes: list[dict], fills: list[dict],
    starting_equity: float,
) -> list[dict]:
    for row in scorecard_rows:
        subject = row["subject_id"]
        card = row["scorecard"]
        settled = [
            item for item in outcomes
            if item["subject_id"] == subject and item.get("settled_at")
        ]
        if settled:
            card["brier_score"] = sum(float(item["brier_score"]) for item in settled) / len(settled)
            correctness, calibration = [], []
            for item in settled:
                forecast = item["forecast"]
                probabilities = {
                    "up": float(forecast["probability_up"]),
                    "flat": float(forecast["probability_flat"]),
                    "down": float(forecast["probability_down"]),
                }
                predicted = max(probabilities, key=probabilities.get)
                correct = 1 if predicted == item["actual_direction"] else 0
                correctness.append(correct)
                calibration.append(abs(float(forecast["confidence"]) - correct))
            card["forecast_accuracy"] = sum(correctness) / len(correctness)
            card["calibration_error"] = sum(calibration) / len(calibration)
        subject_fills = [item for item in fills if item["subject_id"] == subject]
        closed = [item for item in subject_fills if item.get("pnl_usd") is not None]
        card["simulated_fills"] = len(subject_fills)
        card["turnover_usd"] = sum(float(item["notional_usd"]) for item in subject_fills)
        card["fees_usd"] = sum(float(item["fees_usd"]) for item in subject_fills)
        card["slippage_usd"] = sum(float(item["slippage_usd"]) for item in subject_fills)
        card["funding_usd"] = sum(float(item["funding_usd"]) for item in subject_fills)
        if not closed:
            continue
        pnls = [float(item["pnl_usd"]) for item in closed]
        net = sum(pnls)
        card["net_simulated_return_pct"] = net / max(1, starting_equity) * 100
        card["win_rate"] = sum(value > 0 for value in pnls) / len(pnls)
        gains = sum(value for value in pnls if value > 0)
        losses = abs(sum(value for value in pnls if value < 0))
        card["profit_factor"] = gains / losses if losses else None
        card["maximum_drawdown_pct"] = _drawdown(pnls, starting_equity)
        if len(pnls) > 1 and statistics.pstdev(pnls) > 0:
            card["volatility_adjusted_return"] = (
                statistics.mean(pnls) / statistics.pstdev(pnls) * math.sqrt(len(pnls))
            )
    return scorecard_rows


def _drawdown(pnls: list[float], starting_equity: float) -> float:
    equity = peak = starting_equity
    maximum = 0.0
    for pnl in pnls:
        equity += pnl
        peak = max(peak, equity)
        maximum = max(maximum, (peak - equity) / max(1, peak) * 100)
    return maximum
