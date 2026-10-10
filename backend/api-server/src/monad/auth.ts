import { getAddress } from "ethers";
import { verifyParticleSessionToken } from "../../../lib/particleSession.js";
import { MonadApiError } from "./config.js";

export async function requireMera(context: any) {
  const header = context.req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new MonadApiError("A Mera mobile session is required.", 401, "unauthorized");
  const token = header.slice(7).trim();
  try {
    const payload = await verifyParticleSessionToken(token);
    const address = String(payload.walletAddress ?? "").toLowerCase();
    if (payload.tokenUse !== "mobile_access" || payload.authProvider !== "mera" || !payload.deviceId
        || !/^0x[a-f0-9]{40}$/.test(address) || payload.sub !== `mera:${address}`) throw new Error("Invalid Mera session.");
    return { token, ownerAddress: getAddress(address), subject: payload.sub, deviceId: payload.deviceId };
  } catch {
    throw new MonadApiError("Mera session is invalid or expired.", 401, "unauthorized");
  }
}

export function parseBody(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MonadApiError("Request body must be a JSON object.");
  }
  return value as Record<string, any>;
}

export function routeError(error: unknown) {
  if (error instanceof MonadApiError) return { body: { error: error.code === "approval_required" ? error.code : error.message,
    message: error.message, code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }) }, status: error.status };
  if (error && typeof error === "object" && "status" in error && "code" in error) {
    const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
    const status = Number(candidate.status); const code = String(candidate.code);
    if (Number.isInteger(status) && status >= 400 && status <= 599 && /^perpl_[a-z0-9_]+$/.test(code)) {
      const message = String(candidate.message ?? "Perpl Testnet request failed.");
      return { body: { error: message, message, code }, status };
    }
  }
  const message = error instanceof Error ? error.message : "Monad request failed.";
  const status = /not found/i.test(message) ? 404 : /identity|required|belongs to|owner/i.test(message) ? 403 : 409;
  return { body: { error: message.slice(0, 300), code: "monad_request_rejected" }, status };
}
