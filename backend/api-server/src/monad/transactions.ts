import { Contract, Interface, Transaction, getAddress, getBytes, parseUnits } from "ethers";
import type { JsonRpcProvider, TransactionRequest } from "ethers";
import { ADAPTER_ABI, AUSD_ADDRESS, AUSD_DECIMALS, AUSD_FAUCET_ABI, AUSD_FAUCET_ADDRESS,
  ASSETS, ERC20_ABI, MONAD_CHAIN_ID, USDC_ADDRESS,
  VAULT_ABI, WMON_ABI, WMON_ADDRESS } from "./constants.js";
import { configuredAdapter, configuredVault, MonadApiError, type MonadVenue, venueData } from "./config.js";
import { requireContractCode } from "./provider.js";

export type Eip1559Transaction = {
  to: string; data: string; value: string; chainId: number; nonce: number;
  gasLimit: string; maxFeePerGas: string; maxPriorityFeePerGas: string; type: "eip1559";
};
export type BuiltTransaction = { transaction: Eip1559Transaction; gas: {
  gasLimit: string; maxFeePerGas: string; maxPriorityFeePerGas: string; maxCostWei: string;
} };

export function ausdFaucetCall(ownerAddress: string) {
  const recipient = getAddress(ownerAddress);
  return { to: AUSD_FAUCET_ADDRESS,
    data: new Interface(AUSD_FAUCET_ABI).encodeFunctionData("requestFunds", [recipient]),
    intent: { kind: "claim_ausd_faucet", asset: "AUSD", recipient, tokenAddress: AUSD_ADDRESS,
      faucetAddress: AUSD_FAUCET_ADDRESS, method: "requestFunds(address)" } };
}

export function amountUnits(value: unknown, decimals: number): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new MonadApiError("Amount must be a plain decimal string.");
  }
  try {
    const amount = parseUnits(value, decimals);
    if (amount <= 0n) throw new Error("zero");
    return amount;
  } catch { throw new MonadApiError("Amount is zero or exceeds the asset precision."); }
}

export async function buildEip1559Transaction(provider: JsonRpcProvider, sender: string,
  to: string, data: string, value = 0n, maxGasLimit = 3_000_000n): Promise<BuiltTransaction> {
  const [network, nonce, fees] = await Promise.all([
    provider.getNetwork(), provider.getTransactionCount(getAddress(sender), "pending"), provider.getFeeData(),
  ]);
  if (network.chainId !== BigInt(MONAD_CHAIN_ID)) throw new MonadApiError("Transaction builder is not connected to Monad Testnet.", 503, "wrong_chain");
  if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null
      || fees.maxFeePerGas < fees.maxPriorityFeePerGas) {
    throw new MonadApiError("Monad Testnet did not provide a usable EIP-1559 fee quote.", 503, "fee_unavailable");
  }
  const base: TransactionRequest = { from: getAddress(sender), to: getAddress(to), data,
    value, type: 2, chainId: MONAD_CHAIN_ID, nonce,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, accessList: [] };
  let estimate: bigint;
  try { estimate = await provider.estimateGas(base); }
  catch { throw new MonadApiError("Monad Testnet could not estimate this exact transaction.", 409, "gas_estimate_failed"); }
  const gasLimit = (estimate * 115n + 99n) / 100n;
  if (estimate <= 0n || gasLimit > maxGasLimit) {
    throw new MonadApiError("Estimated gas is outside the reviewed Monad Testnet limit.", 409, "gas_limit_rejected");
  }
  return {
    transaction: { to: getAddress(to), data, value: value.toString(), chainId: MONAD_CHAIN_ID,
      nonce, gasLimit: gasLimit.toString(), maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(), type: "eip1559" },
    gas: { gasLimit: gasLimit.toString(), maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      maxCostWei: (gasLimit * fees.maxFeePerGas).toString() },
  };
}

