import { createHash } from "node:crypto";
import { Contract, getAddress, Interface } from "ethers";
import { Hono } from "hono";
import { meraQuery, operatorMutation } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { chooseVenue, configuredAdapter, configuredVault, maxSlippageBps, MonadApiError, venueData } from "./config.js";
import { ADAPTER_ABI, ASSETS, MONAD_CHAIN_ID, USDC_ADDRESS, WMON_ADDRESS, VAULT_ABI } from "./constants.js";
import { monadProvider, readTokenBalance, readWalletBalances, requireContractCode } from "./provider.js";
import { amountUnits } from "./transactions.js";
import { reconcileOwnerPendingOperations } from "./operations.js";

function jsonRecord(value: unknown) {
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}

export function monadQuoteId(input: { ownerAddress: string; scope: string; venue: string; tokenIn: string;
  tokenOut: string; amountIn: string; amountOut: string; minimumOut: string; slippageBps: number; expiresAt: number }) {
  const digest = createHash("sha256").update([input.ownerAddress.toLowerCase(), input.scope, input.venue,
    input.tokenIn.toLowerCase(), input.tokenOut.toLowerCase(), input.amountIn, input.amountOut,
    input.minimumOut, String(input.slippageBps), String(input.expiresAt)].join(":")).digest("hex");
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
  const rows: any[] = await meraQuery(auth.token, "monad", "getActivity", { limit: 60 });
  return context.json(rows.map((row) => {
    const data = jsonRecord(row.dataJson);
    const status = row.status === "authorized" ? "verified" : row.status;
    const receiptStatus = Number(data.receiptStatus);
    const amount = typeof data.amount === "string" ? data.amount : null;
    const asset = typeof data.asset === "string" ? data.asset : null;
    return { id: row.activityId, kind: row.kind, title: row.kind.replaceAll("_", " "),
      summary: row.summary, status, occurredAt: new Date(row.createdAt).toISOString(),
      fundsMoved: status === "finalized" && receiptStatus === 1,
      transactionHash: row.txHash ?? null, amount, asset,
      blockNumber: typeof data.blockNumber === "number" ? data.blockNumber : null,
      details: Object.entries({ ...(asset ? { asset } : {}), ...(amount ? { amount } : {}),
        ...(typeof data.blockNumber === "number" ? { block: String(data.blockNumber) } : {}) })
        .map(([label, value]) => ({ label, value: String(value) })) };
  }));
}

async function quote(context: any) {
  const auth = await requireMera(context);
  const body = parseBody(await context.req.json());
  const venue = chooseVenue(body.venue);
  const scope = body.accountScope;
  if (scope !== "wallet" && scope !== "vault") throw new MonadApiError("Quote scope must be wallet or vault.");
  const tokenIn = getAddress(body.tokenIn); const tokenOut = getAddress(body.tokenOut);
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()
      || ![tokenIn.toLowerCase(), tokenOut.toLowerCase()].every((token) => [USDC_ADDRESS, WMON_ADDRESS].some((a) => a.toLowerCase() === token))) {
    throw new MonadApiError("Only the reviewed USDC/WMON testnet pair is supported.", 400, "pair_unsupported");
  }
  const inputDecimals = tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? ASSETS.USDC.decimals : ASSETS.WMON.decimals;
  const outputDecimals = tokenOut.toLowerCase() === USDC_ADDRESS.toLowerCase() ? ASSETS.USDC.decimals : ASSETS.WMON.decimals;
  const inputUnits = amountUnits(body.amountIn, inputDecimals);
  const slippageBps = maxSlippageBps(body.slippageBps);
  const adapter = configuredAdapter(venue);
  if (!adapter) throw new MonadApiError("Selected Monad Testnet venue is not configured.", 503, "venue_disabled");
  const provider = await monadProvider();
  try {
    await requireContractCode(provider, adapter, "Monad swap adapter");
    if (scope === "vault") await assertVaultQuoteScope(provider, auth.token, auth.ownerAddress, tokenIn, tokenOut, adapter);
    const router = new Contract(adapter, ADAPTER_ABI, provider);
    let result: any;
    try { result = await router.quoteExactInput.staticCall(tokenIn, tokenOut, inputUnits, venueData(venue)); }
    catch { throw new MonadApiError("The selected testnet pool is not initialized or cannot quote this pair.", 409, "pool_unavailable"); }
    const amountOut = BigInt(result[0]);
    if (!result[1] || amountOut <= 0n) throw new MonadApiError("The selected testnet pool has no executable quote.", 409, "pool_unavailable");
    const minOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    if (minOut <= 0n) throw new MonadApiError("Minimum output rounds to zero.");
    const expiresAt = Date.now() + 30_000;
    const quoteId = monadQuoteId({ ownerAddress: auth.ownerAddress, scope, venue, tokenIn, tokenOut,
      amountIn: inputUnits.toString(), amountOut: amountOut.toString(), minimumOut: minOut.toString(), slippageBps, expiresAt });
    const response = { quoteId, accountScope: scope, venue, tokenIn, tokenOut,
      amountInUnits: inputUnits.toString(), amountOutUnits: amountOut.toString(),
      minimumAmountOutUnits: minOut.toString(), expiresAt: new Date(expiresAt).toISOString(),
      feeProvenance: `${venue} adapter quote; output amount includes venue pricing`,
      outputDecimals, ...(scope === "wallet" ? await estimateWalletSwapGas(provider, auth.ownerAddress,
        adapter, tokenIn, tokenOut, inputUnits, minOut) : {}) };
    const gas = (response as any).gas;
    await operatorMutation("monadQuotes", "recordQuote", { subject: auth.subject, ownerAddress: auth.ownerAddress,
      quoteId, accountScope: scope, venue, tokenIn, tokenOut, amountInUnits: inputUnits.toString(),
      amountOutUnits: amountOut.toString(), minimumAmountOutUnits: minOut.toString(), slippageBps,
      feeProvenance: response.feeProvenance, expiresAt, ...(gas ? { gasJson: JSON.stringify(gas) } : {}) });
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
    const [estimate, fees, network] = await Promise.all([
      provider.estimateGas({ from: owner, to: adapter, data, value: 0n, type: 2, chainId: MONAD_CHAIN_ID, accessList: [] }),
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

export function registerMonadReadRoutes(app: Hono<any>) {
  app.get("/api/mobile/monad/wallet", (c) => guard(c, wallet));
  app.get("/api/mobile/monad/agents", (c) => guard(c, agents));
  app.get("/api/mobile/monad/activity", (c) => guard(c, activity));
  app.get("/api/mobile/monad/markets", (c) => guard(c, markets));
  app.post("/api/mobile/monad/quote", (c) => guard(c, quote));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
