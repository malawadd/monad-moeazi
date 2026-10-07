import { Contract, formatUnits, parseUnits } from "ethers";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "../api-server/src/monad/constants.js";
import { finalizedBlockNumber, monadProvider } from "../api-server/src/monad/provider.js";
import { readPerpDeployment } from "../api-server/src/monad/perpChain.js";
import { operatorWallet } from "../api-server/src/monad/vaultTrades.js";

const [group, operation, amountText] = process.argv.slice(2);
const usage = "Usage: node --env-file=.env.local --import tsx scripts/perp-factory-control.ts status | gate on|off | reserve status|deposit|withdraw <usdc>";
const valid = group === "status" || group === "gate" && ["on", "off"].includes(operation)
  || group === "reserve" && (operation === "status" || ["deposit", "withdraw"].includes(operation) && Boolean(amountText));
if (!valid) { process.stderr.write(`${usage}\n`); process.exit(2); }

const provider = await monadProvider();
try {
  const deployment = await readPerpDeployment(provider);
  const wallet = ["deposit", "withdraw", "on", "off"].includes(operation ?? "") ? await operatorWallet() : null;
  const administrator = String(await deployment.factory.administrator({ blockTag: deployment.checkpoint }));
  if (wallet && (wallet.address.toLowerCase() !== administrator.toLowerCase()
      || wallet.address.toLowerCase() !== deployment.executor.toLowerCase())) {
    throw new Error("The local operator wallet must be the verified perp administrator and executor.");
  }
  if (group === "status" || group === "reserve" && operation === "status") {
    await printStatus(provider, deployment, administrator);
  } else if (group === "gate") {
    const desired = operation === "on";
    if (desired) requirePerpEnableGates();
    if (deployment.enabled === desired) {
      process.stdout.write(JSON.stringify({ chainId: MONAD_CHAIN_ID, factory: deployment.factoryAddress,
        enrollmentEnabled: desired, alreadySet: true, finalizedBlock: deployment.checkpoint }) + "\n");
    } else {
      const factory = new Contract(deployment.factoryAddress,
        ["function setEnrollmentEnabled(bool)", "function enrollmentEnabled() view returns (bool)"], wallet!.connect(provider));
      const receipt = await finalize(await factory.setEnrollmentEnabled(desired));
      if (Boolean(await factory.enrollmentEnabled({ blockTag: receipt.blockNumber })) !== desired) {
        throw new Error(`Perp enrollment gate state did not verify at finalized receipt ${receipt.hash}.`);
      }
      process.stdout.write(JSON.stringify({ chainId: MONAD_CHAIN_ID, factory: deployment.factoryAddress,
        enrollmentEnabled: desired, transactionHash: receipt.hash, finalizedBlock: receipt.blockNumber }) + "\n");
    }
  } else {
    requireBroadcastGates();
    const amount = parseUsdc(amountText!);
    if (operation === "withdraw") {
      const clearinghouse = new Contract(deployment.clearinghouseAddress,
        ["function withdrawReserve(uint256)", "function operatorReserve() view returns (uint256)",
          "function reserveCommitted() view returns (uint256)"], wallet!.connect(provider));
      const [beforeValue, committedValue] = await Promise.all([clearinghouse.operatorReserve(), clearinghouse.reserveCommitted()]);
      const before = BigInt(beforeValue); const committed = BigInt(committedValue);
      if (amount > before - committed) throw new Error("Only uncommitted operator reserve can be withdrawn.");
      const receipt = await finalize(await clearinghouse.withdrawReserve(amount));
      const after = BigInt(await clearinghouse.operatorReserve({ blockTag: receipt.blockNumber }));
      if (after !== before - amount) throw new Error(`Reserve withdrawal failed receipt verification: ${receipt.hash}`);
      process.stdout.write(JSON.stringify({ chainId: MONAD_CHAIN_ID, clearinghouse: deployment.clearinghouseAddress,
        withdrawnUnits: amount.toString(), withdrawnUsdc: formatUnits(amount, 6), transactionHash: receipt.hash,
        reserveUnits: after.toString(), committedUnits: committed.toString(), finalizedBlock: receipt.blockNumber }) + "\n");
    } else {
    const usdc = new Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], wallet!.connect(provider));
    const balance = BigInt(await usdc.balanceOf(wallet!.address));
    if (amount > balance) throw new Error("Requested reserve deposit exceeds the operator Circle USDC balance.");
    const approvalHashes: string[] = [];
    const allowance = BigInt(await usdc.allowance(wallet!.address, deployment.clearinghouseAddress));
    if (allowance < amount) {
      if (allowance > 0n) {
        const resetReceipt = await finalize(await usdc.approve(deployment.clearinghouseAddress, 0n));
        approvalHashes.push(resetReceipt.hash);
      }
      const approveReceipt = await finalize(await usdc.approve(deployment.clearinghouseAddress, amount));
      approvalHashes.push(approveReceipt.hash);
    }
    const clearinghouse = new Contract(deployment.clearinghouseAddress,
      ["function depositReserve(uint256)", "function operatorReserve() view returns (uint256)",
        "function reserveCommitted() view returns (uint256)"], wallet!.connect(provider));
    const before = BigInt(await clearinghouse.operatorReserve());
    const receipt = await finalize(await clearinghouse.depositReserve(amount));
    const after = BigInt(await clearinghouse.operatorReserve({ blockTag: receipt.blockNumber }));
    if (after !== before + amount) throw new Error(`Reserve balance failed receipt verification: ${receipt.hash}`);
    process.stdout.write(JSON.stringify({ chainId: MONAD_CHAIN_ID, clearinghouse: deployment.clearinghouseAddress,
      depositedUnits: amount.toString(), depositedUsdc: formatUnits(amount, 6), approvalHashes,
      transactionHash: receipt.hash, reserveUnits: after.toString(), finalizedBlock: receipt.blockNumber }) + "\n");
    }
  }
} finally { await provider.destroy(); }

