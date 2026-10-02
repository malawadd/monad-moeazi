export type UaHyperliquidCompatibilityInput = {
  ownerAddress?: string | null;
  evmUaAddress?: string | null;
};

export function canUseUaForHyperliquid(input: UaHyperliquidCompatibilityInput) {
  const owner = input.ownerAddress?.toLowerCase();
  const ua = input.evmUaAddress?.toLowerCase();
  if (!owner || !ua) {
    return {
      ok: false,
      reason: "Connect Particle and load your Universal Account before trading.",
    };
  }
  if (owner !== ua) {
    return {
      ok: false,
      reason:
        "Hyperliquid funding requires the credited address to sign venue actions. Reconnect with an EIP-7702-capable Particle account.",
    };
  }
  return { ok: true, reason: null };
}

export function fundingAmountNeeded(args: { marginUsd: number; venueAccountValueUsd: number }) {
  return Math.max(0, roundUsdc(args.marginUsd - args.venueAccountValueUsd));
}

function roundUsdc(value: number) {
  return Math.ceil(value * 100) / 100;
}
