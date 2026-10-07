import type { VenueAdapter, VenueOperationInput, VenueOperationResult } from "./venueAdapterContract.js";
import { PERPL_CHAIN_ID, PERPL_DIRECT_VENUE_ID } from "./perplConfig.js";
import { readPerplVenueContext, readPerplVenueMarkets } from "./perplVenueOperations.js";
import { readDirectAccount } from "./perplDirectState.js";
import { finalizedPerplAccount } from "./perplWorkerSettlement.js";
import { reconcileDirectOrder, submitDirectPolicyAction } from "./perplDirectOrders.js";

const result = <T>(phase: string, data: T | null, reason?: string): VenueOperationResult<T> => ({
  venueId: PERPL_DIRECT_VENUE_ID, phase, data, ...(reason ? { reason } : {}),
});

/** The transport changes; public market observations and the policy contract do not. */
export const perplDirectVenueFacade: VenueAdapter = {
  venueId: PERPL_DIRECT_VENUE_ID,
  displayName: "Perpl Testnet · Direct",
  chainId: PERPL_CHAIN_ID,
  executionModel: "onchain_exchange",
  testOnly: true,
  capabilities: ["market_data", "order_book", "account_read", "history", "market_orders", "limit_orders",
    "owner_withdrawal"],
  async readContext() { return result("observed", await readPerplVenueContext()); },
  async prepareEnrollment(input) {
    const [context, markets] = await Promise.all([readPerplVenueContext(), readPerplVenueMarkets({ marketIds: input.marketIds })]);
    return result("review_ready", { ownerAddress: input.ownerAddress ?? null, terms: input.terms ?? null,
      limits: context.limits, eligibleMarkets: markets.filter((market) => market.isOpen),
      requiresOwnerMandate: true, requiresOperatorKey: false });
  },
  async readMarkets(input) { return result("observed", await readPerplVenueMarkets({ marketIds: input.marketIds,
    withBook: input.withBook, finalized: input.finalized })); },
  async readAccount(input) {
    if (!input.provider || !input.run || !input.accountId) return result("blocked", null, "perpl_direct_account_input_missing");
    const run = input.run as any;
    return result("observed", await readDirectAccount(input.provider, input.accountId,
      JSON.parse(run.marketIdsJson), run.delegatedAccountAddress, Number(run.lastRequestId ?? 0)));
  },
  async submitAction(input) {
    if (!input.provider || !input.run || !input.action || !input.market || !input.account || !input.idempotencyKey) {
      return result("blocked", null, "perpl_direct_order_input_missing");
    }
    const submitted = await submitDirectPolicyAction({ provider: input.provider, run: input.run as any,
      action: input.action as any, market: input.market as any, account: input.account as any,
      idempotencyKey: String(input.idempotencyKey) });
    return result(submitted.phase, submitted);
  },
  async reconcileAction(input: VenueOperationInput) {
    if (!input.provider || !input.order || !input.run) return result("blocked", null, "perpl_direct_order_missing");
    return result("observed", await reconcileDirectOrder(input.provider, input.run as any, input.order as any));
  },
  async settleRun(input) {
    if (!input.provider || !input.run || !input.accountId) return result("blocked", null, "perpl_direct_account_input_missing");
    const run = input.run as any;
    const state = await finalizedPerplAccount(input.provider, input.accountId, run.delegatedAccountAddress);
    const flat = !state.positions && state.locks === 0 && state.locked === 0n;
    return result(flat ? "ready" : "incomplete", { flat, accountId: input.accountId,
      balanceUnits: state.balance.toString(), lockedUnits: state.locked.toString(),
      reason: flat ? null : "open_positions_orders_or_locks" });
  },
};
