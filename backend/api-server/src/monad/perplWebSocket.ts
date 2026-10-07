import { randomBytes } from "node:crypto";
import { PERPL_CHAIN_ID, PerplApiError } from "./perplConfig.js";
import { perplEd25519Sign } from "./perplSigning.js";
import type { PerplCredentials } from "./perplApi.js";

type SocketFactory = (url: string) => any;
type SocketResult = { admission: any; updates: any[] };

/** One authenticated trading socket per request; any missing acknowledgement is uncertain, never retried here. */
export async function submitPerplWebSocketOrder(order: Record<string, unknown>, credentials: PerplCredentials,
  options: { socketFactory?: SocketFactory; timeoutMs?: number; settleMs?: number; now?: () => number } = {}): Promise<SocketResult> {
  const factory = options.socketFactory ?? defaultSocketFactory;
  const now = options.now ?? Date.now;
  const socket = factory(tradingSocketUrl());
  const correlationId = Math.max(1, randomBytes(4).readUInt32BE(0));
  const requestId = Number(order.rq);
  return await new Promise<SocketResult>((resolve, reject) => {
    let sent = false; let admission: any; let settled = false;
    const updates: any[] = [];
    const timer = setTimeout(() => finish(new PerplApiError("Perpl WebSocket response was uncertain; reconcile this request ID before retrying.", 504, "perpl_response_uncertain", true)), options.timeoutMs ?? 8_000);
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error); else resolve({ admission, updates });
    };
    socket.addEventListener("open", () => {
      const timestamp = String(now()); const nonce = randomBytes(16).toString("base64url");
      const canonical = [PERPL_CHAIN_ID, "trading-ws-signin", timestamp, nonce].join("\n");
      const signature = perplEd25519Sign(Buffer.from(canonical), credentials.privateKeyHex).toString("base64url");
      socket.send(JSON.stringify({ mt: 29, chain_id: PERPL_CHAIN_ID, api_key: credentials.apiKey,
        timestamp, nonce, signature }));
    }, { once: true });
    socket.addEventListener("message", (event: any) => {
      let frame: any;
      try { frame = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")); }
      catch { return; }
      if (frame.mt === 19 && !sent) {
        sent = true;
        socket.send(JSON.stringify({ ...order, mt: 22, sn: correlationId }));
        return;
      }
      if (frame.mt === 3 && Number(frame.cid) === correlationId) {
        admission = frame;
        if (Number(frame.status?.code) !== 0) {
          const code = Number(frame.status?.code);
          finish(new PerplApiError(code === 429 ? "Perpl Testnet rate limit was reached." : "Perpl rejected the order request.",
            code || 502, code === 429 ? "perpl_rate_limited" : "perpl_order_rejected", code === 429 || code >= 500));
          return;
        }
        setTimeout(() => finish(), options.settleMs ?? 750);
        return;
      }
      if (frame.mt === 24) {
        const rows = Array.isArray(frame.d) ? frame.d : frame.d ? [frame.d] : [];
        for (const row of rows) if (Number(row.rq) === requestId) updates.push(row);
      }
    });
    socket.addEventListener("error", () => finish(new PerplApiError(
      "Perpl WebSocket connection failed; reconcile this request ID before retrying.", 503, "perpl_ws_unavailable", true)));
    socket.addEventListener("close", (event: any) => {
      if (!settled && !admission) finish(new PerplApiError("Perpl WebSocket closed before the order acknowledgement; reconcile before retrying.",
        event?.code === 3401 ? 401 : 503, event?.code === 3401 ? "perpl_key_rejected" : "perpl_response_uncertain", true));
    });
  });
}

function defaultSocketFactory(url: string) {
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (!WebSocketCtor) throw new PerplApiError("This Node runtime does not provide WebSocket support.", 503, "perpl_ws_unavailable");
  return new WebSocketCtor(url);
}

function tradingSocketUrl() {
  const configured = new URL(process.env.PERPL_TESTNET_API_URL?.trim() || "https://testnet.perpl.xyz/api");
  if (configured.protocol !== "https:" || configured.hostname !== "testnet.perpl.xyz") {
    throw new PerplApiError("Perpl trading WebSocket must use the pinned Testnet host.", 503, "perpl_network_rejected");
  }
  return `wss://${configured.hostname}/ws/v1/trading`;
}
