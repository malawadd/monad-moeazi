export const AUTONOMY_RULE_VERSION = "momentum-1m-v1";
export const AUTONOMY_MAX_CYCLES = 3;
export const AUTONOMY_SAMPLE_MS = 15_000;
const ONE_MINUTE_MS = 60_000;
const MAX_WINDOW_GAP_MS = 30_000;
const WAD = 10n ** 18n;

export type PriceSample = {
  tokenIndex: number;
  priceUsdcPerTokenWad: string;
  observedAt: number;
  blockNumber: number;
};
export type Signal = { tokenIndex: number; changeBps: number; priceUsdcPerTokenWad: string };
export type Decision = {
  action: "buy" | "sell" | "hold";
  reasonCode: string;
  ruleVersion: string;
  signal?: Signal;
  rejected: Array<{ tokenIndex: number; reasonCode: string }>;
  positionUpdate?: { peakPriceUsdcPerTokenWad: string };
};

function price(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Autonomy price must be a nonnegative integer string.");
  return BigInt(value);
}

function changeBps(current: bigint, prior: bigint) {
  if (prior <= 0n) return null;
  return Number((current - prior) * 10_000n / prior);
}

function windowStart(samples: PriceSample[], now: number): PriceSample | null {
  const current = [...samples].sort((a, b) => a.observedAt - b.observedAt).at(-1);
  if (!current || now - current.observedAt > MAX_WINDOW_GAP_MS || current.observedAt > now) return null;
  const target = current.observedAt - ONE_MINUTE_MS;
  const prior = [...samples].filter((item) => item.observedAt <= target).sort((a, b) => b.observedAt - a.observedAt)[0];
  if (!prior || target - prior.observedAt > MAX_WINDOW_GAP_MS) return null;
  return prior;
}

export function chooseBuySignal(histories: PriceSample[][], now: number): {
  selected: Signal | null; rejected: Array<{ tokenIndex: number; reasonCode: string }>;
} {
  const candidates: Signal[] = [];
  const rejected: Array<{ tokenIndex: number; reasonCode: string }> = [];
  for (let tokenIndex = 0; tokenIndex < histories.length; tokenIndex += 1) {
    const samples = histories[tokenIndex];
    const start = windowStart(samples, now);
    if (!start) { rejected.push({ tokenIndex, reasonCode: "insufficient_or_stale_one_minute_history" }); continue; }
    const latest = [...samples].sort((a, b) => a.observedAt - b.observedAt).at(-1)!;
    const bps = changeBps(price(latest.priceUsdcPerTokenWad), price(start.priceUsdcPerTokenWad));
    if (bps === null || bps < 300) { rejected.push({ tokenIndex, reasonCode: "rise_below_3_percent" }); continue; }
    candidates.push({ tokenIndex, changeBps: bps, priceUsdcPerTokenWad: latest.priceUsdcPerTokenWad });
  }
  candidates.sort((a, b) => b.changeBps - a.changeBps || a.tokenIndex - b.tokenIndex);
  return { selected: candidates[0] ?? null, rejected };
}

export function decideAutonomy(input: {
  histories: PriceSample[][]; now: number; openPosition?: {
    tokenIndex: number; entryAt: number; peakPriceUsdcPerTokenWad: string;
  } | null;
}): Decision {
  const rejected: Array<{ tokenIndex: number; reasonCode: string }> = [];
  if (input.openPosition) {
    const samples = input.histories[input.openPosition.tokenIndex] ?? [];
    const start = windowStart(samples, input.now);
    const latest = [...samples].sort((a, b) => a.observedAt - b.observedAt).at(-1);
    if (!latest || input.now - latest.observedAt > MAX_WINDOW_GAP_MS || latest.observedAt < input.openPosition.entryAt) {
      return { action: "hold", reasonCode: "current_executable_price_unavailable", ruleVersion: AUTONOMY_RULE_VERSION, rejected };
    }
    const currentPrice = price(latest.priceUsdcPerTokenWad);
    const priorPeak = price(input.openPosition.peakPriceUsdcPerTokenWad);
    const peak = currentPrice > priorPeak ? currentPrice : priorPeak;
    const positionUpdate = { peakPriceUsdcPerTokenWad: peak.toString() };
    const drawdownBps = changeBps(currentPrice, peak);
    if (drawdownBps !== null && drawdownBps <= -200) {
      return { action: "sell", reasonCode: "post_buy_peak_drawdown_2_percent", ruleVersion: AUTONOMY_RULE_VERSION,
        signal: { tokenIndex: input.openPosition.tokenIndex, changeBps: drawdownBps, priceUsdcPerTokenWad: latest.priceUsdcPerTokenWad }, rejected,
        positionUpdate };
    }
    const postEntryMinute = latest.observedAt - input.openPosition.entryAt >= ONE_MINUTE_MS && start
      && start.observedAt >= input.openPosition.entryAt;
    if (postEntryMinute) {
      const flatBps = changeBps(currentPrice, price(start.priceUsdcPerTokenWad));
      if (flatBps !== null && Math.abs(flatBps) <= 50) {
        return { action: "sell", reasonCode: "one_minute_move_within_half_percent", ruleVersion: AUTONOMY_RULE_VERSION,
          signal: { tokenIndex: input.openPosition.tokenIndex, changeBps: flatBps, priceUsdcPerTokenWad: latest.priceUsdcPerTokenWad }, rejected,
          positionUpdate };
      }
    }
    return { action: "hold", reasonCode: "open_position_below_exit_rule", ruleVersion: AUTONOMY_RULE_VERSION, rejected,
      positionUpdate };
  }
  const buy = chooseBuySignal(input.histories, input.now);
  rejected.push(...buy.rejected);
  return buy.selected
    ? { action: "buy", reasonCode: "one_minute_rise_at_least_3_percent", ruleVersion: AUTONOMY_RULE_VERSION,
      signal: buy.selected, rejected }
    : { action: "hold", reasonCode: "no_qualifying_buy_signal", ruleVersion: AUTONOMY_RULE_VERSION, rejected };
}

export function priceUsdcPerTokenWad(usdcInUnits: bigint, tokenOutUnits: bigint) {
  if (usdcInUnits <= 0n || tokenOutUnits <= 0n) throw new Error("Executable quote must have positive input and output.");
  return (usdcInUnits * WAD * 10n ** 12n / tokenOutUnits).toString();
}
