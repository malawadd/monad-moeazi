import { createHash } from "node:crypto";
import { Contract, formatUnits, getAddress, Interface } from "ethers";
import { Hono } from "hono";
import { meraQuery, operatorMutation } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { chooseVenue, configuredAdapter, configuredDynamicV4Adapter, configuredVault, maxSlippageBps,
  MonadApiError, venueData, type MonadVenue } from "./config.js";
import { ADAPTER_ABI, ASSETS, MONAD_CHAIN_ID, USDC_ADDRESS, WMON_ADDRESS, VAULT_ABI } from "./constants.js";
import { finalizedBlockNumber, monadProvider, readTokenBalance, readWalletBalances, requireContractCode } from "./provider.js";
import { amountUnits } from "./transactions.js";
import { reconcileOwnerPendingOperations } from "./operations.js";
import { MOCK_SPOT_VENUE, quoteMockPool, resolveMockPool } from "./mockSpot.js";
import { findV4Pool, poolKeysEqual, v4MarketId, v4PoolKey, type V4PoolRecord } from "./v4PoolIndex.js";
import { buildV4SwapCall, quoteV4Pool } from "./v4PoolSwap.js";
import { v4TokenDecimals } from "./v4PoolMarkets.js";

function jsonRecord(value: unknown) {
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}

export function monadQuoteId(input: { ownerAddress: string; scope: string; venue: string; tokenIn: string;
  tokenOut: string; amountIn: string; amountOut: string; minimumOut: string; slippageBps: number; expiresAt: number;
  poolAddress?: string; poolId?: string; poolKeyJson?: string; gasCapJson?: string }) {
  const digest = createHash("sha256").update([String(MONAD_CHAIN_ID), input.ownerAddress.toLowerCase(), input.scope, input.venue,
    input.tokenIn.toLowerCase(), input.tokenOut.toLowerCase(), input.amountIn, input.amountOut,
    input.minimumOut, String(input.slippageBps), String(input.expiresAt),
    ...(input.poolAddress ? [input.poolAddress.toLowerCase()] : []), ...(input.poolId ? [input.poolId.toLowerCase()] : []),
    ...(input.poolKeyJson ? [input.poolKeyJson] : []), ...(input.gasCapJson ? [input.gasCapJson] : [])].join(":")).digest("hex");
  return `0x${digest}`;
}

async function wallet(context: any) {
  const auth = await requireMera(context);
  const provider = await monadProvider();
  try { return context.json(await readWalletBalances(provider, auth.ownerAddress)); }
  finally { await provider.destroy(); }
}

async function agents(context: any) {
  const auth = await requireMera(context);
  const result: any = await meraQuery(auth.token, "monad", "getAgents", {});
  return context.json({ ...result, observedAt: new Date(result.observedAt ?? Date.now()).toISOString() });
}

