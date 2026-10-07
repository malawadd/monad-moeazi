import { Contract } from "ethers";
import { readAutonomyDeployment } from "../api-server/src/monad/autonomyChain.js";
import { finalizedBlockNumber, monadProvider } from "../api-server/src/monad/provider.js";
import { operatorWallet } from "../api-server/src/monad/vaultTrades.js";

const mode = process.argv[2];
if (!["status", "on", "off"].includes(mode)) {
  process.stderr.write("Usage: node --env-file=.env.local --import tsx scripts/autonomy-factory-gate.ts status|on|off\n");
  process.exit(2);
}

const provider = await monadProvider();
try {
  const deployment = await readAutonomyDeployment(provider);
  const administrator = String(await deployment.factory.administrator({ blockTag: deployment.checkpoint }));
  if (mode === "status") {
    process.stdout.write(JSON.stringify({ chainId: 10143, factory: deployment.factoryAddress,
      administrator, enrollmentEnabled: deployment.enabled, finalizedBlock: deployment.checkpoint }) + "\n");
  } else {
    if (mode === "on" && ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
      "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_AUTONOMY_ENABLED"]
      .some((key) => process.env[key] !== "true")) {
      throw new Error("All four local testnet gates must be true before opening factory enrollment.");
    }
    if (mode === "on" && (process.env.LIVE_EXECUTION_ENABLED === "true"
        || process.env.MAINNET_VENUE_SETUP_ENABLED === "true")) {
      throw new Error("Live execution and mainnet venue setup must remain off for the testnet walkthrough.");
    }
    const wallet = await operatorWallet();
    if (wallet.address.toLowerCase() !== administrator.toLowerCase()
        || wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) {
      throw new Error("The local operator key is not this verified factory's administrator and executor.");
    }
    const desired = mode === "on";
    if (deployment.enabled === desired) {
      process.stdout.write(JSON.stringify({ chainId: 10143, factory: deployment.factoryAddress,
        enrollmentEnabled: desired, alreadySet: true, finalizedBlock: deployment.checkpoint }) + "\n");
    } else {
      const factory = new Contract(deployment.factoryAddress,
        ["function setEnrollmentEnabled(bool)", "function enrollmentEnabled() view returns (bool)"], wallet.connect(provider));
      const tx = await factory.setEnrollmentEnabled(desired);
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error("Factory gate transaction did not succeed.");
      const deadline = Date.now() + 90_000;
      while (await finalizedBlockNumber(provider) < receipt.blockNumber) {
        if (Date.now() >= deadline) throw new Error(`Factory gate transaction is mined but not finalized: ${receipt.hash}`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      const canonical = await provider.getBlock(receipt.blockNumber);
      if (canonical?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()
          || Boolean(await factory.enrollmentEnabled({ blockTag: receipt.blockNumber })) !== desired) {
        throw new Error(`Factory gate receipt or state failed canonical verification: ${receipt.hash}`);
      }
      process.stdout.write(JSON.stringify({ chainId: 10143, factory: deployment.factoryAddress,
        enrollmentEnabled: desired, transactionHash: receipt.hash, finalizedBlock: receipt.blockNumber }) + "\n");
    }
  }
} finally {
  await provider.destroy();
}
