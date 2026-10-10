import { createHash } from "node:crypto";
import { getAddress } from "ethers";
import { meraMutation, meraQuery } from "./convex.js";
import { assertMonadActionsEnabled, assertMonadBroadcastEnabled, MonadApiError } from "./config.js";
import { PERPL_CHAIN_ID, PERPL_DIRECT_VENUE_ID } from "./perplConfig.js";
import { perplMobileTransaction } from "./perplMobileTransaction.js";

export const MANUAL_PERPL_FACTORY = getAddress("0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209");
export const MANUAL_DA_FACTORY_ABI = [
  "function create(address operator,uint256 operatorDeadline,bytes operatorSignature) returns (address)",
];
export const MANUAL_DA_ABI = [
  "function owner() view returns (address)", "function exchange() view returns (address)",
  "function accountId() view returns (uint256)", "function createAccount(uint256 amount)",
  "function depositCollateral(uint256 amount)", "function withdrawCollateral(uint256 amount)",
];

export function manualPerplEnabled() {
  return process.env.MONAD_TESTNET_MANUAL_PERPL_ENABLED?.trim().toLowerCase() === "true";
}
export function requireManualPerplActions() {
  if (!manualPerplEnabled()) throw new MonadApiError("Manual Perpl is disabled by its separate local testnet gate.", 503, "manual_perpl_disabled");
  assertMonadActionsEnabled();
}
export function requireManualPerplBroadcast() {
  requireManualPerplActions();
  assertMonadBroadcastEnabled();
}

export function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function manualTransactionDto(transaction: any) {
  return perplMobileTransaction({ ...transaction, type: "eip1559" });
}
export function manualOperationDto(row: any, action: string, review: Record<string, unknown>) {
  const transaction = row.transaction ?? (row.transactionJson ? JSON.parse(row.transactionJson) : null);
  return { operationId: row.operationId, venueId: PERPL_DIRECT_VENUE_ID, chainId: PERPL_CHAIN_ID,
    status: row.status ?? "prepared", action, review: { ...review, transactionTarget: transaction?.to ?? null,
      transactionValue: transaction?.value ?? "0", maxGas: transaction ? { gasLimit: transaction.gasLimit,
        maxFeePerGas: transaction.maxFeePerGas, maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        maxCostWei: (BigInt(transaction.gasLimit) * BigInt(transaction.maxFeePerGas)).toString() } : undefined },
    transaction: transaction ? manualTransactionDto(transaction) : undefined,
    expiresAt: row.expiresAt, transactionHash: row.txHash ?? null,
    receipt: row.blockNumber ? { status: row.receiptStatus, blockNumber: row.blockNumber, blockHash: row.blockHash } : null,
    result: row.result ?? (row.resultJson ? JSON.parse(row.resultJson) : null), errorCode: row.errorCode ?? null };
}

export async function storedAccount(token: string) {
  return await meraQuery(token, "monadManual", "getAccount", {}) as any;
}
export async function storedOperation(token: string, operationId: string) {
  return await meraQuery(token, "monadManual", "getOperation", { operationId }) as any;
}
export async function storedIdempotentOperation(token: string, idempotencyKey: string, intentHash: string) {
  const row: any = await meraQuery(token, "monadManual", "getOperationByIdempotency", { idempotencyKey });
  if (row && row.intentHash !== intentHash) throw new MonadApiError("Idempotency key was reused for different manual Perpl terms.", 409, "idempotency_conflict");
  return row;
}
export async function persistPrepared(token: string, input: any) {
  return await meraMutation(token, "monadManual", "prepareOperation", input) as any;
}

export function validateIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(value)) {
    throw new MonadApiError("A valid manual Perpl idempotency key is required.", 400, "manual_perpl_idempotency_invalid");
  }
  return value;
}
export function integerUnits(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[1-9]\d{0,23}$/.test(value)) {
    throw new MonadApiError(`${name} must be a positive integer amount in base units.`, 400, "manual_perpl_amount_invalid");
  }
  return BigInt(value);
}
