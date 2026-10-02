import {
  createKernelAccount, addressToEmptyAccount, type KernelSmartAccountImplementation,
} from "@zerodev/sdk";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  CallType, ParamCondition, CallPolicyVersion, toCallPolicy,
  toRateLimitPolicy, toTimestampPolicy,
} from "@zerodev/permissions/policies";
import {
  type Address, type PublicClient, type Hex, type TypedDataDefinition,
  encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256,
  pad, parseAbiParameters, toFunctionSelector, toHex, verifyTypedData,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { SmartAccount } from "viem/account-abstraction";
import { CHAIN, ENTRY_POINT } from "./contracts.js";
import { readSwapAllowanceSnapshot } from "./swapAllowance.js";
import { ARBITRUM_USDC as USDC, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH as WETH,
  swapRouterAbi, V3_FEE_TIER } from "./uniswapV3.js";
import {
  type OwnerApprovalTypedData, type SessionGrantRecord, type SessionSignerVault,
  type SwapScope,
} from "./sessionSignerVault.js";

export { ARBITRUM_V3_SWAP_ROUTER, V3_FEE_TIER } from "./uniswapV3.js";
const ENTRY_POINT_07 = { address: ENTRY_POINT, version: "0.7" as const };

export type SwapGrantInput = {
  grantId: string;
  owner: Address;
  strategyAccountId: string;
  assignmentId: string;
  frozenPolicyHash: Hex;
  expiresAt: number;
  maxUsdcUnits: bigint;
  maxWethUnits: bigint;
  minWethOutUnits: bigint;
  minUsdcOutUnits: bigint;
};
export type PreparedScope = {
  grantId: string; scope: SwapScope; state: "awaiting-owner" | "active" | "revoked";
  owner: Address; sessionAddress: Address; strategyAccountId: string; assignmentId: string; frozenPolicyHash: Hex;
  policyHash: Hex; expiresAt: number; ownerApproval: OwnerApprovalTypedData;
  review: { chainId: 42161; router: Address; tokenIn: Address; tokenOut: Address; feeTier: number;
    recipient: Address; maximumInputUnits: string; minimumOutputUnits: string;
    earliestDeadline: number; latestDeadline: number; maxCalls: 1; callValueWei: "0" };
};
export type ExactInputSingle = {
  amountIn: bigint; amountOutMinimum: bigint; deadline: number;
};

const word = (value: Address | bigint) => typeof value === "bigint"
  ? toHex(value, { size: 32 }) : pad(value, { size: 32 });
const swapSelector = toFunctionSelector("exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))");

export function computeSwapPolicyHash(input: SwapGrantInput): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters(
    "uint256 chainId, address owner, string strategyAccountId, string assignmentId, string grantId, bytes32 frozenPolicyHash, uint48 expiresAt, uint256 maxUsdcUnits, uint256 maxWethUnits, uint256 minWethOutUnits, uint256 minUsdcOutUnits, address router, uint24 fee",
  ), [BigInt(CHAIN), getAddress(input.owner), input.strategyAccountId, input.assignmentId, input.grantId,
    input.frozenPolicyHash, input.expiresAt, input.maxUsdcUnits, input.maxWethUnits,
    input.minWethOutUnits, input.minUsdcOutUnits, ARBITRUM_V3_SWAP_ROUTER, V3_FEE_TIER]));
}

function validateGrant(input: SwapGrantInput, now: number) {
  if (!isAddress(input.owner) || !/^[-_a-zA-Z0-9]{8,128}$/.test(input.grantId)) throw new Error("Invalid owner or grant id");
  if (!input.strategyAccountId.trim() || !input.assignmentId.trim()) throw new Error("Grant identity is incomplete");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.frozenPolicyHash)) throw new Error("Invalid frozen policy hash");
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now + 30 || input.expiresAt > now + 7 * 24 * 60 * 60) throw new Error("Grant expiry is outside the allowed window");
  if (input.maxUsdcUnits <= 0n || input.maxWethUnits <= 0n || input.minWethOutUnits <= 0n || input.minUsdcOutUnits <= 0n) throw new Error("Swap bounds must be positive");
}

function scopeBounds(input: SwapGrantInput, scope: SwapScope) {
  return scope === "buy"
    ? { tokenIn: USDC, tokenOut: WETH, maxInput: input.maxUsdcUnits, minOutput: input.minWethOutUnits }
    : { tokenIn: WETH, tokenOut: USDC, maxInput: input.maxWethUnits, minOutput: input.minUsdcOutUnits };
}

