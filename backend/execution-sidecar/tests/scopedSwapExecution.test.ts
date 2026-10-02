import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, keccak256, pad, stringToHex } from "viem";
import { scopedSwapPayloadHash } from "../src/mobile/scopedSwapPayloadHash.js";
import { assertFinanceMarkerMatches, HttpUniswapFinanceMarkerReader, type VerifiedUniswapFinanceMarker } from "../src/mobile/scopedSwapFinanceMarker.js";
import { quoteScopedSwap } from "../src/mobile/scopedSwapQuote.js";
import { ScopedSwapExecutionService } from "../src/mobile/scopedSwapExecution.js";
import { ENTRY_POINT } from "../src/mobile/contracts.js";
import { ARBITRUM_USDC, ARBITRUM_V3_QUOTER_V2, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH } from "../src/mobile/uniswapV3.js";

const owner = "0x1234567890123456789012345678901234567890" as const;
const pool = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
const pairId = {
  baseAssetUnitId: "arbitrum:42161:erc20:0x82af49447d8a07e3bd95bd0d56f35241523fbab1:18:v1",
  quoteAssetUnitId: "arbitrum:42161:erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831:6:v1",
};

test("payload hash matches the finance service cross-language vector", () => {
  assert.equal(scopedSwapPayloadHash({ assignmentId: "assignment-1", clientId: "swap-client-001",
    grantId: "grant-00000001", owner, scope: "buy", strategyAccountId: "strategy-1",
    target: ARBITRUM_V3_SWAP_ROUTER, calldata: "0x12345678abcdef" }),
  "d359d977b44a987088f48a0831acc73e558bda8f75318a62f628bfc1e45af185");
});

