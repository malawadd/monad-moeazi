import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { GmxApiSdk } from "@gmx-io/sdk/v2";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { allowedTargets, assertFresh, prepareSwapRequest, routingOf, validateTransaction } from "./uniswap.js";
import { reconcileUniswapSwap } from "./uniswapSettlement.js";
import { readUniswapAccount } from "./uniswapAccount.js";
import { loadHookExperiment, quoteHookPool } from "./uniswapHookRoute.js";
import { handleMobileConnector } from "./mobile/handler.js";
import { RedisEncryptedSessionSignerVault } from "./mobile/sessionSignerVault.js";
import { RedisScopedSwapOperationStore } from "./mobile/scopedSwapOperationStore.js";
import { HttpUniswapFinanceMarkerReader } from "./mobile/scopedSwapFinanceMarker.js";
import { PimlicoBundler, PimlicoPaymaster, PimlicoTransport } from "./mobile/providers/pimlico.js";
import { ScopedSwapExecutionService, type ScopedBroadcastInput } from "./mobile/scopedSwapExecution.js";
import type { SwapGrantInput, } from "./mobile/scopedSwapGrant.js";
import { quoteScopedSwap } from "./mobile/scopedSwapQuote.js";
import { assessScopedSwapStorage, scopedSwapStorageConfig, scopedSwapStorageChecking,
  type ScopedSwapStorageReadiness } from "./mobile/scopedSwapStorageReadiness.js";
import type { Address, Hex } from "viem";
import { factoryAbi, readVaultProvision, vaultDeploymentArgs,
  type VaultProvisionMandate } from "./managedSpotVaultProvision.js";
import { broadcastManagedVaultBuy, observeManagedVaultBuy } from "./managedSpotVaultExecution.js";
import { stopManagedSpotVault } from "./managedSpotVaultStop.js";
import { broadcastManagedVaultSell, observeManagedVaultSell,
  prepareManagedVaultSell, type ManagedVaultSellInput } from "./managedSpotVaultSell.js";
import { boundedManagedVaultGas, managedVaultGasCapConfigured } from "./managedVaultGasBudget.js";
import { managedVaultRuntimeReadiness } from "./managedVaultRuntimeReadiness.js";
import { managedVaultBuyBroadcastEnabled, managedVaultTestStopAllowed } from "./managedVaultPilotGate.js";

const port = Number(process.env.PORT ?? 8300);
const sharedSecret = process.env.WORKER_SHARED_SECRET ?? "";
const liveExecution = process.env.LIVE_EXECUTION_ENABLED === "true";
const certified = new Set((process.env.CERTIFIED_VENUES ?? "").split(",").filter(Boolean));
const uniswapApiKey = process.env.UNISWAP_API_KEY ?? "";
const uniswapApiUrl = process.env.UNISWAP_API_URL ?? "https://trade-api.gateway.uniswap.org/v1";
const mainnetSetup = process.env.MAINNET_VENUE_SETUP_ENABLED === "true";
const arbitrumRpcUrl = process.env.ARBITRUM_RPC_URL ?? "";
const swapTargets = allowedTargets(process.env.UNISWAP_ARBITRUM_TARGETS);
const arbitrum = defineChain({ id: 42161, name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [arbitrumRpcUrl || "http://127.0.0.1"] } } });
const arbitrumClient = arbitrumRpcUrl ? createPublicClient({ chain: arbitrum, transport: http(arbitrumRpcUrl) }) : null;
const hookExperiment = loadHookExperiment(process.env);
const gmx = new GmxApiSdk({ chainId: 42161 });
let scopedSwapExecution: ScopedSwapExecutionService | undefined;
let scopedStorageReadiness: ScopedSwapStorageReadiness = scopedSwapStorageChecking();
void assessScopedSwapStorage(scopedSwapStorageConfig(process.env)).then((readiness) => {
  scopedStorageReadiness = readiness;
}).catch(() => {
  scopedStorageReadiness = { ...scopedSwapStorageChecking(), status: "blocked", checkedAt: Date.now(),
    blockerCodes: ["startup_probe_failed"] };
});

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

function authorized(req: IncomingMessage) {
  return Boolean(sharedSecret) && req.headers.authorization === `Bearer ${sharedSecret}`;
}

function vaultProvisionAuthorized(req: IncomingMessage) {
  const secret = process.env.MANAGED_VAULT_PROVISION_SECRET ?? "";
  return secret.length >= 32 && req.headers.authorization === `Bearer ${secret}`;
}