/** CallPolicy offsets are byte offsets into calldata arguments (selector removed).
 * exactInputSingle's sole argument is a static 8-word tuple, flattened at words 0..7. */
export function buildScopePolicies(input: SwapGrantInput, scope: SwapScope, createdAt: number) {
  const bounds = scopeBounds(input, scope);
  const rules = [
    { offset: 0, condition: ParamCondition.EQUAL, params: [word(bounds.tokenIn)] },
    { offset: 32, condition: ParamCondition.EQUAL, params: [word(bounds.tokenOut)] },
    { offset: 64, condition: ParamCondition.EQUAL, params: [word(BigInt(V3_FEE_TIER))] },
    { offset: 96, condition: ParamCondition.EQUAL, params: [word(getAddress(input.owner))] },
    { offset: 128, condition: ParamCondition.GREATER_THAN_OR_EQUAL, params: [word(BigInt(createdAt))] },
    { offset: 128, condition: ParamCondition.LESS_THAN_OR_EQUAL, params: [word(BigInt(input.expiresAt))] },
    { offset: 160, condition: ParamCondition.LESS_THAN_OR_EQUAL, params: [word(bounds.maxInput)] },
    { offset: 192, condition: ParamCondition.GREATER_THAN_OR_EQUAL, params: [word(bounds.minOutput)] },
    { offset: 224, condition: ParamCondition.EQUAL, params: [word(0n)] },
  ];
  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_5,
    permissions: [{ callType: CallType.CALL, target: ARBITRUM_V3_SWAP_ROUTER,
      selector: swapSelector, valueLimit: 0n, rules }],
  });
  return [callPolicy,
    toTimestampPolicy({ validAfter: createdAt, validUntil: input.expiresAt }),
    toRateLimitPolicy({ count: 1, interval: input.expiresAt - createdAt, startAt: createdAt }),
  ];
}

function typedDataShape(value: unknown): OwnerApprovalTypedData {
  const data = value as OwnerApprovalTypedData;
  if (!data || !data.domain || !data.types || !data.message || data.primaryType !== "Enable") {
    throw new Error("ZeroDev returned an unexpected Kernel owner approval payload");
  }
  return data;
}

async function buildOwnerApproval(
  client: PublicClient, input: SwapGrantInput, scope: SwapScope, createdAt: number, privateKey: Hex,
) {
  const accountKey = privateKeyToAccount(privateKey);
  const signer = await toECDSASigner({ signer: accountKey });
  const policies = buildScopePolicies(input, scope, createdAt);
  const validator = await toPermissionValidator(client, {
    entryPoint: ENTRY_POINT_07, kernelVersion: "0.3.3", signer, policies,
  });
  const account = await createKernelAccount(client, {
    address: getAddress(input.owner), eip7702Account: addressToEmptyAccount(getAddress(input.owner)),
    plugins: { regular: validator }, entryPoint: ENTRY_POINT_07, kernelVersion: "0.3.3",
  });
  if (account.address.toLowerCase() !== input.owner.toLowerCase()) throw new Error("Kernel EIP-7702 account does not match the owner");
  // This is the SDK's exact typed-data payload; it does not call the owner signer.
  const ownerApproval = typedDataShape(await account.kernelPluginManager.getPluginsEnableTypedData(account.address));
  return { ownerApproval, sessionAddress: accountKey.address, validator };
}

function prepared(record: SessionGrantRecord): PreparedScope {
  const pair = record.scope === "buy" ? { tokenIn: USDC, tokenOut: WETH } : { tokenIn: WETH, tokenOut: USDC };
  return { grantId: record.grantId, scope: record.scope, state: record.state,
    owner: record.owner, sessionAddress: record.sessionAddress, strategyAccountId: record.strategyAccountId,
    assignmentId: record.assignmentId, frozenPolicyHash: record.frozenPolicyHash, policyHash: record.policyHash,
    expiresAt: record.expiresAt, ownerApproval: record.ownerApproval,
    review: { chainId: CHAIN, router: ARBITRUM_V3_SWAP_ROUTER, ...pair, feeTier: V3_FEE_TIER,
      recipient: record.owner, maximumInputUnits: record.maxInputUnits,
      minimumOutputUnits: record.minOutputUnits, earliestDeadline: record.createdAt,
      latestDeadline: record.expiresAt, maxCalls: 1, callValueWei: "0" } };
}