test("QuoterV2 quote is pinned to the finalized block and computes a floored slippage minimum", async () => {
  const blockHash = `0x${"ab".repeat(32)}` as const;
  const resultData = encodeAbiParameters([{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
    [123_456n, 789n, 12, 34n]);
  const calls: unknown[] = [];
  const client = { chain: { id: 42161 },
    getBlock: async (options: unknown) => { calls.push(options); return { number: 987n, hash: blockHash, timestamp: 1_234_567n }; },
    call: async (options: unknown) => { calls.push(options); return { data: resultData }; },
    readContract: async (options: unknown) => { calls.push(options); return pool; },
  } as any;
  const quote = await quoteScopedSwap(client, "buy", 100_000n, 50);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { blockTag: "finalized" });
  assert.equal((calls[1] as any).to, ARBITRUM_V3_QUOTER_V2);
  assert.equal((calls[1] as any).blockNumber, 987n);
  assert.equal((calls[2] as any).blockNumber, 987n);
  assert.equal(quote.amountIn, "100000");
  assert.equal(quote.amountOut, "123456");
  assert.equal(quote.minimumAmountOut, "122838");
  assert.deepEqual(quote.sourceBlock, { number: "987", hash: blockHash, timestamp: "1234567", finality: "finalized" });
  assert.equal(quote.initializedTicksCrossed, "12");
  assert.equal(quote.pool, pool);
});

test("quote rejects wrong chain, zero amount, and unbounded slippage", async () => {
  const client = { chain: { id: 10 } } as any;
  await assert.rejects(quoteScopedSwap(client, "buy", 1n, 50), /Arbitrum/);
  const arbitrum = { chain: { id: 42161 } } as any;
  await assert.rejects(quoteScopedSwap(arbitrum, "buy", 0n, 50), /positive/);
  await assert.rejects(quoteScopedSwap(arbitrum, "buy", 1n, 501), /Slippage/);
});

test("finance marker must match the exact live wallet, instrument direction, and reserved sizing", () => {
  const frozenProgramPolicyHash = `0x${"d".repeat(64)}` as `0x${string}`;
  const marker: VerifiedUniswapFinanceMarker = {
    attemptId: "attempt-1", reservationId: "reservation-1", intentId: "intent-1", clientId: "client-1",
    grantId: "grant-1", assignmentId: "assignment-1", frozenProgramPolicyHash,
    normalizedPayloadHash: "a".repeat(64), snapshotHash: "b".repeat(64), strategyAccountId: "strategy-1",
    sourceAccountId: `arbitrum:42161:wallet:${owner}`, policyVersion: "p1", policyHash: `0x${"c".repeat(64)}`,
    authorityEpoch: 1, instrumentVersionId: "uniswap:pool:3000:v1", venueId: "uniswap", nativeInstrumentId: pool,
    productKind: "spot", ...pairId, baseDecimals: 18, quoteDecimals: 6,
    quantityUnits: "1000", notionalUnits: "2000", action: "spot_buy", calculationReceiptHash: "d".repeat(64),
  };
  const exact = { marker, owner, scope: "buy" as const, strategyAccountId: "strategy-1", intentId: "intent-1",
    clientId: "client-1", grantId: "grant-1", assignmentId: "assignment-1",
    payloadHash: marker.normalizedPayloadHash, frozenProgramPolicyHash,
    amountIn: 2000n, amountOutMinimum: 1000n };
  assert.doesNotThrow(() => assertFinanceMarkerMatches(exact));
  assert.throws(() => assertFinanceMarkerMatches({ ...exact, owner: "0x9999999999999999999999999999999999999999" as typeof owner }), /account, instrument/);
  assert.throws(() => assertFinanceMarkerMatches({ ...exact, frozenProgramPolicyHash: `0x${"e".repeat(64)}` as `0x${string}` }), /account, instrument/);
  assert.throws(() => assertFinanceMarkerMatches({ ...exact, grantId: "different-grant" }), /account, instrument/);
  assert.throws(() => assertFinanceMarkerMatches({ ...exact, amountOutMinimum: 999n }), /sizing/);
});

test("finance marker reader uses only server identity fields and service bearer; no caller authority flag", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const marker = { attemptId: "a", reservationId: "r", intentId: "i", clientId: "c", grantId: "grant-000001",
    assignmentId: "assignment-1", frozenProgramPolicyHash: `0x${"f".repeat(64)}`, normalizedPayloadHash: "a".repeat(64),
    snapshotHash: "b".repeat(64), strategyAccountId: "s", sourceAccountId: "acct", policyVersion: "p", policyHash: "h",
    authorityEpoch: 1, instrumentVersionId: "iv", venueId: "uniswap", nativeInstrumentId: "pool", productKind: "spot",
    baseAssetUnitId: "b", quoteAssetUnitId: "q", baseDecimals: 18, quoteDecimals: 6, quantityUnits: "1", notionalUnits: "1",
    action: "spot_buy", calculationReceiptHash: "c".repeat(64) };
  const reader = new HttpUniswapFinanceMarkerReader("https://agent.test/", "private-worker-secret",
    (async (url, init) => { captured = { url: String(url), init: init! }; return new Response(JSON.stringify(marker), { status: 200 }); }) as typeof fetch);
  await reader.verify({ strategyAccountId: "s", intentId: "i", clientId: "c", grantId: "grant-000001",
    assignmentId: "assignment-1", normalizedPayloadHash: "d".repeat(64) });
  assert.equal(captured?.url, "https://agent.test/internal/finance/uniswap/verify-submission");
  assert.equal((captured?.init.headers as Record<string, string>).authorization, "Bearer private-worker-secret");
  assert.deepEqual(JSON.parse(String(captured?.init.body)), { strategyAccountId: "s", intentId: "i", clientId: "c",
    grantId: "grant-000001", assignmentId: "assignment-1", normalizedPayloadHash: "d".repeat(64) });
  assert.equal("financeAuthorized" in JSON.parse(String(captured?.init.body)), false);
});

