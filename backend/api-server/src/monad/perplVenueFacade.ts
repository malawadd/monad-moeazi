import type { PerplEnrollmentReview, PerplRegisteredVenueAdapter, PerplSettlementReview, VenueOperationResult } from "./venueAdapterContract.js";
import { perplTestnetVenue } from "./perplVenue.js";
import type { PerplVenueAdapter, VenueAccountSnapshot, VenueAction, VenueMarket, VenueOrderResult, VenueReconciliation } from "./venueTypes.js";

const result = <T>(venueId: string, phase: string, data: T | null, rawResponse?: unknown): VenueOperationResult<T> => ({
  venueId, phase, data,
  ...(rawResponse === undefined ? {} : { rawResponse }),
});

export function createPerplVenueFacade(venue: PerplVenueAdapter = perplTestnetVenue): PerplRegisteredVenueAdapter {
  return {
  venueId: venue.venueId,
  displayName: venue.displayName,
  chainId: venue.chainId,
  executionModel: venue.executionModel,
  testOnly: venue.testOnly,
  capabilities: venue.capabilities,
  async readContext() { return result(venue.venueId, "observed", await venue.readContext()); },
  async prepareEnrollment(input) {
    const context = await venue.readContext();
    const markets = await venue.readMarkets(input.marketIds, false);
    const review: PerplEnrollmentReview = { ownerAddress: input.ownerAddress ?? null, terms: input.terms ?? null,
      limits: context.limits, eligibleMarkets: markets.filter((market) => market.isOpen),
      requiresOwnerMandate: true, requiresOperatorKey: true };
    return result(venue.venueId, "review_ready", review);
  },
  async readMarkets(input) {
    const markets = input.finalized ? await venue.readFinalizedMarkets(input.marketIds)
      : await venue.readMarkets(input.marketIds, input.withBook === true);
    return result(venue.venueId, "observed", markets);
  },
  async readAccount(input) {
    if (!Number.isSafeInteger(input.accountId) || !input.credentials) return result<VenueAccountSnapshot>(venue.venueId, "blocked", null);
    return result(venue.venueId, "observed", await venue.readAccount(input.accountId!, input.credentials));
  },
  async submitAction(input) {
    if (!input.action || !input.credentials) return result<VenueOrderResult>(venue.venueId, "blocked", null);
    const submitted = await venue.submitAction(input.action as VenueAction, input.credentials);
    return result(venue.venueId, submitted.phase, submitted, submitted.rawResponse);
  },
  async reconcileAction(input) {
    if (!Number.isSafeInteger(input.requestId) || !Number.isSafeInteger(input.accountId) || !input.credentials) return result<VenueReconciliation>(venue.venueId, "blocked", null);
    const reconciled = await venue.reconcileAction(input.requestId!, input.accountId!, input.credentials);
    return result(venue.venueId, reconciled.phase, reconciled, reconciled.rawResponse);
  },
  async settleRun(input) {
    if (!Number.isSafeInteger(input.accountId) || !input.credentials) return result<PerplSettlementReview>(venue.venueId, "blocked", null);
    const account = await venue.readAccount(input.accountId!, input.credentials);
    const flat = account.positions.length === 0 && account.orders.length === 0 && account.lockedUnits === "0";
    const settlement: PerplSettlementReview = { flat, accountId: account.accountId,
      balanceUnits: account.balanceUnits, lockedUnits: account.lockedUnits,
      reason: flat ? null : "open_positions_orders_or_locks" };
    return result(venue.venueId, flat ? "ready" : "incomplete", settlement);
  },
  };
}

export const perplVenueFacade = createPerplVenueFacade();
