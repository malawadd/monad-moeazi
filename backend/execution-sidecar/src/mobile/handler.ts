import type {IncomingMessage, ServerResponse} from "node:http";
import {createPublicClient, http} from "viem";
import {arbitrum} from "viem/chains";
import {ConnectorError, VERSION, type OperationRecord} from "./contracts.js";
import {createRegistries, fundingCatalog} from "./configuration.js";
import {ConvexOperationStore} from "./store.js";
import {PurchaseService, publicPurchase} from "./purchases.js";
import {SponsorshipService} from "./sponsorship.js";
import {ConnectorReconciler} from "./reconciliation.js";
import {refreshSettledWallet} from "./balances.js";
import {QuoteService} from "./quotes.js";
import {RedisQuoteStore} from "./quoteStore.js";
import {QuoteError} from "./quoteContracts.js";
import {readExecutionReadiness} from "./executionReadiness.js";

const env = process.env;
const client = createPublicClient({chain: arbitrum, transport: http(env.ARBITRUM_RPC_URL || "http://127.0.0.1:1", {retryCount: 0, timeout: 10_000})});
const store = new ConvexOperationStore(env.CONVEX_SITE_URL ?? "", env.WORKER_SHARED_SECRET ?? "");
const registries = createRegistries(env, client);
const quotes = new QuoteService(registries, env, new RedisQuoteStore(env.REDIS_URL || "redis://127.0.0.1:1"));
const purchases = new PurchaseService(store, registries, env, client, quotes);
const sponsorship = new SponsorshipService(store, registries, env, client);
const reconciler = new ConnectorReconciler(store, registries, client, purchases);

async function dispatch(operationId: string) {
  if (!env.AGENT_SERVICE_URL || !env.WORKER_SHARED_SECRET) return;
  await fetch(`${env.AGENT_SERVICE_URL.replace(/\/$/, "")}/v1/mobile-connectors/reconcile`, {method: "POST",
    headers: {"content-type": "application/json", authorization: `Bearer ${env.WORKER_SHARED_SECRET}`},
    body: JSON.stringify({operation_id: operationId}), signal: AbortSignal.timeout(4000)}).catch(() => undefined);
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {"content-type": "application/json", "cache-control": "no-store"}); res.end(JSON.stringify(value));
}
async function read(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65_536) throw new ConnectorError("INVALID", "Request is too large.", 413); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { throw new ConnectorError("INVALID", "Invalid request.", 400); }
}
export async function handleMobileConnector(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method !== "POST") throw new ConnectorError("INVALID", "Method not allowed.", 405);
    const body = await read(req), action = req.url?.slice("/internal/mobile/".length);
    if (action === "catalog") return json(res, 200, fundingCatalog(registries, env));
    if (action === "reconcile" || action === "attention") {
      const row = await store.command<OperationRecord | null>("mobileConnectorLoad", {operationId: body.operationId});
      if (!row) throw new ConnectorError("INVALID", "Operation not found.", 404);
      if (action === "attention") { const updated = await store.transition(row.subject, row.operationId, ["creating", "checkout_ready", "processing", "delivery_pending", "submitting", "submitted", "uncertain", "confirming"], {status: "needs_attention"}); return json(res, 200, {status: updated.status}); }
      const status = await reconciler.reconcile(row);
      const current = await store.command<OperationRecord>("mobileConnectorLoad", {operationId: row.operationId});
      if (["completed", "received"].includes(status)) await refreshSettledWallet(client, store, current);
      return json(res, 200, {status, history: {operationId: current.operationId, kind: current.kind, status: current.status, providerPins: JSON.parse(current.providerPinsJson), observedAt: current.updatedAt}});
    }
    if (action === "webhook") {
      const id = String(body.providerId);
      const operationId = await purchases.webhook(id, String(body.rawBody), body.headers ?? {}, `/api/mobile/funding/webhooks/${id}`);
      await dispatch(operationId); return json(res, 200, {accepted: true});
    }
    const subject = body.identity?.subject, owner = body.identity?.owner;
    if (typeof subject !== "string" || typeof owner !== "string" || subject !== `magic:${owner.toLowerCase()}`) throw new ConnectorError("INVALID", "Authenticated Magic identity is required.", 403);
    if (action === "quote") return json(res, 200, await quotes.estimate(subject, body.input ?? {}, body.clientIp));
    if (action === "purchase-create") {
      const result = await purchases.create(subject, owner, body.input ?? {}, body.clientIp);
      await dispatch(result.purchaseId); return json(res, 200, result);
    }
    if (action === "purchase-get") { const result = await purchases.get(subject, String(body.operationId)); if (!["received", "failed", "cancelled"].includes(result.status)) await dispatch(result.purchaseId); return json(res, 200, result); }
    if (action === "pending") {
      const rows = await store.command<OperationRecord[]>("mobileConnectorPending", {subject});
      return json(res, 200, rows.filter(row => row.kind === "purchase").map(publicPurchase));
    }
    if (action === "gas-readiness") return json(res, 200, await sponsorship.readiness(subject, owner));
    if (action === "execution-readiness") return json(res, 200, await readExecutionReadiness(client, owner));
    if (action === "activation-prepare" || action === "withdrawal-prepare") return json(res, 200, await sponsorship.prepare(subject, owner, action === "activation-prepare" ? "activation" : "withdrawal", body.input ?? {}));
    if (action === "activation-authorize") {
      const row = await store.find(subject, String(body.input?.operationId));
      if (!row || row.kind !== "activation") throw new ConnectorError("INVALID", "Activation not found.", 404);
      if (row.status !== "authorization_required") return json(res, 200, JSON.parse(row.payloadJson));
      return json(res, 200, await sponsorship.finishPreparation(row, body.input.authorization));
    }
    if (action === "sponsored-submit") { const result = await sponsorship.submit(subject, owner, body.input); await dispatch(result.operationId); return json(res, 200, result); }
    if (action === "sponsored-status") {
      let row = await store.find(subject, String(body.operationId));
      if (!row || row.kind === "purchase") throw new ConnectorError("INVALID", "Operation not found.", 404);
      const expiry = Math.min(row.expiresAt, JSON.parse(row.payloadJson).expiresAt ?? row.expiresAt);
      if (["prepared", "authorization_required"].includes(row.status) && expiry <= Date.now()) row = await store.transition(subject, row.operationId, ["prepared", "authorization_required"], {status: "expired"});
      if (!["completed", "failed", "cancelled", "expired", "prepared", "authorization_required"].includes(row.status)) await dispatch(row.operationId);
      const payload = JSON.parse(row.payloadJson);
      return json(res, 200, {schemaVersion: VERSION, operationId: row.operationId, kind: row.kind, status: row.status, transactionHash: row.transactionHash, withdrawal: payload.withdrawal, updatedAt: row.updatedAt});
    }
    throw new ConnectorError("INVALID", "Unknown connector action.", 404);
  } catch (error) {
    if (error instanceof QuoteError) return json(res, error.code === "EXPIRED" ? 409 : 400, {code: error.code, error: error.message, ...error.bounds});
    const normalized = error instanceof ConnectorError ? error : new ConnectorError("UNAVAILABLE", "This service is temporarily unavailable. Retry or check the pending operation.");
    json(res, normalized.status, {code: normalized.code, error: normalized.message});
  }
}
