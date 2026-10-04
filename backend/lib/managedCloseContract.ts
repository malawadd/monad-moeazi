type JsonRecord = Record<string, unknown>;

export type ManagedCloseReply = {
  status: "blocked" | "pending" | "submitted" | "confirmed_flat";
  code: string;
  message: string;
  positionClosure: "unconfirmed" | "confirmed_flat";
  operationId?: string;
  admissionStopped?: boolean;
  submittedOperationMayStillSettle?: boolean;
  unsettledOperationCount?: number;
  exitGrant?: { verified: boolean; expiresAt: number | null };
  position?: { wethUnits: string; blockNumber: string; blockHash: string };
  closure?: { confirmed: boolean; zeroExposure: boolean; allOperationsSettled: boolean;
    finalizedBlock: string; finalizedBlockHash: string; receiptId: string };
};

export function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function positiveDecimal(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/.test(value); }
function blockHash(value: unknown): value is string { return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value); }

/** Accept only close responses whose status and finalized flat proof agree. */
export function parseManagedCloseReply(httpStatus: number, value: unknown): ManagedCloseReply | null {
  if (!isJsonRecord(value)) return null;

  if (httpStatus === 202 && value.status === "pending" && string(value.code)
      && string(value.message) && value.positionClosure === "unconfirmed"
      && value.admissionStopped === true && value.submittedOperationMayStillSettle === true) {
    return { status: "pending", code: value.code, message: value.message,
      positionClosure: "unconfirmed", admissionStopped: true,
      submittedOperationMayStillSettle: true,
      ...(string(value.operationId) ? { operationId: value.operationId } : {}) };
  }

  if (httpStatus === 200 && value.status === "confirmed_flat"
      && value.positionClosure === "confirmed_flat" && string(value.code)
      && string(value.message) && value.admissionStopped === true
      && value.submittedOperationMayStillSettle === false
      && value.unsettledOperationCount === 0 && isJsonRecord(value.exitGrant)
      && ((value.code === "FINALIZED_NO_TRADE_FLAT"
          && value.exitGrant.verified === false && value.exitGrant.expiresAt === null
          && value.operationId === null)
        || (value.code === "FINALIZED_EXIT_RECONCILED"
          && value.exitGrant.verified === true
          && Number.isSafeInteger(value.exitGrant.expiresAt)
          && string(value.operationId))
        || (value.code === "FINALIZED_VAULT_EXIT_RECONCILED"
          && value.exitGrant.verified === false
          && value.exitGrant.expiresAt === null
          && string(value.operationId)))
      && isJsonRecord(value.position) && value.position.wethUnits === "0"
      && positiveDecimal(value.position.blockNumber) && blockHash(value.position.blockHash)
      && isJsonRecord(value.closure) && value.closure.confirmed === true
      && value.closure.zeroExposure === true && value.closure.allOperationsSettled === true
      && positiveDecimal(value.closure.finalizedBlock)
      && value.closure.finalizedBlock === value.position.blockNumber
      && blockHash(value.closure.finalizedBlockHash)
      && value.closure.finalizedBlockHash === value.position.blockHash
      && string(value.closure.receiptId)) {
    return { status: "confirmed_flat", code: value.code, message: value.message,
      positionClosure: "confirmed_flat", admissionStopped: true,
      submittedOperationMayStillSettle: false, unsettledOperationCount: 0,
      exitGrant: { verified: value.exitGrant.verified as boolean,
        expiresAt: value.exitGrant.expiresAt as number | null },
      position: { wethUnits: "0", blockNumber: value.position.blockNumber,
        blockHash: value.position.blockHash },
      closure: { confirmed: true, zeroExposure: true, allOperationsSettled: true,
        finalizedBlock: value.closure.finalizedBlock,
        finalizedBlockHash: value.closure.finalizedBlockHash,
        receiptId: value.closure.receiptId },
      ...(string(value.operationId) ? { operationId: value.operationId } : {}) };
  }

  if ([409, 423, 503].includes(httpStatus)) {
    const detail = isJsonRecord(value.detail) ? value.detail : value;
    if (detail.status === "blocked" && string(detail.code) && string(detail.message)
        && detail.positionClosure === "unconfirmed") {
      return { status: "blocked", code: detail.code, message: detail.message,
        positionClosure: "unconfirmed",
        submittedOperationMayStillSettle: detail.submittedOperationMayStillSettle === true,
        ...(string(detail.operationId) ? { operationId: detail.operationId } : {}) };
    }
  }
  return null;
}
