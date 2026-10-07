import assert from "node:assert/strict";
import test from "node:test";
import { defaultPerpDecisionProvider } from "../api-server/src/monad/perpDecisionProvider.js";

const now = 200_000;
const price = (observedAt: number, priceUsdcPerTokenWad: string) => ({
  marketIndex: 0, observedAt, priceUsdcPerTokenWad, blockNumber: Math.floor(observedAt / 1000),
});
const position = (overrides: Record<string, unknown> = {}) => ({
  isOpen: true, isLong: true, marketIndex: 0, leverage: 2, marginUsdc: "100000", sizeWad: "2000000000000000000",
  entryPriceWad: "100000000000000000000", fundingAccruedUsdc: "0", takeProfitWad: "120000000000000000000",
  stopLossWad: "90000000000000000000", openedAt: 100, lastFundingAt: 150, ...overrides,
});
function decide(histories: any[][], current: string, overrides: Record<string, unknown> = {}) {
  const sample = price(now, current);
  return defaultPerpDecisionProvider.decide({ now, prices: [sample, price(now, "100000000000000000000"), price(now, "100000000000000000000")],
    histories, position: position(overrides) as any, pendingOrder: null, availableUsdcUnits: "100000", fundingAmountUnits: "100000", expiresAt: 900_000 });
}

test("flat exit uses a one-minute post-entry baseline rather than entry price", () => {
  const baseline = price(139_000, "110000000000000000000");
  const result = decide([[price(99_000, "100000000000000000000"), baseline], [], []], "110300000000000000000");
  assert.equal(result.action, "close_position");
  assert.equal(result.reasonCode, "flat_window_exit");
});

test("flat exit waits for a full post-entry baseline window", () => {
  const tooRecent = price(150_001, "110000000000000000000");
  const result = decide([[tooRecent], [], []], "110300000000000000000");
  assert.equal(result.action, "hold");
  assert.equal(result.reasonCode, "position_within_signed_triggers");
});

test("default trigger levels are derived from entry, not the moved mark", () => {
  const result = decide([[], [], []], "120000000000000000000", { takeProfitWad: "0", stopLossWad: "0" });
  assert.equal(result.action, "set_triggers");
  assert.deepEqual(result.params, {
    takeProfitWad: "102000000000000000000", stopLossWad: "99000000000000000000",
  });
});
