import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, getAddress, keccak256, toUtf8Bytes } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "../../../api-server/src/monad/constants.js";
import { DeploymentJournal, codeHashAt, receiptFromJournal, verifyReceipt } from "./perpDeploySupport.js";

const contractRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifestPath = path.join(contractRoot, "deployments/manifest.autonomy.testnet.json");
const manifestPath = path.join(contractRoot, "deployments/manifest.perp.testnet.json");
const EXPECTED_MARKETS = ["MZA", "MZB", "MZG"] as const;
const sourceFactoryAbi = ["function enrollmentEnabled() view returns (bool)"];
const clearinghouseAbi = [
  "function administrator() view returns (address)", "function usdc() view returns (address)",
  "function factory() view returns (address)", "function factorySet() view returns (bool)",
  "function operatorReserve() view returns (uint256)", "function reserveCommitted() view returns (uint256)",
  "function userCollateralTotal() view returns (uint256)",
];
const perpFactoryAbi = [
  "function administrator() view returns (address)", "function executor() view returns (address)",
  "function usdc() view returns (address)", "function clearinghouse() view returns (address)",
  "function enrollmentEnabled() view returns (bool)", "function tokenAt(uint8) view returns (address)",
  "function poolAt(uint8) view returns (address)",
];
const poolAbi = ["function usdc() view returns (address)", "function token() view returns (address)"];
const tokenAbi = ["function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"];

