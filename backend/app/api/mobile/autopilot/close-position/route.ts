import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { isJsonRecord, parseManagedCloseReply } from "@/lib/managedCloseContract";

export const runtime = "nodejs";
export const maxDuration = 90;

function response(reply: NonNullable<ReturnType<typeof parseManagedCloseReply>>, status: number) {
  return NextResponse.json({ ...reply, error: reply.status === "blocked" ? reply.message : undefined },
    { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const body = await request.json().catch(() => null);
    if (!isJsonRecord(body) || Object.keys(body).some((key) => !["assignmentId", "idempotencyKey"].includes(key))
        || typeof body.assignmentId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(body.assignmentId)
        || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey)) {
      return NextResponse.json({ status: "blocked", code: "INVALID_CLOSE_REQUEST",
        error: "Close accepts only the exact managed assignment and a stable idempotency key.",
        positionClosure: "unconfirmed" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (typeof payload.sub !== "string" || !payload.sub) {
      return NextResponse.json({ status: "blocked", code: "OWNER_IDENTITY_UNAVAILABLE",
        error: "The authenticated Magic owner is unavailable.", positionClosure: "unconfirmed" },
      { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const client = mobileClient(token);
    const home = await client.query(mobileApi.getHome, {});
    if (typeof home?.managedPositionClosureUnconfirmed !== "boolean") {
      return NextResponse.json({ status: "blocked", code: "CLOSURE_STATUS_UNAVAILABLE",
        error: "Managed closure status is unavailable. Keep withdrawal blocked and retry after refreshing the account.",
        positionClosure: "unconfirmed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (home.assignmentId !== body.assignmentId) {
      return NextResponse.json({ status: "blocked", code: "CLOSE_ASSIGNMENT_MISMATCH",
        error: "The managed assignment changed. Refresh the account before requesting a close.",
        positionClosure: "unconfirmed" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (home.managedPositionClosureUnconfirmed !== true) {
      return NextResponse.json({ status: "blocked", code: "CLOSE_NOT_REQUIRED",
        error: "No unconfirmed managed position is available to close. Refresh the account before withdrawing.",
        positionClosure: home.managedPositionClosureUnconfirmed === false ? "confirmed_flat" : "unconfirmed" },
      { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (home.assignmentState !== "paused" || home.primaryAction === "stop") {
      return NextResponse.json({ status: "blocked", code: "STOP_REQUIRED",
        error: "Stop new managed entries before closing the position.",
        positionClosure: "unconfirmed" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const secret = process.env.WORKER_SHARED_SECRET;
    const backend = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
    if (!secret) return NextResponse.json({ status: "blocked", code: "CLOSE_SERVICE_UNAVAILABLE",
      error: "The managed close service is not configured. Position closure is not confirmed.",
      positionClosure: "unconfirmed" }, { status: 503, headers: { "Cache-Control": "no-store" } });

    let upstream: Response;
    try {
      upstream = await fetch(`${backend.replace(/\/$/, "")}/v1/finance/managed-program/close-position`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "X-Moeazi-Subject": payload.sub,
          "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: body.assignmentId, idempotencyKey: body.idempotencyKey }),
        cache: "no-store", signal: AbortSignal.timeout(85_000),
      });
    } catch {
      return NextResponse.json({ status: "pending", code: "CLOSE_REQUEST_UNCERTAIN",
        message: "The close request may still be processing. Retry with the same request; withdrawal remains blocked.",
        submittedOperationMayStillSettle: true,
        positionClosure: "unconfirmed" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    const payloadValue = await upstream.json().catch(() => null);
    const reply = parseManagedCloseReply(upstream.status, payloadValue);
    if (!reply) return NextResponse.json({ status: "blocked", code: "INVALID_CLOSE_RESPONSE",
      error: "The close service returned incomplete or inconsistent evidence. Position closure is not confirmed.",
      positionClosure: "unconfirmed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    if (reply.status !== "confirmed_flat") return response(reply, upstream.status);

    let refreshed;
    try { refreshed = await client.query(mobileApi.getHome, {}); } catch { refreshed = null; }
    if (refreshed?.assignmentId !== body.assignmentId) {
      return NextResponse.json({ status: "blocked", code: "CLOSE_ASSIGNMENT_CHANGED",
        error: "The close proof is complete, but the active managed assignment changed. Refresh before withdrawing.",
        positionClosure: "unconfirmed" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (refreshed?.managedPositionClosureUnconfirmed !== false) {
      return NextResponse.json({ status: "pending", code: "CLOSE_PROJECTION_NOT_VISIBLE",
        message: "Finalized close proof was received. Waiting for the trusted account projection to confirm it; withdrawal remains blocked.",
        operationId: reply.operationId, admissionStopped: true,
        submittedOperationMayStillSettle: false, positionClosure: "unconfirmed" },
      { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return response(reply, 200);
  } catch (error) { return mobileError(error); }
}
