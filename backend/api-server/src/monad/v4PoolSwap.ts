import { Contract, Interface, getAddress } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { configuredDynamicV4Adapter, MonadApiError } from "./config.js";
import { DYNAMIC_V4_ADAPTER_ABI, MONAD_CHAIN_ID, V4_POOL_MANAGER_ADDRESS } from "./constants.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { isNoHook, v4PoolId, v4PoolKey, type V4PoolRecord } from "./v4PoolIndex.js";

const iface = new Interface(DYNAMIC_V4_ADAPTER_ABI);
const MAX_AMOUNT_IN = (1n << 127n) - 1n;

function adapterAddress() {
  const address = configuredDynamicV4Adapter();
  if (!address) throw new MonadApiError("The generic no-hook v4 adapter is not configured on this local Testnet stack.",
    503, "v4_dynamic_adapter_unavailable");
  return address;
}

export function assertV4PoolTradeable(record: V4PoolRecord, tokenInValue: unknown, tokenOutValue: unknown) {
  if (!isNoHook(record)) throw new MonadApiError("Pools with hooks are read only until their hook route is reviewed.", 403, "v4_hook_pool_read_only");
  const key = v4PoolKey(record);
  if (v4PoolId(key) !== record.poolId.toLowerCase()) throw new MonadApiError("PoolKey does not match the indexed PoolId.", 409, "v4_pool_key_mismatch");
  let tokenIn: string; let tokenOut: string;
  try { tokenIn = getAddress(String(tokenInValue)); tokenOut = getAddress(String(tokenOutValue)); }
  catch { throw new MonadApiError("Swap token addresses are invalid.", 400, "pair_unsupported"); }
  if (tokenIn === tokenOut || ![key.currency0, key.currency1].every((currency) =>
    [tokenIn.toLowerCase(), tokenOut.toLowerCase()].includes(currency.toLowerCase()))) {
    throw new MonadApiError("Tokens do not match the selected v4 PoolKey.", 409, "v4_pool_pair_mismatch");
  }
  return { key, tokenIn, tokenOut };
}

export async function quoteV4Pool(provider: JsonRpcProvider, record: V4PoolRecord, tokenInValue: unknown,
  tokenOutValue: unknown, amountIn: bigint) {
  const pair = assertV4PoolTradeable(record, tokenInValue, tokenOutValue);
  if (amountIn <= 0n || amountIn > MAX_AMOUNT_IN) throw new MonadApiError("Swap input is outside the v4 amount limit.");
  const adapter = adapterAddress();
  await requireContractCode(provider, adapter, "Generic Uniswap v4 no-hook adapter");
  const checkpoint = await finalizedBlockNumber(provider);
  const pool = new Contract(adapter, DYNAMIC_V4_ADAPTER_ABI, provider);
  const [network, manager] = await Promise.all([provider.getNetwork(), pool.manager()]);
  if (network.chainId !== BigInt(MONAD_CHAIN_ID) || String(manager).toLowerCase() !== V4_POOL_MANAGER_ADDRESS.toLowerCase()) {
    throw new MonadApiError("Configured generic v4 adapter does not target the reviewed Monad PoolManager.", 503, "v4_adapter_mismatch");
  }
  let result: any;
  try {
    result = await pool.quoteExactInput.staticCall(record.poolId, pair.key, pair.tokenIn, pair.tokenOut, amountIn,
      { blockTag: checkpoint });
  } catch {
    throw new MonadApiError("The selected v4 pool cannot quote this swap at the finalized checkpoint.", 409, "pool_unavailable");
  }
  const amountOut = BigInt(result[0]);
  if (!result[1] || amountOut <= 0n) throw new MonadApiError("The selected v4 pool has no executable liquidity.", 409, "pool_unavailable");
  const block = await provider.getBlock(checkpoint);
  const observedAt = block ? Number(block.timestamp) * 1000 : 0;
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0 || observedAt > Date.now() + 5_000 || Date.now() - observedAt > 60_000) {
    throw new MonadApiError("Finalized v4 pool liquidity data is stale.", 409, "v4_liquidity_stale");
  }
  return { amountOut, adapter, poolKey: pair.key, tokenIn: pair.tokenIn, tokenOut: pair.tokenOut,
    poolId: record.poolId.toLowerCase(), checkpoint, observedAt };
}

export function buildV4SwapCall(record: V4PoolRecord, tokenInValue: unknown, tokenOutValue: unknown,
  amountIn: bigint, minimumAmountOut: bigint) {
  const pair = assertV4PoolTradeable(record, tokenInValue, tokenOutValue);
  if (amountIn <= 0n || amountIn > MAX_AMOUNT_IN || minimumAmountOut <= 0n) {
    throw new MonadApiError("Swap input or minimum output is invalid.", 400, "swap_amount_invalid");
  }
  const to = adapterAddress();
  const data = iface.encodeFunctionData("swap", [record.poolId, pair.key, pair.tokenIn, pair.tokenOut, amountIn, minimumAmountOut]);
  return { to, data, poolId: record.poolId.toLowerCase(), poolKey: pair.key,
    tokenIn: pair.tokenIn, tokenOut: pair.tokenOut };
}
