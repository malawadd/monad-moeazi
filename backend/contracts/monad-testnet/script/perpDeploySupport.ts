import { open, readFile, rename, writeFile, mkdir, link, unlink } from "node:fs/promises";
import path from "node:path";
import { Contract, keccak256, getAddress, Transaction } from "ethers";
import type { JsonRpcProvider, Wallet } from "ethers";
import { finalizedBlockNumber } from "../../../api-server/src/monad/provider.js";

export type DeploymentReceipt = { label: string; txHash: string; blockNumber: number; status: 1 };
export type JournalTx = {
  label: string; nonce: number; rawTransaction: string; txHash: string;
  to?: string; expectedAddress?: string; maxCostWei: string; receipt?: DeploymentReceipt;
};
export type DeploymentJournal = {
  schemaVersion: 1; chainId: 10143; operator: string; fingerprint: string;
  startNonce: number; createdAt: string; transactions: JournalTx[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readArtifact(filePath: string) {
  const artifact = JSON.parse(await readFile(filePath, "utf8"));
  const bytecode = typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode?.object;
  if (!Array.isArray(artifact.abi) || typeof bytecode !== "string" || !/^0x[0-9a-f]+$/i.test(bytecode)) {
    throw new Error(`Forge artifact is incomplete: ${filePath}`);
  }
  return { abi: artifact.abi, bytecode };
}

export async function acquireLock(lockPath: string) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const handle = await open(lockPath, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`Perp deploy lock exists at ${lockPath}; inspect any pending transaction before removing it.`);
    throw error;
  });
  await handle.writeFile(`${process.pid}\n`);
  return async () => { await handle.close(); await unlink(lockPath).catch(() => {}); };
}