export async function buildWalletTransaction(provider: JsonRpcProvider, owner: string, body: any) {
  const kind = body.kind;
  let to: string; let data = "0x"; let value = 0n; let intent: Record<string, unknown>;
  if (kind === "send_mon") {
    to = getAddress(body.recipient); value = amountUnits(body.amount, 18);
    intent = { kind, asset: "MON", amount: body.amount, amountUnits: value.toString(), recipient: to };
  } else if (kind === "send_usdc") {
    to = USDC_ADDRESS;
    const units = amountUnits(body.amount, 6);
    data = new Interface(ERC20_ABI).encodeFunctionData("transfer", [getAddress(body.recipient), units]);
    intent = { kind, asset: "USDC", amount: body.amount, amountUnits: units.toString(), recipient: getAddress(body.recipient) };
  } else if (kind === "claim_ausd_faucet") {
    await Promise.all([
      requireContractCode(provider, AUSD_FAUCET_ADDRESS, "Agora AUSD faucet"),
      requireContractCode(provider, AUSD_ADDRESS, "Agora AUSD"),
    ]);
    const token = new Contract(AUSD_ADDRESS, ERC20_ABI, provider);
    if (Number(await token.decimals()) !== AUSD_DECIMALS) {
      throw new MonadApiError("Agora AUSD decimals differ from the reviewed Monad Testnet configuration.", 503, "asset_config_mismatch");
    }
    const faucet = ausdFaucetCall(owner);
    to = faucet.to; data = faucet.data; intent = faucet.intent;
  } else if (kind === "approve_token") {
    const token = getAddress(body.tokenAddress); const spender = getAddress(body.spender);
    const allowedSpenders = [configuredVault(), configuredAdapter("uniswap_v4_testnet"), configuredAdapter("moeazi_test_amm")].filter(Boolean);
    if (!allowedSpenders.some((address) => address!.toLowerCase() === spender.toLowerCase())) {
      throw new MonadApiError("Approval spender is not a configured Monad Testnet contract.", 403, "spender_rejected");
    }
    if (![USDC_ADDRESS, WMON_ADDRESS].some((asset) => asset.toLowerCase() === token.toLowerCase())) {
      throw new MonadApiError("Only Circle USDC and WMON approvals are supported.", 400, "asset_unsupported");
    }
    const decimals = token.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
    const units = typeof body.amountUnits === "string" && /^\d+$/.test(body.amountUnits)
      ? BigInt(body.amountUnits) : amountUnits(body.amount, decimals);
    if (units <= 0n) throw new MonadApiError("Approval amount must be positive.");
    to = token; data = new Interface(ERC20_ABI).encodeFunctionData("approve", [spender, units]);
    intent = { kind, tokenAddress: token, spender, amountUnits: units.toString() };
  } else if (kind === "wrap" || kind === "unwrap") {
    to = WMON_ADDRESS;
    const units = amountUnits(body.amount, 18);
    const iface = new Interface(WMON_ABI);
    if (kind === "wrap") { data = iface.encodeFunctionData("deposit"); value = units; }
    else data = iface.encodeFunctionData("withdraw", [units]);
    intent = { kind, asset: "WMON", amount: body.amount, amountUnits: units.toString() };
  } else if (kind === "vault_deposit" || kind === "vault_withdraw") {
    const vault = configuredVault();
    if (!vault) throw new MonadApiError("Monad Testnet vault address is not configured.", 503, "vault_unavailable");
    await requireContractCode(provider, vault, "Monad vault");
    const contract = new Contract(vault, VAULT_ABI, provider);
    const [vaultOwner, usdc, wmon] = await Promise.all([contract.owner(), contract.usdc(), contract.wmon()]);
    if (String(vaultOwner).toLowerCase() !== owner.toLowerCase()) throw new MonadApiError("Configured Monad vault has a different owner.", 403, "vault_owner_mismatch");
    if (String(usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase() || String(wmon).toLowerCase() !== WMON_ADDRESS.toLowerCase()) {
      throw new MonadApiError("Configured vault assets differ from the reviewed Monad Testnet assets.", 503, "vault_asset_mismatch");
    }
    const asset = body.asset === "USDC" ? USDC_ADDRESS : body.asset === "WMON" ? WMON_ADDRESS : null;
    if (!asset) throw new MonadApiError("Vault asset must be USDC or WMON.");
    const decimals = asset === USDC_ADDRESS ? 6 : 18;
    const units = amountUnits(body.amount, decimals);
    if (kind === "vault_deposit") {
      const token = new Contract(asset, ERC20_ABI, provider);
      const allowance = await token.allowance(owner, vault);
      if (allowance < units) throw new MonadApiError("Approve this exact amount before depositing into the vault.", 409,
        "approval_required", { kind: "approve_token", tokenAddress: asset, spender: vault, amountUnits: units.toString() });
    }
    to = vault; data = new Interface(VAULT_ABI).encodeFunctionData(kind === "vault_deposit" ? "deposit" : "withdraw", [asset, units]);
    intent = { kind, asset: body.asset, amount: body.amount, amountUnits: units.toString(), vaultAddress: vault };
  } else if (kind === "swap") {
    const venue = body.venue as MonadVenue;
    const adapter = configuredAdapter(venue);
    if (!adapter) throw new MonadApiError("The selected Monad Testnet venue is not configured.", 503, "venue_disabled");
    await requireContractCode(provider, adapter, "Monad swap adapter");
    const tokenIn = getAddress(body.tokenIn); const tokenOut = getAddress(body.tokenOut);
    const inputDecimals = tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
    const outputDecimals = tokenOut.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
    const input = typeof body.amountInUnits === "string" && /^\d+$/.test(body.amountInUnits)
      ? BigInt(body.amountInUnits) : amountUnits(body.amountIn, inputDecimals);
    const minOut = typeof body.minAmountOutUnits === "string" && /^\d+$/.test(body.minAmountOutUnits)
      ? BigInt(body.minAmountOutUnits) : 0n;
    if (input <= 0n || minOut <= 0n || tokenIn.toLowerCase() === tokenOut.toLowerCase()
        || ![USDC_ADDRESS, WMON_ADDRESS].every((asset) => [tokenIn, tokenOut].some((token) => token.toLowerCase() === asset.toLowerCase()))) {
      throw new MonadApiError("Swap pair or minimum output is invalid.");
    }
    const token = new Contract(tokenIn, ERC20_ABI, provider);
    if (await token.allowance(owner, adapter) < input) throw new MonadApiError("Approve the exact swap input before trading.", 409,
      "approval_required", { kind: "approve_token", tokenAddress: tokenIn, spender: adapter, amountUnits: input.toString() });
    to = adapter;
    data = new Interface(ADAPTER_ABI).encodeFunctionData("swap", [tokenIn, tokenOut, input, minOut, venueData(venue)]);
    intent = { kind, accountScope: "wallet", venue, tokenIn, tokenOut, amountInUnits: input.toString(),
      minAmountOutUnits: minOut.toString(), inputDecimals, outputDecimals };
  } else {
    throw new MonadApiError("Unsupported Monad wallet operation.", 400, "operation_unsupported");
  }
  const built = await buildEip1559Transaction(provider, owner, to, data, value);
  return { ...built, intent };
}

export function verifyExactSignedTransaction(raw: unknown, expected: Eip1559Transaction,
  expectedSender: string) {
  if (typeof raw !== "string" || !/^0x[0-9a-f]+$/i.test(raw) || raw.length > 300_000) {
    throw new MonadApiError("Signed transaction must be serialized EIP-1559 bytes.");
  }
  let parsed: Transaction;
  try { parsed = Transaction.from(raw); }
  catch { throw new MonadApiError("Signed transaction could not be decoded.", 400, "signed_transaction_invalid"); }
  if (!parsed.signature || !parsed.from || parsed.type !== 2 || parsed.chainId !== BigInt(MONAD_CHAIN_ID)
      || parsed.from.toLowerCase() !== expectedSender.toLowerCase()
      || parsed.to?.toLowerCase() !== expected.to.toLowerCase()
      || parsed.data.toLowerCase() !== expected.data.toLowerCase()
      || parsed.value !== BigInt(expected.value) || parsed.nonce !== expected.nonce
      || parsed.gasLimit !== BigInt(expected.gasLimit)
      || parsed.maxFeePerGas !== BigInt(expected.maxFeePerGas)
      || parsed.maxPriorityFeePerGas !== BigInt(expected.maxPriorityFeePerGas)
      || (parsed.accessList?.length ?? 0) !== 0) {
    throw new MonadApiError("Signed transaction differs from the prepared owner, chain, intent, nonce, gas, or fee fields.",
      409, "signed_transaction_mismatch");
  }
  const hash = parsed.hash;
  if (!hash) throw new MonadApiError("Signed transaction hash is unavailable.", 400, "signed_transaction_invalid");
  return { transactionHash: hash, recoveredSender: getAddress(parsed.from), canonicalRawTransaction: parsed.serialized };
}

export function quoteCost(gasLimit: bigint, maxFeePerGas: bigint) {
  if (gasLimit <= 0n || maxFeePerGas <= 0n || gasLimit > 3_000_000n) {
    throw new MonadApiError("Gas quote exceeds the reviewed Monad Testnet limit.", 409, "gas_limit_rejected");
  }
  return { gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(),
    maxCostWei: (gasLimit * maxFeePerGas).toString() };
}
