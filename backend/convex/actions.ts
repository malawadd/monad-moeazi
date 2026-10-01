"use node";

import { createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { pack } from "msgpackr";
import {
  concat,
  Contract,
  getAddress,
  getBytes,
  JsonRpcProvider,
  keccak256,
  MaxUint256,
  parseEther,
  parseUnits,
  Signature,
  toBeHex,
  Wallet,
  zeroPadValue,
} from "ethers";
import {
  ALLOWED_UNISWAP_EXECUTORS,
  HYPERLIQUID_API_URL,
  HYPERLIQUID_SIGNATURE_CHAIN_ID,
  LINK_USDC_POOL_FEE,
  LINK_ADDRESS,
  OPTIMISM_NATIVE_ASSET,
  OPTIMISM_ETH_USD_FEED_ADDRESS,
  SWAP_ROUTER_ADDRESS,
  UNISWAP_USDC_ADDRESS,
  EXECUTION_MODE,
} from "./constants";
import { evaluateExecutionPolicy } from "./helpers/executionPolicy";
import { decryptSecret, generateManagedWallet } from "./helpers/walletCrypto";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];
const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
];
const CHAINLINK_AGGREGATOR_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

function toCaip10(chainRef: string, address: string) {
  return `${chainRef}:${address.toLowerCase()}`;
}

function normalizeEvmAddress(address: string) {
  return getAddress(address.toLowerCase());
}

function getOptimismRpcUrl() {
  const rpcUrl = process.env.OPTIMISM_RPC_URL ?? process.env.QUICKNODE_HTTP;
  if (!rpcUrl) {
    throw new Error("OPTIMISM_RPC_URL is only required to read or migrate a legacy Optimism account.");
  }
  return rpcUrl;
}

function parseTxNumber(value: string | number | bigint | undefined, fallback = BigInt(0)) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return value.startsWith("0x") ? BigInt(value) : BigInt(value);
}

function stripEip712Domain(types: Record<string, Array<{ name: string; type: string }>>) {
  const next = { ...types };
  delete next.EIP712Domain;
  return next;
}

