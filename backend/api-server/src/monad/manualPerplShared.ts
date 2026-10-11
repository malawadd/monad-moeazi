import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  "function rescueTokens(address token,uint256 amount)",
];
export const PERPL_EXCHANGE_ACCOUNT_ABI = [
  "function createAccount(uint256 amountCNS) returns (uint256 accountId)",
  "function depositCollateral(uint256 amountCNS)", "function withdrawCollateral(uint256 amountCNS)",
];

const MANUAL_PERPL_GATE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.data/manual-perpl-gate.json");
const MAX_MANUAL_PERPL_AUDIT = 200;
type ManualPerplGateAudit = { changedAt: string; from: boolean; to: boolean; actor: string };
type ManualPerplGateFile = { version: 1; enabled: boolean; updatedAt: string; updatedBy: string; audit: ManualPerplGateAudit[] };

function configuredManualPerplEnabled() {
  return process.env.MONAD_TESTNET_MANUAL_PERPL_ENABLED?.trim().toLowerCase() === "true";
}

function validManualPerplGateFile(value: any): value is ManualPerplGateFile {
  return value?.version === 1 && typeof value.enabled === "boolean" && typeof value.updatedAt === "string"
    && typeof value.updatedBy === "string" && Array.isArray(value.audit)
    && value.audit.every((entry: any) => typeof entry?.changedAt === "string" && typeof entry.from === "boolean"
      && typeof entry.to === "boolean" && typeof entry.actor === "string");
}

export function manualPerplGateState(filePath = MANUAL_PERPL_GATE_FILE, configuredEnabled = configuredManualPerplEnabled()) {
  try {
    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    if (!validManualPerplGateFile(saved)) throw new Error("Stored manual Perpl gate state is invalid.");
    return { configuredEnabled, effectiveEnabled: saved.enabled, source: "persistent_local_state" as const,
      updatedAt: saved.updatedAt, updatedBy: saved.updatedBy, audit: saved.audit.slice(-20), error: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { configuredEnabled, effectiveEnabled: configuredEnabled, source: "environment_default" as const,
        updatedAt: null, updatedBy: null, audit: [] as ManualPerplGateAudit[], error: null };
    }
    return { configuredEnabled, effectiveEnabled: false, source: "invalid_persistent_state" as const,
      updatedAt: null, updatedBy: null, audit: [] as ManualPerplGateAudit[], error: "Stored gate state is invalid; manual Perpl is disabled until repaired." };
  }
}

export function setManualPerplGateEnabled(enabled: boolean, actor: string, filePath = MANUAL_PERPL_GATE_FILE,
  configuredEnabled = configuredManualPerplEnabled()) {
  if (typeof enabled !== "boolean") throw new TypeError("Manual Perpl gate state must be a boolean.");
  if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(actor)) throw new TypeError("Manual Perpl gate audit actor is invalid.");
  const current = manualPerplGateState(filePath, configuredEnabled);
  if (current.error) throw new Error(current.error);
  if (current.effectiveEnabled === enabled) return current;
  const prior = current.effectiveEnabled;
  const changedAt = new Date().toISOString();
  const existing = current.source === "persistent_local_state"
    ? JSON.parse(readFileSync(filePath, "utf8")) as ManualPerplGateFile : null;
  const audit = [...(existing?.audit ?? []), { changedAt, from: prior, to: enabled, actor }].slice(-MAX_MANUAL_PERPL_AUDIT);
  const next: ManualPerplGateFile = { version: 1, enabled, updatedAt: changedAt, updatedBy: actor, audit };
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, filePath);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary file remains */ }
    throw error;
  }
  return manualPerplGateState(filePath, configuredEnabled);
}

export function manualPerplEnabled() {
  return manualPerplGateState().effectiveEnabled;
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
    status: row.status ?? "prepared", action, review: { ...review, expiresAt: row.expiresAt,
      transactionTarget: transaction?.to ?? null,
      transactionData: transaction?.data ?? null, transactionNonce: transaction?.nonce ?? null,
      transactionValue: transaction?.value ?? "0", maxGas: transaction ? { gasLimit: transaction.gasLimit,
        maxFeePerGas: transaction.maxFeePerGas, maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        maxCostWei: (BigInt(transaction.gasLimit) * BigInt(transaction.maxFeePerGas)).toString() } : undefined },
    transaction: transaction ? manualTransactionDto(transaction) : undefined,
    expiresAt: row.expiresAt, transactionHash: row.txHash ?? null,
    receipt: row.blockNumber ? { status: row.receiptStatus, blockNumber: row.blockNumber, blockHash: row.blockHash } : null,
    result: row.result ?? (row.resultJson ? JSON.parse(row.resultJson) : null), errorCode: row.errorCode ?? null };
}

export async function storedAccount(token: string) {
  const accounts: any = await meraQuery(token, "monadManual", "getAccounts", {});
  return accounts?.direct ?? null;
}
export async function storedManualAccounts(token: string) {
  return await meraQuery(token, "monadManual", "getAccounts", {}) as { direct: any; legacy: any };
}
export async function storedLegacyAccount(token: string) {
  const accounts: any = await storedManualAccounts(token);
  return accounts?.legacy ?? null;
}
export async function storedOperation(token: string, operationId: string) {
  return await meraQuery(token, "monadManual", "getOperation", { operationId }) as any;
}
export async function storedIdempotentOperation(token: string, idempotencyKey: string, intentHash: string) {
  const row: any = await meraQuery(token, "monadManual", "getOperationByIdempotency", { idempotencyKey });
  return matchManualIdempotency(row, intentHash);
}
export function matchManualIdempotency(row: any, intentHash: string) {
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
