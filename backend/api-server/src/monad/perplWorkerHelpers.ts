import { Transaction, Wallet, keccak256 } from "ethers";
import { assertMonadBroadcastEnabled } from "./config.js";
import { finalizedBlockNumber } from "./provider.js";
import { buildEip1559Transaction } from "./transactions.js";
import { operatorWallet } from "./vaultTrades.js";

export type TickResult = { status: string; phase: string; patch?: Record<string, unknown>; event?: Record<string, unknown>;
  continueAfter: boolean; nextDelayMs: number };
export function waitResult(status: string, phase: string, patch: Record<string, unknown> = {}, delay = 3_000): TickResult {
  return { status, phase, patch, continueAfter: true, nextDelayMs: delay };
}
export function event(eventId: string, kind: string, status: string, summary: string, data?: unknown, txHash?: string) {
  return { eventId, kind, status, summary, ...(data ? { data } : {}), ...(txHash ? { txHash } : {}) };
}
export async function receiptState(provider: any, txHash: string, raw?: string) {
  let receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    const pending = await provider.getTransaction(txHash);
    if (!pending && raw) {
      try { assertMonadBroadcastEnabled(true); await provider.broadcastTransaction(raw); }
      catch { /* gate-off and uncertain responses only retry the exact saved hash later */ }
    }
    return { state: "pending" as const };
  }
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || String(block.hash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) return { state: "pending" as const };
  if (receipt.blockNumber > await finalizedBlockNumber(provider)) return { state: "pending" as const, receipt };
  return { state: receipt.status === 1 ? "finalized" as const : "failed" as const, receipt };
}
export async function signedOperatorTransaction(provider: any, to: string, data: string, maxGasLimit = 3_000_000n) {
  assertMonadBroadcastEnabled(true);
  const wallet = (await operatorWallet()).connect(provider) as Wallet;
  const built = await buildEip1559Transaction(provider, wallet.address, to, data, 0n, maxGasLimit);
  const raw = await wallet.signTransaction({ ...built.transaction, type: 2 } as any);
  return { raw, hash: keccak256(raw).toLowerCase(), wallet };
}
export function signedTxHash(raw: string) {
  const parsed = Transaction.from(raw); if (!parsed.hash || !parsed.from) throw new Error("Stored Perpl transaction is invalid.");
  return parsed.hash.toLowerCase();
}
