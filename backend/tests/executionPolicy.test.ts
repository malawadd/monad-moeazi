import test from "node:test";
import assert from "node:assert/strict";
import { EXECUTION_MODE } from "../convex/constants";
import { evaluateExecutionPolicy } from "../convex/helpers/executionPolicy";

test("execution policy blocks actions during emergency stop", () => {
  const result = evaluateExecutionPolicy({
    strategyAccount: { status: "active", emergencyStop: true },
    config: {},
    intent: {
      kind: "uniswap_pool_swap",
      origin: "supervisor",
      tokenIn: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638FFa7f6",
      tokenOut: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      notionalUsd: 5,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "EMERGENCY_STOP");
  }
});

test("execution policy preserves shadow mode while allowing valid actions", () => {
  const result = evaluateExecutionPolicy({
    strategyAccount: { status: "active", emergencyStop: false },
    config: { executionMode: EXECUTION_MODE.shadow, maxDailyVolumeUsd: 500 },
    recentExecutions: [],
    intent: {
      kind: "hyperliquid_order",
      origin: "supervisor",
      coin: "LINK",
      notionalUsd: 20,
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, EXECUTION_MODE.shadow);
  }
});

test("execution policy enforces daily notional caps", () => {
  const result = evaluateExecutionPolicy({
    strategyAccount: { status: "active", emergencyStop: false },
    config: { maxDailyVolumeUsd: 25 },
    recentExecutions: [
      {
        kind: "uniswap_rebalance",
        status: "filled",
        notionalUsd: 20,
        createdAt: Date.now(),
      },
    ],
    intent: {
      kind: "uniswap_rebalance",
      origin: "supervisor",
      tokenIn: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638FFa7f6",
      tokenOut: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      notionalUsd: 10,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "DAILY_VOLUME_CAP");
  }
});

test("execution policy blocks unsupported hedge coins", () => {
  const result = evaluateExecutionPolicy({
    strategyAccount: { status: "active", emergencyStop: false },
    config: {},
    intent: {
      kind: "hyperliquid_order",
      origin: "supervisor",
      coin: "ETH",
      notionalUsd: 20,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "COIN_NOT_ALLOWED");
  }
});