function signatureParts(signatureHex: string) {
  const signature = Signature.from(signatureHex);
  return {
    r: signature.r,
    s: signature.s,
    v: signature.v,
  };
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request to ${url} failed (${response.status}): ${text.slice(0, 400)}`);
  }

  return await response.json();
}

function hashIntent(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function weiToEthNumber(value: bigint) {
  return Number(value) / 1e18;
}

function estimateFeeUsdFromGas(args: {
  gasEstimate: bigint;
  gasPriceWei: bigint;
  ethPriceUsd: number;
}) {
  const feeEth = weiToEthNumber(args.gasEstimate * args.gasPriceWei);
  return Number((feeEth * args.ethPriceUsd).toFixed(6));
}

function createExecutionWallet(privateKey: string) {
  return new Wallet(privateKey, new JsonRpcProvider(getOptimismRpcUrl()));
}

function createSigningWallet(privateKey: string) {
  return new Wallet(privateKey);
}

function resolveOptimismAsset(asset: string) {
  const normalized = asset.toUpperCase();
  if (normalized === OPTIMISM_NATIVE_ASSET) {
    return { kind: "native" as const, decimals: 18 };
  }
  if (normalized === "USDC") {
    return { kind: "erc20" as const, address: UNISWAP_USDC_ADDRESS, decimals: 6 };
  }
  if (normalized === "LINK") {
    return { kind: "erc20" as const, address: LINK_ADDRESS, decimals: 18 };
  }
  throw new Error(`Unsupported Optimism withdrawal asset: ${asset}`);
}

async function simulateTransaction(
  wallet: Wallet,
  tx: { to?: string; data?: string; value?: bigint },
  options?: { enforceAllowlist?: boolean },
) {
  if (!wallet.provider) {
    throw new Error("Execution wallet provider is missing");
  }

  const to = tx.to?.toLowerCase();
  if (
    options?.enforceAllowlist !== false &&
    to &&
    !ALLOWED_UNISWAP_EXECUTORS.includes(to) &&
    ![LINK_ADDRESS, UNISWAP_USDC_ADDRESS].map((value) => value.toLowerCase()).includes(to)
  ) {
    throw new Error(`Transaction target ${tx.to} is not on the Moeazi allowlist.`);
  }

  const simulationRequest = {
    from: wallet.address,
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? BigInt(0),
  };

  const [_, gasEstimate] = await Promise.all([
    wallet.provider.call(simulationRequest),
    wallet.provider.estimateGas(simulationRequest),
  ]);

  return {
    provider: "rpc_call",
    gasEstimate: gasEstimate.toString(),
    target: tx.to ?? null,
  };
}

async function getPolicyContext(ctx: any, strategyAccountId: any): Promise<any> {
  return await ctx.runQuery(internal.private.getStrategyPolicyContext, {
    strategyAccountId,
  });
}

async function enforceExecutionPolicy(ctx: any, args: {
  strategyAccountId: any;
  intent: {
    kind: "uniswap_pool_swap" | "uniswap_rebalance" | "hyperliquid_approve_agent" | "hyperliquid_order" | "withdrawal" | "system";
    origin: "viewer" | "supervisor" | "system";
    notionalUsd?: number;
    slippageBps?: number;
    tokenIn?: string;
    tokenOut?: string;
    coin?: string;
  };
}): Promise<{ policyContext: any; result: any }> {
  const policyContext = await getPolicyContext(ctx, args.strategyAccountId);
  const result = evaluateExecutionPolicy({
    strategyAccount: policyContext.strategyAccount,
    config: policyContext.config,
    recentExecutions: policyContext.recentExecutions,
    intent: args.intent,
  });

  return {
    policyContext,
    result,
  };
}

async function ensureAllowance(wallet: Wallet, tokenAddress: string, spender: string, minAmount: bigint) {
  const token = new Contract(tokenAddress, ERC20_ABI, wallet);
  const allowance = (await token.allowance(wallet.address, spender)) as bigint;
  if (allowance >= minAmount) {
    return null;
  }

  const tx = await token.approve(spender, MaxUint256);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

async function sendApprovalFromUniswapApi(
  wallet: Wallet,
  token: string,
  amountRaw: string,
) {
  const data = await postJson(
    `${process.env.UNISWAP_API_URL ?? "https://trade-api.gateway.uniswap.org/v1"}/check_approval`,
    {
      walletAddress: wallet.address,
      token,
      amount: amountRaw,
      chainId: 10,
      includeGasInfo: true,
    },
    {
      "x-api-key": process.env.UNISWAP_API_KEY ?? "",
      "x-universal-router-version": "2.0",
    },
  );

  const approval = (data as { approval?: { to: string; data: string; value?: string; gasLimit?: string } }).approval;
  if (!approval) {
    return null;
  }

  const tx = await wallet.sendTransaction({
    to: approval.to,
    data: approval.data,
    value: parseTxNumber(approval.value),
    gasLimit: parseTxNumber(approval.gasLimit, BigInt(100000)),
  });
  const receipt = await tx.wait();
  return {
    txHash: receipt?.hash ?? tx.hash,
    status: receipt?.status ?? 0,
  };
}

async function quoteUniswapTrade(wallet: Wallet, tokenIn: string, tokenOut: string, amountRaw: string, slippageBps: number) {
  return await postJson(
    `${process.env.UNISWAP_API_URL ?? "https://trade-api.gateway.uniswap.org/v1"}/quote`,
    {
      type: "EXACT_INPUT",
      amount: amountRaw,
      tokenIn,
      tokenOut,
      tokenInChainId: "10",
      tokenOutChainId: "10",
      swapper: wallet.address,
      slippageTolerance: slippageBps / 100,
      routingPreference: "BEST_PRICE",
    },
    {
      "x-api-key": process.env.UNISWAP_API_KEY ?? "",
      "x-universal-router-version": "2.0",
    },
  );
}

async function signPermitData(wallet: Wallet, permitData: any) {
  const signature = await wallet.signTypedData(
    permitData.domain,
    stripEip712Domain(permitData.types),
    permitData.values,
  );
  return signature;
}

async function buildAndSendUniswapSwap(wallet: Wallet, quoteResponse: any, signature?: string) {
  const payload: Record<string, unknown> = {
    quote: quoteResponse.quote,
    simulateTransaction: true,
  };

  if (signature && signature !== "0x") {
    payload.signature = signature;
  }
  if (quoteResponse.permitData) {
    payload.permitData = quoteResponse.permitData;
  }

  const swapData = (await postJson(
    `${process.env.UNISWAP_API_URL ?? "https://trade-api.gateway.uniswap.org/v1"}/swap`,
    payload,
    {
      "x-api-key": process.env.UNISWAP_API_KEY ?? "",
      "x-universal-router-version": "2.0",
    },
  )) as { swap?: { to: string; data: string; value?: string; gasLimit?: string } };

  if (!swapData.swap) {
    throw new Error(`Uniswap swap payload missing transaction data: ${JSON.stringify(swapData)}`);
  }

  const tx = await wallet.sendTransaction({
    to: swapData.swap.to,
    data: swapData.swap.data,
    value: parseTxNumber(swapData.swap.value),
    gasLimit: parseTxNumber(swapData.swap.gasLimit, BigInt(300000)),
  });
  const receipt = await tx.wait();

  return {
    txHash: receipt?.hash ?? tx.hash,
    gasUsed: receipt?.gasUsed?.toString() ?? null,
    status: receipt?.status ?? 0,
  };
}

function addressToBytes(address: string) {
  return getBytes(address.toLowerCase());
}

function hyperliquidActionHash(action: unknown, vaultAddress: string | null, nonce: number, expiresAfter?: number | null) {
  const parts: Uint8Array[] = [
    pack(action),
    getBytes(zeroPadValue(toBeHex(nonce), 8)),
  ];

  if (vaultAddress === null) {
    parts.push(Uint8Array.from([0]));
  } else {
    parts.push(Uint8Array.from([1]));
    parts.push(addressToBytes(vaultAddress));
  }

  if (expiresAfter !== undefined && expiresAfter !== null) {
    parts.push(Uint8Array.from([0]));
    parts.push(getBytes(zeroPadValue(toBeHex(expiresAfter), 8)));
  }

  return keccak256(concat(parts));
}

async function signHyperliquidL1Action(wallet: Wallet, action: unknown, nonce: number, isMainnet = true) {
  const payload = {
    domain: {
      chainId: 1337,
      name: "Exchange",
      verifyingContract: ZERO_ADDRESS,
      version: "1",
    },
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
    message: {
      source: isMainnet ? "a" : "b",
      connectionId: hyperliquidActionHash(action, null, nonce, null),
    },
  };

  const signature = await wallet.signTypedData(
    payload.domain,
    stripEip712Domain(payload.types),
    payload.message,
  );
  return signatureParts(signature);
}

async function signHyperliquidUserAction(
  wallet: Wallet,
  action: Record<string, unknown>,
  payloadTypes: Array<{ name: string; type: string }>,
  primaryType: string,
  isMainnet = true,
) {
  const signedAction = {
    ...action,
    signatureChainId: HYPERLIQUID_SIGNATURE_CHAIN_ID,
    hyperliquidChain: isMainnet ? "Mainnet" : "Testnet",
  };

  const domain = {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: parseInt(HYPERLIQUID_SIGNATURE_CHAIN_ID, 16),
    verifyingContract: ZERO_ADDRESS,
  };
  const types = {
    [primaryType]: payloadTypes,
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
  };

  const signature = await wallet.signTypedData(domain, stripEip712Domain(types), signedAction);
  return {
    signedAction,
    signature: signatureParts(signature),
  };
}

async function postHyperliquidExchange(actionBody: Record<string, unknown>, signature: Record<string, unknown>, nonce: number) {
  return await postJson(`${HYPERLIQUID_API_URL}/exchange`, {
    action: actionBody,
    nonce,
    signature,
    vaultAddress: null,
    expiresAfter: null,
  });
}

async function getHyperliquidMarketInfo(coin: string) {
  const [meta, mids] = await Promise.all([
    postJson(`${HYPERLIQUID_API_URL}/info`, { type: "meta" }),
    postJson(`${HYPERLIQUID_API_URL}/info`, { type: "allMids" }),
  ]);

  const universe = (meta as { universe: Array<{ name: string; szDecimals: number }> }).universe;
  const asset = universe.findIndex((item) => item.name === coin);
  if (asset < 0) {
    throw new Error(`Coin ${coin} not found in HyperLiquid metadata`);
  }

  const sizeDecimals = universe[asset]?.szDecimals ?? 0;
  const mid = Number((mids as Record<string, string>)[coin]);
  if (!Number.isFinite(mid) || mid <= 0) {
    throw new Error(`Invalid HyperLiquid mid price for ${coin}`);
  }

  return {
    asset,
    sizeDecimals,
    mid,
  };
}

async function getOptimismEthUsdPrice(provider: any) {
  const feed = new Contract(normalizeEvmAddress(OPTIMISM_ETH_USD_FEED_ADDRESS), CHAINLINK_AGGREGATOR_ABI, provider);
  const [decimals, roundData] = await Promise.all([
    feed.decimals(),
    feed.latestRoundData() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
  ]);
  const answer = Number(roundData[1]);
  if (!Number.isFinite(answer) || answer <= 0) {
    throw new Error("ETH/USD price feed returned an invalid answer.");
  }
  return answer / 10 ** Number(decimals);
}

async function readOptimismWalletSnapshot(address: string) {
  const provider = new JsonRpcProvider(getOptimismRpcUrl());
  const [ethPriceUsd, linkMid] = await Promise.all([
    getOptimismEthUsdPrice(provider),
    getHyperliquidMarketInfo("LINK").then((result) => result.mid),
  ]);
  const usdc = new Contract(normalizeEvmAddress(UNISWAP_USDC_ADDRESS), ERC20_ABI, provider);
  const link = new Contract(normalizeEvmAddress(LINK_ADDRESS), ERC20_ABI, provider);
  const [ethRaw, usdcRaw, linkRaw] = await Promise.all([
    provider.getBalance(address),
    usdc.balanceOf(address) as Promise<bigint>,
    link.balanceOf(address) as Promise<bigint>,
  ]);

  const ethAmount = Number(ethRaw) / 1e18;
  const usdcAmount = Number(usdcRaw) / 1e6;
  const linkAmount = Number(linkRaw) / 1e18;
  const balances = [
    {
      asset: "ETH",
      amount: ethAmount.toFixed(8),
      valueUsd: Number((ethAmount * ethPriceUsd).toFixed(2)),
      purpose: "gas" as const,
      includedInStrategyEquity: false,
    },
    {
      asset: "USDC",
      amount: usdcAmount.toFixed(6),
      valueUsd: Number(usdcAmount.toFixed(2)),
      purpose: "capital" as const,
      includedInStrategyEquity: true,
    },
    {
      asset: "LINK",
      amount: linkAmount.toFixed(8),
      valueUsd: Number((linkAmount * linkMid).toFixed(2)),
      purpose: "inventory" as const,
      includedInStrategyEquity: true,
    },
  ];

  const strategyValueUsd = balances
    .filter((row) => row.includedInStrategyEquity)
    .reduce((sum, row) => sum + row.valueUsd, 0);
  const gasValueUsd = balances
    .filter((row) => row.purpose === "gas")
    .reduce((sum, row) => sum + row.valueUsd, 0);

  return {
    balances,
    strategyValueUsd: Number(strategyValueUsd.toFixed(2)),
    gasValueUsd: Number(gasValueUsd.toFixed(2)),
    totalValueUsd: Number((strategyValueUsd + gasValueUsd).toFixed(2)),
    linkPriceUsd: Number(linkMid.toFixed(6)),
    ethPriceUsd: Number(ethPriceUsd.toFixed(2)),
  };
}

async function readHyperliquidAccountSnapshot(address: string) {
  const [state, openOrders, rateLimits, mids] = await Promise.all([
    postJson(`${HYPERLIQUID_API_URL}/info`, { type: "clearinghouseState", user: address }),
    postJson(`${HYPERLIQUID_API_URL}/info`, { type: "openOrders", user: address }),
    postJson(`${HYPERLIQUID_API_URL}/info`, { type: "userRateLimit", user: address }),
    postJson(`${HYPERLIQUID_API_URL}/info`, { type: "allMids" }),
  ]);
  const marginSummary = (state as any).marginSummary || (state as any).crossMarginSummary || {};
  const withdrawable = (state as any).withdrawable || marginSummary.withdrawable || "0";
  const assetPositions = (state as any).assetPositions || [];
  const linkMid = Number((mids as Record<string, string>).LINK ?? 0);
  let hedgeValueUsd = 0;
  let netExposureUsd = 0;
  const positions = assetPositions.map((rawPosition: any) => {
    const position = rawPosition?.position ?? rawPosition ?? {};
    const coin = String(position.coin || position.name || "");
    const size = Number(position.szi || 0);
    const markPrice = Number(position.markPx || linkMid || 0);
    const positionValue = Number(position.positionValue || size * markPrice || 0);
    const unrealized = Number(position.unrealizedPnl || 0);
    hedgeValueUsd += Math.abs(positionValue);
    if (coin.toUpperCase() === "LINK") {
      netExposureUsd += size * markPrice;
    }
    return {
      coin,
      size,
      entry_price: Number(position.entryPx || 0),
      mark_price: markPrice,
      position_value_usd: positionValue,
      unrealized_pnl_usd: unrealized,
    };
  });

  return {
    account_value_usd: Number(marginSummary.accountValue || 0),
    withdrawable_usd: Number(withdrawable || 0),
    maintenance_margin_usd: Number(marginSummary.totalMarginUsed || 0),
    hedge_value_usd: Number(hedgeValueUsd.toFixed(2)),
    net_exposure_usd: Number(netExposureUsd.toFixed(2)),
    positions,
    open_orders: Array.isArray(openOrders) ? openOrders : (openOrders as any).orders || [],
    rate_limits: rateLimits,
    raw_state: state,
  };
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** Math.max(decimals, 0);
  return Math.round(value * factor) / factor;
}

function floatToWire(value: number) {
  const rounded = value.toFixed(8);
  if (Math.abs(Number(rounded) - value) >= 1e-12) {
    throw new Error(`floatToWire would round unexpectedly: ${value}`);
  }

  const normalized = rounded.replace(/0+$/, "").replace(/\.$/, "");
  return normalized === "-0" || normalized === "" ? "0" : normalized;
}

function buildAggressiveHyperliquidPrice(mid: number, isBuy: boolean, slippage: number, sizeDecimals: number) {
  const slipped = mid * (isBuy ? 1 + slippage : 1 - slippage);
  const precisionPrice = Number(slipped.toPrecision(5));
  return roundTo(precisionPrice, Math.max(0, 6 - sizeDecimals));
}

async function recordExecution(ctx: any, args: {
  strategyAccountId: any;
  venueAccountId?: any;
  kind: "uniswap_pool_swap" | "uniswap_rebalance" | "hyperliquid_approve_agent" | "hyperliquid_order" | "withdrawal" | "system";
  status: "pending" | "submitted" | "filled" | "failed" | "skipped";
  summary: string;
  detail?: string;
  txHash?: string;
  requestId?: string;
  notionalUsd?: number;
  metadataJson?: string;
  origin?: "viewer" | "supervisor" | "system";
  pipelineStage?: "intent" | "prechecks" | "simulation" | "signing" | "broadcast" | "confirmation" | "reconciliation";
  policyJson?: string;
  simulationJson?: string;
  confirmedAt?: number;
  intentHash?: string;
}) {
  await ctx.runMutation(internal.worker.recordExecution, args);
}

export const simulateExecution = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    kind: v.union(
      v.literal("uniswap_pool_swap"),
      v.literal("uniswap_rebalance"),
      v.literal("hyperliquid_approve_agent"),
      v.literal("hyperliquid_order"),
      v.literal("withdrawal"),
      v.literal("system"),
    ),
    origin: v.optional(v.union(v.literal("viewer"), v.literal("supervisor"), v.literal("system"))),
    notionalUsd: v.optional(v.number()),
    slippageBps: v.optional(v.number()),
    tokenIn: v.optional(v.string()),
    tokenOut: v.optional(v.string()),
    coin: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const { result }: { result: any } = await enforceExecutionPolicy(ctx, {
      strategyAccountId: args.strategyAccountId,
      intent: {
        kind: args.kind,
        origin: args.origin ?? "system",
        notionalUsd: args.notionalUsd,
        slippageBps: args.slippageBps,
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        coin: args.coin,
      },
    });

    return result;
  },
});

export const refreshManagedFundingState = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
  },
  handler: async (ctx, args): Promise<any> => {
    const now = Date.now();
    const context = await ctx.runQuery(internal.private.getStrategyExecutionContext, {
      strategyAccountId: args.strategyAccountId,
    });
    const venueAccounts = context.venueAccounts ?? [];
    const optimismAccount = venueAccounts.find((account: any) => account.role === "optimism_execution_wallet");
    const hyperliquidAccount = venueAccounts.find((account: any) => account.role === "hyperliquid_master_wallet");
    const transferRefBase = `manual-refresh:${args.strategyAccountId}:${now}`;
    const results: Array<Record<string, unknown>> = [];
    let optimismSnapshot:
      | {
          balances: Array<{
            asset: string;
            amount: string;
            valueUsd: number;
            purpose: "capital" | "inventory" | "gas";
            includedInStrategyEquity: boolean;
          }>;
          strategyValueUsd: number;
          gasValueUsd: number;
          totalValueUsd: number;
          linkPriceUsd: number;
          ethPriceUsd: number;
        }
      | null = null;
    let hyperliquidSnapshot:
      | {
          account_value_usd: number;
          withdrawable_usd: number;
          maintenance_margin_usd: number;
          hedge_value_usd: number;
          net_exposure_usd: number;
          positions: unknown[];
          open_orders: unknown[];
          rate_limits: unknown;
          raw_state: unknown;
        }
      | null = null;

    if (optimismAccount) {
      try {
        optimismSnapshot = await readOptimismWalletSnapshot(optimismAccount.walletAddress);
        await ctx.runMutation(internal.mutations.syncVenueAccountState, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: optimismAccount._id,
          syncKind: "balance",
          status: "fresh",
          summary: "Manual wallet refresh read Optimism balances from the chain.",
          dataJson: JSON.stringify({
            balances: optimismSnapshot.balances,
            strategyValueUsd: optimismSnapshot.strategyValueUsd,
            gasValueUsd: optimismSnapshot.gasValueUsd,
            totalValueUsd: optimismSnapshot.totalValueUsd,
            linkPriceUsd: optimismSnapshot.linkPriceUsd,
            ethPriceUsd: optimismSnapshot.ethPriceUsd,
          }),
          totalValueUsd: optimismSnapshot.totalValueUsd,
          balances: optimismSnapshot.balances,
          transferRef: `${transferRefBase}:optimism`,
        });
        results.push({
          role: "optimism_execution_wallet",
          status: "fresh",
          walletAddress: optimismAccount.walletAddress,
          balances: optimismSnapshot.balances,
          totalValueUsd: optimismSnapshot.totalValueUsd,
        });
      } catch (error) {
        await ctx.runMutation(internal.mutations.syncVenueAccountState, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: optimismAccount._id,
          syncKind: "balance",
          status: "error",
          summary: error instanceof Error ? error.message : "Manual Optimism refresh failed.",
          dataJson: undefined,
          error: error instanceof Error ? error.message : String(error),
          totalValueUsd: undefined,
          balances: [],
          transferRef: `${transferRefBase}:optimism:error`,
        });
        results.push({
          role: "optimism_execution_wallet",
          status: "error",
          walletAddress: optimismAccount.walletAddress,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (hyperliquidAccount) {
      try {
        hyperliquidSnapshot = await readHyperliquidAccountSnapshot(hyperliquidAccount.walletAddress);
        await ctx.runMutation(internal.mutations.syncVenueAccountState, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: hyperliquidAccount._id,
          syncKind: "hedge_state",
          status: "fresh",
          summary: "Manual wallet refresh read HyperLiquid account state from the venue.",
          dataJson: JSON.stringify(hyperliquidSnapshot),
          totalValueUsd: hyperliquidSnapshot.account_value_usd,
          balances: [
            {
              asset: "USDC",
              amount: hyperliquidSnapshot.account_value_usd.toFixed(6),
              valueUsd: Number(hyperliquidSnapshot.account_value_usd.toFixed(2)),
              purpose: "capital",
              includedInStrategyEquity: true,
            },
          ],
          transferRef: `${transferRefBase}:hyperliquid`,
        });
        results.push({
          role: "hyperliquid_master_wallet",
          status: "fresh",
          walletAddress: hyperliquidAccount.walletAddress,
          accountValueUsd: hyperliquidSnapshot.account_value_usd,
          withdrawableUsd: hyperliquidSnapshot.withdrawable_usd,
        });
      } catch (error) {
        await ctx.runMutation(internal.mutations.syncVenueAccountState, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: hyperliquidAccount._id,
          syncKind: "hedge_state",
          status: "error",
          summary: error instanceof Error ? error.message : "Manual HyperLiquid refresh failed.",
          dataJson: undefined,
          error: error instanceof Error ? error.message : String(error),
          totalValueUsd: undefined,
          balances: [],
          transferRef: `${transferRefBase}:hyperliquid:error`,
        });
        results.push({
          role: "hyperliquid_master_wallet",
          status: "error",
          walletAddress: hyperliquidAccount.walletAddress,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const lpValueUsd = Number(context.latestSnapshot?.lpValueUsd ?? 0);
    const hedgeValueUsd = Number(
      hyperliquidSnapshot?.hedge_value_usd ?? context.latestSnapshot?.hedgeValueUsd ?? 0,
    );
    const optimismStrategyValueUsd = Number(optimismSnapshot?.strategyValueUsd ?? 0);
    const hyperliquidCashUsd = Number(hyperliquidSnapshot?.account_value_usd ?? 0);
    const cashValueUsd = Number((optimismStrategyValueUsd + hyperliquidCashUsd).toFixed(2));
    const totalEquityUsd = Number((lpValueUsd + hedgeValueUsd + cashValueUsd).toFixed(2));
    const linkSpotValueUsd =
      optimismSnapshot?.balances.find((row) => row.asset === "LINK")?.valueUsd ?? 0;
    const netExposureUsd = Number(
      (linkSpotValueUsd + Number(hyperliquidSnapshot?.net_exposure_usd ?? 0)).toFixed(2),
    );
    const accountBalances = [
      ...(optimismSnapshot?.balances.map((row) => ({
        venueRole: "optimism_execution_wallet",
        asset: row.asset,
        amount: row.amount,
        valueUsd: row.valueUsd,
        purpose: row.purpose,
        includedInStrategyEquity: row.includedInStrategyEquity,
      })) ?? []),
    ];
    if (hyperliquidSnapshot) {
      accountBalances.push({
        venueRole: "hyperliquid_master_wallet",
        asset: "USDC",
        amount: hyperliquidSnapshot.account_value_usd.toFixed(6),
        valueUsd: Number(hyperliquidSnapshot.account_value_usd.toFixed(2)),
        purpose: "capital",
        includedInStrategyEquity: true,
      });
    }

    if (accountBalances.length > 0) {
      await ctx.runMutation(internal.worker.recordSnapshot, {
        strategyAccountId: args.strategyAccountId,
        totalEquityUsd,
        lpValueUsd,
        hedgeValueUsd,
        cashValueUsd,
        netExposureUsd,
        accountBalances,
        capturedBy: "manual_refresh",
        freshnessMs: 0,
        mode: context.config?.executionMode ?? EXECUTION_MODE.live,
        capturedAt: now,
      });
    }

    return {
      refreshedAt: now,
      results,
      snapshotRecorded: accountBalances.length > 0,
    };
  },
});

export const executeUniPoolSwap = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    tokenIn: v.string(),
    tokenOut: v.string(),
    amountInRaw: v.string(),
    amountOutMinimumRaw: v.optional(v.string()),
    poolFee: v.optional(v.number()),
    notionalUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (process.env.LEGACY_OPTIMISM_EXECUTION_ENABLED !== "true") {
      throw new Error("Legacy Optimism execution is disabled; use the Arbitrum execution gateway.");
    }
    const { venueAccount, walletSecret } = await ctx.runQuery(internal.private.getManagedWalletContext, {
      strategyAccountId: args.strategyAccountId,
      role: "optimism_execution_wallet",
    });
    const intent = {
      kind: "uniswap_pool_swap" as const,
      origin: "supervisor" as const,
      notionalUsd: args.notionalUsd,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
    };
    const intentHash = hashIntent(intent);
    const { result } = await enforceExecutionPolicy(ctx, {
      strategyAccountId: args.strategyAccountId,
      intent,
    });

    if (!result.ok) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: venueAccount._id,
        kind: "uniswap_pool_swap",
        status: "skipped",
        summary: "Uniswap pool swap blocked by execution policy",
        detail: result.message,
        notionalUsd: args.notionalUsd,
        origin: intent.origin,
        pipelineStage: "prechecks",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      return { success: false, skipped: true, reason: result.code };
    }

    const wallet = createExecutionWallet(decryptSecret(walletSecret));

    try {
      await ensureAllowance(wallet, args.tokenIn, SWAP_ROUTER_ADDRESS, parseTxNumber(args.amountInRaw));

      const router = new Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const populated = await router.getFunction("exactInputSingle").populateTransaction([
        args.tokenIn,
        args.tokenOut,
        args.poolFee ?? LINK_USDC_POOL_FEE,
        wallet.address,
        deadline,
        parseTxNumber(args.amountInRaw),
        parseTxNumber(args.amountOutMinimumRaw, BigInt(0)),
        BigInt(0),
      ]);
      const simulation = await simulateTransaction(wallet, {
        to: populated.to ?? SWAP_ROUTER_ADDRESS,
        data: populated.data ?? "0x",
        value: parseTxNumber(populated.value as any, BigInt(0)),
      });

      if (result.mode === EXECUTION_MODE.shadow) {
        await recordExecution(ctx, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: venueAccount._id,
          kind: "uniswap_pool_swap",
          status: "skipped",
          summary: "Uniswap pool swap recorded in shadow mode",
          detail: `${args.tokenIn} -> ${args.tokenOut}`,
          notionalUsd: args.notionalUsd,
          origin: intent.origin,
          pipelineStage: "simulation",
          policyJson: JSON.stringify(result.policy),
          simulationJson: JSON.stringify(simulation),
          intentHash,
        });
        return { success: false, skipped: true, shadow: true };
      }

      const tx = await wallet.sendTransaction({
        to: populated.to ?? SWAP_ROUTER_ADDRESS,
        data: populated.data,
        value: parseTxNumber(populated.value as any, BigInt(0)),
      });
      const receipt = await tx.wait();

      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: venueAccount._id,
        kind: "uniswap_pool_swap",
        status: receipt?.status === 1 ? "filled" : "failed",
        summary: "Uniswap pool swap executed",
        detail: `${args.tokenIn} -> ${args.tokenOut}`,
        txHash: receipt?.hash ?? tx.hash,
        notionalUsd: args.notionalUsd,
        metadataJson: JSON.stringify({ amountInRaw: args.amountInRaw }),
        origin: intent.origin,
        pipelineStage: "confirmation",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify(simulation),
        confirmedAt: receipt?.status === 1 ? Date.now() : undefined,
        intentHash,
      });

      return {
        success: receipt?.status === 1,
        txHash: receipt?.hash ?? tx.hash,
      };
    } catch (error) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: venueAccount._id,
        kind: "uniswap_pool_swap",
        status: "failed",
        summary: "Uniswap pool swap failed",
        detail: error instanceof Error ? error.message : String(error),
        notionalUsd: args.notionalUsd,
        metadataJson: JSON.stringify({ amountInRaw: args.amountInRaw }),
        origin: intent.origin,
        pipelineStage: "simulation",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      throw error;
    }
  },
});

export const executeUniRebalance = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    tokenIn: v.string(),
    tokenOut: v.string(),
    amountInRaw: v.string(),
    slippageBps: v.optional(v.number()),
    notionalUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (process.env.LEGACY_OPTIMISM_EXECUTION_ENABLED !== "true") {
      throw new Error("Legacy Optimism execution is disabled; use the Arbitrum execution gateway.");
    }
    const { venueAccount, walletSecret } = await ctx.runQuery(internal.private.getManagedWalletContext, {
      strategyAccountId: args.strategyAccountId,
      role: "optimism_execution_wallet",
    });
    const intent = {
      kind: "uniswap_rebalance" as const,
      origin: "supervisor" as const,
      notionalUsd: args.notionalUsd,
      slippageBps: args.slippageBps,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
    };
    const intentHash = hashIntent(intent);
    const { result } = await enforceExecutionPolicy(ctx, {
      strategyAccountId: args.strategyAccountId,
      intent,
    });

    if (!result.ok) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: venueAccount._id,
        kind: "uniswap_rebalance",
        status: "skipped",
        summary: "Uniswap rebalance blocked by execution policy",
        detail: result.message,
        notionalUsd: args.notionalUsd,
        origin: intent.origin,
        pipelineStage: "prechecks",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      return { success: false, skipped: true, reason: result.code };
    }

    const wallet = createExecutionWallet(decryptSecret(walletSecret));

    try {
      await sendApprovalFromUniswapApi(wallet, args.tokenIn, args.amountInRaw);
      const quote = await quoteUniswapTrade(
        wallet,
        args.tokenIn,
        args.tokenOut,
        args.amountInRaw,
        args.slippageBps ?? 50,
      );
      const permitSignature = quote.permitData ? await signPermitData(wallet, quote.permitData) : undefined;
      const previewPayload: Record<string, unknown> = {
        quote: quote.quote,
        simulateTransaction: true,
      };
      if (permitSignature) previewPayload.signature = permitSignature;
      if (quote.permitData) previewPayload.permitData = quote.permitData;
      const swapData = (await postJson(
        `${process.env.UNISWAP_API_URL ?? "https://trade-api.gateway.uniswap.org/v1"}/swap`,
        previewPayload,
        {
          "x-api-key": process.env.UNISWAP_API_KEY ?? "",
          "x-universal-router-version": "2.0",
        },
      )) as { swap?: { to: string; data: string; value?: string; gasLimit?: string } };

      if (!swapData.swap) {
        throw new Error("Uniswap swap payload missing transaction data.");
      }

      const simulation = await simulateTransaction(wallet, {
        to: swapData.swap.to,
        data: swapData.swap.data,
        value: parseTxNumber(swapData.swap.value),
      });

      if (result.mode === EXECUTION_MODE.shadow) {
        await recordExecution(ctx, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: venueAccount._id,
          kind: "uniswap_rebalance",
          status: "skipped",
          summary: "Uniswap rebalance recorded in shadow mode",
          detail: `${args.tokenIn} -> ${args.tokenOut}`,
          notionalUsd: args.notionalUsd,
          origin: intent.origin,
          pipelineStage: "simulation",
          policyJson: JSON.stringify(result.policy),
          simulationJson: JSON.stringify(simulation),
          intentHash,
        });
        return { success: false, skipped: true, shadow: true };
      }

      const executionResult = await buildAndSendUniswapSwap(wallet, quote, permitSignature);

      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: venueAccount._id,
        kind: "uniswap_rebalance",
        status: executionResult.status === 1 ? "filled" : "failed",
        summary: "Uniswap rebalance routed through Trading API",
        detail: `${args.tokenIn} -> ${args.tokenOut}`,
        txHash: executionResult.txHash,
        notionalUsd: args.notionalUsd,
        metadataJson: JSON.stringify({ amountInRaw: args.amountInRaw, gasUsed: executionResult.gasUsed }),
        origin: intent.origin,
        pipelineStage: "confirmation",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify(simulation),
        confirmedAt: executionResult.status === 1 ? Date.now() : undefined,
        intentHash,
      });

      return {
        success: executionResult.status === 1,
        txHash: executionResult.txHash,
        gasUsed: executionResult.gasUsed,
      };
    } catch (error) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: venueAccount._id,
        kind: "uniswap_rebalance",
        status: "failed",
        summary: "Uniswap rebalance failed",
        detail: error instanceof Error ? error.message : String(error),
        notionalUsd: args.notionalUsd,
        metadataJson: JSON.stringify({ amountInRaw: args.amountInRaw }),
        origin: intent.origin,
        pipelineStage: "simulation",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      throw error;
    }
  },
});

export const executeHLApproveAgent = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    agentName: v.optional(v.string()),
    origin: v.optional(v.union(v.literal("viewer"), v.literal("supervisor"), v.literal("system"))),
  },
  handler: async (ctx, args) => {
    const { master, masterSecret, agent } = await ctx.runQuery(internal.private.getHyperliquidWalletPair, {
      strategyAccountId: args.strategyAccountId,
    });
    const origin = args.origin ?? "viewer";
    const intent = {
      kind: "hyperliquid_approve_agent" as const,
      origin,
      coin: "LINK",
    };
    const intentHash = hashIntent({
      ...intent,
      agent: agent.walletAddress,
      agentName: args.agentName ?? "",
    });
    const { result } = await enforceExecutionPolicy(ctx, {
      strategyAccountId: args.strategyAccountId,
      intent,
    });

    if (!result.ok) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: agent._id,
        kind: "hyperliquid_approve_agent",
        status: "skipped",
        summary: "HyperLiquid agent approval blocked by execution policy",
        detail: result.message,
        origin,
        pipelineStage: "prechecks",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      return { success: false, skipped: true, reason: result.code };
    }

    const wallet = createSigningWallet(decryptSecret(masterSecret));
    const nonce = Date.now();
    const signingAction: Record<string, unknown> = {
      type: "approveAgent",
      agentAddress: agent.walletAddress.toLowerCase(),
      agentName: args.agentName ?? "",
      nonce,
    };

    try {
      const { signedAction, signature } = await signHyperliquidUserAction(
        wallet,
        signingAction,
        [
          { name: "hyperliquidChain", type: "string" },
          { name: "agentAddress", type: "address" },
          { name: "agentName", type: "string" },
          { name: "nonce", type: "uint64" },
        ],
        "HyperliquidTransaction:ApproveAgent",
      );

      const actionBody =
        args.agentName === undefined
          ? { ...signedAction, agentName: undefined }
          : signedAction;

      const response = await postHyperliquidExchange(actionBody, signature, nonce);
      await ctx.runMutation(internal.mutations.updateManagedVenueStatus, {
        venueAccountId: agent._id,
        status: "ready",
        metadataJson: JSON.stringify({
          approved: true,
          approvedAt: nonce,
          approvedBy: master.walletAddress,
          response,
        }),
      });

      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: agent._id,
        kind: "hyperliquid_approve_agent",
        status: "filled",
        summary: "HyperLiquid agent approved",
        detail: agent.walletAddress,
        metadataJson: JSON.stringify(response),
        origin,
        pipelineStage: "confirmation",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify({ nonce, agentAddress: agent.walletAddress, mode: "hyperliquid_preflight" }),
        confirmedAt: Date.now(),
        intentHash,
      });

      return response;
    } catch (error) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: agent._id,
        kind: "hyperliquid_approve_agent",
        status: "failed",
        summary: "HyperLiquid agent approval failed",
        detail: error instanceof Error ? error.message : String(error),
        origin,
        pipelineStage: "signing",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify({ nonce, agentAddress: agent.walletAddress, mode: "hyperliquid_preflight" }),
        intentHash,
      });
      throw error;
    }
  },
});

export const executeHLOrder = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    isBuy: v.boolean(),
    sizeUsd: v.number(),
    slippage: v.optional(v.number()),
    coin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { agent, agentSecret } = await ctx.runQuery(internal.private.getHyperliquidWalletPair, {
      strategyAccountId: args.strategyAccountId,
    });
    const coin = args.coin ?? "LINK";
    const intent = {
      kind: "hyperliquid_order" as const,
      origin: "supervisor" as const,
      notionalUsd: args.sizeUsd,
      coin,
    };
    const intentHash = hashIntent({
      ...intent,
      isBuy: args.isBuy,
      slippage: args.slippage ?? 0.05,
    });
    const { policyContext, result } = await enforceExecutionPolicy(ctx, {
      strategyAccountId: args.strategyAccountId,
      intent,
    });

    if (!result.ok) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: agent._id,
        kind: "hyperliquid_order",
        status: "skipped",
        summary: "HyperLiquid order blocked by execution policy",
        detail: result.message,
        notionalUsd: args.sizeUsd,
        origin: intent.origin,
        pipelineStage: "prechecks",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      return { success: false, skipped: true, reason: result.code };
    }

    const wallet = createSigningWallet(decryptSecret(agentSecret));
    const { asset, sizeDecimals, mid } = await getHyperliquidMarketInfo(coin);

    let size = roundTo(args.sizeUsd / mid, sizeDecimals);
    if (size * mid < 10) {
      size = Math.ceil((10 / mid) * 10 ** sizeDecimals) / 10 ** sizeDecimals;
    }
    if (size <= 0) {
      throw new Error("HyperLiquid order size rounds to zero");
    }

    const aggressivePrice = buildAggressiveHyperliquidPrice(
      mid,
      args.isBuy,
      args.slippage ?? 0.05,
      sizeDecimals,
    );
    const nonce = Date.now();
    const orderWire = {
      a: asset,
      b: args.isBuy,
      p: floatToWire(aggressivePrice),
      s: floatToWire(size),
      r: false,
      t: { limit: { tif: "Ioc" } },
    };
    const actionBody = {
      type: "order",
      orders: [orderWire],
      grouping: "na",
    };
    const simulation = {
      mode: "hyperliquid_preflight",
      nonce,
      asset,
      mid,
      aggressivePrice,
      size,
      twapThresholdUsd: policyContext.config?.hedgeTwapThresholdUsd ?? null,
    };

    try {
      if (result.mode === EXECUTION_MODE.shadow) {
        await recordExecution(ctx, {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: agent._id,
          kind: "hyperliquid_order",
          status: "skipped",
          summary: "HyperLiquid order recorded in shadow mode",
          detail: `${size} ${coin} @ ${aggressivePrice}`,
          notionalUsd: args.sizeUsd,
          origin: intent.origin,
          pipelineStage: "simulation",
          policyJson: JSON.stringify(result.policy),
          simulationJson: JSON.stringify(simulation),
          intentHash,
        });
        return { success: false, skipped: true, shadow: true };
      }

      const signature = await signHyperliquidL1Action(wallet, actionBody, nonce);
      const response = await postHyperliquidExchange(actionBody, signature, nonce);

      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: agent._id,
        kind: "hyperliquid_order",
        status: "filled",
        summary: `HyperLiquid ${args.isBuy ? "buy" : "sell"} order sent`,
        detail: `${size} ${coin} @ ${aggressivePrice}`,
        notionalUsd: args.sizeUsd,
        metadataJson: JSON.stringify(response),
        origin: intent.origin,
        pipelineStage: "confirmation",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify(simulation),
        confirmedAt: Date.now(),
        intentHash,
      });

      return {
        response,
        size,
        aggressivePrice,
      };
    } catch (error) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: agent._id,
        kind: "hyperliquid_order",
        status: "failed",
        summary: "HyperLiquid order failed",
        detail: error instanceof Error ? error.message : String(error),
        notionalUsd: args.sizeUsd,
        origin: intent.origin,
        pipelineStage: "signing",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify(simulation),
        intentHash,
      });
      throw error;
    }
  },
});

export const pauseStrategy = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    reason: v.string(),
    emergencyStop: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const emergencyStop = args.emergencyStop ?? false;

    await ctx.runMutation(internal.mutations.updateStrategyExecutionState, {
      strategyAccountId: args.strategyAccountId,
      status: emergencyStop ? "emergency_stopped" : "paused",
      emergencyStop,
      lastHeartbeatAt: now,
      lastError: args.reason,
    });

    await ctx.runMutation(internal.worker.recordAlert, {
      strategyAccountId: args.strategyAccountId,
      severity: emergencyStop ? "critical" : "warning",
      code: emergencyStop ? "WORKER_EMERGENCY_STOP" : "WORKER_PAUSE",
      message: emergencyStop ? "Strategy stopped by execution worker." : "Strategy paused by execution worker.",
      detail: args.reason,
    });

    await recordExecution(ctx, {
      strategyAccountId: args.strategyAccountId,
      kind: "system",
      status: "submitted",
      summary: emergencyStop ? "Emergency stop applied" : "Strategy paused",
      detail: args.reason,
    });

    return { paused: true };
  },
});

export const startWithdrawal = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    withdrawalId: v.id("withdrawals"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.worker.getWithdrawalRequest, {
      withdrawalId: args.withdrawalId,
    });

    if (!request) {
      throw new Error("Withdrawal request not found");
    }
    if (request.status !== "queued") {
      throw new Error(`Withdrawal must be queued before execution. Current status: ${request.status}`);
    }

    const intent = {
      kind: "withdrawal" as const,
      origin: "supervisor" as const,
      notionalUsd: Number(request.amount),
    };
    const intentHash = hashIntent({
      ...intent,
      asset: request.asset,
      destination: request.destination,
      venueAccountId: request.venueAccountId ?? null,
    });
    const { result } = await enforceExecutionPolicy(ctx, {
      strategyAccountId: args.strategyAccountId,
      intent,
    });

    if (!result.ok) {
      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: request.venueAccountId,
        kind: "withdrawal",
        status: "skipped",
        summary: "Withdrawal blocked by execution policy",
        detail: result.message,
        notionalUsd: Number(request.amount),
        origin: intent.origin,
        pipelineStage: "prechecks",
        policyJson: JSON.stringify(result.policy),
        intentHash,
      });
      return { success: false, skipped: true, reason: result.code };
    }

    await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
      withdrawalId: args.withdrawalId,
      nextStatus: "signing",
      note: request.note,
    });

    if (request.venueAccountId) {
      const venueContext = await ctx.runQuery(internal.private.getManagedWalletContext, {
        strategyAccountId: args.strategyAccountId,
        role: "optimism_execution_wallet",
      });

      if (venueContext.venueAccount._id === request.venueAccountId) {
        if (request.destination.toLowerCase() === venueContext.venueAccount.walletAddress.toLowerCase()) {
          await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
            withdrawalId: args.withdrawalId,
            nextStatus: "failed",
            note: "Destination cannot be the same managed wallet that is sending the withdrawal.",
            failureCode: "WITHDRAWAL_DESTINATION_EQUALS_SOURCE",
          });
          return {
            success: false,
            skipped: true,
            reason: "WITHDRAWAL_DESTINATION_EQUALS_SOURCE",
          };
        }
        const executionWallet = createExecutionWallet(decryptSecret(venueContext.walletSecret));
        const asset = resolveOptimismAsset(request.asset);
        let broadcastTxHash: string | undefined;
        let receiptStatus: number | undefined;

        try {
          let txRequest: { to?: string; data?: string; value?: bigint };
          if (asset.kind === "native") {
            txRequest = {
              to: request.destination,
              value: parseEther(request.amount),
            };
          } else {
            const token = new Contract(asset.address, ERC20_ABI, executionWallet);
            const populated = await token.getFunction("transfer").populateTransaction(
              request.destination,
              parseUnits(request.amount, asset.decimals),
            );
            txRequest = {
              to: populated.to ?? asset.address,
              data: populated.data ?? "0x",
              value: BigInt(0),
            };
          }

          const simulation = await simulateTransaction(executionWallet, txRequest, {
            enforceAllowlist: false,
          });
          const provider = executionWallet.provider;
          if (!provider) {
            throw new Error("Execution wallet provider is missing");
          }
          const [feeData, ethPriceUsd] = await Promise.all([
            provider.getFeeData(),
            getOptimismEthUsdPrice(provider),
          ]);
          const gasEstimate = BigInt(simulation.gasEstimate);
          const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(0);
          const feeEstimateUsd = estimateFeeUsdFromGas({
            gasEstimate,
            gasPriceWei,
            ethPriceUsd,
          });
          await ctx.runMutation(internal.mutations.updateWithdrawalMetadata, {
            withdrawalId: args.withdrawalId,
            feeEstimateUsd,
          });

          if (asset.kind === "native") {
            const balanceWei = await provider.getBalance(executionWallet.address);
            const requiredWei = parseEther(request.amount) + gasEstimate * gasPriceWei;
            if (requiredWei > balanceWei) {
              throw new Error("Not enough ETH is available after reserving Optimism network fees.");
            }
          }
          const tx = await executionWallet.sendTransaction(txRequest);
          broadcastTxHash = tx.hash;
          await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
            withdrawalId: args.withdrawalId,
            nextStatus: "submitted",
            txHash: tx.hash,
            note: request.note,
          });
          const receipt = await tx.wait();
          receiptStatus = receipt?.status ?? undefined;
          await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
            withdrawalId: args.withdrawalId,
            nextStatus: "confirming",
            txHash: receipt?.hash ?? tx.hash,
            note: request.note,
          });
          await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
            withdrawalId: args.withdrawalId,
            nextStatus: receipt?.status === 1 ? "completed" : "failed",
            txHash: receipt?.hash ?? tx.hash,
            note: request.note,
            failureCode: receipt?.status === 1 ? undefined : "OPTIMISM_WITHDRAWAL_REVERTED",
          });

          await recordExecution(ctx, {
            strategyAccountId: args.strategyAccountId,
            venueAccountId: request.venueAccountId,
            kind: "withdrawal",
            status: receipt?.status === 1 ? "filled" : "failed",
            summary: `Optimism withdrawal submitted for ${request.amount} ${request.asset}`,
            detail: request.destination,
            txHash: receipt?.hash ?? tx.hash,
            metadataJson: JSON.stringify({ asset: request.asset, destination: request.destination }),
            notionalUsd: Number(request.amount),
            origin: intent.origin,
            pipelineStage: "confirmation",
            policyJson: JSON.stringify(result.policy),
            simulationJson: JSON.stringify(simulation),
            confirmedAt: receipt?.status === 1 ? Date.now() : undefined,
            intentHash,
          });

          return {
            success: receipt?.status === 1,
            txHash: receipt?.hash ?? tx.hash,
            venue: "optimism",
          };
        } catch (error) {
          if (broadcastTxHash && receiptStatus === 1) {
            await ctx.runMutation(internal.worker.confirmWithdrawalState, {
              withdrawalId: args.withdrawalId,
              txHash: broadcastTxHash,
              status: "completed",
              note: request.note,
            });

            await recordExecution(ctx, {
              strategyAccountId: args.strategyAccountId,
              venueAccountId: request.venueAccountId,
              kind: "withdrawal",
              status: "filled",
              summary: `Optimism withdrawal confirmed after bookkeeping recovery for ${request.amount} ${request.asset}`,
              detail: request.destination,
              txHash: broadcastTxHash,
              metadataJson: JSON.stringify({
                asset: request.asset,
                destination: request.destination,
                recoveredFrom: error instanceof Error ? error.message : String(error),
              }),
              notionalUsd: Number(request.amount),
              origin: intent.origin,
              pipelineStage: "confirmation",
              policyJson: JSON.stringify(result.policy),
              confirmedAt: Date.now(),
              intentHash,
            });

            return {
              success: true,
              txHash: broadcastTxHash,
              venue: "optimism",
              recovered: true,
            };
          }
          await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
            withdrawalId: args.withdrawalId,
            nextStatus: "failed",
            note: error instanceof Error ? error.message : String(error),
            failureCode: "OPTIMISM_WITHDRAWAL_FAILED",
          });

          await recordExecution(ctx, {
            strategyAccountId: args.strategyAccountId,
            venueAccountId: request.venueAccountId,
            kind: "withdrawal",
            status: "failed",
            summary: "Optimism withdrawal failed",
            detail: error instanceof Error ? error.message : String(error),
            notionalUsd: Number(request.amount),
            origin: intent.origin,
            pipelineStage: "simulation",
            policyJson: JSON.stringify(result.policy),
            intentHash,
          });
          throw error;
        }
      }
    }

    const withdrawal = await ctx.runQuery(internal.private.getManagedWalletContext, {
      strategyAccountId: args.strategyAccountId,
      role: "hyperliquid_master_wallet",
    });
    const wallet = createSigningWallet(decryptSecret(withdrawal.walletSecret));

    const nonce = Date.now();
    const actionBody = {
      destination: request.destination.toLowerCase(),
      amount: request.amount,
      time: nonce,
      type: "withdraw3",
    };
    const simulation = {
      mode: "hyperliquid_preflight",
      nonce,
      destination: request.destination.toLowerCase(),
      amount: request.amount,
    };

    try {
      const { signedAction, signature } = await signHyperliquidUserAction(
        wallet,
        actionBody,
        [
          { name: "hyperliquidChain", type: "string" },
          { name: "destination", type: "string" },
          { name: "amount", type: "string" },
          { name: "time", type: "uint64" },
        ],
        "HyperliquidTransaction:Withdraw",
      );
      const response = await postHyperliquidExchange(signedAction, signature, nonce);

      await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
        withdrawalId: args.withdrawalId,
        nextStatus: "submitted",
        txHash: undefined,
        note: JSON.stringify(response),
      });
      await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
        withdrawalId: args.withdrawalId,
        nextStatus: "confirming",
        txHash: undefined,
        note: JSON.stringify(response),
      });

      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: withdrawal.venueAccount._id,
        kind: "withdrawal",
        status: "submitted",
        summary: `Withdrawal submitted for ${request.amount} ${request.asset}`,
        detail: request.destination,
        metadataJson: JSON.stringify(response),
        notionalUsd: Number(request.amount),
        origin: intent.origin,
        pipelineStage: "confirmation",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify(simulation),
        intentHash,
      });

      return response;
    } catch (error) {
      await ctx.runMutation(internal.mutations.transitionWithdrawalState, {
        withdrawalId: args.withdrawalId,
        nextStatus: "failed",
        note: error instanceof Error ? error.message : String(error),
        failureCode: "HYPERLIQUID_WITHDRAWAL_FAILED",
      });

      await recordExecution(ctx, {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: withdrawal.venueAccount._id,
        kind: "withdrawal",
        status: "failed",
        summary: "Withdrawal submission failed",
        detail: error instanceof Error ? error.message : String(error),
        notionalUsd: Number(request.amount),
        origin: intent.origin,
        pipelineStage: "signing",
        policyJson: JSON.stringify(result.policy),
        simulationJson: JSON.stringify(simulation),
        intentHash,
      });
      throw error;
    }
  },
});

export const rotateHyperliquidAgent = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
  },
  handler: async (ctx, args): Promise<any> => {
    const { agent }: { agent: any } = await ctx.runQuery(internal.private.getHyperliquidWalletPair, {
      strategyAccountId: args.strategyAccountId,
    });
    const rotated = generateManagedWallet(1);
    const now = Date.now();

    await ctx.runMutation(internal.mutations.replaceManagedVenueWallet, {
      venueAccountId: agent._id,
      walletAddress: rotated.address,
      accountRef: toCaip10(agent.chainRef, rotated.address),
      metadataJson: JSON.stringify({
        approved: false,
        rotatedAt: now,
        rotatedFrom: agent.walletAddress,
      }),
      cipherText: rotated.cipherText,
      iv: rotated.iv,
      authTag: rotated.authTag,
      keyVersion: rotated.keyVersion,
    });

    await ctx.runMutation(internal.mutations.recordIncidentEvent, {
      strategyAccountId: args.strategyAccountId,
      severity: "warning",
      code: "HYPERLIQUID_AGENT_ROTATED",
      summary: "HyperLiquid agent wallet rotated and now needs approval.",
      detail: JSON.stringify({ previous: agent.walletAddress, current: rotated.address }),
      runbook: "Approve the new HyperLiquid agent before resuming hedge execution.",
      status: "open",
    });

    await recordExecution(ctx, {
      strategyAccountId: args.strategyAccountId,
      venueAccountId: agent._id,
      kind: "system",
      status: "submitted",
      summary: "HyperLiquid agent rotated",
      detail: `${agent.walletAddress} -> ${rotated.address}`,
      origin: "system",
      pipelineStage: "reconciliation",
      metadataJson: JSON.stringify({ previous: agent.walletAddress, current: rotated.address }),
      intentHash: hashIntent({ strategyAccountId: args.strategyAccountId, previous: agent.walletAddress, current: rotated.address }),
    });

    return {
      previousAddress: agent.walletAddress,
      currentAddress: rotated.address,
    };
  },
});

export const runCanaryChecks = internalAction({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const optimism = await ctx.runQuery(internal.private.getManagedWalletContext, {
      strategyAccountId: args.strategyAccountId,
      role: "optimism_execution_wallet",
    });
    const wallet = createExecutionWallet(decryptSecret(optimism.walletSecret));

    try {
      const [nativeBalance, marketInfo] = await Promise.all([
        wallet.provider?.getBalance(wallet.address),
        getHyperliquidMarketInfo("LINK"),
      ]);

      await ctx.runMutation(internal.mutations.recordCanaryCheck, {
        scope: args.strategyAccountId,
        venue: "optimism",
        checkType: "wallet_read",
        status: "pass",
        summary: "Optimism managed wallet read succeeded.",
        detail: JSON.stringify({ walletAddress: wallet.address, nativeBalance: nativeBalance?.toString() ?? null }),
        latencyMs: Date.now() - startedAt,
      });
      await ctx.runMutation(internal.mutations.recordCanaryCheck, {
        scope: args.strategyAccountId,
        venue: "hyperliquid",
        checkType: "market_read",
        status: "pass",
        summary: "HyperLiquid market read succeeded.",
        detail: JSON.stringify(marketInfo),
        latencyMs: Date.now() - startedAt,
      });

      return {
        success: true,
        nativeBalance: nativeBalance?.toString() ?? null,
        marketInfo,
      };
    } catch (error) {
      await ctx.runMutation(internal.mutations.recordCanaryCheck, {
        scope: args.strategyAccountId,
        venue: "system",
        checkType: "composite",
        status: "fail",
        summary: "Managed canary check failed.",
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
});
