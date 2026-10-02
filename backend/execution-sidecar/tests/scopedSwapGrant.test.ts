import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicClient, decodeFunctionData, encodeFunctionData, http, keccak256, stringToHex, zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { getPluginsEnableTypedData } from "@zerodev/sdk";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { ParamCondition } from "@zerodev/permissions/policies";
import {
  activateScopedSwapGrant, ARBITRUM_V3_SWAP_ROUTER,
  buildScopePolicies, buildScopedSwapCall, prepareScopedSwapGrants,
  type SwapGrantInput,
} from "../src/mobile/scopedSwapGrant.js";
import { buildOwnerAllowanceCalls as ownerAllowanceCalls, readSwapAllowanceSnapshot } from "../src/mobile/swapAllowance.js";
import type { SessionGrantRecord, SessionSignerVault, SwapScope } from "../src/mobile/sessionSignerVault.js";

const owner = "0x1234567890123456789012345678901234567890" as const;
const hash = keccak256(stringToHex("frozen-policy"));
const input: SwapGrantInput = {
  grantId: "test-grant-001", owner, strategyAccountId: "strategy-1", assignmentId: "assignment-1",
  frozenPolicyHash: hash, expiresAt: 2000, maxUsdcUnits: 2_000_000n,
  maxWethUnits: 1_000_000_000_000_000n, minWethOutUnits: 10n, minUsdcOutUnits: 1_000n,
};
const swapAbi = [{ type: "function", name: "exactInputSingle", stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }], outputs: [{ name: "amountOut", type: "uint256" }] }] as const;

function rulePolicy(scope: SwapScope) {
  const [call, timestamp, rate] = buildScopePolicies(input, scope, 1000);
  const params = call.policyParams as unknown as { permissions: Array<{ target: string; selector: string; valueLimit: bigint; rules: Array<{ offset: number; condition: number; params: `0x${string}`[] }> }> };
  return { permission: params.permissions[0], timestamp: timestamp.policyParams, rate: rate.policyParams };
}

function record(scope: SwapScope, typedData?: SessionGrantRecord["ownerApproval"]): SessionGrantRecord {
  const buy = scope === "buy";
  return {
    grantId: input.grantId, scope, state: "active", owner, strategyAccountId: input.strategyAccountId,
    assignmentId: input.assignmentId, frozenPolicyHash: hash, policyHash: hash,
    createdAt: 1000, expiresAt: input.expiresAt,
    maxInputUnits: (buy ? input.maxUsdcUnits : input.maxWethUnits).toString(),
    minOutputUnits: (buy ? input.minWethOutUnits : input.minUsdcOutUnits).toString(),
    privateKey: `0x${"01".repeat(32)}`, sessionAddress: owner,
    ownerApproval: typedData ?? { domain: {}, types: {}, primaryType: "Enable", message: {} },
    ownerApprovalSignature: "0x01",
  };
}

class TestVault implements SessionSignerVault {
  readonly durable = true;
  rows = new Map<string, SessionGrantRecord>();
  key(id: string, scope: SwapScope) { return `${id}:${scope}`; }
  async get(id: string, scope: SwapScope) { return this.rows.get(this.key(id, scope)) ?? null; }
  async putIfAbsent(value: SessionGrantRecord) {
    const key = this.key(value.grantId, value.scope);
    if (!this.rows.has(key)) this.rows.set(key, value);
    return this.rows.get(key)!;
  }
  async put(value: SessionGrantRecord) { this.rows.set(this.key(value.grantId, value.scope), value); }
  async delete(id: string, scope: SwapScope) { this.rows.delete(this.key(id, scope)); }
}

function readyClient(overrides: { usdcBalance?: bigint; usdcAllowance?: bigint; wethBalance?: bigint; wethAllowance?: bigint } = {}) {
  return { chain: { id: 42161 },
    getBlock: async () => ({ number: 987n, hash: `0x${"ab".repeat(32)}` }),
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (address.toLowerCase().includes("af88")) return functionName === "allowance"
        ? overrides.usdcAllowance ?? input.maxUsdcUnits : overrides.usdcBalance ?? input.maxUsdcUnits;
      return functionName === "allowance" ? overrides.wethAllowance ?? input.maxWethUnits : overrides.wethBalance ?? 0n;
    },
  } as any;
}

