import assert from "node:assert/strict";
import test from "node:test";
import { mobileActivityTimeline } from "../lib/mobileActivityTimeline";

test("mobile journey distinguishes committed capital, scheduled analysis, credits and confirmed fills", () => {
  const now = Date.now();
  const rows = mobileActivityTimeline({ jobs: [], proposals: [] }, {
    auditEvents: [{ _id: "start", kind: "agent.autopilot.started", createdAt: now,
      detail: JSON.stringify({ programVersionId: "version-1" }) }],
    executions: [{ _id: "approval", kind: "hyperliquid_approve_agent", status: "filled",
      createdAt: now, updatedAt: now }, { _id: "order", kind: "uniswap_pool_swap",
      status: "submitted", createdAt: now, updatedAt: now }],
  }, {
    mandates: [{ id: "mandate", capitalUnits: "500000", durationDays: 1,
      programVersionId: "version-1", status: "active", createdAt: now - 2000,
      expiresAt: now + 86_400_000 }],
    funding: [{ id: "funding", mandateId: "mandate", status: "confirmed",
      createdAt: now - 1000, updatedAt: now }],
    authorities: [], fills: [],
    credits: [{ id: "credit", kind: "reserve", amount: 2,
      balanceAfter: 25, reservedAfter: 2, createdAt: now }],
  });
  assert.equal(rows.find(row => row.id === "mandate:mandate")?.fundsMoved, false);
  assert.equal(rows.find(row => row.id === "funding:funding")?.fundsMoved, true);
  assert.equal(rows.find(row => row.id === "order")?.fundsMoved, false);
  assert.equal(rows.some(row => row.id === "approval"), false);
  assert.equal(rows.find(row => row.id === "start")?.title, "Autopilot started");
  assert.equal(rows.find(row => row.id === "credit:credit")?.category, "Credits");
  assert.equal(rows.some(row => row.title.includes("trade confirmed")), false);
});

test("a skipped scheduled check is visible without claiming an analysis or trade", () => {
  const now = Date.now();
  const rows = mobileActivityTimeline({ jobs: [], proposals: [] }, {}, {}, {
    recentChecks: [{ market: "WETH-USDC", workflowId: "check-1",
      startedAt: new Date(now).toISOString(), status: "skipped", reason: null }],
  });
  const check = rows.find(row => row.id === "check:check-1");
  assert.equal(check?.title, "Market check held");
  assert.equal(check?.fundsMoved, false);
  assert.match(check?.summary ?? "", /No order was sent/);
});

test("a failed schedule run does not duplicate its recorded analysis job", () => {
  const now = Date.now();
  const rows = mobileActivityTimeline({
    jobs: [{ _id: "job-1", marketId: "WETH-USDC", status: "failed",
      createdAt: now, updatedAt: now }], proposals: [],
  }, {}, {}, { recentChecks: [{ market: "WETH-USDC", workflowId: "check-2",
    startedAt: new Date(now).toISOString(), status: "failed", reason: null }] });
  assert.equal(rows.filter(row => row.category === "AI").length, 1);
  assert.equal(rows[0].id, "job-1");
});

test("one observed fill is not presented as two trades", () => {
  const now = Date.now();
  const rows = mobileActivityTimeline({}, {
    executions: [{ _id: "execution", kind: "uniswap_pool_swap", status: "filled",
      txHash: "0xABC", createdAt: now, updatedAt: now }],
  }, { fills: [{ id: "receipt", marketId: "WETH-USDC", side: "buy",
    transactionHash: "0xabc", createdAt: now }] });
  assert.equal(rows.filter(row => row.category === "Trades").length, 1);
  assert.equal(rows[0].id, "fill:receipt");
});

test("expired authority is not displayed as ready", () => {
  const rows = mobileActivityTimeline({}, {}, { authorities: [{ id: "old",
    state: "ready", venue: "uniswap", createdAt: Date.now() - 3_600_000,
    expiresAt: Date.now() - 1_000 }] });
  assert.equal(rows[0].title, "Trading authority expired");
  assert.equal(rows[0].result, "Expired");
  assert.equal(rows[0].requiresAction, true);
});