async function activity(context: any) {
  const auth = await requireMera(context);
  await reconcileOwnerPendingOperations(auth.token, auth.ownerAddress);
  const rawLimit = Number(context.req.query("limit") ?? 60);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 60;
  const cursor = context.req.query("cursor");
  const page: any = await meraQuery(auth.token, "monad", "getActivity", { limit, ...(cursor ? { cursor } : {}) });
  const events = page.rows.map((row: any) => {
    const data = jsonRecord(row.dataJson);
    const status = row.status === "authorized" ? "verified" : row.status;
    const receiptStatus = Number(data.receiptStatus);
    const response = data.response && typeof data.response === "object" && !Array.isArray(data.response)
      ? data.response as Record<string, unknown> : {};
    const fills = Array.isArray(data.fills) ? data.fills : [];
    const verifiedPerplFill = Boolean(row.venueId?.startsWith("perpl-") && row.kind === "perpl_order_finalized"
      && status === "finalized" && fills.length > 0);
    const verifiedPerplReturn = Boolean(row.venueId?.startsWith("perpl-") && row.kind === "perpl_settlement_finalized"
      && status === "completed" && /^\d+$/.test(String(data.returnedUnits ?? "")) && BigInt(String(data.returnedUnits)) > 0n);
    const faucetUnits = String(data.verifiedAUsdUnits ?? "");
    const verifiedFaucetTransfer = row.kind === "claim_ausd_faucet" && status === "finalized"
      && /^\d+$/.test(faucetUnits) && BigInt(faucetUnits) > 0n;
    const amount = row.kind === "claim_ausd_faucet" ? verifiedFaucetTransfer ? formatUnits(BigInt(faucetUnits), 6) : null
      : typeof data.amount === "string" ? data.amount
      : verifiedPerplReturn ? formatUnits(BigInt(String(data.returnedUnits)), 6) : null;
    const asset = row.kind === "claim_ausd_faucet" ? verifiedFaucetTransfer ? "AUSD" : null
      : typeof data.asset === "string" ? data.asset : verifiedPerplReturn ? "AUSD" : null;
    return { id: row.activityId, kind: row.kind, venueId: row.venueId ?? null, title: row.kind.replaceAll("_", " "),
      summary: row.summary, status, occurredAt: new Date(row.createdAt).toISOString(),
      fundsMoved: row.kind === "claim_ausd_faucet" ? verifiedFaucetTransfer
        : status === "finalized" && receiptStatus === 1 || verifiedPerplFill || verifiedPerplReturn,
      transactionHash: row.txHash ?? null, amount, asset,
      blockNumber: typeof data.blockNumber === "number" ? data.blockNumber : null,
      details: Object.entries({ ...(asset ? { asset } : {}), ...(amount ? { amount } : {}),
        ...(typeof data.market === "string" ? { market: data.market } : {}),
        ...(typeof data.side === "string" ? { side: data.side } : {}),
        ...(typeof data.leverage === "number" ? { leverage: `${data.leverage}x` } : {}),
        ...(typeof data.marginUnits === "string" ? { marginUnits: data.marginUnits } : {}),
        ...(typeof data.realizedPnlUnits === "string" ? { realizedPnlUnits: data.realizedPnlUnits } : {}),
        ...(typeof data.requestId === "number" ? { requestId: String(data.requestId) } : {}),
        ...(typeof response.feeUnits === "string" ? { feeAUSDUnits: response.feeUnits } : {}),
        ...(typeof response.operatorGasWei === "string" ? { operatorGasWei: response.operatorGasWei } : {}),
        ...(typeof data.returnedUnits === "string" ? { returnedAUSDUnits: data.returnedUnits } : {}),
        ...(typeof data.blockNumber === "number" ? { block: String(data.blockNumber) } : {}) })
        .map(([label, value]) => ({ label, value: String(value) })) };
  });
  return context.json({ events, nextCursor: page.nextCursor ?? null, hasMore: Boolean(page.hasMore) });
}

