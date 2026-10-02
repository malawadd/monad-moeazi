import test from "node:test";
import assert from "node:assert/strict";
import { WITHDRAWAL_REVIEW_STATUS, WITHDRAWAL_STATUS } from "../convex/constants";
import {
  buildWithdrawalChecks,
  canTransitionWithdrawal,
  createWithdrawalIdempotencyKey,
} from "../convex/helpers/withdrawals";
import { computeWithdrawableBalance } from "../convex/helpers/walletAssets";

test("buildWithdrawalChecks validates destination and returns fee estimate", () => {
  const checks = buildWithdrawalChecks({
    amount: "25",
    destination: "0x1111111111111111111111111111111111111111",
    venue: "hyperliquid",
    asset: "USDC",
  });

  assert.equal(checks.passed, true);
  assert.equal(checks.destinationVerified, true);
  assert.equal(checks.reviewStatus, WITHDRAWAL_REVIEW_STATUS.notRequired);
  assert.equal(checks.feeEstimateUsd, 1.5);
});

test("buildWithdrawalChecks fails when cooldown is still active", () => {
  const now = Date.now();
  const checks = buildWithdrawalChecks({
    amount: "10",
    destination: "0x1111111111111111111111111111111111111111",
    venue: "uniswap",
    asset: "USDC",
    cooldownEndsAt: now + 1_000,
    now,
  });

  assert.equal(checks.passed, false);
  assert.match(checks.reasons.join(" "), /cooldown/i);
});

test("buildWithdrawalChecks fails when request exceeds withdrawable balance", () => {
  const checks = buildWithdrawalChecks({
    amount: "2",
    destination: "0x1111111111111111111111111111111111111111",
    venue: "uniswap",
    asset: "ETH",
    availableBalance: "1.5",
  });

  assert.equal(checks.passed, false);
  assert.match(checks.reasons.join(" "), /withdrawable/i);
});

test("buildWithdrawalChecks fails when destination equals the managed source wallet", () => {
  const checks = buildWithdrawalChecks({
    amount: "0.1",
    destination: "0x1111111111111111111111111111111111111111",
    sourceAddress: "0x1111111111111111111111111111111111111111",
    venue: "uniswap",
    asset: "ETH",
    availableBalance: "1",
  });

  assert.equal(checks.passed, false);
  assert.match(checks.reasons.join(" "), /same managed wallet/i);
});

test("computeWithdrawableBalance reserves a small ETH buffer on Optimism", () => {
  const withdrawable = computeWithdrawableBalance({
    role: "optimism_execution_wallet",
    asset: "ETH",
    balance: "0.000213118736973077",
  });

  assert.equal(Number(withdrawable.amount) < 0.000213118736973077, true);
  assert.match(withdrawable.note ?? "", /gas/i);
});

test("withdrawal transitions follow the managed state machine", () => {
  assert.equal(canTransitionWithdrawal(WITHDRAWAL_STATUS.draft, WITHDRAWAL_STATUS.pendingChecks), true);
  assert.equal(canTransitionWithdrawal(WITHDRAWAL_STATUS.pendingChecks, WITHDRAWAL_STATUS.queued), true);
  assert.equal(canTransitionWithdrawal(WITHDRAWAL_STATUS.queued, WITHDRAWAL_STATUS.signing), true);
  assert.equal(canTransitionWithdrawal(WITHDRAWAL_STATUS.submitted, WITHDRAWAL_STATUS.completed), false);
});

test("idempotency key is stable for the same withdrawal request", () => {
  const first = createWithdrawalIdempotencyKey({
    strategyAccountId: "strategy-1",
    venueAccountId: "venue-1",
    asset: "USDC",
    amount: "25",
    destination: "0x1111111111111111111111111111111111111111",
  });
  const second = createWithdrawalIdempotencyKey({
    strategyAccountId: "strategy-1",
    venueAccountId: "venue-1",
    asset: "USDC",
    amount: "25",
    destination: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(first, second);
});