/** Generate one owner-approved, one-use permission per direction. The private keys only enter the server-side vault. */
export async function prepareScopedSwapGrants(
  client: PublicClient, vault: SessionSignerVault, input: SwapGrantInput, now = Math.floor(Date.now() / 1000),
): Promise<PreparedScope[]> {
  validateGrant(input, now);
  if (!vault.durable) throw new Error("A verified durable encrypted session signer vault is required");
  if (client.chain?.id !== CHAIN) throw new Error("Scoped grants require an Arbitrum One client");
  const policyHash = computeSwapPolicyHash(input);
  const results: PreparedScope[] = [];
  for (const scope of ["buy", "exit"] as const) {
    const existing = await vault.get(input.grantId, scope);
    if (existing) {
      if (existing.policyHash !== policyHash || existing.owner.toLowerCase() !== input.owner.toLowerCase()) throw new Error("Grant id is already bound to a different policy");
      results.push(prepared(existing));
      continue;
    }
    const privateKey = generatePrivateKey();
    const { ownerApproval, sessionAddress } = await buildOwnerApproval(client, input, scope, now, privateKey);
    const scoped = scopeBounds(input, scope);
    const record: SessionGrantRecord = {
      grantId: input.grantId, scope, state: "awaiting-owner", owner: getAddress(input.owner),
      strategyAccountId: input.strategyAccountId, assignmentId: input.assignmentId,
      frozenPolicyHash: input.frozenPolicyHash, policyHash, createdAt: now, expiresAt: input.expiresAt,
      maxInputUnits: scoped.maxInput.toString(), minOutputUnits: scoped.minOutput.toString(),
      privateKey, sessionAddress, ownerApproval };
    const saved = await vault.putIfAbsent(record);
    if (saved.policyHash !== policyHash || saved.owner.toLowerCase() !== input.owner.toLowerCase()) throw new Error("Grant id is already bound to a different policy");
    results.push(prepared(saved));
  }
  return results;
}

export async function activateScopedSwapGrant(
  vault: SessionSignerVault, grantId: string, scope: SwapScope, signature: Hex, now = Math.floor(Date.now() / 1000),
) {
  if (!vault.durable) throw new Error("A verified durable encrypted session signer vault is required");
  const record = await vault.get(grantId, scope);
  if (!record || record.state === "revoked") throw new Error("Prepared session grant is unavailable");
  if (record.expiresAt <= now) throw new Error("Prepared session grant has expired");
  if (record.state === "active") {
    if (record.ownerApprovalSignature !== signature) throw new Error("Grant is already activated with a different owner signature");
    return prepared(record);
  }
  const data = record.ownerApproval as unknown as TypedDataDefinition;
  let signatureValid = false;
  try { signatureValid = await verifyTypedData({ ...data, address: record.owner, signature }); }
  catch { signatureValid = false; }
  if (!signatureValid) throw new Error("Owner approval signature is invalid");
  const active = { ...record, state: "active" as const, ownerApprovalSignature: signature };
  await vault.put(active);
  return prepared(active);
}

