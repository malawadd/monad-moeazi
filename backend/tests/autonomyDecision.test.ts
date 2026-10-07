import assert from "node:assert/strict";
import test from "node:test";
import { AUTONOMY_RULE_VERSION, chooseBuySignal, decideAutonomy, type PriceSample } from "../api-server/src/monad/autonomyDecision.js";

const now = 1_800_000_000_000;
function series(tokenIndex: number, start: bigint, end: bigint, count = 5): PriceSample[] {
  return Array.from({ length: count }, (_, index) => ({ tokenIndex,
    priceUsdcPerTokenWad: (start + (end - start) * BigInt(index) / BigInt(count - 1)).toString(),
    observedAt: now - 60_000 + index * 15_000, blockNumber: index + 1 }));
}

test("buy chooses the strongest qualifying finalized price rise", () => {
  const result = chooseBuySignal([
    series(0, 1_000n, 1_030n), series(1, 1_000n, 1_050n), series(2, 1_000n, 1_029n),
  ], now);
  assert.equal(result.selected?.tokenIndex, 1);
  assert.equal(result.selected?.changeBps, 500);
  assert.equal(result.rejected.some((item) => item.tokenIndex === 2), true);
});

test("buy rejects stale or incomplete one-minute histories", () => {
  const stale = series(0, 1_000n, 1_100n).map((sample) => ({ ...sample, observedAt: sample.observedAt - 60_000 }));
  const short = series(1, 1_000n, 1_100n, 4);
  const result = chooseBuySignal([stale, short], now);
  assert.equal(result.selected, null);
  assert.deepEqual(result.rejected.map((item) => item.reasonCode), [
    "insufficient_or_stale_one_minute_history", "insufficient_or_stale_one_minute_history",
  ]);
});

test("open position sells after a two percent drawdown from its post-buy peak", () => {
  const result = decideAutonomy({ histories: [series(0, 1_000n, 980n)], now,
    openPosition: { tokenIndex: 0, entryAt: now - 90_000, peakPriceUsdcPerTokenWad: "1000" } });
  assert.equal(result.action, "sell");
  assert.equal(result.reasonCode, "post_buy_peak_drawdown_2_percent");
  assert.equal(result.ruleVersion, AUTONOMY_RULE_VERSION);
});

test("open position sells after one flat minute within half a percent", () => {
  const samples = series(2, 1_000_000n, 1_004_000n);
  const result = decideAutonomy({ histories: [[], [], samples], now,
    openPosition: { tokenIndex: 2, entryAt: now - 90_000, peakPriceUsdcPerTokenWad: "1002000" } });
  assert.equal(result.action, "sell");
  assert.equal(result.reasonCode, "one_minute_move_within_half_percent");
});