function vaultExecutorSigner() {
  const path = process.env.MANAGED_VAULT_EXECUTOR_KEY_FILE
    ?? "/run/secrets/managed_vault_executor_key";
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error("Managed vault executor secret is unavailable");
  }
  return privateKeyToAccount(key as Hex);
}

function vaultSignerReady(executorAddress: string) {
  try { return vaultExecutorSigner().address.toLowerCase() === executorAddress.toLowerCase(); }
  catch { return false; }
}

async function sendBoundedVaultTransaction(account: ReturnType<typeof vaultExecutorSigner>,
  to: Address, data: Hex) {
  if (!arbitrumClient) throw new Error("ARBITRUM_RPC_URL is not configured");
  const gas = await boundedManagedVaultGas(arbitrumClient,
    { account: account.address, to, data }, process.env.MANAGED_VAULT_MAX_TX_GAS_COST_WEI);
  const wallet = createWalletClient({ account, chain: arbitrum,
    transport: http(arbitrumRpcUrl) });
  return wallet.sendTransaction({ account, chain: arbitrum, to, data, value: 0n, ...gas });
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function scopedBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65_536) throw new Error("Scoped swap request is too large");
    chunks.push(Buffer.from(chunk));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Scoped swap request must be an object");
  return parsed as Record<string, unknown>;
}

