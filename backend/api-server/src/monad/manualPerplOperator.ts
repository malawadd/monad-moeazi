import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "@/lib/operatorIdentity";
import { booleanGate, MonadApiError } from "./config.js";
import { finalizedBlockNumber, monadProvider, requireContractCode } from "./provider.js";
import { PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE, PerplApiError } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { MANUAL_PERPL_FACTORY, manualPerplGateState, setManualPerplGateEnabled } from "./manualPerplShared.js";

const safeDependencyError = (error: unknown, fallback: string) => error instanceof MonadApiError
  ? error.message : error instanceof PerplApiError ? error.message : fallback;

export async function readManualPerplOperatorStatus() {
  const gate = manualPerplGateState();
  const actionsGate = booleanGate("MONAD_TESTNET_ACTIONS_ENABLED");
  const broadcastGate = booleanGate("MONAD_TESTNET_BROADCAST_ENABLED");
  const autonomyGate = booleanGate("MONAD_TESTNET_PERPL_AUTONOMY_ENABLED");
  let provider: any;
  const rpc: Record<string, any> = { ready: false, chainId: null, latestBlock: null, finalizedBlock: null, error: null };
  const factory: Record<string, any> = { ready: false, address: MANUAL_PERPL_FACTORY, error: null };
  const exchange: Record<string, any> = { ready: false, contextReady: false, contractsReady: false,
    chainId: null, exchangeAddress: PERPL_TESTNET_EXCHANGE, collateralAddress: PERPL_TESTNET_AUSD,
    marketCount: 0, openMarketCount: 0, error: null };
  try {
    provider = await monadProvider();
    const [network, latestBlock, finalizedBlock] = await Promise.all([
      provider.getNetwork(), provider.getBlockNumber(), finalizedBlockNumber(provider),
    ]);
    rpc.chainId = Number(network.chainId);
    rpc.latestBlock = latestBlock;
    rpc.finalizedBlock = finalizedBlock;
    rpc.ready = rpc.chainId === PERPL_CHAIN_ID && finalizedBlock > 0;
    if (!rpc.ready) rpc.error = "Monad Testnet RPC has no finalized checkpoint.";
  } catch (error) { rpc.error = safeDependencyError(error, "Monad Testnet RPC is unavailable."); }
  if (provider) {
    try {
      await requireContractCode(provider, MANUAL_PERPL_FACTORY, "Manual Perpl delegated-account factory");
      factory.ready = true;
    } catch (error) { factory.error = safeDependencyError(error, "Manual Perpl delegated-account factory is unavailable."); }
  } else factory.error = "Monad Testnet RPC is unavailable for the factory check.";

  try {
    const context = await readPerplContext();
    exchange.contextReady = true;
    exchange.chainId = context.chainId;
    exchange.exchangeAddress = context.exchangeAddress;
    exchange.marketCount = context.markets.length;
    exchange.openMarketCount = context.markets.filter((market) => market.isOpen).length;
    if (!provider) throw new Error("The Monad Testnet RPC is unavailable for contract checks.");
    await Promise.all([
      requireContractCode(provider, PERPL_TESTNET_EXCHANGE, "Perpl Testnet exchange"),
      requireContractCode(provider, PERPL_TESTNET_AUSD, "Perpl Testnet AUSD"),
    ]);
    exchange.contractsReady = true;
    exchange.ready = exchange.contextReady && exchange.contractsReady && exchange.chainId === PERPL_CHAIN_ID;
  } catch (error) { exchange.error = safeDependencyError(error, "Perpl Testnet exchange readiness is unavailable."); }
  finally { try { await provider?.destroy(); } catch { /* readiness data is already captured */ } }

  const accountPreparationBlockers = [
    ...(!gate.effectiveEnabled ? ["Enable the global Manual Perpl Testnet gate."] : []),
    ...(!actionsGate ? ["MONAD_TESTNET_ACTIONS_ENABLED is off."] : []),
    ...(!rpc.ready ? ["Monad Testnet RPC is not ready."] : []),
    ...(!exchange.contextReady ? ["Perpl Testnet context is not ready."] : []),
    ...(!exchange.contractsReady ? ["Perpl Testnet exchange or AUSD is not ready."] : []),
    ...(!factory.ready ? ["Manual Perpl delegated-account factory is not ready."] : []),
  ];
  const orderPreparationBlockers = [...accountPreparationBlockers,
    ...(!exchange.ready ? ["Perpl Testnet exchange or AUSD is not ready."] : []),
    ...(exchange.openMarketCount < 1 ? ["Perpl Testnet has no open market."] : []),
  ];
  const accountBroadcastBlockers = [...accountPreparationBlockers,
    ...(!broadcastGate ? ["MONAD_TESTNET_BROADCAST_ENABLED is off."] : []),
  ];
  const orderBroadcastBlockers = [...orderPreparationBlockers,
    ...(!broadcastGate ? ["MONAD_TESTNET_BROADCAST_ENABLED is off."] : []),
  ];
  return {
    gate,
    readiness: { rpc, factory, exchange, actionsGate, broadcastGate, perplAutonomyGate: autonomyGate,
      accountPreparationReady: accountPreparationBlockers.length === 0, accountPreparationBlockers,
      orderPreparationReady: orderPreparationBlockers.length === 0, orderPreparationBlockers,
      accountBroadcastReady: accountBroadcastBlockers.length === 0, accountBroadcastBlockers,
      orderBroadcastReady: orderBroadcastBlockers.length === 0, orderBroadcastBlockers },
    scope: "global_manual_perpl_testnet_gate_only",
  };
}

export function registerManualPerplOperatorRoutes(app: Hono<any>) {
  app.get("/api/operator/manual-perpl", async (context) => {
    try { return context.json(await readManualPerplOperatorStatus()); }
    catch { return context.json({ error: "Manual Perpl readiness could not be read." }, 503); }
  });
  app.post("/api/operator/manual-perpl/gate", async (context) => {
    let body: any;
    try { body = await context.req.json(); } catch { return context.json({ error: "Send a valid JSON body." }, 400); }
    if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length !== 1
      || typeof body.enabled !== "boolean") {
      return context.json({ error: "Send only the boolean enabled field." }, 400);
    }
    try {
      const gate = setManualPerplGateEnabled(body.enabled, LOCAL_OPERATOR_SUBJECT);
      return context.json({ gate });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Manual Perpl gate could not be saved." }, 503);
    }
  });
}
