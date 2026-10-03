import {NextResponse} from "next/server";
import {MobileAuthError, mobileApi, mobileClient, requireMobileBearer} from "./mobileAuth";
import {mobileClientIp} from "./mobileClientIp";

const actions = new Set(["catalog", "quote", "purchase-create", "purchase-get", "pending", "webhook", "gas-readiness", "execution-readiness", "activation-prepare", "activation-authorize", "withdrawal-prepare", "sponsored-submit", "sponsored-status"]);
export async function connectorProxy(request: Request, action: string, extra: Record<string, unknown> = {}, publicWebhook = false) {
  try {
    if (!actions.has(action)) return NextResponse.json({error: "Unsupported operation."}, {status: 404});
    const auth = publicWebhook ? null : await requireMobileBearer(request);
    const identity = auth ? {subject: auth.payload.sub, owner: auth.payload.walletAddress} : undefined;
    if (action === "withdrawal-prepare" && auth) {
      const home = await mobileClient(auth.token).query(mobileApi.getHome, {});
      if (typeof home?.managedPositionClosureUnconfirmed !== "boolean") {
        return NextResponse.json({code: "MANAGED_CLOSURE_STATUS_UNAVAILABLE",
          error: "Managed position closure status is unavailable. Withdrawal preparation is blocked until it can be verified."},
        {status: 503, headers: {"cache-control": "no-store"}});
      }
      if (home?.managedPositionClosureUnconfirmed === true) {
        return NextResponse.json({code: "MANAGED_CLOSURE_UNCONFIRMED",
          error: "Managed position closure and submitted-operation settlement are not confirmed. Withdrawal remains blocked until native close reconciliation confirms a flat position."},
        {status: 409, headers: {"cache-control": "no-store"}});
      }
    }
    const secret = process.env.WORKER_SHARED_SECRET;
    const sidecar = process.env.EXECUTION_SIDECAR_URL;
    if (!secret || !sidecar) return NextResponse.json({code: "UNAVAILABLE", error: "This service has not been configured yet."}, {status: 503});
    const input = request.method === "POST" && !publicWebhook ? await request.json() : undefined;
    const clientIp = mobileClientIp(request, process.env);
    const response = await fetch(`${sidecar.replace(/\/$/, "")}/internal/mobile/${action}`, {method: "POST",
      headers: {authorization: `Bearer ${secret}`, "content-type": "application/json"}, cache: "no-store",
      body: JSON.stringify({...extra, identity, input, clientIp}), signal: AbortSignal.timeout(30_000)});
    const result = await response.json();
    return NextResponse.json(result, {status: response.status, headers: {"cache-control": "no-store"}});
  } catch (error) {
    if (error instanceof MobileAuthError) return NextResponse.json({error: error.message}, {status: error.status});
    return NextResponse.json({code: "UNAVAILABLE", error: action === "quote" ? "The estimate could not be loaded. Retry or check pricing in checkout." : "Connection interrupted. Check the pending operation before trying again."}, {status: 503});
  }
}
