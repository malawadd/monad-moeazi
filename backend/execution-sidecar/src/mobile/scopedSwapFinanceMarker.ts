import type { Address, Hex } from "viem";
import type { SwapScope } from "./sessionSignerVault.js";

export type FinanceMarkerRequest = {
  strategyAccountId: string; intentId: string; clientId: string; grantId: string;
  assignmentId: string; normalizedPayloadHash: string;
};
export type VerifiedUniswapFinanceMarker = {
  attemptId: string; reservationId: string; intentId: string; clientId: string; grantId: string; assignmentId: string;
  normalizedPayloadHash: string; snapshotHash: string; strategyAccountId: string;
  sourceAccountId: string; policyVersion: string; policyHash: string; frozenProgramPolicyHash: Hex; authorityEpoch: number;
  instrumentVersionId: string; venueId: string; nativeInstrumentId: string; productKind: string;
  baseAssetUnitId: string; quoteAssetUnitId: string; baseDecimals: number; quoteDecimals: number;
  quantityUnits: string; notionalUnits: string; action: string; calculationReceiptHash: string;
};

export interface UniswapFinanceMarkerReader {
  verify(input: FinanceMarkerRequest): Promise<VerifiedUniswapFinanceMarker>;
}

/** Calls the protected finance read-only verifier; user input cannot supply its result. */
export class HttpUniswapFinanceMarkerReader implements UniswapFinanceMarkerReader {
  constructor(private readonly baseUrl: string, private readonly workerSecret: string,
    private readonly request: typeof fetch = fetch) {}

  async verify(input: FinanceMarkerRequest) {
    if (!this.baseUrl || !this.workerSecret) throw new Error("Finance authority verifier is not configured");
    const response = await this.request(`${this.baseUrl.replace(/\/$/, "")}/internal/finance/uniswap/verify-submission`, {
      method: "POST", headers: { authorization: `Bearer ${this.workerSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ strategyAccountId: input.strategyAccountId, intentId: input.intentId,
        clientId: input.clientId, grantId: input.grantId, assignmentId: input.assignmentId,
        normalizedPayloadHash: input.normalizedPayloadHash }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error("No current durable Uniswap finance marker matches this operation");
    const value = await response.json() as Partial<VerifiedUniswapFinanceMarker>;
    const required = ["attemptId", "reservationId", "intentId", "clientId", "grantId", "assignmentId",
      "normalizedPayloadHash", "snapshotHash", "strategyAccountId", "sourceAccountId", "policyVersion", "policyHash",
      "instrumentVersionId", "venueId",
      "nativeInstrumentId", "productKind", "baseAssetUnitId", "quoteAssetUnitId", "quantityUnits", "notionalUnits",
      "action", "calculationReceiptHash"] as const;
    if (required.some(key => typeof value[key] !== "string" || !value[key])
      || typeof value.authorityEpoch !== "number" || !Number.isSafeInteger(value.authorityEpoch)
      || typeof value.baseDecimals !== "number" || typeof value.quoteDecimals !== "number") {
      throw new Error("Finance verifier returned a malformed marker");
    }
    if (typeof value.frozenProgramPolicyHash !== "string" || !/^0x[0-9a-f]{64}$/.test(value.frozenProgramPolicyHash)) {
      throw new Error("Finance verifier returned a malformed frozen program policy hash");
    }
    return value as VerifiedUniswapFinanceMarker;
  }
}

export function assertFinanceMarkerMatches(input: {
  marker: VerifiedUniswapFinanceMarker; owner: Address; scope: SwapScope; strategyAccountId: string;
  intentId: string; clientId: string; grantId: string; assignmentId: string;
  payloadHash: string; frozenProgramPolicyHash: Hex;
  amountIn: bigint; amountOutMinimum: bigint;
}) {
  const { marker, owner, scope } = input;
  const isBuy = scope === "buy";
  const expectedAction = isBuy ? "spot_buy" : "spot_sell";
  const quantity = BigInt(marker.quantityUnits), notional = BigInt(marker.notionalUnits);
  const expectedSource = `arbitrum:42161:wallet:${owner.toLowerCase()}`;
  const frozenHashMatches = /^0x[0-9a-f]{64}$/.test(marker.frozenProgramPolicyHash)
    && marker.frozenProgramPolicyHash.toLowerCase() === input.frozenProgramPolicyHash.toLowerCase();
  if (marker.strategyAccountId !== input.strategyAccountId || marker.sourceAccountId !== expectedSource
    || marker.intentId !== input.intentId || marker.clientId !== input.clientId
    || marker.grantId !== input.grantId || marker.assignmentId !== input.assignmentId
    || marker.normalizedPayloadHash !== input.payloadHash
    || !frozenHashMatches
    || marker.venueId !== "uniswap" || marker.productKind !== "spot"
    || marker.baseAssetUnitId !== "arbitrum:42161:erc20:0x82af49447d8a07e3bd95bd0d56f35241523fbab1:18:v1"
    || marker.quoteAssetUnitId !== "arbitrum:42161:erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831:6:v1"
    || marker.baseDecimals !== 18 || marker.quoteDecimals !== 6 || marker.action !== expectedAction
    || !marker.instrumentVersionId || !marker.nativeInstrumentId || quantity <= 0n || notional <= 0n) {
    throw new Error("Finance marker account, instrument, or action differs from the scoped swap");
  }
  if (isBuy ? (input.amountIn !== notional || input.amountOutMinimum !== quantity)
    : (input.amountIn !== quantity || input.amountOutMinimum !== notional)) {
    throw new Error("Finance marker sizing differs from the exact swap calldata");
  }
}
