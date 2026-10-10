import { Contract, getAddress } from "ethers";
import { AUTONOMY_POOL_ABI, readAutonomyDeployment } from "./autonomyChain.js";
import { USDC_ADDRESS } from "./constants.js";
import { MonadApiError } from "./config.js";

export const MOCK_SPOT_VENUE = "moeazi_mock_pools_testnet";

async function verifiedDeployment(provider: any) {
  const deployment = await readAutonomyDeployment(provider);
  return deployment;
}

/** Resolves only a pool/token pair pinned by the receipt-verified factory manifest. */
export async function resolveMockPool(provider: any, tokenInValue: unknown, tokenOutValue: unknown) {
  let tokenIn: string; let tokenOut: string;
  try { tokenIn = getAddress(String(tokenInValue)); tokenOut = getAddress(String(tokenOutValue)); }
  catch { throw new MonadApiError("Mock-pool swap assets are invalid.", 400, "pair_unsupported"); }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw new MonadApiError("Swap assets must differ.", 400, "pair_unsupported");
  const deployment = await verifiedDeployment(provider);
  const index = deployment.tokens.findIndex((address: string) =>
    (tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() && address.toLowerCase() === tokenOut.toLowerCase())
    || (tokenOut.toLowerCase() === USDC_ADDRESS.toLowerCase() && address.toLowerCase() === tokenIn.toLowerCase()));
  if (index < 0) throw new MonadApiError("Only USDC and a verified MZA/MZB/MZG pool pair are supported.", 400, "pair_unsupported");
  const poolAddress = getAddress(deployment.pools[index]);
  const tokenAddress = getAddress(deployment.tokens[index]);
  const tokenInDecimals = tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
  const tokenOutDecimals = tokenOut.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
  return { tokenIn, tokenOut, tokenAddress, poolAddress, tokenInDecimals, tokenOutDecimals,
    checkpoint: deployment.checkpoint, symbol: deployment.tokenMetadata[index]?.symbol ?? `MOCK${index + 1}` };
}

export async function resolveMockPoolApproval(provider: any, tokenValue: unknown, spenderValue: unknown) {
  let token: string; let spender: string;
  try { token = getAddress(String(tokenValue)); spender = getAddress(String(spenderValue)); }
  catch { throw new MonadApiError("Mock-pool approval assets are invalid.", 400, "spender_rejected"); }
  const deployment = await verifiedDeployment(provider);
  const index = deployment.pools.findIndex((address: string) => address.toLowerCase() === spender.toLowerCase());
  if (index < 0 || ![USDC_ADDRESS, deployment.tokens[index]].some((address: string) => address.toLowerCase() === token.toLowerCase())) {
    throw new MonadApiError("Approval must target a verified pool for its pinned USDC/mock-token assets.", 403, "spender_rejected");
  }
  return { token, spender, tokenAddress: deployment.tokens[index], tokenDecimals: token.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18 };
}

export async function quoteMockPool(provider: any, pair: Awaited<ReturnType<typeof resolveMockPool>>, amountIn: bigint) {
  const pool = new Contract(pair.poolAddress, AUTONOMY_POOL_ABI, provider);
  let result: any;
  try { result = await pool.quoteExactInput.staticCall(pair.tokenIn, pair.tokenOut, amountIn,
    { blockTag: pair.checkpoint }); }
  catch { throw new MonadApiError("The verified mock pool cannot quote this pair at the finalized checkpoint.", 409, "pool_unavailable"); }
  const amountOut = BigInt(result[0]);
  if (!result[1] || amountOut <= 0n) throw new MonadApiError("The verified mock pool has no executable liquidity.", 409, "pool_unavailable");
  return amountOut;
}