async function quote(context: any) {
  const auth = await requireMera(context);
  const body = parseBody(await context.req.json());
  const mockPool = body.venue === MOCK_SPOT_VENUE;
  const venue = mockPool ? MOCK_SPOT_VENUE : chooseVenue(body.venue);
  if (!venue) throw new MonadApiError("Selected Monad Testnet venue is not configured.", 503, "venue_disabled");
  const scope = body.accountScope;
  if (scope !== "wallet" && scope !== "vault") throw new MonadApiError("Quote scope must be wallet or vault.");
  if (mockPool && scope !== "wallet") throw new MonadApiError("Mock pool swaps are Mera-wallet only.", 403, "operator_only");
  const dynamicV4 = venue === "uniswap_v4_testnet" && body.poolId !== undefined;
  if (dynamicV4 && scope !== "wallet") throw new MonadApiError("PoolId-bound v4 swaps are Mera-wallet only.", 403, "operator_only");
  const tokenIn = getAddress(body.tokenIn); const tokenOut = getAddress(body.tokenOut);
  if (!mockPool && !dynamicV4 && (tokenIn.toLowerCase() === tokenOut.toLowerCase()
      || ![tokenIn.toLowerCase(), tokenOut.toLowerCase()].every((token) => [USDC_ADDRESS, WMON_ADDRESS].some((a) => a.toLowerCase() === token)))) {
    throw new MonadApiError("Only the reviewed USDC/WMON testnet pair is supported.", 400, "pair_unsupported");
  }
  const provider = await monadProvider();
  let pool: Awaited<ReturnType<typeof resolveMockPool>> | undefined;
  let v4Pool: V4PoolRecord | undefined;
  try {
    if (mockPool) pool = await resolveMockPool(provider, tokenIn, tokenOut);
    if (dynamicV4) {
      v4Pool = await findV4Pool(body.poolId) ?? undefined;
      if (!v4Pool) throw new MonadApiError("PoolId was not found in the Monad v4 pool index.", 404, "v4_pool_not_found");
    }
    const checkpoint = dynamicV4 ? await finalizedBlockNumber(provider) : undefined;
    const inputDecimals = pool?.tokenInDecimals ?? (dynamicV4
      ? await v4TokenDecimals(provider, tokenIn, checkpoint!)
      : tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? ASSETS.USDC.decimals : ASSETS.WMON.decimals);
    const outputDecimals = pool?.tokenOutDecimals ?? (dynamicV4
      ? await v4TokenDecimals(provider, tokenOut, checkpoint!)
      : tokenOut.toLowerCase() === USDC_ADDRESS.toLowerCase() ? ASSETS.USDC.decimals : ASSETS.WMON.decimals);
    const inputUnits = amountUnits(body.amountIn, inputDecimals);
    const slippageBps = maxSlippageBps(body.slippageBps);
    let result: any;
    let adapter: string | null | undefined;
    let v4Quote: Awaited<ReturnType<typeof quoteV4Pool>> | undefined;
    if (pool) result = [await quoteMockPool(provider, pool, inputUnits), true];
    else if (v4Pool) {
      v4Quote = await quoteV4Pool(provider, v4Pool, tokenIn, tokenOut, inputUnits);
      result = [v4Quote.amountOut, true]; adapter = v4Quote.adapter;
      const suppliedKey = body.poolKey;
      if (suppliedKey !== undefined && !poolKeysEqual(suppliedKey, v4Quote.poolKey)) {
        throw new MonadApiError("PoolKey differs from the indexed PoolId record.", 409, "v4_pool_key_mismatch");
      }
    }
    else {
      adapter = configuredAdapter(venue as MonadVenue);
      if (!adapter) throw new MonadApiError("Selected Monad Testnet venue is not configured.", 503, "venue_disabled");
      await requireContractCode(provider, adapter, "Monad swap adapter");
      if (scope === "vault") await assertVaultQuoteScope(provider, auth.token, auth.ownerAddress, tokenIn, tokenOut, adapter);
      try { result = await new Contract(adapter, ADAPTER_ABI, provider).quoteExactInput.staticCall(tokenIn, tokenOut, inputUnits, venueData(venue as MonadVenue)); }
      catch { throw new MonadApiError("The selected testnet pool is not initialized or cannot quote this pair.", 409, "pool_unavailable"); }
    }
    const amountOut = BigInt(result[0]);
    if (!result[1] || amountOut <= 0n) throw new MonadApiError("The selected testnet pool has no executable quote.", 409, "pool_unavailable");
    const minOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    if (minOut <= 0n) throw new MonadApiError("Minimum output rounds to zero.");
    const expiresAt = Date.now() + 30_000;
    const poolKey = v4Pool ? v4PoolKey(v4Pool) : undefined;
    const poolKeyJson = poolKey ? JSON.stringify(poolKey) : undefined;
    const v4Call = v4Pool ? buildV4SwapCall(v4Pool, tokenIn, tokenOut, inputUnits, minOut) : undefined;
    const v4Gas = v4Call ? await estimateV4WalletGasCap(provider, auth.ownerAddress, v4Call) : undefined;
    const gasCapJson = v4Gas?.gasCap ? JSON.stringify(v4Gas.gasCap) : undefined;
    const quoteId = monadQuoteId({ ownerAddress: auth.ownerAddress, scope, venue, tokenIn, tokenOut,
      amountIn: inputUnits.toString(), amountOut: amountOut.toString(), minimumOut: minOut.toString(), slippageBps, expiresAt,
      ...(pool ? { poolAddress: pool.poolAddress } : {}), ...(v4Pool ? { poolId: v4Pool.poolId, poolKeyJson, gasCapJson } : {}) });
    const response: any = { quoteId, accountScope: scope, venue, ownerAddress: auth.ownerAddress, chainId: MONAD_CHAIN_ID, tokenIn, tokenOut,
      amountInUnits: inputUnits.toString(), amountOutUnits: amountOut.toString(),
      minimumAmountOutUnits: minOut.toString(), expiresAt: new Date(expiresAt).toISOString(),
      feeProvenance: pool ? `${venue} finalized pool quote at block ${pool.checkpoint}; output includes pool fee`
        : v4Quote ? `${venue} PoolId ${v4Quote.poolId} quote at finalized block ${v4Quote.checkpoint}; output includes pool fee`
        : `${venue} adapter quote; output amount includes venue pricing`, outputDecimals,
      ...(pool ? { poolAddress: pool.poolAddress, inputDecimals, tokenSymbol: pool.symbol } : {}),
      ...(v4Pool ? { poolId: v4Pool.poolId, poolKey, marketId: v4MarketId(v4Pool.poolId), inputDecimals,
        verified: v4Pool.verified, unverifiedPoolWarning: !v4Pool.verified,
        warning: !v4Pool.verified ? "This pool is not operator verified. Review its PoolId and PoolKey before signing." : undefined,
        observedAt: v4Quote?.observedAt, blockNumber: v4Quote?.checkpoint,
        gasCap: v4Gas?.gasCap, gas: v4Gas?.gas ?? null, gasEstimationAvailable: v4Gas?.gasEstimationAvailable } : {}),
      ...(!v4Pool && scope === "wallet" && adapter
        ? await estimateWalletSwapGas(provider, auth.ownerAddress, adapter, tokenIn, tokenOut, inputUnits, minOut) : {}) };
    const storedGas = v4Pool ? v4Gas?.gasCap : (response as any).gas;
    await operatorMutation("monadQuotes", "recordQuote", { subject: auth.subject, ownerAddress: auth.ownerAddress,
      quoteId, accountScope: scope, venue, tokenIn, tokenOut, amountInUnits: inputUnits.toString(),
      amountOutUnits: amountOut.toString(), minimumAmountOutUnits: minOut.toString(), slippageBps,
      feeProvenance: response.feeProvenance, expiresAt, ...(pool ? { poolAddress: pool.poolAddress } : {}),
      ...(v4Pool ? { poolId: v4Pool.poolId, poolKeyJson, marketId: v4MarketId(v4Pool.poolId), inputDecimals, outputDecimals } : {}),
      ...(storedGas ? { gasJson: JSON.stringify(storedGas) } : {}) });
    return context.json(response);
  } finally { await provider.destroy(); }
}

