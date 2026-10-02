import test from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  ARBITRUM_CHAIN_ID,
  ARBITRUM_TOKENS,
  ARBITRUM_UNIVERSAL_ROUTER,
  assertArbitrumSwapPair,
  isAllowedArbitrumSwapTarget,
} from "../lib/trade/arbitrumRegistry";
import { ownerCapabilities } from "../lib/ownerSigner";
import {
  allowedTargets,
  assertFresh,
  prepareSwapRequest,
  validateTransaction,
} from "../execution-sidecar/src/uniswap";
import {
  ARBITRUM_USDC,
  ARBITRUM_V4_ROUTER,
  ARBITRUM_WETH,
  buildHookRouteTransaction,
  hookConfigHash,
  hookPoolId,
  hookPoolKey,
  loadHookExperiment,
} from "../execution-sidecar/src/uniswapHookRoute";

test("Arbitrum is the sole active strategy chain", () => {
  assert.equal(ARBITRUM_CHAIN_ID, 42161);
  assert.doesNotThrow(() => assertArbitrumSwapPair({
    tokenIn: ARBITRUM_TOKENS.USDC.address,
    tokenOut: ARBITRUM_TOKENS.WETH.address,
    tokenInChainId: "42161",
    tokenOutChainId: "42161",
  }));
  assert.throws(() => assertArbitrumSwapPair({
    tokenIn: ARBITRUM_TOKENS.USDC.address,
    tokenOut: ARBITRUM_TOKENS.WETH.address,
    tokenInChainId: 10,
    tokenOutChainId: 10,
  }), /Arbitrum/);
});

test("Particle without 7702 retains approval but not autopilot", () => {
  const unsupported = ownerCapabilities({ eip7702Supported: false, delegatedChainIds: [] });
  assert.equal(unsupported.shadow, true);
  assert.equal(unsupported.approval, true);
  assert.equal(unsupported.autopilot, false);
  const delegated = ownerCapabilities({ eip7702Supported: true, delegatedChainIds: [42161] });
  assert.equal(delegated.autopilot, true);
});

test("Uniswap request shaping distinguishes classic and UniswapX", () => {
  const permitData = { domain: { chainId: 42161 } };
  const classic = prepareSwapRequest({ routing: "CLASSIC", permitData, requestId: "a" }, "0xsigned");
  assert.deepEqual(classic.permitData, permitData);
  assert.equal(classic.signature, "0xsigned");
  const auction = prepareSwapRequest({ routing: "DUTCH_V2", permitData, requestId: "b" }, "0xsigned");
  assert.equal(auction.signature, "0xsigned");
  assert.equal("permitData" in auction, false);
});

test("swap validation binds sender, target, chain, and freshness", () => {
  const now = 1_700_000_000_000;
  assert.doesNotThrow(() => assertFresh(now - 29_999, now));
  assert.throws(() => assertFresh(now - 30_001, now), /stale/);
  assert.equal(isAllowedArbitrumSwapTarget(ARBITRUM_UNIVERSAL_ROUTER), true);
  const sender = `0x${"2".repeat(40)}`;
  const tx = validateTransaction({
    expectedSender: sender,
    allowedTargets: allowedTargets(),
    result: { swap: { to: ARBITRUM_UNIVERSAL_ROUTER, from: sender, data: "0x12", value: "0", chainId: 42161 } },
  });
  assert.equal(tx.chainId, 42161);
  assert.throws(() => validateTransaction({
    expectedSender: sender,
    allowedTargets: allowedTargets(),
    result: { swap: { to: `0x${"3".repeat(40)}`, from: sender, data: "0x12", value: "0", chainId: 42161 } },
  }), /allowlisted/);
});

test("v4 hook experiment stays disabled without an explicit complete configuration", () => {
  assert.deepEqual(loadHookExperiment({}), {
    enabled: false,
    reason: "Hook experiment is disabled",
  });
  const incomplete = loadHookExperiment({ UNISWAP_HOOK_EXPERIMENT_ENABLED: "true" });
  assert.equal(incomplete.enabled, false);
});

test("v4 hook configuration requires exact beforeSwap and afterSwap address flags", () => {
  const common = {
    UNISWAP_HOOK_EXPERIMENT_ENABLED: "true",
    UNISWAP_HOOK_CODE_HASH: `0x${"1".repeat(64)}`,
  };
  const wrong = loadHookExperiment({
    ...common,
    UNISWAP_HOOK_ADDRESS: "0x00000000000000000000000000000000000000c4",
  });
  assert.equal(wrong.enabled, false);
  const ready = loadHookExperiment({
    ...common,
    UNISWAP_HOOK_ADDRESS: "0x00000000000000000000000000000000000000c0",
  });
  assert.equal(ready.enabled, true);
});

test("v4 hook route is attested to the configured pool and never changes the standard target", () => {
  const status = loadHookExperiment({
    UNISWAP_HOOK_EXPERIMENT_ENABLED: "true",
    UNISWAP_HOOK_ADDRESS: "0x00000000000000000000000000000000000000c0",
    UNISWAP_HOOK_CODE_HASH: `0x${"2".repeat(64)}`,
    UNISWAP_HOOK_FEE: "3000",
    UNISWAP_HOOK_TICK_SPACING: "60",
  });
  assert.equal(status.enabled, true);
  if (!status.enabled) return;
  const key = hookPoolKey(status);
  const transaction = buildHookRouteTransaction({
    config: status,
    tokenIn: ARBITRUM_USDC,
    amountIn: 100_000_000n,
    amountOutMinimum: 1n,
    deadline: 1_800_000_000n,
  });
  assert.equal(transaction.to, ARBITRUM_V4_ROUTER);
  assert.equal(transaction.output, ARBITRUM_WETH);
  assert.equal(transaction.poolId, hookPoolId(key));
  assert.match(transaction.data, /^0x[0-9a-f]+$/);
  assert.match(hookConfigHash(key, status.hookCodeHash), /^0x[0-9a-f]{64}$/);
  assert.equal(buildHookRouteTransaction({
    config: status,
    tokenIn: getAddress(ARBITRUM_USDC),
    amountIn: 100_000_000n,
    amountOutMinimum: 1n,
    deadline: 1_800_000_000n,
  }).output, ARBITRUM_WETH);
});

test("v4 hook route rejects unregistered pairs and amounts outside uint128", () => {
  const status = loadHookExperiment({
    UNISWAP_HOOK_EXPERIMENT_ENABLED: "true",
    UNISWAP_HOOK_ADDRESS: "0x00000000000000000000000000000000000000c0",
    UNISWAP_HOOK_CODE_HASH: `0x${"3".repeat(64)}`,
  });
  assert.equal(status.enabled, true);
  if (!status.enabled) return;
  assert.throws(() => buildHookRouteTransaction({
    config: status,
    tokenIn: `0x${"4".repeat(40)}`,
    amountIn: 1n,
    amountOutMinimum: 1n,
    deadline: 1n,
  }), /USDC\/WETH/);
  assert.throws(() => buildHookRouteTransaction({
    config: status,
    tokenIn: ARBITRUM_WETH,
    amountIn: 1n << 128n,
    amountOutMinimum: 1n,
    deadline: 1n,
  }), /uint128/);
});
