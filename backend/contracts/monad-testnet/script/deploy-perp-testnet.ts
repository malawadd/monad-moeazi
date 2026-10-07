import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, Interface, getCreateAddress, keccak256, toUtf8Bytes } from "ethers";
import { loadMonadEnvironment } from "../../../api-server/src/environment.js";
import { monadProvider, finalizedBlockNumber } from "../../../api-server/src/monad/provider.js";
import { operatorWallet } from "../../../api-server/src/monad/vaultTrades.js";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "../../../api-server/src/monad/constants.js";
import { DeploymentJournal, acquireLock, loadJournal, readArtifact,
  saveJournal, sendJournaledTransaction, writeJsonExclusive } from "./perpDeploySupport.js";
import { buildManifest, existingManifest, loadSource, verifyOnchain } from "./perpDeploymentManifest.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contractRoot = path.resolve(scriptDir, "..");
const backendRoot = path.resolve(contractRoot, "../..");
const manifestPath = path.join(contractRoot, "deployments/manifest.perp.testnet.json");
const dataRoot = path.join(backendRoot, ".data");
const journalPath = path.join(dataRoot, "monad-perp-deploy.state.json");
const lockPath = path.join(dataRoot, "monad-perp-deploy.lock");
const FACTORY_MAX_GAS = 12_000_000n;
const SET_FACTORY_MAX_GAS = 300_000n;
const CLEARINGHOUSE_MAX_GAS = 8_000_000n;
const DEFAULT_MAX_COST_WEI = 500_000_000_000_000_000n;