export async function loadSource(provider: JsonRpcProvider, checkpoint: number) {
  const raw = await readFile(sourceManifestPath, "utf8");
  const source: any = JSON.parse(raw);
  if (source.verified !== true || source.deploymentStatus !== "verified" || source.chainId !== MONAD_CHAIN_ID
      || source.addresses?.usdc?.toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || source.deploymentTxHashes?.status !== "verified" || !Array.isArray(source.deploymentTxHashes.items)
      || source.codeHashes?.tokens?.length !== 3 || source.codeHashes?.pools?.length !== 3
      || source.addresses?.tokens?.length !== 3) throw new Error("Verified MZA/MZB/MZG autonomy deployment manifest is required.");
  const sourceFactory = new Contract(getAddress(source.addresses.factory), sourceFactoryAbi, provider);
  if (await sourceFactory.enrollmentEnabled({ blockTag: checkpoint })) {
    throw new Error("Existing Spot autonomy factory enrollment is enabled; keep Spot off for Perp deployment.");
  }
  if ((await codeHashAt(provider, source.addresses.factory, checkpoint)).toLowerCase()
      !== String(source.codeHashes.factory).toLowerCase()) {
    throw new Error("Existing Spot autonomy factory code differs from its verified manifest.");
  }
  for (const item of source.deploymentTxHashes.items) {
    await verifyReceipt(provider, { label: item.label, txHash: item.txHash,
      blockNumber: Number(item.blockNumber), status: item.status }, checkpoint);
  }
  const markets = [];
  for (let index = 0; index < 3; index += 1) {
    const item = source.addresses.tokens[index];
    if (item.index !== index || item.symbol !== EXPECTED_MARKETS[index]) throw new Error("Existing pool market order must be MZA, MZB, MZG.");
    const tokenAddress = getAddress(item.address); const poolAddress = getAddress(item.pool);
    const [tokenHash, poolHash] = await Promise.all([
      codeHashAt(provider, tokenAddress, checkpoint), codeHashAt(provider, poolAddress, checkpoint),
    ]);
    if (tokenHash.toLowerCase() !== source.codeHashes.tokens[index].toLowerCase()
        || poolHash.toLowerCase() !== source.codeHashes.pools[index].toLowerCase()) {
      throw new Error(`${item.symbol} token or pool code differs from the verified autonomy manifest.`);
    }
    const token = new Contract(tokenAddress, tokenAbi, provider); const pool = new Contract(poolAddress, poolAbi, provider);
    const [name, symbol, decimals, poolUsdc, poolToken] = await Promise.all([
      token.name({ blockTag: checkpoint }), token.symbol({ blockTag: checkpoint }), token.decimals({ blockTag: checkpoint }),
      pool.usdc({ blockTag: checkpoint }), pool.token({ blockTag: checkpoint }),
    ]);
    if (String(symbol) !== item.symbol || Number(decimals) !== 18
        || String(poolUsdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()
        || String(poolToken).toLowerCase() !== tokenAddress.toLowerCase()) {
      throw new Error(`${item.symbol} token or pool metadata does not match the reviewed manifest.`);
    }
    markets.push({ index, name: String(name), symbol: item.symbol, token: tokenAddress, pool: poolAddress });
  }
  return { source, sourceHash: keccak256(toUtf8Bytes(raw)), markets };
}

function validatePolicy(manifest: any) {
  const policy = manifest.policy;
  if (manifest.verified !== true || manifest.deploymentStatus !== "verified" || manifest.chainId !== MONAD_CHAIN_ID
      || policy?.version !== 1 || String(policy.minFunding) !== "100000" || String(policy.maxFunding) !== "10000000"
      || Number(policy.minDurationSeconds) !== 600 || Number(policy.maxDurationSeconds) !== 7200
      || Number(policy.maxLeverage) !== 10 || Number(policy.maxPayoutMultiple) !== 5 || Number(policy.reserveMultiple) !== 4) {
    throw new Error("Existing Perp manifest is not a verified policy-version-1 deployment.");
  }
}

export async function verifyOnchain(provider: JsonRpcProvider, manifest: any, markets: any[],
  walletAddress: string, checkpoint: number, requireFactoryDisabled: boolean, requireEmptyReserve: boolean) {
  validatePolicy(manifest);
  const addresses = manifest.addresses;
  if (String(addresses.administrator).toLowerCase() !== walletAddress.toLowerCase()
      || String(addresses.executor).toLowerCase() !== walletAddress.toLowerCase()
      || String(addresses.usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || !Array.isArray(addresses.markets) || addresses.markets.length !== 3) throw new Error("Perp manifest addresses do not match operator, USDC, and verified markets.");
  for (let i = 0; i < 3; i += 1) {
    const expected = markets[i]; const item = addresses.markets[i];
    if (item.index !== i || item.symbol !== expected.symbol || String(item.token).toLowerCase() !== expected.token.toLowerCase()
        || String(item.pool).toLowerCase() !== expected.pool.toLowerCase()) throw new Error("Perp manifest market addresses differ from the existing verified pools.");
  }
  const items = manifest.deploymentTxHashes?.items;
  const labels = new Set(Array.isArray(items) ? items.map((item: any) => item.label) : []);
  if (manifest.deploymentTxHashes?.status !== "verified"
      || !["deploy_perp_clearinghouse", "deploy_perp_factory", "set_perp_factory"].every((label) => labels.has(label))) {
    throw new Error("Perp manifest is missing verified deployment and factory-link receipts.");
  }
  for (const item of items) await verifyReceipt(provider, item, checkpoint);
  const hashAddresses = [addresses.factory, addresses.clearinghouse, ...addresses.markets.map((item: any) => item.token),
    ...addresses.markets.map((item: any) => item.pool)];
  const expectedHashes = [manifest.codeHashes?.factory, manifest.codeHashes?.clearinghouse,
    ...(manifest.codeHashes?.tokens ?? []), ...(manifest.codeHashes?.pools ?? [])];
  if (hashAddresses.length !== expectedHashes.length || expectedHashes.some((hash: unknown) => typeof hash !== "string")) {
    throw new Error("Perp manifest code-hash lists are incomplete.");
  }
  for (let i = 0; i < hashAddresses.length; i += 1) {
    const actual = await codeHashAt(provider, getAddress(hashAddresses[i]), checkpoint);
    if (actual.toLowerCase() !== String(expectedHashes[i]).toLowerCase()) throw new Error("Perp deployment code hash differs from manifest.");
  }
  const factory = new Contract(addresses.factory, perpFactoryAbi, provider);
  const clearinghouse = new Contract(addresses.clearinghouse, clearinghouseAbi, provider);
  const [admin, executor, usdc, ch, enabled, chAdmin, chUsdc, chFactorySet, chFactory, reserve, committed, collateral] = await Promise.all([
    factory.administrator({ blockTag: checkpoint }), factory.executor({ blockTag: checkpoint }),
    factory.usdc({ blockTag: checkpoint }), factory.clearinghouse({ blockTag: checkpoint }),
    factory.enrollmentEnabled({ blockTag: checkpoint }), clearinghouse.administrator({ blockTag: checkpoint }),
    clearinghouse.usdc({ blockTag: checkpoint }), clearinghouse.factorySet({ blockTag: checkpoint }),
    clearinghouse.factory({ blockTag: checkpoint }), clearinghouse.operatorReserve({ blockTag: checkpoint }),
    clearinghouse.reserveCommitted({ blockTag: checkpoint }), clearinghouse.userCollateralTotal({ blockTag: checkpoint }),
  ]);
  const [tokens, pools] = await Promise.all([
    Promise.all([0, 1, 2].map((i) => factory.tokenAt(i, { blockTag: checkpoint }))),
    Promise.all([0, 1, 2].map((i) => factory.poolAt(i, { blockTag: checkpoint }))),
  ]);
  if ([admin, executor, chAdmin].some((value) => String(value).toLowerCase() !== walletAddress.toLowerCase())
      || String(usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase() || String(chUsdc).toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || String(ch).toLowerCase() !== String(addresses.clearinghouse).toLowerCase() || !chFactorySet
      || String(chFactory).toLowerCase() !== String(addresses.factory).toLowerCase()
      || (requireFactoryDisabled && Boolean(enabled))
      || (requireEmptyReserve && (BigInt(reserve) !== 0n || BigInt(committed) !== 0n || BigInt(collateral) !== 0n))) {
    throw new Error("Perp deployment constructor state differs from the reviewed default-off configuration.");
  }
  if (tokens.some((value, i) => String(value).toLowerCase() !== markets[i].token.toLowerCase())
      || pools.some((value, i) => String(value).toLowerCase() !== markets[i].pool.toLowerCase())) {
    throw new Error("Perp factory market addresses differ from the verified pools.");
  }
  return { enrollmentEnabled: Boolean(enabled), operatorReserve: String(reserve), reserveCommitted: String(committed) };
}

export async function existingManifest(provider: JsonRpcProvider, walletAddress: string, markets: any[], checkpoint: number) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const state = await verifyOnchain(provider, manifest, markets, walletAddress, checkpoint, false, false);
    return { manifest, state };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function buildManifest(provider: JsonRpcProvider, journal: DeploymentJournal,
  operator: string, markets: any[], clearinghouse: string, factory: string, source: any,
  sourceHash: string, revision: string, checkpoint: number) {
  const contractHashes = await Promise.all([codeHashAt(provider, factory, checkpoint), codeHashAt(provider, clearinghouse, checkpoint)]);
  const [tokenHashes, poolHashes] = await Promise.all([
    Promise.all(markets.map((market) => codeHashAt(provider, market.token, checkpoint))),
    Promise.all(markets.map((market) => codeHashAt(provider, market.pool, checkpoint))),
  ]);
  const toml = await readFile(path.join(contractRoot, "foundry.toml"), "utf8");
  const forgeVersion = await import("node:child_process").then(({ execFileSync }) => execFileSync("forge", ["--version"], { encoding: "utf8" }));
  const version = /Version:\s*(\S+)/i.exec(forgeVersion)?.[1];
  if (!version) throw new Error("Could not determine the installed Foundry version.");
  const items = ["deploy_perp_clearinghouse", "deploy_perp_factory", "set_perp_factory"]
    .map((label) => receiptFromJournal(journal, label));
  for (const receipt of items) await verifyReceipt(provider, receipt, checkpoint);
  return {
    schemaVersion: 1, network: "monad-testnet", chainId: MONAD_CHAIN_ID,
    deploymentStatus: "verified", verified: true, enrollmentEnabled: false,
    policy: { version: 1, minFunding: "100000", maxFunding: "10000000", minDurationSeconds: 600,
      maxDurationSeconds: 7200, maxLeverage: 10, maxPositionMarginMultiple: 1, maxPayoutMultiple: 5, reserveMultiple: 4 },
    addresses: { administrator: getAddress(operator), executor: getAddress(operator), usdc: USDC_ADDRESS,
      factory: getAddress(factory), clearinghouse: getAddress(clearinghouse),
      markets: markets.map((market) => ({ index: market.index, name: market.name, symbol: market.symbol,
        token: getAddress(market.token), pool: getAddress(market.pool) })) },
    codeHashes: { factory: contractHashes[0], clearinghouse: contractHashes[1], tokens: tokenHashes, pools: poolHashes },
    reserve: { token: USDC_ADDRESS, depositedUsdc: "0", committedUsdc: "0", availableUsdc: "0", status: "not_funded" },
    source: { revision, solc: "0.8.26", foundry: `v${version}`, foundryTomlHash: keccak256(toUtf8Bytes(toml)),
      autonomyManifestHash: sourceHash, autonomyFactory: source.addresses.factory },
    deploymentTxHashes: { status: "verified", items },
  };
}
