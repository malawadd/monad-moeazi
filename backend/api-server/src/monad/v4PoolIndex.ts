import { AbiCoder, Interface, getAddress, keccak256, zeroPadValue } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { operatorMutation, operatorQuery } from "./convex.js";
import { MonadApiError } from "./config.js";
import { USDC_ADDRESS, V4_POOL_MANAGER_ADDRESS, WMON_ADDRESS } from "./constants.js";
import { finalizedBlockNumber, monadProvider } from "./provider.js";

export type PoolKey = { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
export type V4PoolRecord = PoolKey & { poolId: string; initializedBlock: number; verified: boolean;
  verificationSource: string; verificationEvidence?: string; verifiedAt?: number; indexStatus?: string };

export const V4_POOL_MANAGER = V4_POOL_MANAGER_ADDRESS;
export const V4_START_BLOCK = 61_283_810;
export const V4_INITIALIZE_ABI = [
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
];
const eventInterface = new Interface(V4_INITIALIZE_ABI);
const initializeTopic = eventInterface.getEvent("Initialize")!.topicHash;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const seedKey: PoolKey = { currency0: USDC_ADDRESS, currency1: WMON_ADDRESS, fee: 3000,
  tickSpacing: 60, hooks: ZERO_ADDRESS };
const seedPoolId = keccak256(AbiCoder.defaultAbiCoder().encode(
  ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"], [[
    seedKey.currency0, seedKey.currency1, seedKey.fee, seedKey.tickSpacing, seedKey.hooks,
  ]],
)).toLowerCase();
const seedRecord: V4PoolRecord = { ...seedKey, poolId: seedPoolId, initializedBlock: 68_302_897,
  verified: true, verificationSource: "verified_testnet_manifest",
  verificationEvidence: "deployments/manifest.testnet.json: initialized pool and verified seeder receipt" };
const indexCache = { expiresAt: 0, state: null as any, pools: [] as any[] };
let indexRequest: Promise<any> | undefined;
let scanTask: Promise<void> | undefined;
let scanRetryAfter = 0;

export function v4PoolId(key: PoolKey) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"], [[
      getAddress(key.currency0), getAddress(key.currency1), key.fee, key.tickSpacing, getAddress(key.hooks),
    ]],
  )).toLowerCase();
}

export function normalizePoolId(value: unknown) {
  if (typeof value !== "string" || !/^0x[a-f0-9]{64}$/i.test(value)) {
    throw new MonadApiError("PoolId must be a 32-byte hex value.", 400, "v4_pool_id_invalid");
  }
  return value.toLowerCase();
}

export function v4MarketId(poolId: string) { return poolId.toLowerCase() === seedPoolId ? "WMON_USDC" : `v4_${poolId.toLowerCase()}`; }
export function v4PoolKey(record: Pick<V4PoolRecord, "currency0" | "currency1" | "fee" | "tickSpacing" | "hooks">): PoolKey {
  return { currency0: getAddress(record.currency0), currency1: getAddress(record.currency1), fee: Number(record.fee),
    tickSpacing: Number(record.tickSpacing), hooks: getAddress(record.hooks) };
}
export function poolKeysEqual(value: unknown, expected: PoolKey) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  try {
    return getAddress(String(row.currency0)).toLowerCase() === expected.currency0.toLowerCase()
      && getAddress(String(row.currency1)).toLowerCase() === expected.currency1.toLowerCase()
      && Number(row.fee) === expected.fee && Number(row.tickSpacing) === expected.tickSpacing
      && getAddress(String(row.hooks)).toLowerCase() === expected.hooks.toLowerCase();
  } catch { return false; }
}
export function isNoHook(record: Pick<V4PoolRecord, "hooks">) { return record.hooks.toLowerCase() === ZERO_ADDRESS; }
export function isTargetPool(record: Pick<PoolKey, "currency0" | "currency1">) {
  const a = record.currency0.toLowerCase(); const b = record.currency1.toLowerCase();
  return [a, b].some((token) => token === USDC_ADDRESS.toLowerCase() || token === WMON_ADDRESS.toLowerCase());
}
export function seedV4Pool() { return seedRecord; }

export async function readV4IndexSnapshot(force = false) {
  if (!force && indexCache.expiresAt > Date.now()) return indexCache;
  if (indexRequest) return await indexRequest;
  indexRequest = (async () => {
    const value: any = await operatorQuery("monadV4PoolIndex", "getIndexSnapshot", {});
    const result = { expiresAt: Date.now() + 5_000, state: value?.state ?? null,
      pools: Array.isArray(value?.pools) ? value.pools : [] };
    indexCache.expiresAt = result.expiresAt; indexCache.state = result.state; indexCache.pools = result.pools;
    return result;
  })();
  try { return await indexRequest; } finally { indexRequest = undefined; }
}

export async function findV4Pool(poolIdValue: unknown): Promise<V4PoolRecord | null> {
  const poolId = normalizePoolId(poolIdValue);
  if (poolId === seedPoolId) return seedRecord;
  const snapshot = await readV4IndexSnapshot();
  const row = snapshot.pools.find((item: any) => String(item.poolId).toLowerCase() === poolId);
  return row ? toPoolRecord(row) : null;
}

export async function listV4PoolRecords(options: { verifiedOnly?: boolean } = {}) {
  const snapshot = await readV4IndexSnapshot();
  const rows = [seedRecord, ...snapshot.pools.map(toPoolRecord)]
    .filter((row, index, list) => list.findIndex((item) => item.poolId === row.poolId) === index)
    .filter((row) => !options.verifiedOnly || row.verified);
  return { pools: rows, index: { status: snapshot.state && snapshot.state.scannedThrough >= snapshot.state.latestBlock
    ? "current" : "indexing", scannedThrough: Number(snapshot.state?.scannedThrough ?? V4_START_BLOCK - 1),
    latestBlock: Number(snapshot.state?.latestBlock ?? 0) } };
}