function uintField(input: Record<string, unknown>, name: string) {
  const value = input[name];
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be canonical integer units`);
  return BigInt(value);
}
function textField(input: Record<string, unknown>, name: string) {
  const value = input[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function swapScope(value: unknown): "buy" | "exit" {
  if (value !== "buy" && value !== "exit") throw new Error("scope must be buy or exit");
  return value;
}
function grantInput(input: Record<string, unknown>): SwapGrantInput {
  const owner = textField(input, "owner") as Address;
  const frozenPolicyHash = textField(input, "frozenPolicyHash") as Hex;
  const expiresAt = input.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) throw new Error("expiresAt must be an integer Unix timestamp");
  return { grantId: textField(input, "grantId"), owner,
    strategyAccountId: textField(input, "strategyAccountId"), assignmentId: textField(input, "assignmentId"),
    frozenPolicyHash, expiresAt, maxUsdcUnits: uintField(input, "maxUsdcUnits"),
    maxWethUnits: uintField(input, "maxWethUnits"), minWethOutUnits: uintField(input, "minWethOutUnits"),
    minUsdcOutUnits: uintField(input, "minUsdcOutUnits") };
}
function scopedService() {
  if (scopedSwapExecution) return scopedSwapExecution;
  if (!arbitrumClient) throw new Error("ARBITRUM_RPC_URL is not configured");
  if (!scopedStorageReadiness.ready) throw new Error("Scoped swap durable storage readiness is blocked");
  const redisUrl = process.env.REDIS_URL ?? "";
  const signerVaultSecret = process.env.SCOPED_SWAP_SIGNER_VAULT_SECRET ?? "";
  const operationStoreSecret = process.env.SCOPED_SWAP_OPERATION_STORE_SECRET ?? "";
  if (!redisUrl || !signerVaultSecret || !operationStoreSecret) throw new Error("Encrypted scoped swap storage is not configured");
  const vault = new RedisEncryptedSessionSignerVault(redisUrl, signerVaultSecret,
    "moeazi:scoped-uniswap:signers:v1", true);
  const operations = new RedisScopedSwapOperationStore(redisUrl, operationStoreSecret,
    "moeazi:scoped-uniswap:operations:v1", true);
  const transport = new PimlicoTransport(process.env.PIMLICO_API_KEY ?? "", undefined, process.env.PIMLICO_SPONSORSHIP_POLICY_ID);
  scopedSwapExecution = new ScopedSwapExecutionService({ client: arbitrumClient, vault, operations,
    finance: new HttpUniswapFinanceMarkerReader(process.env.AGENT_SERVICE_URL ?? "", sharedSecret),
    bundler: new PimlicoBundler(transport), paymaster: new PimlicoPaymaster(transport),
    broadcastEnabled: liveExecution && mainnetSetup && certified.has("uniswap")
      && process.env.SCOPED_UNISWAP_EXECUTION_ENABLED === "true"
      && process.env.MOBILE_SPONSORSHIP_ENABLED === "true" && process.env.MOBILE_SPONSORSHIP_CERTIFIED === "true"
      && scopedStorageReadiness.ready,
    maxFeeWei: process.env.MOBILE_GAS_OPERATION_LIMIT_WEI ?? "0" });
  return scopedSwapExecution;
}
function scopedRouteError(res: ServerResponse, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /gates are closed/i.test(message) ? 423
    : /not configured|durable|unavailable|rpc|quoter/i.test(message) ? 503 : 409;
  return json(res, status, { error: message.slice(0, 300) });
}

async function uniswap(path: string, payload: unknown) {
  if (!uniswapApiKey) throw new Error("UNISWAP_API_KEY is not configured");
  const response = await fetch(`${uniswapApiUrl}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": uniswapApiKey,
      "x-universal-router-version": "2.0",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    const detail = result && typeof result === "object" && "detail" in result ? result.detail : response.statusText;
    throw new Error(`Uniswap ${path} failed: ${String(detail)}`);
  }
  return result;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && new URL(req.url ?? "", "http://sidecar").pathname
      === "/internal/uniswap/managed-vault-runtime-readiness") {
      if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
      const vaultAddress = new URL(req.url ?? "", "http://sidecar").searchParams.get("vaultAddress") ?? "";
      let signerAddress: string | null = null;
      try { signerAddress = vaultExecutorSigner().address; } catch { /* Readiness reports the missing signer. */ }
      return json(res, 200, await managedVaultRuntimeReadiness(process.env, signerAddress,
        arbitrumClient ? (address) => arbitrumClient.getBalance({ address }) : null, vaultAddress));
    }
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        status: "ok",
        gmx: { sdk: "@gmx-io/sdk/v2", live: liveExecution && certified.has("gmx") },
        uniswap: {
          chainId: 42161,
          setup: mainnetSetup,
          live: false,
          receiptReadReady: Boolean(arbitrumClient),
          liveBlocker: "Scoped autonomous signer is not configured",
          scopedStorage: scopedStorageReadiness,
          hookExperiment: hookExperiment.enabled
            ? { enabled: true, hookAddress: hookExperiment.hookAddress }
            : hookExperiment,
        },
      });
    }
    if (req.method === "POST" && (req.url === "/internal/uniswap/managed-vault-provision/read"
      || req.url === "/internal/uniswap/managed-vault-provision/submit")) {
      try {
        if (!arbitrumClient) throw new Error("ARBITRUM_RPC_URL is not configured");
        if (!vaultProvisionAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
        const input = await scopedBody(req) as unknown as VaultProvisionMandate;
        const factoryAddress = process.env.MANAGED_VAULT_FACTORY_ADDRESS ?? "";
        const executorAddress = process.env.MANAGED_VAULT_EXECUTOR_ADDRESS ?? "";
        const config = { factoryAddress,
          factoryCodeHash: process.env.MANAGED_VAULT_FACTORY_CODE_HASH ?? "",
          executorAddress };
        const current = await readVaultProvision(arbitrumClient, input, config);
        if (req.url.endsWith("/read") || current.status === "vault_ready") {
          return json(res, 200, { ...current,
            deploymentEnabled: mainnetSetup
              && process.env.MANAGED_VAULT_PROVISION_ENABLED === "true"
              && managedVaultGasCapConfigured(process.env.MANAGED_VAULT_MAX_TX_GAS_COST_WEI)
              && vaultSignerReady(executorAddress) });
        }
        if (!mainnetSetup || process.env.MANAGED_VAULT_PROVISION_ENABLED !== "true") {
          return json(res, 423, { error: "Managed vault provisioning is not enabled" });
        }
        const account = vaultExecutorSigner();
        if (account.address.toLowerCase() !== executorAddress.toLowerCase()) {
          throw new Error("Mounted executor signer differs from the reviewed factory deployer");
        }
        const data = encodeFunctionData({ abi: factoryAbi, functionName: "deploy",
          args: vaultDeploymentArgs(input, account.address) });
        const transactionHash = await sendBoundedVaultTransaction(account,
          factoryAddress as Address, data);
        return json(res, 200, { status: "submitted", mandateId: input.mandateId,
          transactionHash, executorAddress: account.address.toLowerCase() });
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Managed vault provisioning failed" });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-observe-buy") {
      const secret = process.env.MANAGED_VAULT_EXECUTION_SECRET ?? "";
      if (secret.length < 32 || req.headers.authorization !== `Bearer ${secret}`) {
        return json(res, 401, { error: "Unauthorized" });
      }
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const input = await scopedBody(req);
        return json(res, 200, await observeManagedVaultBuy(arbitrumClient,
          input as unknown as import("./managedSpotVaultOrder.js").ManagedVaultBuyInput
            & { fromBlock: string }));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Finalized vault order evidence is unavailable" });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-broadcast-buy") {
      const secret = process.env.MANAGED_VAULT_EXECUTION_SECRET ?? "";
      if (secret.length < 32 || req.headers.authorization !== `Bearer ${secret}`) {
        return json(res, 401, { error: "Unauthorized" });
      }
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const input = await scopedBody(req);
        if (!managedVaultBuyBroadcastEnabled(process.env,
          String(input.vaultAddress ?? ""), String(input.amountIn ?? ""))) {
          return json(res, 423, { error: "Managed vault execution gates are closed" });
        }
        const account = vaultExecutorSigner();
        if (account.address.toLowerCase()
          !== (process.env.MANAGED_VAULT_EXECUTOR_ADDRESS ?? "").toLowerCase()) {
          throw new Error("Vault execution signer differs from the reviewed executor");
        }
        return json(res, 200, await broadcastManagedVaultBuy(arbitrumClient,
          input as unknown as import("./managedSpotVaultOrder.js").ManagedVaultBuyInput
            & { normalizedPayloadHash: string }, account.address,
          (to, data) => sendBoundedVaultTransaction(account, to, data)));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Managed vault buy broadcast is unavailable" });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-stop-readiness") {
      const secret = process.env.MANAGED_VAULT_EXECUTION_SECRET ?? "";
      if (secret.length < 32 || req.headers.authorization !== `Bearer ${secret}`) {
        return json(res, 401, { error: "Unauthorized" });
      }
      const input = await scopedBody(req);
      const enabled = process.env.MANAGED_VAULT_STOP_ENABLED === "true" && Boolean(arbitrumClient)
        && managedVaultTestStopAllowed(process.env, String(input.vaultAddress ?? ""));
      let signerMatches = false;
      if (enabled) {
        try { signerMatches = vaultExecutorSigner().address.toLowerCase()
          === (process.env.MANAGED_VAULT_EXECUTOR_ADDRESS ?? "").toLowerCase(); }
        catch { signerMatches = false; }
      }
      return json(res, 200, { ready: enabled && signerMatches, signerMatches });
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-stop") {
      const secret = process.env.MANAGED_VAULT_EXECUTION_SECRET ?? "";
      if (secret.length < 32 || req.headers.authorization !== `Bearer ${secret}`) {
        return json(res, 401, { error: "Unauthorized" });
      }
      if (process.env.MANAGED_VAULT_STOP_ENABLED !== "true") {
        return json(res, 423, { error: "Managed vault stop authority is unavailable" });
      }
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const account = vaultExecutorSigner();
        if (account.address.toLowerCase()
          !== (process.env.MANAGED_VAULT_EXECUTOR_ADDRESS ?? "").toLowerCase()) {
          throw new Error("Vault stop signer differs from the reviewed executor");
        }
        const input = await scopedBody(req);
        if (!managedVaultTestStopAllowed(process.env, String(input.vaultAddress ?? ""))) {
          return json(res, 423, { error: "Vault is outside the internal Stop scope" });
        }
        return json(res, 200, await stopManagedSpotVault(arbitrumClient,
          input as unknown as import("./managedSpotVaultRead.js").ManagedSpotVaultExpectation,
          account.address, (to, data) => sendBoundedVaultTransaction(account, to, data)));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Managed vault stop failed" });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-prepare-sell") {
      if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const input = await scopedBody(req);
        return json(res, 200, await prepareManagedVaultSell(arbitrumClient,
          input as unknown as ManagedVaultSellInput));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Managed vault sell preflight failed" });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-observe-sell") {
      const secret = process.env.MANAGED_VAULT_EXECUTION_SECRET ?? "";
      if (secret.length < 32 || req.headers.authorization !== `Bearer ${secret}`) {
        return json(res, 401, { error: "Unauthorized" });
      }
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const input = await scopedBody(req);
        return json(res, 200, await observeManagedVaultSell(arbitrumClient,
          input as unknown as ManagedVaultSellInput & { fromBlock: string }));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Finalized vault sell evidence is unavailable" });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-broadcast-sell") {
      const secret = process.env.MANAGED_VAULT_EXECUTION_SECRET ?? "";
      if (secret.length < 32 || req.headers.authorization !== `Bearer ${secret}`) {
        return json(res, 401, { error: "Unauthorized" });
      }
      if (process.env.MANAGED_VAULT_STOP_ENABLED !== "true") {
        return json(res, 423, { error: "Managed vault close authority is unavailable" });
      }
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const account = vaultExecutorSigner();
        if (account.address.toLowerCase()
          !== (process.env.MANAGED_VAULT_EXECUTOR_ADDRESS ?? "").toLowerCase()) {
          throw new Error("Vault sell signer differs from the reviewed executor");
        }
        const input = await scopedBody(req);
        if (!managedVaultTestStopAllowed(process.env, String(input.vaultAddress ?? ""))) {
          return json(res, 423, { error: "Vault is outside the internal close scope" });
        }
        return json(res, 200, await broadcastManagedVaultSell(arbitrumClient,
          input as unknown as ManagedVaultSellInput & { normalizedPayloadHash: string },
          account.address, (to, data) => sendBoundedVaultTransaction(account, to, data)));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message
          : "Managed vault sell broadcast is unavailable" });
      }
    }
    if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
    if (req.method === "GET" && req.url === "/internal/uniswap/scoped-readiness") {
      return json(res, 200, { storage: scopedStorageReadiness,
        broadcastEnabled: scopedStorageReadiness.ready && liveExecution && mainnetSetup && certified.has("uniswap")
          && process.env.SCOPED_UNISWAP_EXECUTION_ENABLED === "true"
          && process.env.MOBILE_SPONSORSHIP_ENABLED === "true" && process.env.MOBILE_SPONSORSHIP_CERTIFIED === "true" });
    }
    if (req.url?.startsWith("/internal/mobile/")) return handleMobileConnector(req, res);
    if (req.method === "GET" && req.url === "/internal/gmx/markets") {
      return json(res, 200, { markets: await gmx.fetchMarkets() });
    }
    if (req.method === "GET" && req.url?.startsWith("/internal/gmx/snapshots")) {
      const requested = new URL(req.url, "http://sidecar").searchParams.get("symbol")?.toUpperCase();
      const [markets, tickers] = await Promise.all([
        gmx.fetchMarkets(),
        gmx.fetchMarketsTickers(),
      ]);
      const listed = new Map(markets.filter((market) => market.isListed && !market.isSpotOnly).map((market) => [market.symbol, market]));
      return json(res, 200, {
        snapshots: tickers.filter((ticker) => listed.has(ticker.symbol)
          && (!requested || ticker.symbol.split("/")[0].toUpperCase() === requested)).map((ticker) => ({
          ...ticker,
          minPositionSizeUsd: listed.get(ticker.symbol)?.minPositionSizeUsd,
          maxLeverage: listed.get(ticker.symbol)?.leverageTiers?.[0]?.maxLeverage,
        })),
      });
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/check-approval") {
      return json(res, 200, await uniswap("check_approval", await body(req)));
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/quote") {
      return json(res, 200, await uniswap("quote", await body(req)));
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-read") {
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const { readManagedSpotVault } = await import("./managedSpotVaultRead.js");
        return json(res, 200, await readManagedSpotVault(arbitrumClient, await body(req)));
      } catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : "Vault read failed" }); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-observe-release") {
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const { observeManagedVaultRelease } = await import("./managedSpotVaultRelease.js");
        return json(res, 200, await observeManagedVaultRelease(arbitrumClient,
          await body(req) as import("./managedSpotVaultRelease.js").ManagedVaultReleaseInput));
      } catch (error) { return json(res, 409, { error: error instanceof Error ? error.message
        : "Finalized Magic vault return evidence is unavailable" }); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/managed-vault-prepare-buy") {
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      try {
        const { prepareManagedVaultBuy } = await import("./managedSpotVaultOrder.js");
        const input = await scopedBody(req);
        return json(res, 200, await prepareManagedVaultBuy(arbitrumClient,
          input as unknown as import("./managedSpotVaultOrder.js").ManagedVaultBuyInput));
      } catch (error) { return json(res, 409,
        { error: error instanceof Error ? error.message : "Vault buy preflight failed" }); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/account") {
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      const request = await body(req);
      return json(res, 200, await readUniswapAccount(arbitrumClient, request.owner));
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-quote") {
      try {
        if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
        const request = await scopedBody(req);
        const slippageBps = request.slippageBps;
        if (typeof slippageBps !== "number" || !Number.isSafeInteger(slippageBps)) throw new Error("slippageBps must be an integer");
        return json(res, 200, await quoteScopedSwap(arbitrumClient, swapScope(request.scope), uintField(request, "amountIn"), slippageBps));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-prepare-broadcast") {
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().prepareBroadcast(request as unknown as ScopedBroadcastInput));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-grant/prepare") {
      try {
        const request = await scopedBody(req), input = grantInput(request), service = scopedService();
        const [grants, allowance] = await Promise.all([
          service.prepare(input), service.allowance(input.owner, input),
        ]);
        return json(res, 200, { grants, ownerAllowanceCalls: service.allowanceCalls(input), allowance });
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-grant/activate") {
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().activate(textField(request, "grantId"), swapScope(request.scope), textField(request, "signature") as Hex));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-grant/read") {
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().read(textField(request, "grantId"), swapScope(request.scope), textField(request, "owner") as Address));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-grant/allowance") {
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().allowanceForGrant(textField(request, "grantId"),
          swapScope(request.scope), textField(request, "owner") as Address));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-grant/revoke") {
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().revoke(textField(request, "grantId"), swapScope(request.scope), textField(request, "owner") as Address));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/scoped-reconcile") {
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().reconcile(textField(request, "grantId"), swapScope(request.scope)));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/hook-quote") {
      const request = await body(req);
      if (!hookExperiment.enabled) return json(res, 200, hookExperiment);
      if (!arbitrumClient) {
        return json(res, 200, { enabled: true, available: false, reason: "ARBITRUM_RPC_URL is not configured" });
      }
      try {
        return json(res, 200, await quoteHookPool(arbitrumClient, hookExperiment, {
          tokenIn: String(request.tokenIn).toLowerCase() as `0x${string}`,
          tokenOut: String(request.tokenOut).toLowerCase() as `0x${string}`,
          amount: String(request.amount),
          swapper: String(request.swapper).toLowerCase() as `0x${string}`,
          slippageTolerance: request.slippageTolerance === undefined
            ? undefined : Number(request.slippageTolerance),
        }));
      } catch (error) {
        return json(res, 200, {
          enabled: true,
          available: false,
          reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
      }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/swap") {
      const request = await body(req);
      const quoteResponse = request.quoteResponse ?? request;
      const quotedAt = Number(request.quotedAt ?? request.moeazi?.quotedAt);
      const expectedSender = String(request.expectedSender ?? request.swapper ?? "");
      assertFresh(quotedAt);
      const result = await uniswap("swap", prepareSwapRequest(quoteResponse, request.signature));
      const transaction = validateTransaction({ result, expectedSender, allowedTargets: swapTargets });
      let simulation = { success: false, reason: "ARBITRUM_RPC_URL is not configured" };
      if (arbitrumClient) {
        try {
          await arbitrumClient.call({ account: transaction.from, to: transaction.to, data: transaction.data, value: transaction.value });
          simulation = { success: true, reason: "eth_call succeeded" };
        } catch (error) {
          simulation = { success: false, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) };
        }
      }
      return json(res, 200, { ...result, routeSource: "trading_api", routing: routingOf(quoteResponse), transaction,
        simulation, broadcastAllowed: false });
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/broadcast") {
      if (!liveExecution || !mainnetSetup || !certified.has("uniswap")
        || process.env.SCOPED_UNISWAP_EXECUTION_ENABLED !== "true"
        || process.env.MOBILE_SPONSORSHIP_ENABLED !== "true" || process.env.MOBILE_SPONSORSHIP_CERTIFIED !== "true") {
        return json(res, 423, { error: "Uniswap live execution certification gate is closed" });
      }
      try {
        const request = await scopedBody(req);
        return json(res, 200, await scopedService().broadcast(request as unknown as ScopedBroadcastInput));
      } catch (error) { return scopedRouteError(res, error); }
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/reconcile-swap") {
      if (!arbitrumClient) return json(res, 503, { error: "ARBITRUM_RPC_URL is not configured" });
      return json(res, 200, await reconcileUniswapSwap(arbitrumClient, await body(req)));
    }
    if (req.method === "POST" && req.url === "/internal/uniswap/cancel") {
      return json(res, 409, { error: "A broadcast AMM swap cannot be cancelled; reconcile its receipt instead" });
    }
    if (req.method === "POST" && req.url?.startsWith("/internal/execute")) {
      await body(req);
      if (!liveExecution) return json(res, 423, { error: "Live execution circuit breaker is open" });
      return json(res, 501, {
        error: "Signing endpoint intentionally unavailable until the venue canary suite certifies it",
      });
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0");