test("CallPolicy manual tuple words match the exact static Uniswap calldata layout", () => {
  const { permission, timestamp, rate } = rulePolicy("buy");
  const args = { tokenIn: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    tokenOut: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", fee: 3000,
    recipient: owner, deadline: 1800n, amountIn: 1_000_000n,
    amountOutMinimum: 11n, sqrtPriceLimitX96: 0n } as const;
  const data = encodeFunctionData({ abi: swapAbi, functionName: "exactInputSingle", args: [args] });
  assert.equal(permission.target.toLowerCase(), ARBITRUM_V3_SWAP_ROUTER.toLowerCase());
  assert.equal(permission.valueLimit, 0n);
  assert.deepEqual(permission.rules.map(rule => rule.offset), [0, 32, 64, 96, 128, 128, 160, 192, 224]);
  for (const rule of permission.rules) {
    const word = data.slice(10 + rule.offset * 2, 10 + (rule.offset + 32) * 2).toLowerCase();
    const actual = BigInt(`0x${word}`), expected = BigInt(rule.params[0]);
    if (rule.condition === ParamCondition.EQUAL) assert.equal(actual, expected);
    if (rule.condition === ParamCondition.LESS_THAN_OR_EQUAL) assert.ok(actual <= expected);
    if (rule.condition === ParamCondition.GREATER_THAN_OR_EQUAL) assert.ok(actual >= expected);
  }
  assert.equal(permission.rules[6].condition, ParamCondition.LESS_THAN_OR_EQUAL);
  assert.equal(permission.rules[7].condition, ParamCondition.GREATER_THAN_OR_EQUAL);
  assert.equal(permission.rules[8].condition, ParamCondition.EQUAL);
  assert.equal((timestamp as { validUntil: number }).validUntil, input.expiresAt);
  assert.equal((rate as { count: number }).count, 1);
});

test("ZeroDev SDK composes the real Kernel Enable payload without invoking the owner signer", async () => {
  const client = createPublicClient({ chain: arbitrum, transport: http() });
  const session = privateKeyToAccount(`0x${"33".repeat(32)}`);
  const signer = await toECDSASigner({ signer: session });
  const policies = buildScopePolicies(input, "buy", 1000);
  const validator = await toPermissionValidator(client, {
    entryPoint: { address: "0x0000000071727de22e5e9d8baf0edac6f37da032", version: "0.7" },
    kernelVersion: "0.3.3", signer, policies,
  });
  assert.equal(validator.validatorType, "PERMISSION");
  assert.notEqual(await validator.getIdentifier(), "0x");
  const typedData = await getPluginsEnableTypedData({
    accountAddress: owner, chainId: 42161, kernelVersion: "0.3.3", validatorNonce: 1,
    action: { selector: "0x00000000", address: zeroAddress }, validator,
  });
  const validationId = typedData.message.validationId as Hex;
  assert.equal(typedData.primaryType, "Enable");
  assert.equal(typedData.domain?.verifyingContract?.toLowerCase(), owner.toLowerCase());
  assert.equal(typedData.domain?.chainId, 42161);
  assert.equal(validationId.slice(0, 4), "0x02");
  assert.equal(typedData.message.validatorData, await validator.getEnableData(owner));
  assert.equal(validationId.slice(4), validator.getIdentifier().slice(2).padEnd(40, "0"));
});

test("buy and exit grants are directional and each has its own one-use rate limit", () => {
  const buy = rulePolicy("buy"), exit = rulePolicy("exit");
  assert.equal(buy.permission.rules[0].params[0].toLowerCase(), "0x000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831");
  assert.equal(exit.permission.rules[0].params[0].toLowerCase(), "0x00000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1");
  assert.equal(buy.permission.rules[6].params[0], `0x${input.maxUsdcUnits.toString(16).padStart(64, "0")}`);
  assert.equal(exit.permission.rules[6].params[0], `0x${input.maxWethUnits.toString(16).padStart(64, "0")}`);
  assert.equal((buy.rate as { count: number }).count, 1);
  assert.equal((exit.rate as { count: number }).count, 1);
});

test("builder emits zero-value exactInputSingle to fixed router and owner recipient", async () => {
  const vault = new TestVault();
  vault.rows.set(vault.key(input.grantId, "buy"), record("buy"));
  const call = await buildScopedSwapCall(readyClient(), vault, input.grantId, "buy",
    { amountIn: 1_000_000n, amountOutMinimum: 12n, deadline: 1900 }, 1100);
  assert.equal(call.to, ARBITRUM_V3_SWAP_ROUTER);
  assert.equal(call.value, 0n);
  const decoded = decodeFunctionData({ abi: swapAbi, data: call.data });
  assert.equal(decoded.functionName, "exactInputSingle");
  assert.equal(decoded.args[0].recipient.toLowerCase(), owner.toLowerCase());
  assert.equal(decoded.args[0].amountIn, 1_000_000n);
  assert.equal(decoded.args[0].amountOutMinimum, 12n);
  assert.equal(decoded.args[0].sqrtPriceLimitX96, 0n);
});

