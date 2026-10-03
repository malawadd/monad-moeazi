import { timingSafeEqual } from "node:crypto";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";

export type OperatorBridgeIdentity = { subject: typeof LOCAL_OPERATOR_SUBJECT };
type BridgeContext = { req: { header(name: string): string | undefined } };

function failure(status: 401 | 503, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Validate the private console-to-API hop and derive identity only from server policy. */
export function requireOperatorBridge(context: BridgeContext): OperatorBridgeIdentity | Response {
  const configured = process.env.OPERATOR_CONSOLE_BRIDGE_SECRET;
  if (!configured || configured.length < 40) {
    return failure(503, "The local operator bridge is not configured.");
  }
  const supplied = context.req.header("x-moeazi-operator-bridge") ?? "";
  const expectedBytes = Buffer.from(configured, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return failure(401, "Operator console authentication is required.");
  }
  return { subject: LOCAL_OPERATOR_SUBJECT };
}