async function assertVaultQuoteScope(provider: any, token: string, owner: string, tokenIn: string, tokenOut: string, adapter: string) {
  const mandates: any[] = await meraQuery(token, "monadMandates", "getMandates", {});
  const row = mandates.find((item) => item.status === "active" && item.expiresAt > Math.floor(Date.now() / 1000)
    && item.ownerAddress.toLowerCase() === owner.toLowerCase());
  if (!row) throw new MonadApiError("Vault quote requires an active on-chain mandate.", 403, "mandate_inactive");
  if (String(row.tokenIn).toLowerCase() !== tokenIn.toLowerCase() || String(row.tokenOut).toLowerCase() !== tokenOut.toLowerCase()) {
    throw new MonadApiError("This vault mandate does not authorize the selected token direction.", 403, "mandate_pair_mismatch");
  }
  const allowed: string[] = JSON.parse(row.allowedAdaptersJson);
  if (!allowed.some((value) => value.toLowerCase() === adapter.toLowerCase())) {
    throw new MonadApiError("This mandate does not authorize the selected adapter.", 403, "mandate_adapter_mismatch");
  }
  if (configuredVault()?.toLowerCase() !== row.vaultAddress.toLowerCase()) {
    throw new MonadApiError("The mandate vault differs from the configured Monad Testnet vault.", 409, "vault_config_mismatch");
  }
  const vault = new Contract(row.vaultAddress, VAULT_ABI, provider);
  const [vaultOwner, active, stopped] = await Promise.all([
    vault.owner(), vault.isMandateActive(row.typedDataHash), vault.stopped(),
  ]);
  if (String(vaultOwner).toLowerCase() !== owner.toLowerCase() || !active || stopped) {
    throw new MonadApiError("The exact mandate is not active on chain.", 403, "mandate_inactive");
  }
}

