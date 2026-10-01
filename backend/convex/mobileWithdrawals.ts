"use node";

import { createHash, randomUUID } from "node:crypto";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getAddress } from "ethers";
import {
  erc20TransferData, MOBILE_WITHDRAWAL_CHAIN_ID, MOBILE_WITHDRAWAL_SCHEMA,
  MOBILE_WITHDRAWAL_TTL_MS, MOBILE_WITHDRAWAL_USDC, usdcFromRaw, usdcToRaw,
} from "./helpers/mobileWithdrawal";

const TIMEOUT_MS = 8_000;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type RpcFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function rpc(url: string, method: string, params: unknown[], fetcher: RpcFetcher = fetch) {
  const response = await fetcher(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Arbitrum is temporarily unavailable.");
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? "Arbitrum returned an incomplete response.");
  return body.result;
}

function rpcUrl() {
  return process.env.ARBITRUM_RPC_URL ?? process.env.NEXT_PUBLIC_ARB_RPC_URL ?? "https://arb1.arbitrum.io/rpc";
}

function assertEnabled() {
  if (process.env.MOBILE_WALLET_WITHDRAWALS_ENABLED === "false") {
    throw new Error("Mobile withdrawals are temporarily unavailable.");
  }
}

function hex(value: bigint) { return `0x${value.toString(16)}`; }
function topicAddress(value: string) { return `0x${value.toLowerCase().slice(2).padStart(64, "0")}`; }

function preparedResponse(row: any) {
  return {
    schemaVersion: MOBILE_WITHDRAWAL_SCHEMA, operationId: row.operationId,
    idempotencyKey: row.idempotencyKey, owner: row.ownerAddress,
    chainId: MOBILE_WITHDRAWAL_CHAIN_ID, network: "Arbitrum" as const,
    asset: { symbol: "USDC" as const, contractAddress: MOBILE_WITHDRAWAL_USDC, decimals: 6 as const },
    amount: row.amount, amountRaw: row.amountRaw, destination: row.destination,
    destinationKind: row.destinationKind, remainingAmount: row.remainingAmount,
    estimatedFeeWei: row.estimatedFeeWei, observedBlock: row.observedBlock,
    transaction: JSON.parse(row.transactionJson), preparedHash: row.preparedHash,
    expiresAt: row.expiresAt,
  };
}

export const prepare = action({
  args: { amount: v.string(), destination: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<any> => {
    assertEnabled();
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(args.idempotencyKey)) throw new Error("Withdrawal request ID is invalid.");
    const context: any = await ctx.runQuery(internal.mobileWithdrawalModel.getContext, { subject: identity.subject });
    const identityOwner = String(identity.walletAddress ?? "").toLowerCase();
    const owner = String(context.ownerAddress).toLowerCase();
    if (identityOwner !== owner) throw new Error("Magic wallet does not match this Moeazi account.");
    if (!context.profilePaused || context.strategyStatus === "active") throw new Error("Pause the AI trader before reviewing this withdrawal.");
    if (context.hasPendingExecution) throw new Error("Moeazi is finishing an already-submitted action. Check again shortly.");
    if (context.managedPositionClosureUnconfirmed) {
      throw new Error("The managed assignment is stopped, but native position closure and submitted-operation settlement are not confirmed. Close and reconcile the managed position before preparing a withdrawal.");
    }
    const existing: any = await ctx.runQuery(internal.mobileWithdrawalModel.getByIdempotency, {
      userId: context.userId, idempotencyKey: args.idempotencyKey,
    });
    if (existing) {
      if (existing.amount !== args.amount || existing.destination.toLowerCase() !== args.destination.trim().toLowerCase()) {
        throw new Error("This withdrawal request ID is already bound to different details.");
      }
      return preparedResponse(existing);
    }

    let destination: string;
    try { destination = getAddress(args.destination.trim()); }
    catch { throw new Error("Enter a valid wallet address."); }
    if ([owner, "0x0000000000000000000000000000000000000000", MOBILE_WITHDRAWAL_USDC].includes(destination.toLowerCase())) {
      throw new Error("Choose another wallet that can receive Arbitrum USDC.");
    }
    const amountRaw = usdcToRaw(args.amount);
    const url = rpcUrl();
    const [chainHex, blockHex] = await Promise.all([
      rpc(url, "eth_chainId", []), rpc(url, "eth_blockNumber", []),
    ]);
    if (Number(BigInt(String(chainHex))) !== MOBILE_WITHDRAWAL_CHAIN_ID) throw new Error("Withdrawal service is connected to the wrong network.");
    const observedBlock = Number(BigInt(String(blockHex)));
    const data = erc20TransferData(destination, amountRaw);
    const balanceData = `0x70a08231${owner.slice(2).padStart(64, "0")}`;
    const [usdcHex, ethHex, nonceHex, code, gasHex, gasPriceHex] = await Promise.all([
      rpc(url, "eth_call", [{ to: MOBILE_WITHDRAWAL_USDC, data: balanceData }, blockHex]),
      rpc(url, "eth_getBalance", [owner, blockHex]),
      rpc(url, "eth_getTransactionCount", [owner, "pending"]),
      rpc(url, "eth_getCode", [destination, blockHex]),
      rpc(url, "eth_estimateGas", [{ from: owner, to: MOBILE_WITHDRAWAL_USDC, data, value: "0x0" }, blockHex]),
      rpc(url, "eth_gasPrice", []),
    ]);
    const usdcBalanceRaw = BigInt(String(usdcHex));
    const ethBalanceRaw = BigInt(String(ethHex));
    if (amountRaw > usdcBalanceRaw) throw new Error("This amount is higher than your current USDC balance.");
    const gasLimit = (BigInt(String(gasHex)) * 120n + 99n) / 100n;
    const maxFeePerGas = BigInt(String(gasPriceHex)) * 2n;
    const estimatedFeeWei = gasLimit * maxFeePerGas;
    if (ethBalanceRaw < estimatedFeeWei) throw new Error("Add a small amount of ETH for the Arbitrum network fee before withdrawing.");
    const expectedNonce = Number(BigInt(String(nonceHex)));
    if (!Number.isSafeInteger(observedBlock) || !Number.isSafeInteger(expectedNonce)) throw new Error("Arbitrum returned invalid transaction metadata.");
    const transaction = {
      from: owner, to: MOBILE_WITHDRAWAL_USDC, data, value: "0x0",
      gas: hex(gasLimit), maxFeePerGas: hex(maxFeePerGas), nonce: hex(BigInt(expectedNonce)),
    };
    const operationId = randomUUID();
    const expiresAt = Date.now() + MOBILE_WITHDRAWAL_TTL_MS;
    const preparedHash = `0x${createHash("sha256").update(JSON.stringify({ operationId, owner, destination, amountRaw: amountRaw.toString(), transaction, expiresAt })).digest("hex")}`;
    const row: any = await ctx.runMutation(internal.mobileWithdrawalModel.createPrepared, {
      userId: context.userId, strategyAccountId: context.strategyAccountId,
      operationId, idempotencyKey: args.idempotencyKey, ownerAddress: owner,
      destination, destinationKind: String(code) === "0x" ? "wallet" : "contract",
      amount: usdcFromRaw(amountRaw), amountRaw: amountRaw.toString(),
      remainingAmount: usdcFromRaw(usdcBalanceRaw - amountRaw), transactionJson: JSON.stringify(transaction),
      preparedHash, expectedNonce, observedBlock, estimatedFeeWei: estimatedFeeWei.toString(), expiresAt,
    });
    return preparedResponse(row);
  },
});

