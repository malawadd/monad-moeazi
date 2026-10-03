import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveScopedGrantId, validAllowanceCall } from "../app/api/mobile/autopilot/scoped-grant/_proxy";

const router = "0xe592427a0aece92de3edee1f18e0157c05861564";
const usdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const weth = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";

function approveData(spender: string, amount: string) {
  return `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`;
}

test("scoped grant ID is server-derived, idempotent, and rotates for a fresh one-use grant", () => {
  const contextGrantId = "managed-context-binding";
  const first = deriveScopedGrantId(contextGrantId, "mobile-setup-0001");
  assert.match(first ?? "", /^managed-[0-9a-f]{48}$/);
  assert.equal(deriveScopedGrantId(contextGrantId, "mobile-setup-0001"), first);
  assert.notEqual(deriveScopedGrantId(contextGrantId, "mobile-setup-0002"), first);
  assert.notEqual(deriveScopedGrantId("managed-next-policy", "mobile-setup-0001"), first);
  assert.equal(deriveScopedGrantId(contextGrantId, ""), null);
});

test("scoped grant proxy allows only exact capped USDC/WETH router approvals", () => {
  const usdcCall = { to: usdc, token: usdc, value: "0", amount: "25000000", data: approveData(router, "25000000") };
  const wethCall = { to: weth, token: weth, value: "0", amount: "1500000000000000000",
    data: approveData(router, "1500000000000000000") };
  assert.equal(validAllowanceCall(usdcCall, usdc, "25000000"), true);
  assert.equal(validAllowanceCall(wethCall, weth, "1500000000000000000"), true);
  assert.equal(validAllowanceCall({ ...usdcCall, value: "1" }, usdc, "25000000"), false);
  assert.equal(validAllowanceCall({ ...usdcCall, amount: "25000001" }, usdc, "25000000"), false);
  assert.equal(validAllowanceCall({ ...usdcCall, data: approveData(weth, "25000000") }, usdc, "25000000"), false);
  assert.equal(validAllowanceCall({ ...wethCall, data: `${wethCall.data}00` }, weth, "1500000000000000000"), false);
});