async function printStatus(provider: any, deployment: any, administrator: string) {
  const usdc = new Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
  const [reserveValue, committedValue, walletBalance] = await Promise.all([
    deployment.clearinghouse.operatorReserve({ blockTag: deployment.checkpoint }),
    deployment.clearinghouse.reserveCommitted({ blockTag: deployment.checkpoint }),
    usdc.balanceOf(deployment.executor, { blockTag: deployment.checkpoint }),
  ]);
  const reserve = BigInt(reserveValue); const committed = BigInt(committedValue);
  process.stdout.write(JSON.stringify({ chainId: MONAD_CHAIN_ID, factory: deployment.factoryAddress,
    clearinghouse: deployment.clearinghouseAddress, administrator, executor: deployment.executor,
    enrollmentEnabled: deployment.enabled, operatorReserveUnits: reserve.toString(),
    committedUnits: committed.toString(), availableUnits: (reserve > committed ? reserve - committed : 0n).toString(),
    operatorUsdcBalanceUnits: String(walletBalance), finalizedBlock: deployment.checkpoint,
    localGates: { actions: process.env.MONAD_TESTNET_ACTIONS_ENABLED === "true",
      broadcast: process.env.MONAD_TESTNET_BROADCAST_ENABLED === "true",
      operatorTrades: process.env.MONAD_TESTNET_OPERATOR_TRADES_ENABLED === "true",
      perpAutonomy: process.env.MONAD_TESTNET_PERP_AUTONOMY_ENABLED === "true" } }) + "\n");
}

function requireBroadcastGates() {
  if (["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED", "MONAD_TESTNET_OPERATOR_TRADES_ENABLED"]
    .some((key) => process.env[key] !== "true")) throw new Error("Action, broadcast, and operator trade gates must be true before a reserve transaction.");
  requireTestOnlyMode();
}

function requirePerpEnableGates() {
  requireBroadcastGates();
  if (process.env.MONAD_TESTNET_PERP_AUTONOMY_ENABLED !== "true") {
    throw new Error("Set MONAD_TESTNET_PERP_AUTONOMY_ENABLED=true before opening perp enrollment.");
  }
}

function requireTestOnlyMode() {
  if (process.env.LIVE_EXECUTION_ENABLED === "true" || process.env.MAINNET_VENUE_SETUP_ENABLED === "true") {
    throw new Error("Live execution and mainnet venue setup must remain disabled.");
  }
}

function parseUsdc(value: string) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/.test(value)) throw new Error("Reserve deposit must be a decimal USDC amount with at most 6 places.");
  const amount = parseUnits(value, 6);
  if (amount <= 0n || amount > parseUnits("10", 6)) throw new Error("Reserve deposit must be greater than zero and at most 10 USDC.");
  return amount;
}

async function finalize(transaction: Promise<any>) {
  const sent = await transaction;
  const receipt = await sent.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Operator transaction did not succeed: ${sent.hash}`);
  const deadline = Date.now() + 120_000;
  while (await finalizedBlockNumber(provider) < receipt.blockNumber) {
    if (Date.now() >= deadline) throw new Error(`Operator transaction is mined but not finalized: ${receipt.hash}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const canonical = await provider.getBlock(receipt.blockNumber);
  if (canonical?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error(`Operator transaction receipt failed canonical verification: ${receipt.hash}`);
  }
  return receipt;
}
