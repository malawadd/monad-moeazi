import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { PERP_VAULT_ABI } from "../api-server/src/monad/perpChain.js";
import { defaultPerpDecisionProvider } from "../api-server/src/monad/perpDecisionProvider.js";
import { accumulateReceipt } from "../api-server/src/monad/perpRunExecutor.js";
import { encodeExpiredSettlement, failedReceiptEvent, isPerpPreparedOrderExpired,
  perpOrderRecoveryAction, receiptEvents } from "../api-server/src/monad/perpOrderExecutor.js";
import { perpTickClaimDecision } from "../convex/monadPerpLeaseRules.js";

test("restart recovery broadcasts only persisted prepared transactions and reconciles the same hash otherwise", () => {
  assert.equal(perpOrderRecoveryAction("prepared"), "broadcast");
  for (const status of ["broadcasting", "submitted", "executed", "uncertain"]) {
    assert.equal(perpOrderRecoveryAction(status), "reconcile_same_hash");
  }
  assert.equal(perpOrderRecoveryAction("finalized"), "ignore");
  assert.equal(perpOrderRecoveryAction("failed"), "ignore");
});

test("duplicate tick and live lease cannot claim the same worker run", () => {
  const row = { status: "active", nextTickId: "run:tick:4", lastTickId: "run:tick:3",
    leaseHolder: "worker-a", leaseExpiresAt: 50_000 };
  assert.deepEqual(perpTickClaimDecision(row, "run:tick:4", 40_000),
    { claimed: false, reason: "leased", retryAfterMs: 10_500 });
  assert.deepEqual(perpTickClaimDecision({ ...row, leaseHolder: undefined, leaseExpiresAt: undefined }, "run:tick:3", 40_000),
    { claimed: false, reason: "duplicate" });
  assert.deepEqual(perpTickClaimDecision({ ...row, leaseHolder: undefined, leaseExpiresAt: undefined }, "run:tick:4", 40_000),
    { claimed: true });
});

test("stale prepared quote is rejected before broadcast", () => {
  assert.equal(isPerpPreparedOrderExpired({ status: "prepared", validUntil: 1_999 }, 2_000_000), true);
  assert.equal(isPerpPreparedOrderExpired({ status: "prepared", validUntil: 2_001 }, 2_000_000), false);
  assert.equal(isPerpPreparedOrderExpired({ status: "uncertain", validUntil: 1_999 }, 2_000_000), false);
});

test("flat expired runs choose settlement and encode it without an open position", () => {
  const decision = defaultPerpDecisionProvider.decide({ now: 2_000_000, prices: [], histories: [[], [], []],
    position: null, pendingOrder: null, availableUsdcUnits: "100000", fundingAmountUnits: "100000", expiresAt: 2_000_000 });
  assert.equal(decision.action, "settle_expired");
  const orderId = `0x${"1".repeat(64)}`;
  const iface = new Interface(PERP_VAULT_ABI);
  const data = encodeExpiredSettlement(orderId);
  assert.deepEqual(iface.decodeFunctionData("settleExpired", data).map(String), [orderId]);
});

test("one clearinghouse close log contributes PnL exactly once", () => {
  const event = new Interface(["event PositionClosed(address indexed vault,bytes32 indexed orderId,uint8 indexed marketIndex,bool isLong,uint256 sizeWad,uint256 entryPriceWad,uint256 exitPriceWad,int256 realizedPnlUsdc,int256 fundingUsdc,uint256 returnedUsdc,uint8 reason)"]);
  const orderId = `0x${"2".repeat(64)}`;
  const encoded = event.encodeEventLog(event.getEvent("PositionClosed")!, [
    "0x0000000000000000000000000000000000000001", orderId, 0, true, 2n, 100n, 99n, -10n, -2n, 88n, 0,
  ]);
  const clearinghouseAddress = "0x0000000000000000000000000000000000000002";
  const logs = [{ address: clearinghouseAddress, ...encoded, index: 0, blockNumber: 77 }];
  const events = receiptEvents({ orderId, txHash: `0x${"3".repeat(64)}`,
    vaultAddress: "0x0000000000000000000000000000000000000001", clearinghouseAddress }, logs, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.realizedPnlUsdc, "-10");
  assert.equal(accumulateReceipt({ events, order: { gasUsed: "5", effectiveGasPrice: "7" } }, 0n, 0n).realizedPnl, -10n);
});

test("finalized receipt failures remain visible with their broadcast hash", () => {
  const hash = `0x${"4".repeat(64)}`;
  const event = failedReceiptEvent({ orderId: "action-1", kind: "market_entry", txHash: hash },
    { blockNumber: 88, blockHash: `0x${"5".repeat(64)}`, status: 0 }, true);
  assert.equal(event.type, "perp_order_failed");
  assert.equal(event.status, "finalized");
  assert.equal(event.txHash, hash);
  assert.equal(event.payload.receiptStatus, 0);
});
