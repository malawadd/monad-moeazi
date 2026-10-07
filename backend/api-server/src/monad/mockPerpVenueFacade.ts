import type { AnyVenueAdapter, VenueOperationResult } from "./venueAdapterContract.js";
import { mockClearinghouseVenue } from "./perpVenue.js";

const result = <T = unknown>(phase: string, data: T | null = null): VenueOperationResult<T> => ({ venueId: mockClearinghouseVenue.venueId,
  phase, data });
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`Mock Perp venue requires ${label}.`);
  return value;
}

export const mockPerpVenueFacade: AnyVenueAdapter = {
  venueId: mockClearinghouseVenue.venueId,
  displayName: mockClearinghouseVenue.displayName,
  chainId: mockClearinghouseVenue.chainId,
  executionModel: mockClearinghouseVenue.executionModel,
  testOnly: mockClearinghouseVenue.testOnly,
  capabilities: mockClearinghouseVenue.capabilities,
  async readContext(input) {
    const provider = required(input?.provider, "Monad provider");
    return result("observed", await mockClearinghouseVenue.readDeployment(provider));
  },
  async prepareEnrollment(input) {
    const provider = required(input.provider, "Monad provider");
    const deployment = input.deployment ?? await mockClearinghouseVenue.readDeployment(provider);
    const blockNumber = required(input.blockNumber, "finalized block number");
    return result("review_ready", { ownerAddress: input.ownerAddress ?? null,
      markets: await mockClearinghouseVenue.readFinalizedMarkets(provider, deployment, blockNumber, input.observedAt ?? Date.now()),
      requiresOwnerMandate: true });
  },
  async readMarkets(input) {
    const provider = required(input.provider, "Monad provider");
    const deployment = required(input.deployment, "deployment snapshot");
    const blockNumber = required(input.blockNumber, "finalized block number");
    return result("observed", await mockClearinghouseVenue.readFinalizedMarkets(provider, deployment, blockNumber, input.observedAt ?? Date.now()));
  },
  async readAccount(input) {
    const provider = required(input.provider, "Monad provider");
    const deployment = required(input.deployment, "deployment snapshot");
    const run = required(input.run, "signed run");
    const blockNumber = required(input.blockNumber, "finalized block number");
    return result("observed", await mockClearinghouseVenue.readFinalizedRunState(provider, deployment, run, blockNumber));
  },
  async submitAction(input) {
    const provider = required(input.provider, "Monad provider"); const wallet = required(input.wallet, "operator wallet");
    const deployment = required(input.deployment, "deployment snapshot"); const run = required(input.run, "signed run");
    const prepared = await mockClearinghouseVenue.prepareAction(provider, wallet, { row: run, tickId: input.tickId,
      decision: input.decision, position: input.position, pending: input.pending, deployment, markPrices: input.markPrices });
    if (!prepared) return result("held", null);
    return result("submitted", await mockClearinghouseVenue.broadcastOrder(provider, wallet, run, prepared));
  },
  async reconcileAction(input) {
    const provider = required(input.provider, "Monad provider"); const order = required(input.order, "venue order");
    return result("reconciled", await mockClearinghouseVenue.reconcileOrder(provider, order, required(input.finalizedBlock, "finalized block")));
  },
  async settleRun(input) {
    const state = await this.readAccount(input);
    const raw: any = state.data;
    const flat = !raw?.position && !raw?.pendingOrder;
    return result(flat ? "ready" : "incomplete", { flat, reason: flat ? null : "position_or_order_open", account: raw });
  },
};
