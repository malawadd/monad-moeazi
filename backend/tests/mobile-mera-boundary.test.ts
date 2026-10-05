import assert from "node:assert/strict";
import test from "node:test";
import * as mobile from "../convex/mobile";
import * as account from "../convex/mobileAccount";
import * as activity from "../convex/mobileActivity";
import * as funding from "../convex/mobileFunding";
import * as fundingModel from "../convex/mobileFundingModel";
import * as magicChain from "../convex/mobileMagicChain";
import * as signing from "../convex/mobileSigning";
import * as venue from "../convex/mobileVenueSetup";
import * as withdrawalModel from "../convex/mobileWithdrawalModel";
import * as withdrawals from "../convex/mobileWithdrawals";

type ConvexHandler = {_handler: (ctx: unknown, args: Record<string, unknown>) => unknown};
const paused = async (entry: unknown, args: Record<string, unknown> = {}) => {
  await assert.rejects(Promise.resolve().then(() =>
    (entry as ConvexHandler)._handler({}, args)), /Mobile chain actions are paused/);
};

test("Mera sessions cannot enter direct public Magic or chain Convex handlers", async () => {
  const calls: Array<[unknown, Record<string, unknown>?]> = [
    [mobile.getUniswapGrantContext], [mobile.getHome], [mobile.getAutopilotLimits],
    [mobile.getUaOperation, {operationId: "operation"}], [mobile.startAutopilot, {confirmed: true}],
    [mobile.confirmAutopilotMode, {confirmed: true}], [mobile.stopAutopilot],
    [mobile.registerNotificationDevice, {deviceId: "device", pushToken: "token", preferencesJson: "{}"}],
    [account.bootstrap], [activity.getManagedJourney], [funding.refresh],
    [fundingModel.getSnapshot], [magicChain.sync],
    [signing.createProof, {proofId: "proof", ownerAddress: "0x", chainId: 42161,
      typedDataJson: "{}", rootHash: "0x", expiresAt: Date.now() + 1000}],
    [signing.getProof, {proofId: "proof"}], [signing.claimProof, {proofId: "proof"}],
    [signing.completeProof, {proofId: "proof"}],
    [venue.getHyperliquidBindingAttempt, {attemptId: "attempt"}],
    [withdrawalModel.reportBroadcast, {operationId: "op", outcome: "cancelled"}],
    [withdrawalModel.getStatus, {operationId: "op"}], [withdrawalModel.listRecent],
    [withdrawals.prepare, {amount: "1", destination: "0x", idempotencyKey: "request-12345678"}],
    [withdrawals.reconcile, {operationId: "op"}],
  ];
  await Promise.all(calls.map(([entry, args]) => paused(entry, args)));
});
