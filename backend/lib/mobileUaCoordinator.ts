export const MOBILE_UA_SCHEMA_VERSION = "2026-09-01" as const;
export const ARBITRUM_CHAIN_ID = 42161 as const;

export type UaPrepareInput = { intent: unknown; idempotencyKey: string; owner: string };
export type UaSubmitInput = { operationId: string; signatures: unknown; owner: string };

export class UaCoordinatorError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503) { super(message); }
}

export interface UniversalAccountAdapter {
  prepare(input: UaPrepareInput): Promise<unknown>;
  submit(input: UaSubmitInput): Promise<unknown>;
}

class CertificationGatedUniversalAccountAdapter implements UniversalAccountAdapter {
  async prepare(input: UaPrepareInput) {
    if (!/^mobile:[A-Za-z0-9:_-]{16,160}$/.test(input.idempotencyKey)) {
      throw new UaCoordinatorError("A stable mobile idempotency key is required.", "INVALID_IDEMPOTENCY_KEY", 400);
    }
    if (!input.intent || typeof input.intent !== "object") {
      throw new UaCoordinatorError("A structured operation intent is required.", "INVALID_INTENT", 400);
    }
    throw new UaCoordinatorError(
      "Mobile Universal Account preparation is disabled until private signing and venue certification are complete.",
      "MOBILE_UA_NOT_CERTIFIED",
    );
  }
  async submit(input: UaSubmitInput) {
    void input;
    throw new UaCoordinatorError(
      "Mobile Universal Account submission is disabled until private signing and venue certification are complete.",
      "MOBILE_UA_NOT_CERTIFIED",
    );
  }
}

export const universalAccountAdapter: UniversalAccountAdapter = new CertificationGatedUniversalAccountAdapter();
