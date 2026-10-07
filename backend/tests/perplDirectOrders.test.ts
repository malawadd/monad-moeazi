import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { buildDirectOrderDesc, PERPL_DIRECT_EXEC_ABI } from "../api-server/src/monad/perplDirectOrders.js";
import { buildPerplMandate } from "../api-server/src/monad/perplContracts.js";
import { PERPL_TESTNET_EXCHANGE } from "../api-server/src/monad/perplConfig.js";
import { decodeDirectReceipt, PERPL_DIRECT_EVENT_ABI } from "../api-server/src/monad/perplDirectEvents.js";
import type { VenueAction, VenueMarket } from "../api-server/src/monad/venueTypes.js";

const market = { id: 16, isOpen: true, orderTtlBlocks: 1000, maxMarketSlippageBps: 100,
  price: { bid: 40_000, ask: 40_010, blockNumber: 100, observedAt: Date.now() } } as VenueMarket;
const action = { kind: "market_entry", marketId: 16, accountId: 7, side: "long", size: 10,
  leverage: 2, maxSlippageBps: 50 } as VenueAction;

test("direct mandate binds transport to the Mera signature", () => {
  const base = { owner: "0x0000000000000000000000000000000000000001", vault: "0x0000000000000000000000000000000000000002",
    operator: "0x0000000000000000000000000000000000000003", amountUnits: "100000000",
    maxExposureUnits: "300000000", maxLeverage: 3, durationSeconds: 600, deadline: 2000000000,
    nonce: "0", marketIds: [16] };
  const direct = buildPerplMandate({ ...base, transport: 1 });
  const api = buildPerplMandate({ ...base, transport: 2 });
  assert.equal(direct.domain.version, "2");
  assert.equal(direct.message.policyVersion, 2);
  assert.equal(direct.message.transport, 1);
  assert.equal(api.message.transport, 2);
  assert.deepEqual(direct.types.PerplRunMandate.find((field) => field.name === "transport"), { name: "transport", type: "uint8" });
});

test("direct order encodes the exchange tuple and uses its zero-based type", () => {
  const iface = new Interface(PERPL_DIRECT_EXEC_ABI);
  const entry = buildDirectOrderDesc(action, market, 8, 100);
  assert.equal(entry.orderType, 0);
  assert.equal(entry.immediateOrCancel, true);
  assert.equal(entry.maxNegPnlCollatBPS, 1000);
  assert.equal(entry.pricePNS, "40211");
  assert.equal(iface.getFunction("execOrder")?.selector, "0x4d8dc985");
  assert.ok(iface.encodeFunctionData("execOrder", [entry]).startsWith("0x4d8dc985"));
  const close = buildDirectOrderDesc({ ...action, kind: "close_position", side: "long" }, market, 9, 100);
  assert.equal(close.orderType, 2);
  const cancel = buildDirectOrderDesc({ ...action, kind: "cancel_limit", orderId: 4, size: 0 }, market, 10, 100);
  assert.equal(cancel.orderType, 4);
  assert.equal(cancel.orderId, 4);
});

test("direct receipt counts only matching exchange request and gross fill fee", () => {
  const events = new Interface(PERPL_DIRECT_EVENT_ABI);
  const requested = events.getEvent("OrderRequestV2")!;
  const filled = events.getEvent("TakerOrderFilledV2")!;
  const requestLog = events.encodeEventLog(requested, [16, 7, 8, 3, 0, 40211, 10, 0,
    false, false, true, 0, 200, 0, 0, 0, 100000, "0x"]);
  const fillLog = events.encodeEventLog(filled, [40000, 1, 1, 10, 45, 2000, 100000000, 4, 7]);
  const receipt = { logs: [
    { address: "0x0000000000000000000000000000000000000001", ...requestLog },
    { address: PERPL_TESTNET_EXCHANGE, ...requestLog },
    { address: PERPL_TESTNET_EXCHANGE, ...fillLog },
  ] };
  const decoded = decodeDirectReceipt(receipt, 7, 8);
  assert.equal(decoded.requests.length, 1);
  assert.equal(decoded.requests[0].orderId, 3);
  assert.equal(decoded.fills.length, 1);
  assert.equal(decoded.feeUnits, "45");
  assert.equal(decodeDirectReceipt(receipt, 9, 8).requests.length, 0);
});