async function findUncertainTransaction(url: string, row: any) {
  const latest = Number(BigInt(String(await rpc(url, "eth_blockNumber", []))));
  const start = Math.max(row.observedBlock, latest - 64);
  for (let block = latest; block >= start; block -= 1) {
    const value = await rpc(url, "eth_getBlockByNumber", [hex(BigInt(block)), true]) as any;
    const match = value?.transactions?.find((tx: any) =>
      String(tx.from).toLowerCase() === row.ownerAddress.toLowerCase()
      && Number(BigInt(String(tx.nonce))) === row.expectedNonce
      && String(tx.to).toLowerCase() === MOBILE_WITHDRAWAL_USDC
      && String(tx.input).toLowerCase() === JSON.parse(row.transactionJson).data.toLowerCase());
    if (match?.hash) return String(match.hash).toLowerCase();
  }
  return undefined;
}

export const reconcile = action({
  args: { operationId: v.string() },
  handler: async (ctx, args): Promise<any> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const context: any = await ctx.runQuery(internal.mobileWithdrawalModel.getContext, { subject: identity.subject });
    const row: any = await ctx.runQuery(internal.mobileWithdrawalModel.getInternal, { operationId: args.operationId });
    if (!row || String(row.userId) !== String(context.userId)) throw new Error("Withdrawal operation was not found.");
    if (["completed", "failed", "cancelled", "expired", "needs_attention"].includes(row.status)) return row;
    if (row.status === "prepared" && row.expiresAt <= Date.now()) {
      return await ctx.runMutation(internal.mobileWithdrawalModel.updateStatus, { operationId: row.operationId, status: "expired" });
    }
    const url = rpcUrl();
    let txHash = row.txHash;
    if (!txHash && row.status === "uncertain") txHash = await findUncertainTransaction(url, row);
    if (!txHash) return row;
    const receipt = await rpc(url, "eth_getTransactionReceipt", [txHash]);
    if (receipt === null) return await ctx.runMutation(internal.mobileWithdrawalModel.updateStatus, { operationId: row.operationId, status: "confirming", txHash });
    const transaction = await rpc(url, "eth_getTransactionByHash", [txHash]) as any;
    const expected = JSON.parse(row.transactionJson);
    const validTransaction = transaction && String(transaction.from).toLowerCase() === row.ownerAddress.toLowerCase()
      && String(transaction.to).toLowerCase() === MOBILE_WITHDRAWAL_USDC
      && String(transaction.input).toLowerCase() === expected.data.toLowerCase();
    const validLog = Array.isArray((receipt as any).logs) && (receipt as any).logs.some((log: any) =>
      String(log.address).toLowerCase() === MOBILE_WITHDRAWAL_USDC
      && String(log.topics?.[0]).toLowerCase() === TRANSFER_TOPIC
      && String(log.topics?.[1]).toLowerCase() === topicAddress(row.ownerAddress)
      && String(log.topics?.[2]).toLowerCase() === topicAddress(row.destination)
      && BigInt(String(log.data)) === BigInt(row.amountRaw));
    if (String((receipt as any).status) !== "0x1" || !validTransaction || !validLog) {
      return await ctx.runMutation(internal.mobileWithdrawalModel.updateStatus, {
        operationId: row.operationId, status: "failed", txHash,
        failureCode: "RECEIPT_MISMATCH", failureMessage: "Arbitrum did not confirm the exact USDC transfer.",
      });
    }
    return await ctx.runMutation(internal.mobileWithdrawalModel.updateStatus, { operationId: row.operationId, status: "completed", txHash });
  },
});
