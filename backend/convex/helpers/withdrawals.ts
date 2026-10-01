import {
  WITHDRAWAL_REVIEW_STATUS,
  WITHDRAWAL_STATUS,
} from "../constants";

type WithdrawalStatus = (typeof WITHDRAWAL_STATUS)[keyof typeof WITHDRAWAL_STATUS];

const WITHDRAWAL_GRAPH: Record<string, WithdrawalStatus[]> = {
  [WITHDRAWAL_STATUS.draft]: [WITHDRAWAL_STATUS.pendingChecks, WITHDRAWAL_STATUS.cancelled],
  [WITHDRAWAL_STATUS.pendingChecks]: [
    WITHDRAWAL_STATUS.queued,
    WITHDRAWAL_STATUS.failed,
    WITHDRAWAL_STATUS.cancelled,
  ],
  [WITHDRAWAL_STATUS.queued]: [WITHDRAWAL_STATUS.signing, WITHDRAWAL_STATUS.cancelled],
  [WITHDRAWAL_STATUS.signing]: [WITHDRAWAL_STATUS.submitted, WITHDRAWAL_STATUS.failed],
  [WITHDRAWAL_STATUS.submitted]: [WITHDRAWAL_STATUS.confirming, WITHDRAWAL_STATUS.failed],
  [WITHDRAWAL_STATUS.confirming]: [WITHDRAWAL_STATUS.completed, WITHDRAWAL_STATUS.failed],
  [WITHDRAWAL_STATUS.completed]: [],
  [WITHDRAWAL_STATUS.failed]: [WITHDRAWAL_STATUS.queued, WITHDRAWAL_STATUS.cancelled],
  [WITHDRAWAL_STATUS.cancelled]: [],
  [WITHDRAWAL_STATUS.requested]: [WITHDRAWAL_STATUS.pendingChecks],
  [WITHDRAWAL_STATUS.processing]: [WITHDRAWAL_STATUS.confirming, WITHDRAWAL_STATUS.completed, WITHDRAWAL_STATUS.failed],
  [WITHDRAWAL_STATUS.rejected]: [WITHDRAWAL_STATUS.cancelled, WITHDRAWAL_STATUS.pendingChecks],
};

function toPositiveNumberString(amount: string) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Withdrawal amount must be a positive number.");
  }
  return value.toString();
}

export function isValidEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function createWithdrawalIdempotencyKey(args: {
  strategyAccountId: string;
  venueAccountId?: string | null;
  asset: string;
  amount: string;
  destination: string;
}) {
  return [
    args.strategyAccountId,
    args.venueAccountId ?? "",
    args.asset.toUpperCase(),
    args.amount,
    args.destination.toLowerCase(),
  ].join("|");
}

export function estimateWithdrawalFeeUsd(venue: string, asset: string) {
  if (venue === "hyperliquid") return asset.toUpperCase() === "USDC" ? 1.5 : 2.5;
  return asset.toUpperCase() === "ETH" ? 0.75 : 0.5;
}

export function buildWithdrawalChecks(args: {
  amount: string;
  destination: string;
  venue: string;
  asset: string;
  availableBalance?: string | null;
  sourceAddress?: string | null;
  cooldownEndsAt?: number | null;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const normalizedAmount = toPositiveNumberString(args.amount);
  const normalizedDestination = args.destination.trim().toLowerCase();
  const destinationVerified = isValidEvmAddress(normalizedDestination);
  const reasons: string[] = [];

  if (!destinationVerified) {
    reasons.push("Destination must be a valid EVM address.");
  }

  if (args.sourceAddress && normalizedDestination === args.sourceAddress.trim().toLowerCase()) {
    reasons.push("Destination cannot be the same managed wallet that is sending the withdrawal.");
  }

  if (args.cooldownEndsAt && args.cooldownEndsAt > now) {
    reasons.push("Withdrawal cooldown is still active for this strategy account.");
  }

  if (args.availableBalance !== undefined && args.availableBalance !== null) {
    const available = Number(args.availableBalance);
    if (!Number.isFinite(available) || available <= 0) {
      reasons.push(`No ${args.asset.toUpperCase()} is currently available to withdraw from this wallet.`);
    } else if (Number(normalizedAmount) > available) {
      reasons.push(
        `Requested amount exceeds the currently withdrawable ${args.asset.toUpperCase()} balance for this wallet.`,
      );
    }
  }

  return {
    normalizedAmount,
    normalizedDestination,
    destinationVerified,
    feeEstimateUsd: estimateWithdrawalFeeUsd(args.venue, args.asset),
    reviewStatus:
      reasons.length === 0
        ? WITHDRAWAL_REVIEW_STATUS.notRequired
        : WITHDRAWAL_REVIEW_STATUS.pending,
    passed: reasons.length === 0,
    reasons,
  };
}

export function canTransitionWithdrawal(current: WithdrawalStatus, next: WithdrawalStatus) {
  return (WITHDRAWAL_GRAPH[current] ?? []).includes(next);
}
