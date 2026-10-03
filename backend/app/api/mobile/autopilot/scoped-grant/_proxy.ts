import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { mobileApi, mobileClient, requireMobileBearer, MobileAuthError } from "@/lib/mobileAuth";
import { scopedAllowanceReadiness } from "./allowanceReadiness";

const ROUTER = "0xe592427a0aece92de3edee1f18e0157c05861564";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const noStore = { "Cache-Control": "no-store" };
export type GrantContext = {
  contextAvailable: true; strategyAccountId: string; assignmentId: string; programVersionId: string;
  contentHash: string; policyHash: string; ownerAddress: string; venueAccountId: string;
  executionGrantId: string; expiresAt: number;
  bounds: { maxUsdcUnits: string; maxWethUnits: string; minWethOutUnits: string; minUsdcOutUnits: string };
};

export const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isHash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const isUnits = (value: unknown) => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);
const isPositiveUnits = (value: unknown) => isUnits(value) && BigInt(value as string) > 0n;
const isAddress = (value: unknown) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
const isText = (value: unknown) => typeof value === "string" && value.length > 0;

export function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export async function currentGrantContext(token: string): Promise<GrantContext | NextResponse> {
  const context = await mobileClient(token).query(mobileApi.getUniswapGrantContext, {});
  if (!isRecord(context) || context.contextAvailable !== true) {
    return response({ code: isRecord(context) ? context.code : "grant_context_unavailable",
      error: isRecord(context) && typeof context.blockingReason === "string"
        ? context.blockingReason : "The managed Uniswap grant is not ready." }, 409);
  }
  const bounds = context.bounds;
  if (!isText(context.strategyAccountId) || !isText(context.assignmentId) || !isText(context.programVersionId)
      || !isText(context.venueAccountId) || !isAddress(context.ownerAddress)
      || !isHash(context.policyHash) || !isHash(context.contentHash)
      || typeof context.executionGrantId !== "string" || !/^[-_a-zA-Z0-9]{8,128}$/.test(context.executionGrantId)
      || !Number.isSafeInteger(context.expiresAt) || !isRecord(bounds)
      || ![bounds.maxUsdcUnits, bounds.maxWethUnits, bounds.minWethOutUnits, bounds.minUsdcOutUnits].every(isPositiveUnits)) {
    return response({ code: "grant_context_invalid", error: "The current managed grant context failed validation." }, 409);
  }
  return context as GrantContext;
}

export function isGrantContext(value: GrantContext | NextResponse): value is GrantContext {
  return !(value instanceof NextResponse);
}

export async function parseJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return isRecord(body) ? body : null;
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function deriveScopedGrantId(contextGrantId: string, idempotencyKey: string) {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return null;
  const binding = JSON.stringify([contextGrantId, idempotencyKey]);
  return `managed-${createHash("sha256").update(binding).digest("hex").slice(0, 48)}`;
}

function actualGrantId(context: GrantContext, request: Request) {
  return deriveScopedGrantId(context.executionGrantId, request.headers.get("Idempotency-Key") ?? "");
}

export async function sidecar(path: string, body: Record<string, unknown> | undefined, method: "GET" | "POST" = "POST") {
  const secret = process.env.WORKER_SHARED_SECRET;
  const base = process.env.EXECUTION_SIDECAR_URL;
  if (!secret || !base) return response({ code: "unavailable", error: "Scoped Uniswap grant service is not configured." }, 503);
  try {
    const result = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method, headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    const payload = await result.json().catch(() => null);
    if (!isRecord(payload)) return response({ code: "invalid_sidecar_response", error: "Scoped grant service returned an invalid response." }, 502);
    return { status: result.status, payload };
  } catch {
    return response({ code: "unavailable", error: "Scoped Uniswap grant service could not be reached." }, 503);
  }
}

export async function requireDurableSidecar() {
  const check = await sidecar("/internal/uniswap/scoped-readiness", undefined, "GET");
  if (check instanceof NextResponse) return check;
  if (check.status < 200 || check.status >= 300 || check.payload.storage?.ready !== true) {
    return response({ code: "scoped_storage_unavailable",
      error: "Durable scoped-grant storage is not ready; no owner approval has been prepared." }, 503);
  }
  return null;
}

export function safeSidecarError(result: { status: number; payload: Record<string, any> }) {
  const status = [400, 409, 423, 503].includes(result.status) ? result.status : 502;
  const message = typeof result.payload.error === "string" ? result.payload.error.slice(0, 300)
    : "Scoped grant request was rejected.";
  return response({ code: "scoped_grant_rejected", error: message }, status);
}

