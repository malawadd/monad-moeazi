import { pack } from "msgpackr";
import { concat, getBytes, keccak256, Signature, toBeHex, zeroPadValue } from "ethers";
import { coinForHyperliquidMarket, postHyperliquidExchange, postHyperliquidInfo } from "./hyperliquidApi";
import type { PerpMarket, TradeSide } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type WalletSigner = {
  signTypedData?: (args: {
    account?: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
};

export type HyperliquidOrderInput = {
  market: PerpMarket;
  side: TradeSide;
  marginUsd: number;
  leverage: number;
  slippageCapBps: number;
  account: string;
  walletClient: unknown;
};

export type HyperliquidOrderPlan = {
  coin: string;
  asset: number;
  sizeDecimals: number;
  mid: number;
  size: number;
  aggressivePrice: number;
  isBuy: boolean;
  notionalUsd: number;
  orderAction: Record<string, unknown>;
  leverageAction: Record<string, unknown>;
};

export async function buildHyperliquidOrderPlan(input: Omit<HyperliquidOrderInput, "walletClient" | "account">) {
  const coin = coinForHyperliquidMarket(input.market.id);
  if (!coin) throw new Error("Hyperliquid only supports listed crypto perps in this release.");
  if (!Number.isInteger(input.leverage)) throw new Error("Hyperliquid leverage must be a whole number.");
  if (input.leverage > input.market.maxLeverage) {
    throw new Error(`Requested leverage exceeds the live ${coin} cap.`);
  }
  if (input.market.assetIndex === undefined || input.market.szDecimals === undefined) {
    throw new Error("Live Hyperliquid asset metadata is required before submitting.");
  }
  const { mid } = await readHyperliquidMarketInfo(coin);
  const asset = input.market.assetIndex;
  const sizeDecimals = input.market.szDecimals;
  const notionalUsd = input.marginUsd * input.leverage;
  let size = formatHyperliquidSize(notionalUsd / mid, sizeDecimals);
  if (size * mid < 10) size = Math.ceil((10 / mid) * 10 ** sizeDecimals) / 10 ** sizeDecimals;
  if (size <= 0) throw new Error("Hyperliquid order size rounds to zero.");
  const isBuy = input.side === "long";
  const { aggressivePrice, orderAction, leverageAction } = buildHyperliquidOrderActions({
    asset,
    isBuy,
    mid,
    size,
    sizeDecimals,
    slippageCapBps: input.slippageCapBps,
    leverage: input.leverage,
    reduceOnly: false,
  });
  return { coin, asset, sizeDecimals, mid, size, aggressivePrice, isBuy, notionalUsd, orderAction, leverageAction };
}

export function buildHyperliquidOrderActions(args: {
  asset: number;
  isBuy: boolean;
  mid: number;
  size: number;
  sizeDecimals: number;
  slippageCapBps: number;
  leverage: number;
  reduceOnly: boolean;
}) {
  if (!Number.isInteger(args.leverage)) throw new Error("Hyperliquid leverage must be a whole number.");
  const aggressivePrice = buildAggressivePrice(args.mid, args.isBuy, args.slippageCapBps / 10_000, args.sizeDecimals);
  return {
    aggressivePrice,
    orderAction: {
      type: "order",
      orders: [
        {
          a: args.asset,
          b: args.isBuy,
          p: floatToWire(aggressivePrice),
          s: floatToWire(formatHyperliquidSize(args.size, args.sizeDecimals)),
          r: args.reduceOnly,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    },
    leverageAction: { type: "updateLeverage", asset: args.asset, isCross: false, leverage: args.leverage },
  };
}

export async function submitHyperliquidMarketOrder(input: HyperliquidOrderInput) {
  const plan = await buildHyperliquidOrderPlan(input);
  const leverageNonce = Date.now();
  const leverageSignature = await signHyperliquidL1Action(input.walletClient, input.account, plan.leverageAction, leverageNonce);
  const leverageResponse = await postHyperliquidExchange({
    action: plan.leverageAction,
    nonce: leverageNonce,
    signature: leverageSignature,
    vaultAddress: null,
    expiresAfter: null,
  });
  const orderNonce = leverageNonce + 1;
  const orderSignature = await signHyperliquidL1Action(input.walletClient, input.account, plan.orderAction, orderNonce);
  const orderResponse = await postHyperliquidExchange({
    action: plan.orderAction,
    nonce: orderNonce,
    signature: orderSignature,
    vaultAddress: null,
    expiresAfter: null,
  });
  return { plan, leverageResponse, orderResponse };
}

export async function signHyperliquidL1Action(
  walletClient: unknown,
  account: string,
  action: unknown,
  nonce: number,
) {
  const signer = walletClient as WalletSigner | null | undefined;
  if (typeof signer?.signTypedData !== "function") {
    throw new Error("Connected wallet cannot sign Hyperliquid typed data.");
  }
  const signature = await signer.signTypedData({
    account: account as `0x${string}`,
    domain: { chainId: 1337, name: "Exchange", verifyingContract: ZERO_ADDRESS, version: "1" },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: "a", connectionId: hyperliquidActionHash(action, nonce) },
  });
  const parsed = Signature.from(signature);
  return { r: parsed.r, s: parsed.s, v: parsed.v };
}

async function readHyperliquidMarketInfo(coin: string) {
  const [meta, mids] = await Promise.all([
    postHyperliquidInfo<{ universe: Array<{ name: string; szDecimals: number }> }>({ type: "meta" }),
    postHyperliquidInfo<Record<string, string>>({ type: "allMids" }),
  ]);
  const asset = meta.universe.findIndex((item) => item.name === coin);
  if (asset < 0) throw new Error(`Coin ${coin} not found in Hyperliquid metadata.`);
  const mid = Number(mids[coin]);
  if (!Number.isFinite(mid) || mid <= 0) throw new Error(`Invalid Hyperliquid mid for ${coin}.`);
  return { asset, sizeDecimals: meta.universe[asset]?.szDecimals ?? 0, mid };
}

export function formatHyperliquidPrice(value: number, szDecimals: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid Hyperliquid price.");
  if (Number.isInteger(value)) return value;
  return roundTo(Number(value.toPrecision(5)), Math.max(0, 6 - szDecimals));
}

export function formatHyperliquidSize(value: number, szDecimals: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundTo(value, szDecimals);
}

function hyperliquidActionHash(action: unknown, nonce: number) {
  const parts = [pack(action), getBytes(zeroPadValue(toBeHex(nonce), 8)), Uint8Array.from([0])];
  return keccak256(concat(parts));
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** Math.max(decimals, 0);
  return Math.round(value * factor) / factor;
}

function floatToWire(value: number) {
  const rounded = value.toFixed(8);
  const normalized = rounded.replace(/0+$/, "").replace(/\.$/, "");
  return normalized === "-0" || normalized === "" ? "0" : normalized;
}

function buildAggressivePrice(mid: number, isBuy: boolean, slippage: number, sizeDecimals: number) {
  return formatHyperliquidPrice(mid * (isBuy ? 1 + slippage : 1 - slippage), sizeDecimals);
}