async function markets(context: any) {
  const auth = await requireMera(context);
  const provider = await monadProvider();
  try {
    const mandates: any[] = await meraQuery(auth.token, "monadMandates", "getMandates", {});
    const activeMandate = mandates.find((item) => item.status === "active"
      && item.expiresAt > Math.floor(Date.now() / 1000) && item.ownerAddress.toLowerCase() === auth.ownerAddress.toLowerCase());
    const venues = await Promise.all(([["uniswap_v4_testnet", "Uniswap v4 Testnet"], ["moeazi_test_amm", "Moeazi Test AMM"]] as const)
      .map(async ([id, name]) => {
        const adapter = configuredAdapter(id);
        let enabled = false; let reason: string | undefined = "Adapter is not configured for Monad Testnet.";
        if (adapter) {
          try {
            await requireContractCode(provider, adapter, `${name} adapter`);
            const result = await new Contract(adapter, ADAPTER_ABI, provider).quoteExactInput.staticCall(
              USDC_ADDRESS, WMON_ADDRESS, 1_000_000n, venueData(id));
            enabled = Boolean(result[1]) && BigInt(result[0]) > 0n;
            reason = enabled ? undefined : "The testnet pool is not initialized or has no quoteable liquidity.";
          } catch { reason = "The testnet adapter is unavailable or the pool is not quoteable."; }
        }
        let vaultEnabled = false;
        if (enabled && activeMandate && adapter) {
          try {
            const vaultAddress = configuredVault();
            if (vaultAddress && vaultAddress.toLowerCase() === activeMandate.vaultAddress.toLowerCase()) {
              const vault = new Contract(vaultAddress, VAULT_ABI, provider);
              const [vaultOwner, mandateActive, stopped] = await Promise.all([
                vault.owner(), vault.isMandateActive(activeMandate.typedDataHash), vault.stopped().catch(() => true),
              ]);
              const allowed: string[] = JSON.parse(activeMandate.allowedAdaptersJson);
              const pair = [USDC_ADDRESS, WMON_ADDRESS].every((asset) =>
                [activeMandate.tokenIn, activeMandate.tokenOut].some((token: string) =>
                  token.toLowerCase() === asset.toLowerCase()));
              vaultEnabled = String(vaultOwner).toLowerCase() === auth.ownerAddress.toLowerCase()
                && Boolean(mandateActive) && !stopped && pair
                && allowed.some((value) => value.toLowerCase() === adapter.toLowerCase());
            }
          } catch { vaultEnabled = false; }
        }
        if (enabled && !vaultEnabled) reason = "Wallet quotes are available; vault quotes require a matching active on-chain mandate.";
        return { id, name, enabled, ...(reason ? { reason } : {}), capabilities: {
          wallet: enabled, vault: vaultEnabled } };
      }));
    return context.json({ markets: [{ id: "WMON_USDC",
      baseAsset: { id: "WMON", symbol: "WMON", address: WMON_ADDRESS, decimals: ASSETS.WMON.decimals },
      quoteAsset: { id: "USDC", symbol: "USDC", address: USDC_ADDRESS, decimals: ASSETS.USDC.decimals }, venues }] });
  } finally { await provider.destroy(); }
}

