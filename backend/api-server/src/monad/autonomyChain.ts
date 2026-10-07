import { Contract, Interface, getAddress, keccak256, toUtf8Bytes } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "./constants.js";
import { configuredAutonomyFactory, MonadApiError } from "./config.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { assertCircleUsdcDomain } from "./autonomyTypedData.js";
import { retryMissingRevertData } from "./autonomyRpcRead.js";

export const AUTONOMY_FACTORY_ABI = [
  "function enrollmentEnabled() view returns (bool)", "function administrator() view returns (address)",
  "function executor() view returns (address)", "function usdc() view returns (address)",
  "function enrollmentNonce(address) view returns (uint256)", "function predictVault(address,uint256) view returns (address)",
  "function tokenAt(uint8) view returns (address)", "function poolAt(uint8) view returns (address)",
  "function mandateDigest((uint256 chainId,address owner,address vault,address usdc,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 startBy,uint8 maxCycles,uint16 buySlippageBps,uint16 sellSlippageBps,uint256 nonce)) view returns (bytes32)",
  "function createAndEnroll((address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s),(uint256 chainId,address owner,address vault,address usdc,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 startBy,uint8 maxCycles,uint16 buySlippageBps,uint16 sellSlippageBps,uint256 nonce),bytes mandateSignature) returns (address)",
];
export const AUTONOMY_VAULT_ABI = [
  "function owner() view returns (address)", "function executor() view returns (address)",
  "function factory() view returns (address)", "function usdc() view returns (address)",
  "function fundedAmount() view returns (uint256)", "function mandateNonce() view returns (uint256)",
  "function mandateHash() view returns (bytes32)", "function activatedAt() view returns (uint64)",
  "function expiresAt() view returns (uint64)", "function buySlippageBps() view returns (uint16)",
  "function sellSlippageBps() view returns (uint16)", "function completedCycles() view returns (uint8)",
  "function positionTokenIndex() view returns (uint8)", "function positionAmount() view returns (uint256)",
  "function positionUsdcCost() view returns (uint256)", "function positionOpen() view returns (bool)",
  "function settlementStatus() view returns (uint8)", "function tokenAt(uint8) view returns (address)",
  "function poolAt(uint8) view returns (address)", "function executedOrder(bytes32) view returns (bool)",
  "function buy(bytes32,uint8,uint256,uint256)", "function sell(bytes32,uint256)",
  "function settleExpired(bytes32,uint256)", "function emergencyRecover()",
  "event Enrolled(address indexed owner,address indexed vault,uint256 fundingAmount,uint64 durationSeconds,uint64 activatedAt,uint64 expiresAt,uint256 nonce,bytes32 mandateHash)",
  "event BuyExecuted(bytes32 indexed orderId,uint8 indexed tokenIndex,uint256 amountIn,uint256 amountOut,uint256 expectedAmountOut,uint256 quotedAmountOut,uint256 minAmountOut)",
  "event SellExecuted(bytes32 indexed orderId,uint8 indexed tokenIndex,uint256 amountIn,uint256 amountOut,uint256 expectedAmountOut,uint256 quotedAmountOut,uint256 minAmountOut)",
  "event CycleCompleted(uint8 indexed cycles,uint8 indexed tokenIndex,uint256 usdcSpent,uint256 usdcReceived,int256 realizedProfitLoss,uint256 usdcBalance)",
  "event AssetReturned(address indexed asset,uint256 amount)",
  "event Settled(address indexed owner,uint8 indexed status,uint256 usdcReturned,uint8 unsoldTokenMask,uint8 completedCycles)",
];
export const AUTONOMY_POOL_ABI = [
  "function usdc() view returns (address)", "function token() view returns (address)",
  "function owner() view returns (address)", "function reserveUsdc() view returns (uint256)",
  "function reserveToken() view returns (uint256)", "function getReserves() view returns (uint256,uint256)",
  "function spotPriceUsdcPerTokenWad() view returns (uint256)",
  "function quoteSpotExactInput(address,address,uint256) view returns (uint256,bool)",
  "function quoteExactInput(address,address,uint256) view returns (uint256,bool)",
  "function swap(address,address,uint256,uint256) returns (uint256)",
  "function addLiquidity(uint256,uint256)",
  "event Swap(address indexed caller,address indexed tokenIn,uint256 amountIn,address indexed tokenOut,uint256 amountOut)",
];
export const AUTONOMY_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function symbol() view returns (string)", "function totalSupply() view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
export const CIRCLE_AUTHORIZATION_ABI = [
  "function version() view returns (string)", "function decimals() view returns (uint8)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function authorizationState(address,bytes32) view returns (bool)",
  "function receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ZERO32 = `0x${"0".repeat(64)}`;
const verifiedDeploymentCache = new Map<string, Promise<void>>();

export async function readAutonomyDeployment(provider: JsonRpcProvider) {
  const factoryAddress = configuredAutonomyFactory();
  if (!factoryAddress) throw new MonadApiError("Monad autonomy factory is not configured.", 503, "autonomy_factory_unavailable");
  await requireContractCode(provider, factoryAddress, "Monad autonomy factory");
  const manifest = await readAutonomyManifest();
  if (!manifest || manifest.verified !== true || manifest.deploymentStatus !== "verified"
      || manifest.deploymentTxHashes?.status !== "verified"
      || Number(manifest.chainId) !== MONAD_CHAIN_ID || String(manifest.addresses?.factory ?? "").toLowerCase() !== factoryAddress.toLowerCase()) {
    throw new MonadApiError("A receipt-verified Monad autonomy deployment manifest is required.", 503, "autonomy_manifest_unverified");
  }
  const codeHashes = manifest.codeHashes;
  if (!/^0x[a-f0-9]{64}$/i.test(String(codeHashes?.factory ?? ""))
      || !Array.isArray(codeHashes?.tokens) || codeHashes.tokens.length !== 3
      || !Array.isArray(codeHashes?.pools) || codeHashes.pools.length !== 3
      || [...codeHashes.tokens, ...codeHashes.pools].some((hash: unknown) => !/^0x[a-f0-9]{64}$/i.test(String(hash)))) {
    throw new MonadApiError("Verified autonomy manifest is missing required factory, token, or pool code hashes.", 503, "autonomy_manifest_incomplete");
  }
  const checkpoint = await finalizedBlockNumber(provider);
  const manifestKey = `${MONAD_CHAIN_ID}:${factoryAddress.toLowerCase()}:${keccak256(toUtf8Bytes(JSON.stringify(manifest)))}`;
  await verifyAutonomyManifestOnce(manifestKey, provider, factoryAddress, manifest, checkpoint);
  const factory = new Contract(factoryAddress, AUTONOMY_FACTORY_ABI, provider);
  const [enabled, executor, usdc, tokens, pools] = await Promise.all([
    retryMissingRevertData(() => factory.enrollmentEnabled({ blockTag: checkpoint })),
    retryMissingRevertData(() => factory.executor({ blockTag: checkpoint })),
    retryMissingRevertData(() => factory.usdc({ blockTag: checkpoint })),
    Promise.all([0, 1, 2].map((i) => retryMissingRevertData(() => factory.tokenAt(i, { blockTag: checkpoint })))),
    Promise.all([0, 1, 2].map((i) => retryMissingRevertData(() => factory.poolAt(i, { blockTag: checkpoint })))),
  ]);
  if (String(usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()) throw new MonadApiError("Autonomy factory does not pin Circle testnet USDC.", 503, "autonomy_deployment_mismatch");
  if (String(manifest.addresses?.usdc ?? "").toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || String(manifest.addresses?.executor ?? "").toLowerCase() !== String(executor).toLowerCase()) {
    throw new MonadApiError("Autonomy factory assets or executor differ from the verified manifest.", 503, "autonomy_deployment_mismatch");
  }
  for (let i = 0; i < 3; i += 1) {
    const expected = manifest.addresses?.tokens?.[i];
    if (!expected || Number(expected.index) !== i
        || String(expected.address).toLowerCase() !== String(tokens[i]).toLowerCase()
        || String(expected.pool).toLowerCase() !== String(pools[i]).toLowerCase()) {
      throw new MonadApiError(`Autonomy factory token/pool ${i} differs from the verified deployment manifest.`, 503, "autonomy_deployment_mismatch");
    }
    await Promise.all([requireContractCode(provider, getAddress(tokens[i]), `Autonomy token ${i}`),
      requireContractCode(provider, getAddress(pools[i]), `Autonomy pool ${i}`)]);
    const pool = new Contract(pools[i], AUTONOMY_POOL_ABI, provider);
    const [poolUsdc, poolToken] = await Promise.all([
      retryMissingRevertData(() => pool.usdc({ blockTag: checkpoint })),
      retryMissingRevertData(() => pool.token({ blockTag: checkpoint })),
    ]);
    if (String(poolUsdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()
        || String(poolToken).toLowerCase() !== String(tokens[i]).toLowerCase()) {
      throw new MonadApiError(`Autonomy pool ${i} is paired with an unexpected asset.`, 503, "autonomy_deployment_mismatch");
    }
  }
  const tokenMetadata = await Promise.all(tokens.map(async (address: string) => {
    const token = new Contract(address, AUTONOMY_TOKEN_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      retryMissingRevertData(() => token.symbol({ blockTag: checkpoint })),
      retryMissingRevertData(() => token.decimals({ blockTag: checkpoint })),
    ]);
    if (Number(decimals) !== 18) throw new MonadApiError("Autonomy token decimals differ from the reviewed mock token configuration.", 503, "autonomy_deployment_mismatch");
    return { address: getAddress(address), symbol: String(symbol), decimals: Number(decimals) };
  }));
  return { factoryAddress: getAddress(factoryAddress), factory, enabled: Boolean(enabled), executor: getAddress(executor),
    usdc: getAddress(usdc), tokens: tokens.map(getAddress), pools: pools.map(getAddress), tokenMetadata, checkpoint };
}

function assertVerifiedManifestShape(manifest: any) {
  const hashes = manifest.codeHashes;
  if (!/^0x[a-f0-9]{64}$/i.test(String(hashes?.factory ?? ""))
      || !Array.isArray(hashes?.tokens) || hashes.tokens.length !== 3
      || !Array.isArray(hashes?.pools) || hashes.pools.length !== 3
      || [...hashes.tokens, ...hashes.pools].some((hash: unknown) => !/^0x[a-f0-9]{64}$/i.test(String(hash)))) {
    throw new MonadApiError("Verified autonomy manifest is missing required factory, token, or pool code hashes.", 503, "autonomy_manifest_incomplete");
  }
  const required = ["deploy_token_MZA", "deploy_token_MZB", "deploy_token_MZG", "deploy_pool_MZA",
    "deploy_pool_MZB", "deploy_pool_MZG", "seed_MZA", "seed_MZB", "seed_MZG", "deploy_factory"];
  if (!Array.isArray(manifest.deploymentTxHashes?.items)) {
    throw new MonadApiError("Verified autonomy manifest is missing deployment receipts.", 503, "autonomy_manifest_incomplete");
  }
  const byLabel = new Map(manifest.deploymentTxHashes.items.map((item: any) => [item.label, item]));
  if (required.some((label) => !byLabel.has(label))) {
    throw new MonadApiError("Verified autonomy manifest is missing a token, pool, seed, or factory receipt.", 503, "autonomy_manifest_incomplete");
  }
}

async function verifyAutonomyManifestOnce(key: string, provider: JsonRpcProvider, factoryAddress: string,
  manifest: any, checkpoint: number) {
  assertVerifiedManifestShape(manifest);
  let validation = verifiedDeploymentCache.get(key);
  if (!validation) {
    validation = (async () => {
      for (const item of manifest.deploymentTxHashes.items) await verifyReceipt(provider, item, checkpoint);
      await assertDeploymentCodeHash(provider, factoryAddress, manifest.codeHashes.factory);
      for (let index = 0; index < 3; index += 1) {
        await assertDeploymentCodeHash(provider, manifest.addresses.tokens[index].address, manifest.codeHashes.tokens[index]);
        await assertDeploymentCodeHash(provider, manifest.addresses.tokens[index].pool, manifest.codeHashes.pools[index]);
      }
    })();
    verifiedDeploymentCache.set(key, validation);
    validation.catch(() => verifiedDeploymentCache.delete(key));
  }
  await validation;
}

async function verifyReceipt(provider: JsonRpcProvider, item: any, checkpoint: number) {
  const hash = String(item?.hash ?? item?.txHash ?? "");
  if (!/^0x[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(Number(item.blockNumber))) {
    throw new MonadApiError("Verified autonomy manifest contains an invalid deployment receipt.", 503, "autonomy_manifest_incomplete");
  }
  if (!(item.status === 1 || ["verified", "success"].includes(String(item.status).toLowerCase()))) {
    throw new MonadApiError("Verified autonomy manifest contains an unverified deployment receipt.", 503, "autonomy_manifest_incomplete");
  }
  const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(hash), provider.getTransaction(hash)]);
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  if (!receipt || receipt.status !== 1 || !tx || tx.chainId !== BigInt(MONAD_CHAIN_ID)
      || receipt.blockNumber !== Number(item.blockNumber) || receipt.blockNumber > checkpoint
      || block?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new MonadApiError("An autonomy deployment transaction receipt no longer verifies on Monad Testnet.", 503, "autonomy_receipt_unverified");
  }
}

export async function assertCircleAuthorizationReady(provider: JsonRpcProvider, owner: string, vault: string, nonce: string) {
  await requireContractCode(provider, USDC_ADDRESS, "Circle testnet USDC");
  const circle = new Contract(USDC_ADDRESS, CIRCLE_AUTHORIZATION_ABI, provider);
  const [version, decimals, separator, used] = await Promise.all([
    retryMissingRevertData(() => circle.version()), retryMissingRevertData(() => circle.decimals()),
    retryMissingRevertData(() => circle.DOMAIN_SEPARATOR()), retryMissingRevertData(() => circle.authorizationState(owner, nonce)),
  ]);
  if (String(version) !== "2" || Number(decimals) !== 6) throw new MonadApiError("Circle testnet USDC authorization interface is not the reviewed v2 contract.", 503, "usdc_authorization_unavailable");
  try { assertCircleUsdcDomain(separator); }
  catch { throw new MonadApiError("Circle testnet USDC EIP-712 domain does not match its deployed contract.", 503, "usdc_domain_mismatch"); }
  if (used) throw new MonadApiError("Circle USDC authorization nonce was already used.", 409, "authorization_nonce_replayed");
  const now = Math.floor(Date.now() / 1000);
  const data = new Interface(CIRCLE_AUTHORIZATION_ABI).encodeFunctionData("receiveWithAuthorization", [
    owner, vault, 100_000, 0, now + 60, nonce, 27, ZERO32, ZERO32,
  ]);
  try {
    await provider.call({ to: USDC_ADDRESS, from: vault, data });
    throw new MonadApiError("Circle authorization probe unexpectedly accepted an empty signature.", 503, "usdc_authorization_unverified");
  } catch (error) {
    const nested = (error as any)?.info?.error?.message ?? (error as any)?.error?.message ?? "";
    const text = `${(error as any)?.reason ?? ""} ${(error as any)?.shortMessage ?? ""} ${(error as any)?.message ?? ""} ${nested}`;
    if (error instanceof MonadApiError) throw error;
    if (!/invalid signature/i.test(text)) throw new MonadApiError("Circle receiveWithAuthorization could not be verified on the deployed USDC contract.", 503, "usdc_authorization_unavailable");
  }
}

export async function assertDeploymentCodeHash(provider: JsonRpcProvider, address: string, expected?: string) {
  if (!expected) return;
  const actual = keccak256(await provider.getCode(address)).toLowerCase();
  if (actual !== expected.toLowerCase()) throw new MonadApiError("Monad autonomy contract code hash differs from the reviewed manifest.", 503, "autonomy_code_hash_mismatch");
}

export async function readAutonomyManifest() {
  try { return JSON.parse(await readFile(path.join(root, "contracts/monad-testnet/deployments/manifest.autonomy.testnet.json"), "utf8")); }
  catch { return null; }
}
