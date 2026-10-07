import { Contract, getAddress, keccak256 } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuredPerpFactory, MonadApiError } from "./config.js";
import { ERC20_ABI, MONAD_CHAIN_ID, USDC_ADDRESS } from "./constants.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { assertCircleUsdcDomain } from "./autonomyTypedData.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const PERP_FACTORY_ABI = [
  "function enrollmentEnabled() view returns (bool)", "function administrator() view returns (address)",
  "function executor() view returns (address)", "function usdc() view returns (address)",
  "function clearinghouse() view returns (address)", "function enrollmentNonce(address) view returns (uint256)",
  "function predictVault(address,uint256) view returns (address)", "function activeVault(address) view returns (address)",
  "function tokenAt(uint8) view returns (address)",
  "function poolAt(uint8) view returns (address)",
  "function setEnrollmentEnabled(bool)",
  "function mandateDigest((uint256 chainId,address owner,address vault,address usdc,address clearinghouse,address executor,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce)) view returns (bytes32)",
  "function createAndEnroll((address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s),(uint256 chainId,address owner,address vault,address usdc,address clearinghouse,address executor,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce),bytes mandateSignature) returns (address)",
];
export const PERP_CLEARINGHOUSE_ABI = [
  "function operatorReserve() view returns (uint256)", "function reserveCommitted() view returns (uint256)",
  "function currentMargin(address) view returns (uint256)", "function userCollateralTotal() view returns (uint256)",
  "function currentPrice(uint8) view returns (uint256)",
  "function position(address) view returns (bool open,bool isLong,uint8 marketIndex,uint8 leverage,uint256 marginUsdc,uint256 sizeWad,uint256 entryPriceWad,int256 fundingAccruedUsdc,uint256 takeProfitWad,uint256 stopLossWad,uint64 openedAt,uint64 lastFundingAt)",
  "function pendingOrder(address) view returns (bytes32 orderId,uint8 marketIndex,bool isLong,uint8 leverage,uint256 marginUsdc,uint256 limitPriceWad,uint64 goodUntil)",
  "event EntrySubmitted(address indexed vault,bytes32 indexed orderId,uint8 indexed marketIndex,bool isLong,uint8 leverage,uint256 marginUsdc,uint256 limitPriceWad,bool filled)",
  "event LimitFilled(address indexed vault,bytes32 indexed orderId,uint256 entryPriceWad,uint256 sizeWad)",
  "event PositionChanged(address indexed vault,bytes32 indexed orderId,uint256 marginUsdc,uint256 sizeWad,uint256 entryPriceWad,uint8 leverage)",
  "event FundingAccrued(address indexed vault,bytes32 indexed orderId,int256 amountUsdc,int16 rateBpsPerDay,uint64 elapsedSeconds)",
  "event PositionClosed(address indexed vault,bytes32 indexed orderId,uint8 indexed marketIndex,bool isLong,uint256 sizeWad,uint256 entryPriceWad,uint256 exitPriceWad,int256 realizedPnlUsdc,int256 fundingUsdc,uint256 returnedUsdc,uint8 reason)",
  "event Liquidated(address indexed vault,bytes32 indexed orderId,uint256 markPriceWad,int256 equityUsdc,uint256 maintenanceMarginUsdc)",
  "event EntryCancelled(address indexed vault,bytes32 indexed orderId,uint256 marginReturned)",
  "event TriggersChanged(address indexed vault,bytes32 indexed orderId,uint256 takeProfitWad,uint256 stopLossWad)",
];
export const PERP_VAULT_ABI = [
  "function owner() view returns (address)", "function executor() view returns (address)",
  "function factory() view returns (address)", "function clearinghouse() view returns (address)",
  "function usdc() view returns (address)", "function mandateNonce() view returns (uint256)",
  "function mandateHash() view returns (bytes32)", "function fundedAmount() view returns (uint256)",
  "function activatedAt() view returns (uint64)", "function expiresAt() view returns (uint64)",
  "function status() view returns (uint8)", "function stopNonce() view returns (uint256)",
  "function submitEntry(bytes32,uint8,bool,uint8,uint256,uint256,uint256,uint64)",
  "function fillLimit(bytes32)", "function amendLimit(bytes32,uint256,uint64)", "function cancelPending(bytes32)",
  "function increaseSize(bytes32,uint256,uint256,uint64)", "function reduceSize(bytes32,uint256,uint256,uint64)",
  "function addMargin(bytes32,uint256,uint256,uint64)", "function removeMargin(bytes32,uint256,uint256,uint64)",
  "function setTriggers(bytes32,uint256,uint256)", "function closePosition(bytes32,uint256,uint64)",
  "function executeTrigger(bytes32,uint256,uint64)", "function liquidate(bytes32)", "function settleExpired(bytes32)",
  "function accrueFunding(bytes32)", "function stopDigest(uint256,uint64) view returns (bytes32)",
  "function stopWithSignature(uint256,uint64,bytes)",
  "event EntrySubmitted(address indexed vault,bytes32 indexed orderId,uint8 indexed marketIndex,bool isLong,uint8 leverage,uint256 marginUsdc,uint256 limitPriceWad,bool filled)",
  "event LimitFilled(address indexed vault,bytes32 indexed orderId,uint256 entryPriceWad,uint256 sizeWad)",
  "event PositionChanged(address indexed vault,bytes32 indexed orderId,uint256 marginUsdc,uint256 sizeWad,uint256 entryPriceWad,uint8 leverage)",
  "event FundingAccrued(address indexed vault,bytes32 indexed orderId,int256 amountUsdc,int16 rateBpsPerDay,uint64 elapsedSeconds)",
  "event PositionClosed(address indexed vault,bytes32 indexed orderId,uint8 indexed marketIndex,bool isLong,uint256 sizeWad,uint256 entryPriceWad,uint256 exitPriceWad,int256 realizedPnlUsdc,int256 fundingUsdc,uint256 returnedUsdc,uint8 reason)",
  "event Liquidated(address indexed vault,bytes32 indexed orderId,uint256 markPriceWad,int256 equityUsdc,uint256 maintenanceMarginUsdc)",
  "event EntryCancelled(address indexed vault,bytes32 indexed orderId,uint256 marginReturned)",
  "event TriggersChanged(address indexed vault,bytes32 indexed orderId,uint256 takeProfitWad,uint256 stopLossWad)",
  "event SettlementReturned(address indexed owner,uint256 amountUsdc,uint8 status)",
  "event Stopped(address indexed owner,uint256 nonce,uint256 returnedUsdc)",
  "event RunExpired(address indexed owner,uint256 returnedUsdc)",
];
export const PERP_POOL_ABI = ["function usdc() view returns (address)", "function token() view returns (address)",
  "function spotPriceUsdcPerTokenWad() view returns (uint256)"];
