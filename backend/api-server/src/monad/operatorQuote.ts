import { Contract, formatUnits } from "ethers";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { chooseVenue, configuredAdapter, configuredVault, maxSlippageBps, MonadApiError, venueData } from "./config.js";
import { ADAPTER_ABI, MONAD_CHAIN_ID, USDC_ADDRESS, VAULT_ABI, WMON_ADDRESS } from "./constants.js";
import { monadProvider, requireContractCode } from "./provider.js";
import { amountUnits } from "./transactions.js";
import { monadQuoteId } from "./readRoutes.js";
import { parseBody } from "./auth.js";

export async function operatorVaultQuote(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) {
    throw new MonadApiError("The local operator console bridge is required.", 401, "operator_auth_required");
  }
  const body = parseBody(await context.req.json());
  if (typeof body.mandateId !== "string") throw new MonadApiError("A mandate ID is required.");
  const mandate: any = await operatorQuery("monadMandates", "getOperatorMandate", { mandateId: body.mandateId });
  if (!mandate || mandate.status !== "active" || mandate.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new MonadApiError("An active signed mandate is required.", 409, "mandate_inactive");
  }
  const venue = chooseVenue(body.venue);
  const adapter = configuredAdapter(venue);
  const allowed: string[] = JSON.parse(mandate.allowedAdaptersJson);
  if (!adapter || !allowed.some(item => item.toLowerCase() === adapter.toLowerCase())) {
    throw new MonadApiError("The signed mandate does not allow this venue.", 403, "adapter_not_allowed");
  }
  const vaultAddress = configuredVault();
  if (!vaultAddress || vaultAddress.toLowerCase() !== mandate.vaultAddress.toLowerCase()) {
    throw new MonadApiError("Configured vault differs from the signed mandate.", 409, "vault_config_mismatch");
  }
  const tokenIn = mandate.tokenIn;
  const tokenOut = mandate.tokenOut;
  if (![USDC_ADDRESS, WMON_ADDRESS].some(token => token.toLowerCase() === tokenIn.toLowerCase())
      || ![USDC_ADDRESS, WMON_ADDRESS].some(token => token.toLowerCase() === tokenOut.toLowerCase())
      || tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new MonadApiError("Mandate pair is unsupported.", 409, "mandate_pair_mismatch");
  }
  const decimals = tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
  const amountIn = amountUnits(body.amountIn, decimals);
  const slippageBps = maxSlippageBps(body.slippageBps);
  if (amountIn > BigInt(mandate.maxInputPerTrade)) {
    throw new MonadApiError("Quoted amount exceeds the per-trade cap.", 409, "mandate_cap_exceeded");
  }
  const provider = await monadProvider();
  try {
    await requireContractCode(provider, vaultAddress, "Monad managed vault");
    await requireContractCode(provider, adapter, "Monad swap adapter");
    const vault = new Contract(vaultAddress, VAULT_ABI, provider);
    const [owner, active, stopped, balance] = await Promise.all([
      vault.owner(), vault.isMandateActive(mandate.typedDataHash), vault.stopped(),
      new Contract(tokenIn, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(vaultAddress),
    ]);
    if (String(owner).toLowerCase() !== mandate.ownerAddress.toLowerCase() || !active || stopped) {
      throw new MonadApiError("The exact mandate is not active on chain.", 409, "mandate_inactive");
    }
    if (BigInt(balance) < amountIn) {
      throw new MonadApiError(`Vault has insufficient ${tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? "USDC" : "WMON"} for ${formatUnits(amountIn, decimals)}.`, 409, "vault_balance_insufficient");
    }
    let result: any;
    try { result = await new Contract(adapter, ADAPTER_ABI, provider).quoteExactInput.staticCall(tokenIn, tokenOut, amountIn, venueData(venue)); }
    catch { throw new MonadApiError("Selected testnet pool cannot quote this trade.", 409, "pool_unavailable"); }
    const amountOut = BigInt(result[0]);
    if (!result[1] || amountOut <= 0n) throw new MonadApiError("Selected testnet pool has no executable quote.", 409, "pool_unavailable");
    const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    if (minimumOut <= 0n) throw new MonadApiError("Minimum output rounds to zero.");
    const expiresAt = Date.now() + 45_000;
    const quoteId = monadQuoteId({ ownerAddress: mandate.ownerAddress, scope: "vault", venue,
      tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: amountOut.toString(),
      minimumOut: minimumOut.toString(), slippageBps, expiresAt });
    await operatorMutation("monadQuotes", "recordQuote", { subject: mandate.subject,
      ownerAddress: mandate.ownerAddress, quoteId, accountScope: "vault", venue, tokenIn,
      tokenOut, amountInUnits: amountIn.toString(), amountOutUnits: amountOut.toString(),
      minimumAmountOutUnits: minimumOut.toString(), slippageBps, expiresAt,
      feeProvenance: `${venue} adapter quote; output includes venue pricing` });
    return context.json({ quoteId, chainId: MONAD_CHAIN_ID, accountScope: "vault", mandateId: body.mandateId,
      venue, tokenIn, tokenOut, amountInUnits: amountIn.toString(), amountOutUnits: amountOut.toString(),
      minimumAmountOutUnits: minimumOut.toString(), expiresAt: new Date(expiresAt).toISOString() });
  } finally { await provider.destroy(); }
}
