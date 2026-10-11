import test from "node:test";
import assert from "node:assert/strict";
import { replaceCurrentPositionWithFinalizedSnapshot } from "../api-server/src/monad/perplCurrentSnapshot.js";
import { manualOrderRow } from "../api-server/src/monad/manualPerplState.js";
import { directOrderPricePNS } from "../api-server/src/monad/perplDirectState.js";

test("finalized Perpl position replaces cached fields such as stale TP and SL", () => {
  const current: any = { position: { marketId: "old", takeProfitPriceUnits: "12000",
    stopLossPriceUnits: "9000", liquidationPriceUnits: "9500" } };
  const finalized = { marketId: "16", entryPrice: "10000", liquidationPriceUnits: "9400",
    verified: true, finalizedBlockNumber: 1234 };

  replaceCurrentPositionWithFinalizedSnapshot(current, [finalized]);

  assert.deepEqual(current.position, { ...finalized, venueId: "perpl-direct-testnet-v1" });
  assert.equal("takeProfitPriceUnits" in current.position, false);
  assert.equal("stopLossPriceUnits" in current.position, false);
});

test("empty finalized snapshot clears cached Perpl position", () => {
  const current: any = { position: { verified: true, takeProfitPriceUnits: "12000" } };
  replaceCurrentPositionWithFinalizedSnapshot(current, []);
  assert.equal(current.position, null);
});

test("finalized open order exposes PNS chart units, not compressed ONS", () => {
  assert.equal(directOrderPricePNS("829000", "767"), "829767");
  const row = manualOrderRow({ orderId: 4, orderType: 0, size: "125", price: "767", priceONS: "767",
    pricePNS: "829767" }, { id: 16, symbol: "BTC" }, 1234);
  assert.equal(row.price, "767"); // legacy compressed ONS field remains compatible
  assert.equal(row.priceONS, "767");
  assert.equal(row.priceUnits, "829767");
  assert.equal(row.pricePNS, "829767");
  assert.equal(row.priceUnitSystem, "PNS");
  assert.equal(row.finalizedBlockNumber, 1234);
  assert.equal(row.verified, true);
});