const cache = new Map<string, Promise<void>>();

export async function readPerpDeployment(provider: JsonRpcProvider) {
  const factoryAddress = configuredPerpFactory();
  if (!factoryAddress) throw new MonadApiError("Monad Testnet perp factory is not configured.", 503, "perp_factory_unavailable");
  const manifest = await readPerpManifest();
  if (manifest.verified !== true || manifest.deploymentStatus !== "verified" || manifest.deploymentTxHashes?.status !== "verified"
      || Number(manifest.chainId) !== MONAD_CHAIN_ID || String(manifest.addresses?.factory).toLowerCase() !== factoryAddress.toLowerCase()
      || manifest.policy?.version !== 1 || String(manifest.policy?.minFunding) !== "100000"
      || String(manifest.policy?.maxFunding) !== "10000000" || Number(manifest.policy?.minDurationSeconds) !== 600
      || Number(manifest.policy?.maxDurationSeconds) !== 7200 || Number(manifest.policy?.maxLeverage) !== 10
      || Number(manifest.policy?.maxPayoutMultiple) !== 5 || Number(manifest.policy?.reserveMultiple) !== 4) {
    throw new MonadApiError("A receipt-verified Monad Testnet perp manifest is required.", 503, "perp_manifest_unverified");
  }
  const { clearinghouse } = manifest.addresses;
  if (!Array.isArray(manifest.addresses.markets) || manifest.addresses.markets.length !== 3
      || !/^0x[a-f0-9]{64}$/i.test(String(manifest.codeHashes?.factory ?? ""))
      || !/^0x[a-f0-9]{64}$/i.test(String(manifest.codeHashes?.clearinghouse ?? ""))
      || manifest.codeHashes?.tokens?.length !== 3 || manifest.codeHashes?.pools?.length !== 3) {
    throw new MonadApiError("Verified perp manifest is missing addresses or code hashes.", 503, "perp_manifest_incomplete");
  }
  const checkpoint = await finalizedBlockNumber(provider);
  const key = `${MONAD_CHAIN_ID}:${factoryAddress.toLowerCase()}:${JSON.stringify(manifest)}`;
  let validation = cache.get(key);
  if (!validation) {
    validation = verifyManifest(provider, manifest, checkpoint);
    cache.set(key, validation); validation.catch(() => cache.delete(key));
  }
  await validation;
  await Promise.all([requireContractCode(provider, factoryAddress, "Monad perp factory"),
    requireContractCode(provider, clearinghouse, "Monad perp clearinghouse")]);
  const factory = new Contract(factoryAddress, PERP_FACTORY_ABI, provider);
  const [enabled, executor, usdc, onchainClearinghouse, onchainTokens, onchainPools] = await Promise.all([
    factory.enrollmentEnabled({ blockTag: checkpoint }), factory.executor({ blockTag: checkpoint }),
    factory.usdc({ blockTag: checkpoint }), factory.clearinghouse({ blockTag: checkpoint }),
    Promise.all([0, 1, 2].map((i) => factory.tokenAt(i, { blockTag: checkpoint }))),
    Promise.all([0, 1, 2].map((i) => factory.poolAt(i, { blockTag: checkpoint }))),
  ]);
  if (String(usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase() || String(manifest.addresses.usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || String(onchainClearinghouse).toLowerCase() !== String(clearinghouse).toLowerCase()
      || String(manifest.addresses.executor).toLowerCase() !== String(executor).toLowerCase()) {
    throw new MonadApiError("Perp factory assets or executor differ from the verified manifest.", 503, "perp_deployment_mismatch");
  }
  const markets = manifest.addresses.markets.map((market: any, i: number) => {
    if (Number(market.index) !== i || String(market.token).toLowerCase() !== String(onchainTokens[i]).toLowerCase()
        || String(market.pool).toLowerCase() !== String(onchainPools[i]).toLowerCase()) {
      throw new MonadApiError(`Perp market ${i} differs from the verified factory manifest.`, 503, "perp_deployment_mismatch");
    }
    return { index: i, name: String(market.name), symbol: String(market.symbol),
      tokenAddress: getAddress(market.token), poolAddress: getAddress(market.pool) };
  });
  await Promise.all(markets.map(async (market: any) => {
    await Promise.all([requireContractCode(provider, market.tokenAddress, `Perp market ${market.index} token`),
      requireContractCode(provider, market.poolAddress, `Perp market ${market.index} pool`)]);
    const [poolUsdc, poolToken, symbol, decimals] = await Promise.all([
      new Contract(market.poolAddress, PERP_POOL_ABI, provider).usdc({ blockTag: checkpoint }),
      new Contract(market.poolAddress, PERP_POOL_ABI, provider).token({ blockTag: checkpoint }),
      new Contract(market.tokenAddress, ["function symbol() view returns (string)"], provider).symbol({ blockTag: checkpoint }),
      new Contract(market.tokenAddress, ["function decimals() view returns (uint8)"], provider).decimals({ blockTag: checkpoint }),
    ]);
    if (String(poolUsdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()
        || String(poolToken).toLowerCase() !== market.tokenAddress.toLowerCase()
        || String(symbol) !== market.symbol || Number(decimals) !== 18) {
      throw new MonadApiError(`Perp market ${market.index} pool or token differs from the reviewed manifest.`, 503, "perp_deployment_mismatch");
    }
  }));
  return { factory, factoryAddress: getAddress(factoryAddress), clearinghouseAddress: getAddress(clearinghouse),
    clearinghouse: new Contract(clearinghouse, PERP_CLEARINGHOUSE_ABI, provider),
    executor: getAddress(executor), administrator: getAddress(manifest.addresses.administrator),
    usdc: getAddress(usdc), markets, enabled: Boolean(enabled), checkpoint, manifest };
}

async function readPerpManifest() {
  try { return JSON.parse(await readFile(path.join(root, "contracts/monad-testnet/deployments/manifest.perp.testnet.json"), "utf8")); }
  catch { throw new MonadApiError("Monad Testnet perp manifest is unavailable.", 503, "perp_manifest_unavailable"); }
}

async function verifyManifest(provider: JsonRpcProvider, manifest: any, checkpoint: number) {
  const labels = new Map((manifest.deploymentTxHashes.items ?? []).map((item: any) => [item.label, item]));
  const required = ["deploy_perp_clearinghouse", "deploy_perp_factory"];
  if (required.some((label) => !labels.has(label))) throw new MonadApiError("Perp manifest is missing deployment receipts.", 503, "perp_manifest_incomplete");
  for (const item of labels.values() as any) {
    const receipt = await provider.getTransactionReceipt(item.txHash);
    if (!receipt || receipt.status !== 1 || receipt.blockNumber !== Number(item.blockNumber) || receipt.blockNumber > checkpoint
        || item.status !== 1) throw new MonadApiError("A perp deployment receipt is not finalized and successful.", 503, "perp_manifest_receipt_invalid");
  }
  const addresses = [manifest.addresses.factory, manifest.addresses.clearinghouse,
    ...manifest.addresses.markets.map((market: any) => market.token), ...manifest.addresses.markets.map((market: any) => market.pool)];
  const hashes = [manifest.codeHashes.factory, manifest.codeHashes.clearinghouse,
    ...manifest.codeHashes.tokens, ...manifest.codeHashes.pools];
  for (let i = 0; i < addresses.length; i += 1) {
    const code = await provider.getCode(getAddress(addresses[i]), checkpoint);
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== String(hashes[i]).toLowerCase()) {
      throw new MonadApiError("Deployed perp bytecode differs from the verified manifest.", 503, "perp_code_hash_mismatch");
    }
  }
}

export async function assertCirclePerpReady(provider: JsonRpcProvider, owner: string, vault: string, nonce: string) {
  const usdc = new Contract(USDC_ADDRESS, [...ERC20_ABI, "function DOMAIN_SEPARATOR() view returns (bytes32)",
    "function authorizationState(address,bytes32) view returns (bool)"], provider);
  const [decimals, separator, used] = await Promise.all([usdc.decimals(), usdc.DOMAIN_SEPARATOR(), usdc.authorizationState(owner, nonce)]);
  if (Number(decimals) !== 6 || used) throw new MonadApiError("Circle USDC authorization is unavailable or already consumed.", 409, "circle_authorization_unavailable");
  try { assertCircleUsdcDomain(String(separator)); }
  catch { throw new MonadApiError("Circle USDC domain differs from the reviewed testnet authorization domain.", 503, "circle_domain_mismatch"); }
  void vault;
}