export async function setV4PoolVerification(poolIdValue: unknown, verified: boolean, evidence: unknown) {
  const poolId = normalizePoolId(poolIdValue);
  if (poolId === seedPoolId && !verified) throw new MonadApiError("The seeded WMON/USDC pool remains an operator-verified market.", 409, "seed_pool_cannot_be_unverified");
  if (typeof evidence !== "string" || evidence.trim().length < 8 || evidence.trim().length > 1000) {
    throw new MonadApiError("Review evidence must contain 8 to 1000 characters.", 400, "v4_verification_evidence_required");
  }
  const result = await operatorMutation("monadV4PoolIndex", "setPoolVerification", {
    poolId, verified, evidence: evidence.trim(),
  });
  indexCache.expiresAt = 0;
  return result;
}

export function scheduleV4PoolIndexScan() {
  if (scanTask || Date.now() < scanRetryAfter) return;
  scanTask = (async () => {
    let provider: JsonRpcProvider | undefined;
    let pending = false;
    try { provider = await monadProvider(); await scanPoolEvents(provider); }
    catch (error) { process.stderr.write(`[api] v4 pool index pass failed (${error instanceof Error ? `${error.name}: ${error.message.slice(0, 500)}` : "error"}).\n`); }
    finally {
      await provider?.destroy(); scanTask = undefined; indexCache.expiresAt = 0;
      try {
        const snapshot = await readV4IndexSnapshot(true);
        pending = !snapshot.state || snapshot.state.scannedThrough < snapshot.state.latestBlock;
      } catch { pending = true; }
      if (pending) {
        scanRetryAfter = Date.now() + 5_000;
        const timer = setTimeout(() => { scanRetryAfter = 0; scheduleV4PoolIndexScan(); }, 5_000);
        timer.unref?.();
      }
    }
  })();
}

export async function scanPoolEvents(provider: JsonRpcProvider, maxChunks = 120) {
  let snapshot: any = await readV4IndexSnapshot(true);
  let cursor = Math.max(V4_START_BLOCK - 1, Number(snapshot.state?.scannedThrough ?? V4_START_BLOCK - 1));
  const latestBlock = await finalizedBlockNumber(provider);
  // The public Monad Testnet RPC rejects eth_getLogs ranges above 100 blocks.
  const chunkSize = 100;
  const targetCurrencies = [zeroPadValue(USDC_ADDRESS, 32), zeroPadValue(WMON_ADDRESS, 32)];
  for (let count = 0; count < maxChunks && cursor < latestBlock; count += 8) {
    const ranges = Array.from({ length: Math.min(8, maxChunks - count) }, (_, index) => {
      const fromBlock = cursor + index * chunkSize + 1;
      return { fromBlock, toBlock: Math.min(latestBlock, fromBlock + chunkSize - 1) };
    }).filter(({ fromBlock }) => fromBlock <= latestBlock);
    if (ranges.length === 0) break;
    const batches = await Promise.all(ranges.map(async ({ fromBlock, toBlock }) => {
      const [currency0Logs, currency1Logs] = await Promise.all([
        provider.getLogs({ address: V4_POOL_MANAGER, fromBlock, toBlock,
          topics: [initializeTopic, null, targetCurrencies] }),
        provider.getLogs({ address: V4_POOL_MANAGER, fromBlock, toBlock,
          topics: [initializeTopic, null, null, targetCurrencies] }),
      ]);
      const seen = new Set<string>(); const rows: any[] = [];
      for (const log of [...currency0Logs, ...currency1Logs]) {
        try {
          const parsed = eventInterface.parseLog(log); if (!parsed) continue;
          const row = { poolId: String(parsed.args.id).toLowerCase(), currency0: getAddress(parsed.args.currency0).toLowerCase(),
            currency1: getAddress(parsed.args.currency1).toLowerCase(), fee: Number(parsed.args.fee),
            tickSpacing: Number(parsed.args.tickSpacing), hooks: getAddress(parsed.args.hooks).toLowerCase(),
            initializedBlock: Number(log.blockNumber) };
          if (!isTargetPool(row) || seen.has(row.poolId)) continue;
          seen.add(row.poolId); rows.push(row);
        } catch { /* malformed Initialize logs do not enter the operator index */ }
      }
      return { toBlock, rows };
    }));
    const rows = batches.flatMap((batch) => batch.rows);
    const toBlock = batches[batches.length - 1].toBlock;
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500);
      await operatorMutation("monadV4PoolIndex", "persistIndexBatch", { rows: batch,
        scannedThrough: toBlock, latestBlock, commitCursor: false });
    }
    await operatorMutation("monadV4PoolIndex", "persistIndexBatch", { rows: [], scannedThrough: toBlock, latestBlock });
    cursor = toBlock;
  }
}

export function toPoolRecord(row: any): V4PoolRecord {
  return { poolId: String(row.poolId).toLowerCase(), currency0: getAddress(row.currency0),
    currency1: getAddress(row.currency1), fee: Number(row.fee), tickSpacing: Number(row.tickSpacing),
    hooks: getAddress(row.hooks), initializedBlock: Number(row.initializedBlock), verified: row.verified === true,
    verificationSource: row.verified === true ? "operator_review" : "community_poolmanager_index",
    ...(row.verificationEvidence ? { verificationEvidence: String(row.verificationEvidence) } : {}),
    ...(Number.isSafeInteger(row.verifiedAt) ? { verifiedAt: Number(row.verifiedAt) } : {}) };
}
