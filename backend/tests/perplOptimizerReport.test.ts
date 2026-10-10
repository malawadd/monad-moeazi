import assert from "node:assert/strict";
import test from "node:test";
import { optimizerReportEventGroups } from "../convex/monadVenueOptimizer.js";

test("scanner coverage stays separate from frequent optimizer decision events", () => {
  const groups = optimizerReportEventGroups([
    { timestamp: 200, status: "no_proposal", dataJson: JSON.stringify({ rejectedMarkets: [{ marketId: 12, reason: "stale_book" }] }) },
    { timestamp: 100, status: "proposed", dataJson: JSON.stringify({ proposal: { marketId: 16, side: "long" } }) },
  ], [
    { timestamp: 250, status: "optimizer_target_or_cycle_cap_reached", dataJson: "{}" },
    { timestamp: 240, status: "optimizer_market_scan_not_due", dataJson: "{}" },
  ]);

  assert.deepEqual(groups.recentScans.map((scan) => scan.timestamp), [200, 100]);
  assert.deepEqual(groups.recentScans[0].details.rejectedMarkets, [{ marketId: 12, reason: "stale_book" }]);
  assert.deepEqual(groups.recentDecisions.map((decision) => decision.phase), ["optimizer_target_or_cycle_cap_reached"]);
});
