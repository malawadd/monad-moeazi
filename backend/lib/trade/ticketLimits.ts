import type { TradeSide, VenueLevel, VenueSnapshot } from "./types";

export type TradeTicketLimits = {
  maxLeverage: number;
  maxNotionalByDepthUsd: number;
  maxMarginByDepthUsd: number;
  maxMarginByAccountUsd: number | null;
  maxMarginUsd: number;
  reason: string | null;
};

export function buildTradeTicketLimits(args: {
  snapshot: VenueSnapshot | null;
  side: TradeSide;
  leverage: number;
  slippageCapBps: number;
  marketMaxLeverage?: number;
  accountCollateralUsd?: number | null;
}) {
  const maxLeverage = args.snapshot?.maxLeverage ?? args.marketMaxLeverage ?? 1;
  const leverage = Math.max(1, Math.min(args.leverage, maxLeverage));
  const maxNotionalByDepthUsd = args.snapshot
    ? maxNotionalWithinSlippage(args.snapshot, args.side, args.slippageCapBps)
    : 0;
  const maxMarginByDepthUsd = leverage > 0 ? roundUsdc(maxNotionalByDepthUsd / leverage) : 0;
  const maxMarginByAccountUsd =
    args.accountCollateralUsd === null || args.accountCollateralUsd === undefined
      ? null
      : Math.max(0, roundUsdc(args.accountCollateralUsd));
  const maxMarginUsd =
    maxMarginByAccountUsd === null
      ? maxMarginByDepthUsd
      : Math.min(maxMarginByDepthUsd, maxMarginByAccountUsd);

  return {
    maxLeverage,
    maxNotionalByDepthUsd,
    maxMarginByDepthUsd,
    maxMarginByAccountUsd,
    maxMarginUsd,
    reason: limitReason(maxMarginByDepthUsd, maxMarginByAccountUsd),
  } satisfies TradeTicketLimits;
}

export function maxNotionalWithinSlippage(
  snapshot: VenueSnapshot,
  side: TradeSide,
  slippageCapBps: number,
) {
  const levels = side === "long" ? snapshot.asks : snapshot.bids;
  if (!levels?.length || snapshot.midPrice <= 0) return 0;
  let quantity = 0;
  let notional = 0;
  let accepted = 0;
  for (const level of levels) {
    if (!validLevel(level)) continue;
    quantity += level.size;
    notional += level.price * level.size;
    const avgFill = notional / quantity;
    const impactBps =
      side === "long"
        ? ((avgFill - snapshot.midPrice) / snapshot.midPrice) * 10_000
        : ((snapshot.midPrice - avgFill) / snapshot.midPrice) * 10_000;
    if (impactBps <= slippageCapBps) accepted = notional;
    else break;
  }
  return roundUsdc(accepted);
}

function limitReason(depthMax: number, accountMax: number | null) {
  if (depthMax <= 0) return "No order book depth inside the selected slippage cap.";
  if (accountMax !== null && accountMax <= 0) return "No account collateral is available.";
  if (accountMax !== null && accountMax < depthMax) return "Capped by available account collateral.";
  return null;
}

function validLevel(level: VenueLevel) {
  return Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.size) && level.size > 0;
}

function roundUsdc(value: number) {
  return Math.max(0, Math.floor(value * 100) / 100);
}
