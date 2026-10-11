import test from "node:test";
import assert from "node:assert/strict";
import { estimatePerplLiquidationPrice } from "../api-server/src/monad/perplLiquidation.js";
import { manualPositionRows } from "../api-server/src/monad/manualPerplState.js";

const position = (side: "long" | "short", overrides: Record<string, unknown> = {}) => ({
  side, entryPriceUnits: "100", sizeUnits: "1", depositUnits: "10000000", fundingPnlUnits: "0",
  maintenanceMarginFactor: 2500, priceDecimals: 0, sizeDecimals: 0,
  markPriceUnits: "100", markValid: true, ...overrides,
});

test("Perpl liquidation estimate matches long and short official formula", () => {
  assert.equal(estimatePerplLiquidationPrice(position("long") as any).priceUnits, "94");
  assert.equal(estimatePerplLiquidationPrice(position("short") as any).priceUnits, "106");
});

test("signed premium PnL moves the long liquidation estimate in the correct direction", () => {
  const credit = estimatePerplLiquidationPrice(position("long", { fundingPnlUnits: "1000000" }) as any);
  const payment = estimatePerplLiquidationPrice(position("long", { fundingPnlUnits: "-1000000" }) as any);
  assert.equal(credit.priceUnits, "93");
  assert.equal(payment.priceUnits, "95");
});

test("price and size scales plus Perpl Q16 entry residue are retained", () => {
  const long = estimatePerplLiquidationPrice(position("long", { entryPriceUnits: "10000", sizeUnits: "100",
    depositUnits: "10000000", priceDecimals: 2, sizeDecimals: 2, entryPriceResidueQ16: "32768" }) as any);
  const short = estimatePerplLiquidationPrice(position("short", { entryPriceUnits: "10000", sizeUnits: "100",
    depositUnits: "10000000", priceDecimals: 2, sizeDecimals: 2, entryPriceResidueQ16: "32768" }) as any);
  assert.equal(long.priceUnits, "9399");
  assert.equal(short.priceUnits, "10600");
});

test("partial size and changed margin affect the estimate using the latest finalized inputs", () => {
  const reduced = estimatePerplLiquidationPrice(position("long", { sizeUnits: "1", depositUnits: "20000000" }) as any);
  const sameMarginLargerPosition = estimatePerplLiquidationPrice(position("long", { sizeUnits: "2", depositUnits: "20000000" }) as any);
  assert.equal(reduced.priceUnits, "84");
  assert.equal(sameMarginLargerPosition.priceUnits, "94");
});

test("maintenance factor, missing funding, and invalid mark are handled explicitly", () => {
  assert.equal(estimatePerplLiquidationPrice(position("long", { maintenanceMarginFactor: 2000 }) as any).priceUnits, "95");
  const missing = estimatePerplLiquidationPrice(position("long", { fundingPnlUnits: undefined }) as any);
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.priceUnits, null);
  assert.equal(missing.reason, "perpl_position_inputs_missing");
  const stale = estimatePerplLiquidationPrice(position("long", { markValid: false }) as any);
  assert.equal(stale.status, "unavailable");
  assert.equal(stale.reason, "perpl_mark_invalid");
});

test("manual DTO keeps aggregate PnL and exposes finalized exchange risk inputs", () => {
  const [row] = manualPositionRows({ blockNumber: 1234, positions: [{ mkt: 1, sd: 1, s: "100", ep: "10000",
    depositUnits: "10000000", pnlUnits: "75", deltaPnlUnits: "70", fundingPnlUnits: "0", markPrice: "9900",
    markValid: true, entryBlock: 1200, entryPriceResidueQ16: "0" }] }, [{ id: 1, symbol: "BTC", priceDecimals: 2,
    sizeDecimals: 2, maintenanceMarginFactor: 2500, maintenanceMarginBps: 400 }]);
  assert.equal(row.depositUnits, "10000000");
  assert.equal(row.fundingPnlUnits, "0");
  assert.equal(row.maintenanceMarginFactor, 2500);
  assert.equal(row.maintenanceMarginBps, 400);
  assert.equal(row.finalizedBlockNumber, 1234);
  assert.equal(row.entryBlock, 1200);
  assert.equal(row.verified, true);
  assert.equal(row.markValid, true);
  assert.equal(row.liquidationPriceUnits, "9400");
  assert.equal(row.unrealizedPnlUnits, "75");
  assert.equal(row.deltaPnlUnits, "70");
});
