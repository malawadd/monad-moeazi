import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync,
  writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeDeployData, getAddress,
  http, keccak256, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { ARBITRUM_USDC, ARBITRUM_WETH, ARBITRUM_V3_SWAP_ROUTER,
} from "../execution-sidecar/src/mobile/uniswapV3";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractRoot = join(root, "contracts", "managed-spot-vault");
const artifactPath = join(contractRoot, "out", "ManagedSpotVaultFactory.sol",
  "ManagedSpotVaultFactory.json");
const defaultKeyFile = process.platform === "win32" && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "Moeazi", "secrets", "managed-vault-executor.key")
  : join(homedir(), ".moeazi", "secrets", "managed-vault-executor.key");
const factoryReads = ["deployer", "usdc", "weth", "router"] as const;

function option(name: string) {
  return process.argv.slice(3).find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function keyFile() { return resolve(option("key-file") ?? defaultKeyFile); }

function executor() {
  const key = readFileSync(keyFile(), "utf8").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Executor key file is invalid.");
  return privateKeyToAccount(key as Hex);
}

function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item, 2)}\n`);
}

function artifact() {
  execFileSync("forge", ["build"], { cwd: contractRoot, stdio: "ignore" });
  const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    abi: Abi; bytecode: { object: Hex };
  };
  if (!Array.isArray(parsed.abi) || !/^0x[a-fA-F0-9]+$/.test(parsed.bytecode?.object)) {
    throw new Error("Compiled factory artifact is missing or malformed.");
  }
  return parsed;
}

async function publicClient() {
  const client = createPublicClient({ chain: arbitrum,
    transport: http(option("rpc-url") ?? process.env.ARBITRUM_RPC_URL
      ?? "https://arb1.arbitrum.io/rpc", { timeout: 15_000 }) });
  if (await client.getChainId() !== 42161) throw new Error("RPC is not Arbitrum One.");
  return client;
}

async function verify(address: Address, expectedExecutor?: Address) {
  const client = await publicClient();
  const compiled = artifact();
  const finalized = await client.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || !finalized.hash) throw new Error("No finalized block.");
  const code = await client.getCode({ address, blockNumber: finalized.number });
  if (!code || code === "0x") throw new Error("Factory code is not finalized.");
  const values = await Promise.all(factoryReads.map((functionName) =>
    client.readContract({ address, abi: compiled.abi, functionName,
      blockNumber: finalized.number })));
  const [deployer, usdc, weth, router] = values.map((item) =>
    getAddress(String(item) as Address));
  if (expectedExecutor && deployer !== getAddress(expectedExecutor)) {
    throw new Error("Factory deployer differs from the restricted executor.");
  }
  if (usdc !== getAddress(ARBITRUM_USDC) || weth !== getAddress(ARBITRUM_WETH)
    || router !== getAddress(ARBITRUM_V3_SWAP_ROUTER)) {
    throw new Error("Factory route differs from canonical Arbitrum assets and router.");
  }
  return { factoryAddress: address, factoryCodeHash: keccak256(code),
    executorAddress: deployer, usdc, weth, router,
    finalizedBlockNumber: finalized.number, finalizedBlockHash: finalized.hash };
}

async function prepare(deploy = false) {
  const account = executor();
  const client = await publicClient();
  const compiled = artifact();
  const args = [account.address, ARBITRUM_USDC, ARBITRUM_WETH,
    ARBITRUM_V3_SWAP_ROUTER] as const;
  const data = encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode.object,
    args: [...args] });
  const [gas, fees, balance] = await Promise.all([
    client.estimateGas({ account: account.address, data }),
    client.estimateFeesPerGas(), client.getBalance({ address: account.address }),
  ]);
  const maxFeePerGas = fees.maxFeePerGas;
  if (!maxFeePerGas) throw new Error("Arbitrum max fee quote is unavailable.");
  const maxCostWei = gas * maxFeePerGas;
  const review = { chainId: 42161, executorAddress: account.address,
    constructor: { deployer: account.address, usdc: ARBITRUM_USDC,
      weth: ARBITRUM_WETH, router: ARBITRUM_V3_SWAP_ROUTER },
    creationCodeHash: keccak256(data), estimatedGas: gas,
    maxFeePerGasWei: maxFeePerGas, estimatedMaxCostWei: maxCostWei,
    executorBalanceWei: balance, canCoverEstimate: balance >= maxCostWei };
  output({ mode: deploy ? "broadcast_review" : "dry_run", ...review });
  if (!deploy) return;
  const limit = option("max-cost-wei");
  if (!limit || !/^[1-9][0-9]*$/.test(limit) || maxCostWei > BigInt(limit)) {
    throw new Error("Explicit --max-cost-wei must cover the current estimate.");
  }
  if (balance < maxCostWei) throw new Error("Executor has insufficient ETH for deployment.");
  const wallet = createWalletClient({ account, chain: arbitrum,
    transport: http(option("rpc-url") ?? process.env.ARBITRUM_RPC_URL
      ?? "https://arb1.arbitrum.io/rpc") });
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode.object,
    args: [...args], gas, maxFeePerGas });
  output({ status: "submitted", transactionHash: hash,
    retryBroadcast: false });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Factory transaction failed or has no address: ${hash}`);
  }
  output({ status: "awaiting_finality", transactionHash: hash,
    factoryAddress: receipt.contractAddress,
    verifyCommand: `node --import tsx scripts/managed-vault-factory.ts verify --factory-address=${receipt.contractAddress}` });
}

async function main() {
  const command = process.argv[2];
  if (command === "init") {
    if (option("key-file")) throw new Error("init uses the private user-profile secret path only.");
    const path = keyFile();
    if (existsSync(path)) throw new Error("Executor key already exists; it was not replaced.");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const key = generatePrivateKey();
    writeFileSync(path, key, { flag: "wx", mode: 0o600 });
    try {
      if (process.platform === "win32") {
        const identity = execFileSync("whoami", { encoding: "utf8" }).trim();
        execFileSync("icacls", [path, "/inheritance:r", "/grant:r",
          `${identity}:(F)`, "NT AUTHORITY\\SYSTEM:(F)",
          "BUILTIN\\Administrators:(F)"], { stdio: "ignore" });
      } else chmodSync(path, 0o600);
    } catch (error) {
      unlinkSync(path);
      throw error;
    }
    output({ status: "created", executorAddress: privateKeyToAccount(key).address,
      keyFile: path, funded: false });
  } else if (command === "prepare") await prepare();
  else if (command === "deploy") await prepare(true);
  else if (command === "verify") {
    const raw = option("factory-address");
    if (!raw) throw new Error("--factory-address is required.");
    output(await verify(getAddress(raw), option("executor-address")
      ? getAddress(option("executor-address")!) : undefined));
  } else {
    output({ usage: "node --import tsx scripts/managed-vault-factory.ts init|prepare|deploy|verify",
      deploymentRequires: "deploy --max-cost-wei=<approved bound>" });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error
  ? error.message : "Factory preparation failed."}\n`); process.exitCode = 1; });