async function estimateWalletSwapGas(provider: any, owner: string, adapter: string, tokenIn: string,
  tokenOut: string, amountIn: bigint, minOut: bigint) {
  try {
    const data = new Interface(ADAPTER_ABI).encodeFunctionData("swap", [tokenIn, tokenOut, amountIn, minOut, "0x"]);
    return await estimateWalletCallGas(provider, owner, { to: adapter, data });
  } catch { return {}; }
}

async function estimateWalletCallGas(provider: any, owner: string, call: { to: string; data: string }) {
  try {
    const [estimate, fees, network] = await Promise.all([
      provider.estimateGas({ from: owner, to: call.to, data: call.data, value: 0n, type: 2, chainId: MONAD_CHAIN_ID, accessList: [] }),
      provider.getFeeData(), provider.getNetwork(),
    ]);
    if (network.chainId !== BigInt(MONAD_CHAIN_ID) || estimate <= 0n || fees.maxFeePerGas === null
        || fees.maxPriorityFeePerGas === null || fees.maxFeePerGas < fees.maxPriorityFeePerGas) return {};
    const gasLimit = (estimate * 115n + 99n) / 100n;
    if (gasLimit > 3_000_000n) return {};
    return { gas: { gasLimit: gasLimit.toString(), maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(), maxCostWei: (gasLimit * fees.maxFeePerGas).toString() } };
  } catch { return {}; }
}

async function estimateV4WalletGasCap(provider: any, owner: string, call: { to: string; data: string }) {
  const maxGas = 3_000_000n;
  const [fees, network] = await Promise.all([provider.getFeeData(), provider.getNetwork()]);
  if (network.chainId !== BigInt(MONAD_CHAIN_ID)) throw new MonadApiError("Gas quote is not on Monad Testnet.", 503, "wrong_chain");
  if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null || fees.maxFeePerGas < fees.maxPriorityFeePerGas) {
    throw new MonadApiError("Monad Testnet did not provide a usable EIP-1559 fee quote.", 503, "fee_unavailable");
  }
  let estimatedGasLimit: bigint | undefined;
  try {
    const estimate = await provider.estimateGas({ from: owner, to: call.to, data: call.data, value: 0n,
      type: 2, chainId: MONAD_CHAIN_ID, accessList: [] });
    const padded = (estimate * 115n + 99n) / 100n;
    if (estimate > 0n && padded <= maxGas) estimatedGasLimit = padded;
  } catch { /* approval may not exist yet; retain the explicit reviewed ceiling */ }
  const gasCap = { gasLimit: maxGas.toString(), maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(), maxCostWei: (maxGas * fees.maxFeePerGas).toString() };
  const gas = estimatedGasLimit ? { gasLimit: estimatedGasLimit.toString(), maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(), maxCostWei: (estimatedGasLimit * fees.maxFeePerGas).toString() } : null;
  return { gasCap, gas, gasEstimationAvailable: Boolean(gas) };
}

export function registerMonadReadRoutes(app: Hono<any>) {
  app.get("/api/mobile/monad/wallet", (c) => guard(c, wallet));
  app.get("/api/mobile/monad/agents", (c) => guard(c, agents));
  app.get("/api/mobile/monad/activity", (c) => guard(c, activity));
  app.get("/api/mobile/monad/markets", (c) => guard(c, markets));
  app.post("/api/mobile/monad/quote", (c) => guard(c, quote));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) {
    process.stderr.write(`[api] Monad read ${context.req.path} failed: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 500)}` : "unknown error"}.\n`);
    const mapped = routeError(error); return context.json(mapped.body, mapped.status as any);
  }
}