export async function loadJournal(journalPath: string, operator: string, fingerprint: string) {
  let raw: string;
  try { raw = await readFile(journalPath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const journal = JSON.parse(raw) as DeploymentJournal;
  if (journal.schemaVersion !== 1 || journal.chainId !== 10143
      || journal.operator.toLowerCase() !== operator.toLowerCase() || journal.fingerprint !== fingerprint
      || !Number.isSafeInteger(journal.startNonce) || !Array.isArray(journal.transactions)) {
    throw new Error("Existing deployment journal does not match the reviewed chain, operator, or pool configuration.");
  }
  for (const [index, item] of journal.transactions.entries()) {
    const tx = Transaction.from(item.rawTransaction);
    if (item.nonce !== journal.startNonce + index || tx.nonce !== item.nonce
        || tx.chainId !== 10143n || tx.from?.toLowerCase() !== operator.toLowerCase()
        || tx.hash?.toLowerCase() !== item.txHash.toLowerCase()
        || BigInt(item.maxCostWei) !== (tx.gasLimit ?? 0n) * (tx.maxFeePerGas ?? 0n)) {
      throw new Error("Existing Perp deployment journal has an invalid signed transaction; inspect it before continuing.");
    }
  }
  return journal;
}

export async function saveJournal(journalPath: string, journal: DeploymentJournal) {
  await mkdir(path.dirname(journalPath), { recursive: true });
  const temp = `${journalPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, journalPath);
}

export async function sendJournaledTransaction(args: {
  provider: JsonRpcProvider; wallet: Wallet; journal: DeploymentJournal; journalPath: string;
  label: string; data: string; to?: string; expectedAddress?: string; maxGas: bigint; maxCostWei: bigint;
}): Promise<DeploymentReceipt> {
  const { provider, wallet, journal, journalPath, label, data, expectedAddress } = args;
  let record = journal.transactions.find((item) => item.label === label);
  const sequence = ["deploy_perp_clearinghouse", "deploy_perp_factory", "set_perp_factory"];
  if (!record) {
    if (journal.transactions.length >= sequence.length || sequence[journal.transactions.length] !== label) {
      throw new Error(`Deployment journal is not ready for transaction ${label}.`);
    }
    const [latestNonce, pendingNonce, fees] = await Promise.all([
      provider.getTransactionCount(wallet.address, "latest"),
      provider.getTransactionCount(wallet.address, "pending"), provider.getFeeData(),
    ]);
    if (latestNonce !== pendingNonce || latestNonce !== journal.startNonce + journal.transactions.length) {
      throw new Error("Operator nonce changed outside this deployment; reconcile pending transactions before continuing.");
    }
    if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null
        || fees.maxFeePerGas < fees.maxPriorityFeePerGas) throw new Error("Monad Testnet EIP-1559 fee quote is unavailable.");
    const estimate = await provider.estimateGas({ from: wallet.address, data, value: 0n,
      ...(args.to ? { to: getAddress(args.to) } : {}) });
    const gasLimit = (estimate * 115n + 99n) / 100n;
    if (estimate <= 0n || gasLimit > args.maxGas) throw new Error(`${label} gas estimate exceeds its reviewed cap.`);
    const txMaxCost = gasLimit * fees.maxFeePerGas;
    const totalMaxCost = journal.transactions.reduce((sum, item) => sum + BigInt(item.maxCostWei), 0n) + txMaxCost;
    if (totalMaxCost > args.maxCostWei) throw new Error(`${label} would exceed the configured total deployment gas cap.`);
    const nonce = latestNonce;
    const rawTransaction = await wallet.signTransaction({ type: 2, chainId: 10143, nonce, data, to: args.to,
      value: 0n, gasLimit, maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas, accessList: [] });
    const txHash = keccak256(rawTransaction);
    record = { label, nonce, rawTransaction, txHash, to: args.to, expectedAddress, maxCostWei: txMaxCost.toString() };
    journal.transactions.push(record);
    await saveJournal(journalPath, journal);
  } else if (record.expectedAddress?.toLowerCase() !== expectedAddress?.toLowerCase()) {
    throw new Error(`Journaled address for ${label} differs from the current deployment plan.`);
  }
  const signed = Transaction.from(record.rawTransaction);
  const expectedTo = args.to ? getAddress(args.to).toLowerCase() : null;
  if (signed.hash?.toLowerCase() !== record.txHash.toLowerCase() || signed.from?.toLowerCase() !== wallet.address.toLowerCase()
      || signed.chainId !== 10143n || signed.nonce !== record.nonce || signed.data.toLowerCase() !== data.toLowerCase()
      || (signed.to?.toLowerCase() ?? null) !== expectedTo || signed.type !== 2 || signed.value !== 0n
      || (signed.gasLimit ?? 0n) > args.maxGas) {
    throw new Error(`Journaled signed bytes for ${label} differ from the current reviewed transaction plan.`);
  }

  let receipt = await provider.getTransactionReceipt(record.txHash);
  if (!receipt) {
    const known = await provider.getTransaction(record.txHash);
    if (!known) {
      const [latestNonce, pendingNonce] = await Promise.all([
        provider.getTransactionCount(wallet.address, "latest"), provider.getTransactionCount(wallet.address, "pending"),
      ]);
      if (latestNonce > record.nonce || pendingNonce > record.nonce) {
        throw new Error(`Nonce ${record.nonce} for ${label} may have been consumed by another transaction; journal retained for reconciliation.`);
      }
      try { await provider.broadcastTransaction(record.rawTransaction); }
      catch {
        if (!await provider.getTransaction(record.txHash)) throw new Error(`Broadcast outcome for ${label} is uncertain; journal retained at ${journalPath}.`);
      }
    }
    const deadline = Date.now() + 180_000;
    while (!receipt && Date.now() < deadline) { await sleep(2_000); receipt = await provider.getTransactionReceipt(record.txHash); }
  }
  if (!receipt) throw new Error(`${label} is still pending; resume from the existing journal after checking its hash ${record.txHash}.`);
  if (receipt.status !== 1) throw new Error(`${label} reverted in transaction ${record.txHash}; journal retained for review.`);
  if (expectedAddress && receipt.contractAddress?.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`${label} deployed to an address that differs from the nonce-derived address.`);
  }
  const finalizedDeadline = Date.now() + 180_000;
  while (await finalizedBlockNumber(provider) < receipt.blockNumber) {
    if (Date.now() >= finalizedDeadline) throw new Error(`${label} is mined but not finalized: ${record.txHash}`);
    await sleep(2_000);
  }
  const [canonical, checked] = await Promise.all([
    provider.getBlock(receipt.blockNumber), provider.getTransactionReceipt(record.txHash),
  ]);
  if (!canonical?.hash || canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
      || !checked || checked.status !== 1 || checked.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error(`${label} receipt is not canonical after finality: ${record.txHash}`);
  }
  const verified: DeploymentReceipt = { label, txHash: record.txHash, blockNumber: receipt.blockNumber, status: 1 };
  record.receipt = verified;
  await saveJournal(journalPath, journal);
  return verified;
}

export async function codeHashAt(provider: JsonRpcProvider, address: string, blockNumber: number) {
  const code = await provider.getCode(getAddress(address), blockNumber);
  if (code === "0x") throw new Error(`No contract code at ${address} in finalized block ${blockNumber}.`);
  return keccak256(code);
}

export async function writeJsonExclusive(filePath: string, value: unknown) {
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try { await link(temp, filePath); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
  await unlink(temp);
}

export function receiptFromJournal(journal: DeploymentJournal, label: string) {
  const receipt = journal.transactions.find((item) => item.label === label)?.receipt;
  if (!receipt) throw new Error(`Deployment journal has no finalized receipt for ${label}.`);
  return receipt;
}

export async function verifyReceipt(provider: JsonRpcProvider, item: DeploymentReceipt, checkpoint: number) {
  const receipt = await provider.getTransactionReceipt(item.txHash);
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  if (!receipt || receipt.status !== 1 || receipt.blockNumber !== item.blockNumber
      || receipt.blockNumber > checkpoint || !block?.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error(`Manifest receipt ${item.label} is not successful, canonical, and finalized.`);
  }
}