export function validPreparedGrant(row: any, context: GrantContext, scope: "buy" | "exit") {
  const expectedInput = scope === "buy" ? USDC : WETH;
  const expectedOutput = scope === "buy" ? WETH : USDC;
  const expectedMax = scope === "buy" ? context.bounds.maxUsdcUnits : context.bounds.maxWethUnits;
  const expectedMin = scope === "buy" ? context.bounds.minWethOutUnits : context.bounds.minUsdcOutUnits;
  const review = row?.review, approval = row?.ownerApproval;
  return isRecord(row) && row.grantId === context.executionGrantId && row.scope === scope
    && String(row.owner).toLowerCase() === context.ownerAddress.toLowerCase()
    && row.frozenPolicyHash === `0x${context.policyHash}`
    && ["awaiting-owner", "active"].includes(row.state) && /^0x[0-9a-f]{64}$/.test(row.policyHash ?? "")
    && row.expiresAt === context.expiresAt && isAddress(row.sessionAddress)
    && isRecord(approval) && isRecord(approval.domain) && isRecord(approval.types)
    && approval.primaryType === "Enable" && isRecord(approval.message)
    && (approval.domain.chainId === 42161 || approval.domain.chainId === "42161")
    && isRecord(review) && review.chainId === 42161
    && String(review.router).toLowerCase() === ROUTER && String(review.tokenIn).toLowerCase() === expectedInput
    && String(review.tokenOut).toLowerCase() === expectedOutput && review.feeTier === 3000
    && String(review.recipient).toLowerCase() === context.ownerAddress.toLowerCase()
    && review.maximumInputUnits === expectedMax && review.minimumOutputUnits === expectedMin
    && review.latestDeadline === context.expiresAt && review.maxCalls === 1 && review.callValueWei === "0";
}

export function validAllowanceCall(call: any, token: string, expectedUnits: string) {
  if (!isRecord(call) || String(call.to).toLowerCase() !== token || String(call.token).toLowerCase() !== token
      || !(call.value === "0" || call.value === 0) || call.amount !== expectedUnits
      || typeof call.data !== "string" || !/^0x095ea7b3[0-9a-fA-F]{128}$/.test(call.data)) return false;
  const spender = `0x${call.data.slice(34, 74)}`.toLowerCase();
  const amount = BigInt(`0x${call.data.slice(74)}`).toString();
  return spender === ROUTER && amount === expectedUnits;
}

function validInitialAllowance(allowance: any, owner: string) {
  return isRecord(allowance) && allowance.owner?.toLowerCase() === owner.toLowerCase()
    && isUnits(allowance.blockNumber) && /^0x[0-9a-fA-F]{64}$/.test(allowance.blockHash ?? "")
    && [allowance.usdcBalanceUnits, allowance.usdcAllowanceUnits,
      allowance.wethBalanceUnits, allowance.wethAllowanceUnits].every(isUnits)
    && typeof allowance.buyReady === "boolean" && typeof allowance.exitAllowanceReady === "boolean";
}

export async function prepareGrant(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const body = await parseJsonObject(request);
    if (!body || !hasOnlyKeys(body, [])) return response({ error: "Grant bounds are derived from the managed program and cannot be supplied by the client." }, 400);
    const contextOrError = await currentGrantContext(token);
    if (!isGrantContext(contextOrError)) return contextOrError;
    const grantId = actualGrantId(contextOrError, request);
    if (!grantId) return response({ error: "A stable Idempotency-Key is required to prepare this one-use grant." }, 400);
    const storageError = await requireDurableSidecar();
    if (storageError) return storageError;
    const result = await sidecar("/internal/uniswap/scoped-grant/prepare", {
      grantId, owner: contextOrError.ownerAddress,
      strategyAccountId: contextOrError.strategyAccountId, assignmentId: contextOrError.assignmentId,
      frozenPolicyHash: `0x${contextOrError.policyHash}`, expiresAt: contextOrError.expiresAt,
      ...contextOrError.bounds,
    });
    if (result instanceof NextResponse) return result;
    if (result.status < 200 || result.status >= 300) return safeSidecarError(result);
    const grants = result.payload.grants;
    const calls = result.payload.ownerAllowanceCalls;
    const allowance = result.payload.allowance;
    const grantContext = { ...contextOrError, executionGrantId: grantId };
    if (!Array.isArray(grants) || grants.length !== 2
        || !validPreparedGrant(grants.find((row: any) => row?.scope === "buy"), grantContext, "buy")
        || !validPreparedGrant(grants.find((row: any) => row?.scope === "exit"), grantContext, "exit")
        || !Array.isArray(calls) || calls.length !== 2
        || !validAllowanceCall(calls.find((call: any) => String(call?.token).toLowerCase() === USDC), USDC, contextOrError.bounds.maxUsdcUnits)
        || !validAllowanceCall(calls.find((call: any) => String(call?.token).toLowerCase() === WETH), WETH, contextOrError.bounds.maxWethUnits)
        || !validInitialAllowance(allowance, contextOrError.ownerAddress)) {
      return response({ code: "invalid_sidecar_response", error: "Scoped grant response did not match the exact managed policy bounds." }, 502);
    }
    return response({ grants, ownerAllowanceCalls: calls, allowance, grantId,
      ownerActionsRequired: true, activationReceiptReady: false, liveTradingEnabled: false });
  } catch (error) {
    if (error instanceof MobileAuthError) return response({ error: error.message }, error.status);
    return response({ code: "unavailable", error: "The scoped Uniswap grant could not be prepared." }, 503);
  }
}

