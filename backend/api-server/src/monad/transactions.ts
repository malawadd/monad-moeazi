import { Contract, Interface, Transaction, getAddress, getBytes, parseUnits } from "ethers";
import type { JsonRpcProvider, TransactionRequest } from "ethers";
import { ADAPTER_ABI, AUSD_ADDRESS, AUSD_DECIMALS, AUSD_FAUCET_ABI, AUSD_FAUCET_ADDRESS,
  ASSETS, ERC20_ABI, MONAD_CHAIN_ID, USDC_ADDRESS,
  VAULT_ABI, WMON_ABI, WMON_ADDRESS } from "./constants.js";
import { configuredAdapter, configuredDynamicV4Adapter, configuredVault, MonadApiError, type MonadVenue, venueData } from "./config.js";
import { requireContractCode } from "./provider.js";
import { AUTONOMY_POOL_ABI } from "./autonomyChain.js";
import { MOCK_SPOT_VENUE, quoteMockPool, resolveMockPool, resolveMockPoolApproval } from "./mockSpot.js";
import { findV4Pool, poolKeysEqual, v4MarketId, v4PoolKey } from "./v4PoolIndex.js";
import { buildV4SwapCall, quoteV4Pool } from "./v4PoolSwap.js";

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
  to: string, data: string, value = 0n, maxGasLimit = 3_000_000n,
  gasPolicy?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }): Promise<BuiltTransaction> {
  const [network, nonce, fees] = await Promise.all([
    provider.getNetwork(), provider.getTransactionCount(getAddress(sender), "pending"), provider.getFeeData(),
  ]);
  if (network.chainId !== BigInt(MONAD_CHAIN_ID)) throw new MonadApiError("Transaction builder is not connected to Monad Testnet.", 503, "wrong_chain");
  const maxFeePerGas = gasPolicy?.maxFeePerGas ?? fees.maxFeePerGas;
  const maxPriorityFeePerGas = gasPolicy?.maxPriorityFeePerGas ?? fees.maxPriorityFeePerGas;
  if (maxFeePerGas === null || maxPriorityFeePerGas === null || maxFeePerGas < maxPriorityFeePerGas) {
    throw new MonadApiError("Monad Testnet did not provide a usable EIP-1559 fee quote.", 503, "fee_unavailable");
  }
  const base: TransactionRequest = { from: getAddress(sender), to: getAddress(to), data,
    value, type: 2, chainId: MONAD_CHAIN_ID, nonce,
    maxFeePerGas, maxPriorityFeePerGas, accessList: [] };
  let estimate: bigint;
  try { estimate = await provider.estimateGas(base); }
  catch { throw new MonadApiError("Monad Testnet could not estimate this exact transaction.", 409, "gas_estimate_failed"); }
  const gasLimit = (estimate * 115n + 99n) / 100n;
  if (estimate <= 0n || gasLimit > maxGasLimit) {
    throw new MonadApiError("Estimated gas is outside the reviewed Monad Testnet limit.", 409, "gas_limit_rejected");
  }
  return {
    transaction: { to: getAddress(to), data, value: value.toString(), chainId: MONAD_CHAIN_ID,
      nonce, gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(), type: "eip1559" },
    gas: { gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(), maxCostWei: (gasLimit * maxFeePerGas).toString() },
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
    const allowedSpenders = [configuredVault(), configuredAdapter("uniswap_v4_testnet"), configuredAdapter("moeazi_test_amm"),
      configuredDynamicV4Adapter()].filter(Boolean);
    const configured = allowedSpenders.some((address) => address!.toLowerCase() === spender.toLowerCase());
    let mockDecimals: number | undefined;
    if (!configured) mockDecimals = (await resolveMockPoolApproval(provider, token, spender)).tokenDecimals;
    if (!configured && mockDecimals === undefined) throw new MonadApiError("Approval spender is not a configured Monad Testnet contract.", 403, "spender_rejected");
    const standardAsset = [USDC_ADDRESS, WMON_ADDRESS].some((asset) => asset.toLowerCase() === token.toLowerCase());
    if (!standardAsset && mockDecimals === undefined) throw new MonadApiError("Only verified Monad Testnet assets are supported.", 400, "asset_unsupported");
    const decimals = mockDecimals ?? (token.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18);
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
    const tokenIn = getAddress(body.tokenIn); const tokenOut = getAddress(body.tokenOut);
    if (body.poolId !== undefined) {
      if (body.venue !== "uniswap_v4_testnet" || body.accountScope !== "wallet") {
        throw new MonadApiError("PoolId-bound v4 swaps are Mera-wallet only.", 403, "operator_only");
      }
      const record = await findV4Pool(body.poolId);
      if (!record) throw new MonadApiError("PoolId was not found in the Monad v4 pool index.", 404, "v4_pool_not_found");
      const key = v4PoolKey(record);
      if (body.poolKey && !poolKeysEqual(body.poolKey, key)) {
        throw new MonadApiError("PoolKey differs from the indexed PoolId record.", 409, "v4_pool_key_mismatch");
      }
      const adapter = configuredDynamicV4Adapter();
      if (!adapter) throw new MonadApiError("The generic no-hook v4 adapter is not configured.", 503, "v4_dynamic_adapter_unavailable");
      await requireContractCode(provider, adapter, "Generic Uniswap v4 no-hook adapter");
      const input = typeof body.amountInUnits === "string" && /^\d+$/.test(body.amountInUnits) ? BigInt(body.amountInUnits) : 0n;
      const minOut = typeof body.minAmountOutUnits === "string" && /^\d+$/.test(body.minAmountOutUnits) ? BigInt(body.minAmountOutUnits) : 0n;
      if (input <= 0n || minOut <= 0n) throw new MonadApiError("Swap input or minimum output is invalid.", 400, "swap_amount_invalid");
      const fresh = await quoteV4Pool(provider, record, tokenIn, tokenOut, input);
      if (fresh.amountOut < minOut) throw new MonadApiError("The finalized v4 quote moved below the reviewed minimum; request a fresh quote.", 409, "quote_stale");
      const token = new Contract(tokenIn, ERC20_ABI, provider);
      if (await token.allowance(owner, adapter) < input) throw new MonadApiError("Approve the exact swap input before trading.", 409,
        "approval_required", { kind: "approve_token", tokenAddress: tokenIn, spender: adapter, amountUnits: input.toString() });
      const call = buildV4SwapCall(record, tokenIn, tokenOut, input, minOut);
      to = call.to; data = call.data;
      intent = { kind, accountScope: "wallet", venue: "uniswap_v4_testnet", marketId: v4MarketId(record.poolId),
        chainId: MONAD_CHAIN_ID, ownerAddress: getAddress(owner), poolId: record.poolId.toLowerCase(), poolKey: key,
        verified: record.verified, unverifiedPoolWarning: !record.verified, tokenIn, tokenOut,
        amountInUnits: input.toString(), minAmountOutUnits: minOut.toString(), inputDecimals: body.inputDecimals,
        outputDecimals: body.outputDecimals, freshAmountOutUnits: fresh.amountOut.toString(),
        freshBlockNumber: fresh.checkpoint, freshObservedAt: fresh.observedAt };
    } else if (body.venue === MOCK_SPOT_VENUE) {
      if (body.accountScope !== "wallet") throw new MonadApiError("Mock pool swaps are Mera-wallet only.", 403, "operator_only");
      const pair = await resolveMockPool(provider, tokenIn, tokenOut);
      if (String(body.poolAddress ?? "").toLowerCase() !== pair.poolAddress.toLowerCase()) {
        throw new MonadApiError("Mock pool differs from the quote-bound verified deployment.", 409, "quote_mismatch");
      }
      const input = typeof body.amountInUnits === "string" && /^\d+$/.test(body.amountInUnits) ? BigInt(body.amountInUnits) : 0n;
      const minOut = typeof body.minAmountOutUnits === "string" && /^\d+$/.test(body.minAmountOutUnits) ? BigInt(body.minAmountOutUnits) : 0n;
      if (input <= 0n || minOut <= 0n) throw new MonadApiError("Swap input or minimum output is invalid.", 400, "swap_amount_invalid");
      const currentOut = await quoteMockPool(provider, pair, input);
      if (minOut > currentOut) throw new MonadApiError("The finalized pool quote moved below the reviewed minimum; request a fresh quote.", 409, "quote_stale");
      const token = new Contract(tokenIn, ERC20_ABI, provider);
      if (await token.allowance(owner, pair.poolAddress) < input) throw new MonadApiError("Approve the exact swap input before trading.", 409,
        "approval_required", { kind: "approve_token", tokenAddress: tokenIn, spender: pair.poolAddress, amountUnits: input.toString() });
      to = pair.poolAddress; data = new Interface(AUTONOMY_POOL_ABI).encodeFunctionData("swap", [tokenIn, tokenOut, input, minOut]);
      intent = { kind, accountScope: "wallet", venue: MOCK_SPOT_VENUE, poolAddress: pair.poolAddress, tokenIn, tokenOut,
        amountInUnits: input.toString(), minAmountOutUnits: minOut.toString(), inputDecimals: pair.tokenInDecimals,
        outputDecimals: pair.tokenOutDecimals, marketId: `${pair.symbol}_USDC` };
    } else {
      const venue = body.venue as MonadVenue; const adapter = configuredAdapter(venue);
      if (!adapter) throw new MonadApiError("The selected Monad Testnet venue is not configured.", 503, "venue_disabled");
      await requireContractCode(provider, adapter, "Monad swap adapter");
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
    }
  } else {
    throw new MonadApiError("Unsupported Monad wallet operation.", 400, "operation_unsupported");
  }
  const gasCap = body.poolId !== undefined ? parseGasCap(body.gasCap) : undefined;
  const built = await buildEip1559Transaction(provider, owner, to, data, value,
    gasCap?.gasLimit ?? 3_000_000n, gasCap ? { maxFeePerGas: gasCap.maxFeePerGas,
      maxPriorityFeePerGas: gasCap.maxPriorityFeePerGas } : undefined);
  if (gasCap) intent = { ...intent, gasCap: { gasLimit: gasCap.gasLimit.toString(),
    maxFeePerGas: gasCap.maxFeePerGas.toString(), maxPriorityFeePerGas: gasCap.maxPriorityFeePerGas.toString(),
    maxCostWei: (gasCap.gasLimit * gasCap.maxFeePerGas).toString() } };
  return { ...built, intent };
}

function parseGasCap(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fields = [row.gasLimit, row.maxFeePerGas, row.maxPriorityFeePerGas];
  if (!fields.every((field) => typeof field === "string" && /^\d+$/.test(field))) {
    throw new MonadApiError("Pool-bound swap quote is missing its gas cap.", 409, "gas_cap_required");
  }
  const [gasLimit, maxFeePerGas, maxPriorityFeePerGas] = fields.map((field) => BigInt(String(field)));
  if (gasLimit <= 0n || gasLimit > 3_000_000n || maxFeePerGas <= 0n || maxPriorityFeePerGas <= 0n
      || maxPriorityFeePerGas > maxFeePerGas) throw new MonadApiError("Quoted gas cap is outside the reviewed limit.", 409, "gas_cap_invalid");
  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas };
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