/** Read only the owner-facing grant review; never return the stored session key. */
export async function readScopedSwapGrant(
  vault: SessionSignerVault, grantId: string, scope: SwapScope, owner: Address,
) {
  if (!isAddress(owner)) throw new Error("Invalid grant owner");
  const record = await vault.get(grantId, scope);
  if (!record || record.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("Scoped swap grant is unavailable");
  return prepared(record);
}

/** Revoke locally and erase the server-side key; an already-submitted UserOp must still be reconciled. */
export async function revokeScopedSwapGrant(
  vault: SessionSignerVault, grantId: string, scope: SwapScope, owner: Address,
) {
  if (!isAddress(owner)) throw new Error("Invalid grant owner");
  const record = await vault.get(grantId, scope);
  if (!record || record.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("Scoped swap grant is unavailable");
  if (record.state !== "revoked") await vault.put({ ...record, state: "revoked",
    privateKey: `0x${"00".repeat(32)}` as Hex });
  return prepared({ ...record, state: "revoked" });
}

/** Build the exact router call from an active vault record; the installed CallPolicy rechecks the same bounds on-chain. */
export async function buildScopedSwapCall(
  client: PublicClient, vault: SessionSignerVault, grantId: string, scope: SwapScope, params: ExactInputSingle,
  now = Math.floor(Date.now() / 1000),
) {
  if (!vault.durable) throw new Error("A verified durable encrypted session signer vault is required");
  const record = await vault.get(grantId, scope);
  if (!record || record.state !== "active" || !record.ownerApprovalSignature) throw new Error("Session grant is not active");
  if (record.expiresAt <= now) throw new Error("Session grant has expired");
  const maxInput = BigInt(record.maxInputUnits), minOutput = BigInt(record.minOutputUnits);
  if (params.amountIn <= 0n || params.amountIn > maxInput) throw new Error("Swap input exceeds the approved cap");
  if (params.amountOutMinimum < minOutput) throw new Error("Swap minimum output is below the approved floor");
  if (!Number.isSafeInteger(params.deadline) || params.deadline < record.createdAt || params.deadline > record.expiresAt || params.deadline <= now) throw new Error("Swap deadline is outside the approved window");
  const allowance = await readSwapAllowanceSnapshot(client, record.owner, {
    owner: record.owner, maxUsdcUnits: scope === "buy" ? maxInput : 0n,
    maxWethUnits: scope === "exit" ? maxInput : 0n,
  });
  if (scope === "buy" && !allowance.buyReady) throw new Error("USDC balance or router allowance is below the approved buy cap");
  if (scope === "exit" && (!allowance.exitAllowanceReady || BigInt(allowance.wethBalanceUnits) < params.amountIn)) {
    throw new Error("WETH balance or router allowance is below the approved exit amount");
  }
  const bounds = scope === "buy"
    ? { tokenIn: USDC, tokenOut: WETH }
    : { tokenIn: WETH, tokenOut: USDC };
  const data = encodeFunctionData({ abi: swapRouterAbi, functionName: "exactInputSingle", args: [{
    tokenIn: bounds.tokenIn, tokenOut: bounds.tokenOut, fee: V3_FEE_TIER,
    recipient: record.owner, deadline: BigInt(params.deadline), amountIn: params.amountIn,
    amountOutMinimum: params.amountOutMinimum, sqrtPriceLimitX96: 0n,
  }] });
  return { to: ARBITRUM_V3_SWAP_ROUTER, value: 0n, data } as const;
}

/** Rebuild a session smart account inside the isolated signer boundary for one scoped operation. */
export async function createScopedSessionAccount(
  client: PublicClient, vault: SessionSignerVault, grantId: string, scope: SwapScope,
  now = Math.floor(Date.now() / 1000),
): Promise<SmartAccount<KernelSmartAccountImplementation>> {
  if (!vault.durable) throw new Error("A verified durable encrypted session signer vault is required");
  const record = await vault.get(grantId, scope);
  if (!record || record.state !== "active" || !record.ownerApprovalSignature) throw new Error("Session grant is not active");
  if (record.expiresAt <= now || client.chain?.id !== CHAIN) throw new Error("Session grant is expired or client is on the wrong chain");
  const input = { grantId, owner: record.owner, strategyAccountId: record.strategyAccountId,
    assignmentId: record.assignmentId, frozenPolicyHash: record.frozenPolicyHash,
    expiresAt: record.expiresAt, maxUsdcUnits: 1n, maxWethUnits: 1n,
    minWethOutUnits: 1n, minUsdcOutUnits: 1n } satisfies SwapGrantInput;
  const maxInput = BigInt(record.maxInputUnits), minOutput = BigInt(record.minOutputUnits);
  if (scope === "buy") { input.maxUsdcUnits = maxInput; input.minWethOutUnits = minOutput; }
  else { input.maxWethUnits = maxInput; input.minUsdcOutUnits = minOutput; }
  const signer = await toECDSASigner({ signer: privateKeyToAccount(record.privateKey) });
  const validator = await toPermissionValidator(client, { entryPoint: ENTRY_POINT_07,
    kernelVersion: "0.3.3", signer, policies: buildScopePolicies(input, scope, record.createdAt) });
  return createKernelAccount(client, { address: record.owner,
    eip7702Account: addressToEmptyAccount(record.owner),
    plugins: { regular: validator, pluginEnableSignature: record.ownerApprovalSignature },
    entryPoint: ENTRY_POINT_07, kernelVersion: "0.3.3" });
}