export async function activateGrant(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const body = await parseJsonObject(request);
    if (!body || !hasOnlyKeys(body, ["scope", "signature"]) || !["buy", "exit"].includes(String(body.scope))
        || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) {
      return response({ error: "A buy or exit scope and its Magic owner typed-data signature are required." }, 400);
    }
    const contextOrError = await currentGrantContext(token);
    if (!isGrantContext(contextOrError)) return contextOrError;
    const grantId = actualGrantId(contextOrError, request);
    if (!grantId) return response({ error: "The Idempotency-Key used to prepare this grant is required." }, 400);
    const storageError = await requireDurableSidecar();
    if (storageError) return storageError;
    const result = await sidecar("/internal/uniswap/scoped-grant/activate", {
      grantId, scope: body.scope, signature: body.signature,
    });
    if (result instanceof NextResponse) return result;
    if (result.status < 200 || result.status >= 300) return safeSidecarError(result);
    const grant = result.payload;
    if (!validPreparedGrant(grant, { ...contextOrError, executionGrantId: grantId }, body.scope as "buy" | "exit") || grant.state !== "active") {
      return response({ code: "invalid_sidecar_response", error: "Owner signature activation could not be confirmed for this exact scope." }, 502);
    }
    return response({ grant, activationReceiptReady: false, liveTradingEnabled: false,
      nextStep: "Re-read finalized Arbitrum allowance after any owner approval calls have been submitted and confirmed." });
  } catch (error) {
    if (error instanceof MobileAuthError) return response({ error: error.message }, error.status);
    return response({ code: "unavailable", error: "The scoped owner signature could not be activated." }, 503);
  }
}

export async function readGrantAllowance(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const body = await parseJsonObject(request);
    if (!body || !hasOnlyKeys(body, ["scope"]) || !["buy", "exit"].includes(String(body.scope))) {
      return response({ error: "A buy or exit scope is required." }, 400);
    }
    const contextOrError = await currentGrantContext(token);
    if (!isGrantContext(contextOrError)) return contextOrError;
    const grantId = actualGrantId(contextOrError, request);
    if (!grantId) return response({ error: "The Idempotency-Key used to prepare this grant is required." }, 400);
    const result = await sidecar("/internal/uniswap/scoped-grant/allowance", {
      grantId, scope: body.scope, owner: contextOrError.ownerAddress,
    });
    if (result instanceof NextResponse) return result;
    if (result.status < 200 || result.status >= 300) return safeSidecarError(result);
    const allowance = result.payload;
    const expectedUnits = body.scope === "buy" ? contextOrError.bounds.maxUsdcUnits : contextOrError.bounds.maxWethUnits;
    const expectedToken = body.scope === "buy" ? USDC : WETH;
    if (allowance.grantId !== grantId || allowance.scope !== body.scope
        || allowance.owner?.toLowerCase() !== contextOrError.ownerAddress.toLowerCase()
        || allowance.token?.toLowerCase() !== expectedToken || allowance.requiredUnits !== expectedUnits
        || !isUnits(allowance.blockNumber) || !/^0x[0-9a-fA-F]{64}$/.test(allowance.blockHash ?? "")
        || !isUnits(allowance.balanceUnits) || !isUnits(allowance.allowanceUnits)) {
      return response({ code: "invalid_sidecar_response", error: "Allowance result did not match the exact managed grant." }, 502);
    }
    const readiness = scopedAllowanceReadiness(allowance, { grantId, owner: contextOrError.ownerAddress,
      scope: body.scope as "buy" | "exit", requiredUnits: expectedUnits });
    if (!readiness) return response({ code: "invalid_sidecar_response",
      error: "Allowance readiness fields did not match the exact finalized balance and authorization." }, 502);
    return response({ ...allowance, ...readiness, activationReceiptReady: false, liveTradingEnabled: false });
  } catch (error) {
    if (error instanceof MobileAuthError) return response({ error: error.message }, error.status);
    return response({ code: "unavailable", error: "The finalized allowance could not be read." }, 503);
  }
}

export function grantContextResponse(context: unknown) {
  if (!isRecord(context) || context.contextAvailable !== true) {
    return response({ code: isRecord(context) ? context.code : "grant_context_unavailable",
      error: isRecord(context) && typeof context.blockingReason === "string"
        ? context.blockingReason : "The managed Uniswap grant is not ready." }, 409);
  }
  return response(context);
}