test("finance marker reader rejects missing or malformed Convex frozen policy binding", async () => {
  for (const frozenProgramPolicyHash of [undefined, `0x${"A".repeat(64)}`, `0x${"a".repeat(63)}`]) {
    const response = { attemptId: "a", reservationId: "r", intentId: "i", clientId: "c", grantId: "grant-000001",
      assignmentId: "assignment-1", normalizedPayloadHash: "a".repeat(64), snapshotHash: "b".repeat(64),
      strategyAccountId: "s", sourceAccountId: "acct", policyVersion: "p", policyHash: "finance-policy-hash",
      frozenProgramPolicyHash, authorityEpoch: 1, instrumentVersionId: "iv", venueId: "uniswap",
      nativeInstrumentId: "pool", productKind: "spot", baseAssetUnitId: "b", quoteAssetUnitId: "q",
      baseDecimals: 18, quoteDecimals: 6, quantityUnits: "1", notionalUnits: "1", action: "spot_buy",
      calculationReceiptHash: "c".repeat(64) };
    const reader = new HttpUniswapFinanceMarkerReader("https://agent.test", "worker",
      (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch);
    await assert.rejects(reader.verify({ strategyAccountId: "s", intentId: "i", clientId: "c",
      grantId: "grant-000001", assignmentId: "assignment-1", normalizedPayloadHash: "a".repeat(64) }), /policy hash/);
  }
});

test("scoped broadcast stops before finance or Pimlico when certification gates are closed", async () => {
  let financeCalls = 0, bundlerCalls = 0;
  const service = new ScopedSwapExecutionService({ client: { chain: { id: 42161 } } as any,
    vault: { durable: true } as any, operations: { durable: true } as any,
    finance: { verify: async () => { financeCalls++; throw new Error("must not call"); } } as any,
    bundler: { estimate: async () => { bundlerCalls++; throw new Error("must not call"); } } as any,
    paymaster: {} as any, broadcastEnabled: false, maxFeeWei: "1" });
  await assert.rejects(service.broadcast({ grantId: "grant-000001", scope: "buy", strategyAccountId: "s",
    assignmentId: "a", intentId: "intent-00001", idempotencyKey: "client-00001",
    amountIn: "1", amountOutMinimum: "1", deadline: 1_900_000_000 }), /gates are closed/);
  assert.equal(financeCalls, 0); assert.equal(bundlerCalls, 0);
});

test("mobile allowance read is owner-bound and reports the finalized capped-token balance and allowance", async () => {
  const blockHash = `0x${"ab".repeat(32)}` as const, reads: any[] = [];
  const grant = { grantId: "grant-000001", scope: "buy", owner, maxInputUnits: "100", minOutputUnits: "1" };
  const service = new ScopedSwapExecutionService({ client: { chain: { id: 42161 },
    getBlock: async (arg: unknown) => { reads.push(arg); return { number: 123n, hash: blockHash }; },
    readContract: async (arg: any) => {
      reads.push(arg);
      if (arg.functionName === "balanceOf") return arg.address === ARBITRUM_USDC ? 150n : 50n;
      return arg.address === ARBITRUM_USDC ? 125n : 40n;
    } } as any,
    vault: { get: async () => grant } as any, operations: {} as any, finance: {} as any,
    bundler: {} as any, paymaster: {} as any, broadcastEnabled: false, maxFeeWei: "0" });
  const result = await service.allowanceForGrant(grant.grantId, "buy", owner);
  assert.equal(result.ready, true);
  assert.equal(result.balanceReady, true);
  assert.equal(result.allowanceReady, true);
  assert.equal(result.requiredUnits, "100");
  assert.equal(result.balanceUnits, "150");
  assert.equal(result.allowanceUnits, "125");
  assert.equal(result.blockNumber, "123");
  assert.equal(result.blockHash, blockHash);
  assert.ok(reads.every((read) => !read.blockNumber || read.blockNumber === 123n));
  await assert.rejects(service.allowanceForGrant(grant.grantId, "buy", "0x9999999999999999999999999999999999999999"), /unavailable/);
});

test("exit authorization can be ready with exact WETH allowance and zero current WETH balance", async () => {
  const grant = { grantId: "grant-000002", scope: "exit", owner, maxInputUnits: "100", minOutputUnits: "90" };
  const service = new ScopedSwapExecutionService({ client: { chain: { id: 42161 },
    getBlock: async () => ({ number: 124n, hash: `0x${"bc".repeat(32)}` }),
    readContract: async (arg: any) => {
      if (arg.functionName === "balanceOf") return arg.address === ARBITRUM_WETH ? 0n : 1000n;
      return arg.address === ARBITRUM_WETH ? 100n : 1000n;
    } } as any, vault: { get: async () => grant } as any,
    operations: {} as any, finance: {} as any, bundler: {} as any, paymaster: {} as any,
    broadcastEnabled: false, maxFeeWei: "0" });
  const result = await service.allowanceForGrant(grant.grantId, "exit", owner);
  assert.equal(result.balanceUnits, "0");
  assert.equal(result.allowanceUnits, "100");
  assert.equal(result.balanceReady, false);
  assert.equal(result.allowanceReady, true);
  assert.equal(result.ready, false);
});

test("read-only prepare-broadcast returns the exact capped call hash without finance or bundler calls", async () => {
  const grant = { grantId: "grant-000001", scope: "buy", state: "active", owner,
    strategyAccountId: "strategy-1", assignmentId: "assignment-1", frozenPolicyHash: `0x${"a".repeat(64)}`,
    policyHash: `0x${"b".repeat(64)}`, createdAt: 900, expiresAt: 2000,
    maxInputUnits: "1000", minOutputUnits: "900", privateKey: `0x${"01".repeat(32)}`,
    sessionAddress: owner, ownerApproval: { domain: {}, types: {}, primaryType: "Enable", message: {} },
    ownerApprovalSignature: "0x01" };
  let financeCalls = 0, bundlerCalls = 0;
  const service = new ScopedSwapExecutionService({ client: { chain: { id: 42161 },
    getBlock: async () => ({ number: 100n, hash: `0x${"ab".repeat(32)}` }),
    readContract: async () => 2000n } as any,
    vault: { durable: true, get: async () => grant } as any,
    operations: { durable: true, get: async () => null } as any,
    finance: { verify: async () => { financeCalls++; throw new Error("prepare must not call finance"); } } as any,
    bundler: { estimate: async () => { bundlerCalls++; throw new Error("prepare must not call bundler"); } } as any,
    paymaster: {} as any, broadcastEnabled: false, maxFeeWei: "0", now: () => 1000 });
  const prepared = await service.prepareBroadcast({ grantId: grant.grantId, scope: "buy",
    strategyAccountId: grant.strategyAccountId, assignmentId: grant.assignmentId,
    intentId: "intent-000001", idempotencyKey: "client-000001", amountIn: "1000",
    amountOutMinimum: "900", deadline: 1200 });
  assert.equal(prepared.target, ARBITRUM_V3_SWAP_ROUTER);
  assert.equal(prepared.value, "0");
  assert.equal(prepared.amountIn, "1000");
  assert.equal(prepared.amountOutMinimum, "900");
  assert.equal(prepared.normalizedPayloadHash, scopedSwapPayloadHash({ assignmentId: grant.assignmentId,
    calldata: prepared.calldata as `0x${string}`, clientId: "client-000001", grantId: grant.grantId,
    owner, scope: "buy", strategyAccountId: grant.strategyAccountId, target: prepared.target }));
  assert.equal(financeCalls, 0);
  assert.equal(bundlerCalls, 0);
});

function scopedOperation() {
  return { grantId: "grant-000001", scope: "buy" as const, state: "submitted" as const, owner,
    strategyAccountId: "strategy-1", assignmentId: "assignment-1", intentId: "intent-000001",
    idempotencyKey: "client-000001", payloadHash: "a".repeat(64),
    userOperationHash: `0x${"11".repeat(32)}` as `0x${string}`, amountIn: "100", amountOutMinimum: "90",
    deadline: 1200, createdAt: 1000, expiresAt: 2000, attemptId: "attempt-1", reservationId: "reservation-1",
    confirmedBlockNumber: undefined as string | undefined, confirmedBlockHash: undefined as `0x${string}` | undefined };
}

test("scoped reconciliation persists the finalized receipt inclusion block for snapshot proof", async () => {
  const receiptBlockHash = `0x${"ab".repeat(32)}` as const;
  const finalizedHeadHash = `0x${"cd".repeat(32)}` as const;
  const transactionHash = `0x${"ef".repeat(32)}` as const;
  const userOpHash = `0x${"11".repeat(32)}` as const;
  const other = "0x9999999999999999999999999999999999999999" as const;
  const before = { address: ENTRY_POINT, data: "0x", topics: [keccak256(stringToHex("BeforeExecution()"))] };
  const transferTopic = keccak256(stringToHex("Transfer(address,address,uint256)"));
  const inputTransfer = { data: encodeAbiParameters([{ type: "uint256" }], [100n]),
    topics: [transferTopic, pad(owner, { size: 32 }), pad(ARBITRUM_V3_SWAP_ROUTER, { size: 32 })] };
  const outputTransfer = { data: encodeAbiParameters([{ type: "uint256" }], [95n]),
    topics: [transferTopic, pad(other, { size: 32 }), pad(owner, { size: 32 })] };
  const operationTopic = keccak256(stringToHex("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"));
  const userOperation = { data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, true, 1n, 1n]),
    topics: [operationTopic, userOpHash, pad(owner, { size: 32 }), pad(other, { size: 32 })] };
  const row = scopedOperation();
  const rowWrites: any[] = [], blocks: any[] = [];
  const service = new ScopedSwapExecutionService({ client: {
    getTransactionReceipt: async () => ({ transactionHash, blockNumber: 500n, blockHash: receiptBlockHash,
      status: "success", logs: [before, { address: ARBITRUM_USDC, ...inputTransfer },
        { address: ARBITRUM_WETH, ...outputTransfer }, { address: ENTRY_POINT, ...userOperation }] }),
    getBlock: async (arg: any) => {
      blocks.push(arg);
      return arg.blockTag === "finalized" ? { number: 600n, hash: finalizedHeadHash }
        : { number: 500n, hash: receiptBlockHash };
    },
  } as any, vault: {} as any,
  operations: { get: async () => row, transition: async (_grant: string, _scope: string, _expected: any, patch: any) => {
    Object.assign(row, patch); rowWrites.push(patch); return row;
  } } as any,
  finance: {} as any, bundler: { locate: async () => ({ transactionHash }) } as any,
  paymaster: {} as any, broadcastEnabled: false, maxFeeWei: "0" });
  const result = await service.reconcile(row.grantId, row.scope);
  assert.equal(result?.state, "confirmed");
  assert.equal(result?.confirmedBlockNumber, "500");
  assert.equal(result?.confirmedBlockHash, receiptBlockHash);
  assert.notEqual(result?.confirmedBlockHash, finalizedHeadHash);
  assert.deepEqual(blocks, [{ blockTag: "finalized" }, { blockNumber: 500n }]);
  assert.equal(rowWrites.length, 1);
  assert.equal(row.confirmedBlockNumber, "500");
  assert.equal(row.confirmedBlockHash, receiptBlockHash);
});

test("scoped reconciliation leaves the operation uncertain if the receipt block is not canonical", async () => {
  const receiptBlockHash = `0x${"ab".repeat(32)}` as const;
  const row = scopedOperation();
  let transitions = 0;
  const service = new ScopedSwapExecutionService({ client: {
    getTransactionReceipt: async () => ({ transactionHash: `0x${"ef".repeat(32)}`, blockNumber: 500n,
      blockHash: receiptBlockHash, status: "success", logs: [] }),
    getBlock: async (arg: any) => arg.blockTag === "finalized" ? { number: 600n }
      : { number: 500n, hash: `0x${"de".repeat(32)}` },
  } as any, vault: {} as any,
  operations: { get: async () => row, transition: async () => { transitions++; return row; } } as any,
  finance: {} as any, bundler: { locate: async () => ({ transactionHash: `0x${"ef".repeat(32)}` }) } as any,
  paymaster: {} as any, broadcastEnabled: false, maxFeeWei: "0" });
  const result = await service.reconcile(row.grantId, row.scope);
  assert.equal(result?.state, "submitted");
  assert.equal(transitions, 0);
  assert.equal(result?.confirmedBlockHash, undefined);
});
