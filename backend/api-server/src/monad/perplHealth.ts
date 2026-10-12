import { Hono } from "hono";
import { booleanGate } from "./config.js";
import { operatorReadOnlyQuery } from "./convex.js";
import { finalizedBlockNumber, monadProvider } from "./provider.js";
import { PERPL_CHAIN_ID } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { evaluatePerplHealth } from "./perplHealthModel.js";

const gateDefinitions = [
  ["actions", "Reviewed Testnet actions", "MONAD_TESTNET_ACTIONS_ENABLED"],
  ["broadcast", "Transaction broadcast", "MONAD_TESTNET_BROADCAST_ENABLED"],
  ["operator", "Operator trades", "MONAD_TESTNET_OPERATOR_TRADES_ENABLED"],
  ["autonomy", "Perpl autonomy", "MONAD_TESTNET_PERPL_AUTONOMY_ENABLED"],
  ["direct", "Direct Perpl execution", "MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED"],
] as const;
const failure = (error: unknown, fallback: string) => String(error instanceof Error ? error.message : fallback)
  .replace(/https?:\/\/\S+/gi, "[endpoint]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180);

async function rpcReadiness() {
  let provider: any;
  try {
    provider = await monadProvider();
    const [network, finalizedBlock, latestBlock] = await Promise.all([
      provider.getNetwork(), finalizedBlockNumber(provider), provider.getBlockNumber(),
    ]);
    const chainId = Number(network.chainId);
    return { id: "rpc", name: "Monad Testnet RPC", state: chainId === PERPL_CHAIN_ID && finalizedBlock > 0 ? "healthy" : "unavailable",
      chainId, latestBlock, finalizedBlock, detail: chainId === PERPL_CHAIN_ID ? "Finalized checkpoint available." : `Unexpected chain ${chainId}.` };
  } catch (error) { return { id: "rpc", name: "Monad Testnet RPC", state: "unavailable", detail: failure(error, "RPC read failed.") }; }
  finally { try { await provider?.destroy(); } catch { /* read-only readiness result already captured */ } }
}

async function perplReadiness() {
  try {
    const context = await readPerplContext();
    const openMarkets = context.markets.filter((market) => market.isOpen).length;
    return { id: "perpl", name: "Perpl Testnet context", state: context.chainId === PERPL_CHAIN_ID && openMarkets > 0 ? "healthy" : "unavailable",
      chainId: context.chainId, openMarkets, detail: `${openMarkets} open markets · AUSD collateral context verified.` };
  } catch (error) { return { id: "perpl", name: "Perpl Testnet context", state: "unavailable", detail: failure(error, "Public context read failed.") }; }
}

export async function readPerplHealthSnapshot() {
  let snapshot: any = null; let convexError = "";
  try { snapshot = await operatorReadOnlyQuery("monadVenueHealth", "snapshot", {}); }
  catch (error) { convexError = failure(error, "Convex health query failed."); }
  const [rpc, perpl] = await Promise.all([rpcReadiness(), perplReadiness()]);
  const services = [
    { id: "api", name: "Hono API", state: "healthy", detail: "Health endpoint responding." },
    { id: "convex", name: "Local Convex", state: snapshot ? "healthy" : "unavailable",
      detail: snapshot ? "Read-only run snapshot loaded." : convexError || "Convex query unavailable." },
    rpc, perpl,
  ];
  const gates = gateDefinitions.map(([id, name, env]) => ({ id, name, enabled: booleanGate(env) }));
  return evaluatePerplHealth({ runs: snapshot?.runs ?? [], services, gates,
    coverage: { truncatedRuns: Boolean(snapshot?.truncatedRuns), totalCandidateCount: Number(snapshot?.totalCandidateCount ?? 0) } });
}

export function registerPerplHealthRoutes(app: Hono<any>) {
  app.get("/api/operator/perpl-health", async (context) => {
    const health = await readPerplHealthSnapshot();
    const unavailable = health.services.some((service) => service.state === "unavailable");
    return context.json(health, unavailable ? 503 : 200);
  });
}