test("builder rejects input over cap, low output floor, and expired or out-of-window deadlines", async () => {
  const vault = new TestVault();
  vault.rows.set(vault.key(input.grantId, "buy"), record("buy"));
  await assert.rejects(buildScopedSwapCall(readyClient(), vault, input.grantId, "buy",
    { amountIn: input.maxUsdcUnits + 1n, amountOutMinimum: 12n, deadline: 1900 }, 1100), /cap/);
  await assert.rejects(buildScopedSwapCall(readyClient(), vault, input.grantId, "buy",
    { amountIn: 1n, amountOutMinimum: 9n, deadline: 1900 }, 1100), /floor/);
  await assert.rejects(buildScopedSwapCall(readyClient(), vault, input.grantId, "buy",
    { amountIn: 1n, amountOutMinimum: 12n, deadline: 2001 }, 1100), /deadline/);
  await assert.rejects(buildScopedSwapCall(readyClient(), vault, input.grantId, "buy",
    { amountIn: 1n, amountOutMinimum: 12n, deadline: 1900 }, 2000), /expired/);
});

test("builder refuses a buy without finalized USDC balance and allowance", async () => {
  const vault = new TestVault();
  vault.rows.set(vault.key(input.grantId, "buy"), record("buy"));
  await assert.rejects(buildScopedSwapCall(readyClient({ usdcAllowance: 0n }), vault,
    input.grantId, "buy", { amountIn: 1n, amountOutMinimum: 12n, deadline: 1900 }, 1100), /allowance/);
});

test("owner approval activates only when the exact EIP-712 payload verifies", async () => {
  const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const ownerApproval = { domain: { name: "Kernel", version: "0.3.3", chainId: 42161, verifyingContract: account.address },
    types: { Enable: [{ name: "nonce", type: "uint256" }] }, primaryType: "Enable" as const, message: { nonce: 9n } };
  const signature = await account.signTypedData(ownerApproval);
  const vault = new TestVault();
  vault.rows.set(vault.key(input.grantId, "buy"), { ...record("buy", ownerApproval), owner: account.address, state: "awaiting-owner", ownerApprovalSignature: undefined });
  await assert.rejects(activateScopedSwapGrant(vault, input.grantId, "buy", `0x${"00".repeat(65)}`, 1100), /invalid/);
  const activated = await activateScopedSwapGrant(vault, input.grantId, "buy", signature, 1100);
  assert.equal(activated.state, "active");
  assert.equal(activated.owner, account.address);
  assert.equal(activated.strategyAccountId, input.strategyAccountId);
  assert.equal(activated.assignmentId, input.assignmentId);
  assert.equal(activated.frozenPolicyHash, input.frozenPolicyHash);
  assert.equal(activated.policyHash, input.frozenPolicyHash);
  assert.equal((await vault.get(input.grantId, "buy"))?.ownerApprovalSignature, signature);
});

test("owner allowance operations set exact router caps and never unlimited values", () => {
  const calls = ownerAllowanceCalls(input);
  assert.equal(calls[0].value, 0n);
  assert.equal(calls[1].value, 0n);
  assert.equal(calls[0].to.toLowerCase(), "0xaf88d065e77c8cc2239327c5edb3a432268e5831");
  assert.equal(calls[1].to.toLowerCase(), "0x82af49447d8a07e3bd95bd0d56f35241523fbab1");
  for (const [index, call] of calls.entries()) {
    const decoded = decodeFunctionData({ abi: [{ type: "function", name: "approve", stateMutability: "nonpayable",
      inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const, data: call.data });
    assert.equal(decoded.functionName, "approve");
    assert.equal(decoded.args[0].toLowerCase(), ARBITRUM_V3_SWAP_ROUTER.toLowerCase());
    assert.equal(decoded.args[1], index === 0 ? input.maxUsdcUnits : input.maxWethUnits);
  }
});

test("balance and allowance preflight reads all four values at one finalized block", async () => {
  const reads: Array<{ address: string; functionName: string; blockNumber: bigint }> = [];
  const client = {
    chain: { id: 42161 },
    getBlock: async ({ blockTag }: { blockTag: string }) => {
      assert.equal(blockTag, "finalized");
      return { number: 987n, hash: `0x${"ab".repeat(32)}` };
    },
    readContract: async (call: { address: string; functionName: string; blockNumber: bigint }) => {
      reads.push(call);
      if (call.address.toLowerCase().includes("af88")) {
        return call.functionName === "balanceOf" ? input.maxUsdcUnits : input.maxUsdcUnits;
      }
      return call.functionName === "balanceOf" ? 0n : input.maxWethUnits;
    },
  } as any;
  const snapshot = await readSwapAllowanceSnapshot(client, owner, input);
  assert.equal(snapshot.blockNumber, "987");
  assert.equal(snapshot.buyReady, true);
  assert.equal(snapshot.exitAllowanceReady, true);
  assert.equal(snapshot.wethBalanceUnits, "0");
  assert.deepEqual(reads.map(read => read.blockNumber), [987n, 987n, 987n, 987n]);
});

test("preparation stays closed unless the signer vault is configured as durable", async () => {
  const ephemeral = { durable: false } as SessionSignerVault;
  await assert.rejects(prepareScopedSwapGrants({ chain: { id: 42161 } } as any, ephemeral, input, 1100), /durable/);
});