function requireDeployGates() {
  const required = ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
    "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_PERP_AUTONOMY_ENABLED"];
  const missing = required.filter((key) => process.env[key] !== "true");
  if (missing.length) throw new Error(`--deploy requires these local gates to be true: ${missing.join(", ")}`);
  if (process.env.MONAD_TESTNET_AUTONOMY_ENABLED === "true") {
    throw new Error("Spot autonomy gate must remain off while deploying the separate Perp venue.");
  }
  if (process.env.LIVE_EXECUTION_ENABLED === "true" || process.env.MAINNET_VENUE_SETUP_ENABLED === "true") {
    throw new Error("Live execution and mainnet venue setup must remain off for this testnet deployment.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--deploy") || args.filter((arg) => arg === "--deploy").length > 1) {
    throw new Error("Usage: node --import tsx contracts/monad-testnet/script/deploy-perp-testnet.ts [--deploy]");
  }
  const deploy = args.includes("--deploy");
  await loadMonadEnvironment(backendRoot);
  if (deploy) requireDeployGates();
  const provider = await monadProvider();
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) throw new Error("RPC chain ID is not Monad Testnet 10143.");
    const wallet = await operatorWallet();
    const checkpoint = await finalizedBlockNumber(provider);
    const [{ source, sourceHash, markets }, clearinghouseArtifact, factoryArtifact] = await Promise.all([
      loadSource(provider, checkpoint),
      readArtifact(path.join(contractRoot, "out/PerpClearinghouse.sol/PerpClearinghouse.json")),
      readArtifact(path.join(contractRoot, "out/PerpVaultFactory.sol/PerpVaultFactory.json")),
    ]);
    if (wallet.address.toLowerCase() !== String(source.addresses.administrator).toLowerCase()
        || wallet.address.toLowerCase() !== String(source.addresses.executor).toLowerCase()) {
      throw new Error("Local operatorWallet is not the verified pool operator, administrator, and executor.");
    }
    const existing = await existingManifest(provider, wallet.address, markets, checkpoint);
    if (existing) {
      process.stdout.write(JSON.stringify({ mode: deploy ? "deploy" : "dry-run", alreadyDeployed: true,
        chainId: MONAD_CHAIN_ID, factory: existing.manifest.addresses.factory,
        clearinghouse: existing.manifest.addresses.clearinghouse, enrollmentEnabled: existing.state.enrollmentEnabled,
        verifiedAtBlock: checkpoint, manifest: path.relative(backendRoot, manifestPath) }) + "\n");
      return;
    }
    const fingerprint = keccak256(toUtf8Bytes(JSON.stringify({ chainId: MONAD_CHAIN_ID,
      operator: wallet.address.toLowerCase(), usdc: USDC_ADDRESS.toLowerCase(), markets,
      clearinghouseBytecode: keccak256(clearinghouseArtifact.bytecode), factoryBytecode: keccak256(factoryArtifact.bytecode) })));
    const journal = await loadJournal(journalPath, wallet.address, fingerprint);
    const startNonce = journal?.startNonce ?? await provider.getTransactionCount(wallet.address, "pending");
    const clearAddress = getCreateAddress({ from: wallet.address, nonce: startNonce });
    const factoryAddress = getCreateAddress({ from: wallet.address, nonce: startNonce + 1 });
    const clearData = await new ContractFactory(clearinghouseArtifact.abi, clearinghouseArtifact.bytecode)
      .getDeployTransaction(wallet.address, USDC_ADDRESS, markets.map((m) => m.token), markets.map((m) => m.pool));
    const factoryData = await new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode)
      .getDeployTransaction(wallet.address, wallet.address, USDC_ADDRESS, clearAddress,
        markets.map((m) => m.token), markets.map((m) => m.pool));
    const factoryEstimateData = await new ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode)
      .getDeployTransaction(wallet.address, wallet.address, USDC_ADDRESS, source.addresses.factory,
        markets.map((m) => m.token), markets.map((m) => m.pool));
    const setFactoryData = new Interface(clearinghouseArtifact.abi).encodeFunctionData("setFactory", [factoryAddress]);
    const feeData = await provider.getFeeData();
    if (feeData.maxFeePerGas === null || feeData.maxPriorityFeePerGas === null
        || feeData.maxFeePerGas < feeData.maxPriorityFeePerGas) throw new Error("Monad Testnet EIP-1559 fee quote is unavailable.");
    const clearEstimate = await provider.estimateGas({ from: wallet.address, data: clearData.data, value: 0n });
    const clearGasLimit = (clearEstimate * 115n + 99n) / 100n;
    if (clearEstimate <= 0n || clearGasLimit > CLEARINGHOUSE_MAX_GAS) throw new Error("Perp clearinghouse deploy gas exceeds reviewed cap.");
    const factoryEstimate = await provider.estimateGas({ from: wallet.address, data: factoryEstimateData.data, value: 0n });
    const factoryGasLimit = (factoryEstimate * 115n + 99n) / 100n;
    if (factoryEstimate <= 0n || factoryGasLimit > FACTORY_MAX_GAS) throw new Error("Perp factory deploy gas exceeds reviewed cap.");
    const maxCost = BigInt(process.env.MONAD_TESTNET_PERP_DEPLOY_MAX_COST_WEI ?? DEFAULT_MAX_COST_WEI.toString());
    if (maxCost <= 0n) throw new Error("MONAD_TESTNET_PERP_DEPLOY_MAX_COST_WEI must be positive.");
    const projectedMaxCost = (clearGasLimit + factoryGasLimit + SET_FACTORY_MAX_GAS) * feeData.maxFeePerGas;
    const nativeBalance = await provider.getBalance(wallet.address);
    const withinCostCap = projectedMaxCost <= maxCost;
    const enoughNativeBalance = nativeBalance >= projectedMaxCost;
    if (deploy && !withinCostCap) throw new Error("Conservative deployment fee projection exceeds MONAD_TESTNET_PERP_DEPLOY_MAX_COST_WEI.");
    if (deploy && !enoughNativeBalance) throw new Error("Operator native balance is below the conservative maximum deployment fee projection.");
    const sourceRevision = process.env.MONAD_SOURCE_REVISION?.trim() ?? "";
    if (deploy && sourceRevision.length < 7) throw new Error("--deploy requires MONAD_SOURCE_REVISION (at least 7 characters).");
    const deployPlan = { chainId: MONAD_CHAIN_ID, operator: wallet.address, executor: wallet.address,
      administrator: wallet.address, usdc: USDC_ADDRESS, markets, predicted: { clearinghouse: clearAddress, factory: factoryAddress },
      initialNonce: startNonce, finalizedSourceBlock: checkpoint, clearinghouseGasEstimate: clearEstimate.toString(),
      factoryGasEstimate: factoryEstimate.toString(),
      conservativeMaxGasCostWei: projectedMaxCost.toString(), gasCostCapWei: maxCost.toString(),
      withinCostCap, enoughNativeBalance, operatorNativeBalanceWei: nativeBalance.toString(),
      sourceRevision: sourceRevision || "required for --deploy",
      sourceManifestHash: sourceHash, enrollmentEnabledAfterDeployment: false,
      reserveDepositDuringDeployment: "0 USDC", artifacts: {
        clearinghouseInitCodeHash: keccak256(clearinghouseArtifact.bytecode),
        factoryInitCodeHash: keccak256(factoryArtifact.bytecode),
      }, resumeJournal: Boolean(journal) };
    if (!deploy) { process.stdout.write(JSON.stringify({ mode: "dry-run", deployPlan }) + "\n"); return; }

    releaseLock = await acquireLock(lockPath);
    try { await access(manifestPath); throw new Error("Perp manifest appeared after preflight; refusing to overwrite it."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const latestNonce = await provider.getTransactionCount(wallet.address, "latest");
    const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
    if (!journal && (latestNonce !== pendingNonce || latestNonce !== startNonce)) {
      throw new Error("Operator has a pending transaction or nonce changed after preflight; retry dry-run before deployment.");
    }
    const state: DeploymentJournal = journal ?? { schemaVersion: 1, chainId: 10143, operator: wallet.address,
      fingerprint, startNonce, createdAt: new Date().toISOString(), transactions: [] };
    await saveJournal(journalPath, state);
    const send = (label: string, data: string, expectedAddress: string | undefined, maxGas: bigint, to?: string) =>
      sendJournaledTransaction({ provider, wallet, journal: state, journalPath, label, data, to,
        expectedAddress, maxGas, maxCostWei: maxCost });
    const clearReceipt = await send("deploy_perp_clearinghouse", clearData.data!, clearAddress, CLEARINGHOUSE_MAX_GAS);
    const factoryReceipt = await send("deploy_perp_factory", factoryData.data!, factoryAddress, FACTORY_MAX_GAS);
    const factoryLinkReceipt = await send("set_perp_factory", setFactoryData, undefined, SET_FACTORY_MAX_GAS, clearAddress);
    const finalBlock = await finalizedBlockNumber(provider);
    const manifest = await buildManifest(provider, state, wallet.address, markets, clearAddress, factoryAddress,
      source, sourceHash, sourceRevision, finalBlock);
    await verifyOnchain(provider, manifest, markets, wallet.address, finalBlock, true, true);
    await writeJsonExclusive(manifestPath, manifest);
    await saveJournal(journalPath, state);
    process.stdout.write(JSON.stringify({ mode: "deployed", chainId: MONAD_CHAIN_ID,
      factory: factoryAddress, clearinghouse: clearAddress, enrollmentEnabled: false,
      receipts: [clearReceipt, factoryReceipt, factoryLinkReceipt], finalizedBlock: finalBlock,
      manifest: path.relative(backendRoot, manifestPath), journal: path.relative(backendRoot, journalPath) }) + "\n");
  } finally {
    if (releaseLock) await releaseLock();
    await provider.destroy();
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
