import { PERPL_VENUE_ID } from "./perplConfig.js";
import { getVenueAdapter } from "./venueRegistry.js";
import type { PerplRegisteredVenueAdapter, VenueOperationInput } from "./venueAdapterContract.js";
import type { PerplContext } from "./perplContext.js";
import type { VenueAccountSnapshot, VenueAction, VenueMarket, VenueOrderResult, VenueReconciliation } from "./venueTypes.js";

function adapter(): PerplRegisteredVenueAdapter {
  const registered = getVenueAdapter(PERPL_VENUE_ID);
  if (registered.venueId !== PERPL_VENUE_ID) throw new Error("Registered Perpl adapter identity is invalid.");
  return registered as PerplRegisteredVenueAdapter;
}
function data<T>(result: { venueId: string; data: T | null }, operation: string): T {
  if (result.venueId !== PERPL_VENUE_ID || result.data === null) throw new Error(`Registered Perpl adapter could not ${operation}.`);
  return result.data;
}

export async function readPerplVenueContext(): Promise<PerplContext> {
  return data(await adapter().readContext(), "read context");
}
export async function preparePerplVenueEnrollment(input: VenueOperationInput) {
  return data(await adapter().prepareEnrollment(input), "prepare enrollment");
}
export async function readPerplVenueMarkets(input: { marketIds?: number[]; withBook?: boolean; finalized?: boolean } = {}): Promise<VenueMarket[]> {
  return data(await adapter().readMarkets(input), "read markets");
}
export async function readPerplVenueAccount(accountId: number, credentials: NonNullable<VenueOperationInput["credentials"]>): Promise<VenueAccountSnapshot> {
  return data(await adapter().readAccount({ accountId, credentials }), "read account");
}
export async function submitPerplVenueAction(action: VenueAction, credentials: NonNullable<VenueOperationInput["credentials"]>): Promise<VenueOrderResult> {
  return data(await adapter().submitAction({ action, credentials }), "submit action");
}
export async function reconcilePerplVenueAction(requestId: number, accountId: number,
  credentials: NonNullable<VenueOperationInput["credentials"]>): Promise<VenueReconciliation> {
  return data(await adapter().reconcileAction({ requestId, accountId, credentials }), "reconcile action");
}
export async function settlePerplVenueRun(accountId: number, credentials: NonNullable<VenueOperationInput["credentials"]>) {
  return data(await adapter().settleRun({ accountId, credentials }), "settle run");
}
