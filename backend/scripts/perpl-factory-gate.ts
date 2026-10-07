import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, getAddress, keccak256 } from "ethers";
import { openPerplStrategy } from "../api-server/src/monad/perplContracts.js";
import { finalizedBlockNumber, monadProvider } from "../api-server/src/monad/provider.js";
import { registerPerpVenues } from "../api-server/src/monad/registerPerpVenues.js";

const mode = process.argv[2];
if (!["status", "on", "off"].includes(mode)) {
  process.stderr.write("Usage: node --env-file=.env.local --import tsx scripts/perpl-factory-gate.ts status|on|off\n");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "contracts/monad-testnet/deployments/manifest.perpl.strategy.testnet.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.verified !== true || manifest.deploymentStatus !== "verified" || manifest.chainId !== 10143) {
  throw new Error("The Perpl strategy manifest is not a verified Monad Testnet deployment.");
}
if (mode === "on") {
  const required = ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
    "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_PERPL_AUTONOMY_ENABLED",
    "MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED"];
  if (required.some((key) => process.env[key]?.trim().toLowerCase() !== "true")) {
    throw new Error(`Opening Perpl enrollment requires all five local Testnet gates: ${required.join(", ")}.`);
  }
  if (process.env.LIVE_EXECUTION_ENABLED === "true" || process.env.MAINNET_VENUE_SETUP_ENABLED === "true") {
    throw new Error("Live execution and mainnet venue setup must remain off.");
  }
}

const provider = await monadProvider();
try {
  registerPerpVenues();
  const deployment = await openPerplStrategy(provider);
  if (getAddress(deployment.address) !== getAddress(manifest.addresses.factory)
      || getAddress(deployment.operator.address) !== getAddress(manifest.addresses.operator)) {
    throw new Error("Configured Perpl factory or operator differs from the verified manifest.");
  }
  const codeHash = keccak256(await provider.getCode(deployment.address));
  if (codeHash.toLowerCase() !== String(manifest.codeHashes.factory).toLowerCase()) {
    throw new Error("Perpl factory code hash differs from the verified manifest.");
  }
  const factory = new Contract(deployment.address,
    ["function administrator() view returns (address)", "function enrollmentEnabled() view returns (bool)",
      "function setEnrollmentEnabled(bool)"], provider);
  const finalized = await finalizedBlockNumber(provider);
  const [administrator, enabled] = await Promise.all([
    factory.administrator({ blockTag: finalized }), factory.enrollmentEnabled({ blockTag: finalized }),
  ]);
  if (getAddress(administrator) !== getAddress(manifest.addresses.administrator)
      || getAddress(administrator) !== getAddress(deployment.operator.address)) {
    throw new Error("The local operator key is not the verified factory administrator.");
  }
  const desired = mode === "on";
  if (mode === "status" || Boolean(enabled) === desired) {
    process.stdout.write(JSON.stringify({ chainId: 10143, factory: deployment.address,
      administrator, codeHash, enrollmentEnabled: Boolean(enabled), finalizedBlock: finalized,
      ...(mode === "status" ? {} : { alreadySet: true }) }) + "\n");
  } else {
    const tx = await factory.connect(deployment.operator.connect(provider)).setEnrollmentEnabled(desired);
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error("Perpl factory gate transaction failed.");
    const deadline = Date.now() + 90_000;
    while (await finalizedBlockNumber(provider) < receipt.blockNumber) {
      if (Date.now() >= deadline) throw new Error(`Gate transaction mined but not finalized: ${receipt.hash}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    const canonical = await provider.getBlock(receipt.blockNumber);
    if (canonical?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()
        || Boolean(await factory.enrollmentEnabled({ blockTag: receipt.blockNumber })) !== desired) {
      throw new Error(`Perpl factory gate receipt or state failed verification: ${receipt.hash}`);
    }
    process.stdout.write(JSON.stringify({ chainId: 10143, factory: deployment.address,
      enrollmentEnabled: desired, transactionHash: receipt.hash, finalizedBlock: receipt.blockNumber }) + "\n");
  }
} finally {
  await provider.destroy();
}
