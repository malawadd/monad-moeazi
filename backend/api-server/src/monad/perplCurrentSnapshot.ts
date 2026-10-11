import { monadProvider, finalizedBlockNumber } from "./provider.js";
import { PERPL_CHAIN_ID, PERPL_DIRECT_VENUE_ID } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { readDirectAccount } from "./perplDirectState.js";
import { manualPositionRows, readManualOrders } from "./manualPerplState.js";

/** Replace cached position data so only fields from the finalized exchange row survive. */
export function replaceCurrentPositionWithFinalizedSnapshot(current: any, positions: any[]) {
  current.position = positions.length ? { ...positions[0], venueId: PERPL_DIRECT_VENUE_ID } : null;
  return current.position;
}

/** Add a finalized exchange snapshot to the Mera-owned direct Perpl run DTO. */
export async function ownerPerplCurrentSnapshot(auth: { token: string; ownerAddress: string }, result: any) {
  const current = result?.current;
  if (!current || current.venueId !== PERPL_DIRECT_VENUE_ID) return result;
  if (String(current.ownerAddress).toLowerCase() !== auth.ownerAddress.toLowerCase()
      || Number(current.chainId) !== PERPL_CHAIN_ID) return result;
  let provider: any;
  try {
    provider = await monadProvider();
    if ((await provider.getNetwork()).chainId !== BigInt(PERPL_CHAIN_ID)) throw new Error("perpl_wrong_chain");
    const blockNumber = await finalizedBlockNumber(provider);
    const accountId = Number(current.accountId);
    const address = String(current.delegatedAccountAddress ?? "");
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || !/^0x[0-9a-f]{40}$/i.test(address)) {
      throw new Error("perpl_account_not_ready");
    }
    const live = await readPerplContext();
    const allowedIds: number[] = Array.isArray(current.policy?.marketIds)
      ? current.policy.marketIds.map(Number).filter((id: number) => Number.isSafeInteger(id)) : [];
    const marketIds: number[] = allowedIds.length ? allowedIds : live.markets.filter((market) => market.isOpen).map((market) => market.id);
    if (!marketIds.length || marketIds.some((id) => !live.markets.some((market) => market.id === id))) {
      throw new Error("perpl_market_set_invalid");
    }
    const account = await readDirectAccount(provider, accountId, marketIds, address,
      Number(current.lastRequestId ?? 0), blockNumber);
    const positions = manualPositionRows(account, live.markets).map((position: any) => ({
      ...position, venueId: PERPL_DIRECT_VENUE_ID,
    }));
    const openOrders = await readManualOrders(provider, account, live.markets, accountId);
    replaceCurrentPositionWithFinalizedSnapshot(current, positions);
    current.positionSnapshot = { status: "finalized", stateSource: "finalized_perpl_exchange",
      verified: true, blockNumber: account.blockNumber, observedAt: account.observedAt,
      balanceUnits: account.balanceUnits, lockedUnits: account.lockedUnits,
      positions, openOrders };
    current.blockNumber = account.blockNumber;
    current.observedAt = account.observedAt;
  } catch (error: any) {
    const reason = typeof error?.message === "string" && /^[a-z0-9_]{3,80}$/.test(error.message)
      ? error.message : "perpl_finalized_position_unavailable";
    current.positionSnapshot = { status: "unavailable", stateSource: "finalized_perpl_exchange",
      verified: false, blockNumber: null, observedAt: Date.now(), reason };
    if (current.position && typeof current.position === "object") current.position = {
      ...current.position, verified: false, finalizedBlockNumber: null, liquidationPriceUnits: null,
      liquidationPrice: null,
      liquidationEstimateReason: reason, liquidationEstimate: { status: "unavailable",
        formula: "perpl_position_v1", priceUnits: null, reason,
        caveat: "A finalized Perpl snapshot is unavailable; this cached position must not be used for a live chart overlay." },
    };
  } finally { await provider?.destroy(); }
  return result;
}
