import { Contract, formatUnits } from "ethers";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { requireMera, parseBody, routeError } from "./auth.js";
import { MonadApiError } from "./config.js";
import { AUSD_DECIMALS, ERC20_ABI } from "./constants.js";
import { buildEip1559Transaction } from "./transactions.js";
import { monadProvider, finalizedBlockNumber, requireContractCode } from "./provider.js";
import { PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE, PERPL_DIRECT_VENUE_ID,
  PerplApiError } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { readDirectManualState, readLegacyManualState } from "./manualPerplState.js";
import { manualPerplAccountCall } from "./manualPerplCalls.js";
import { storedManualAccounts, persistPrepared, storedIdempotentOperation, sha256Json, integerUnits,
  validateIdempotencyKey, manualOperationDto, manualPerplEnabled, requireManualPerplActions } from "./manualPerplShared.js";

const LEGACY_ACTIONS = new Set(["legacy_withdraw", "legacy_rescue"]);
const ACCOUNT_ACTIONS = new Set(["approve", "open", "deposit", "withdraw", ...LEGACY_ACTIONS]);

async function account(context: any) {
  const auth = await requireMera(context); const saved: any = await storedManualAccounts(auth.token);
  let provider: any;
  try {
    provider = await monadProvider();
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(PERPL_CHAIN_ID)) throw new MonadApiError("Manual Perpl requires Monad Testnet.", 503, "perpl_wrong_chain");
    const blockNumber = await finalizedBlockNumber(provider);
    await Promise.all([requireContractCode(provider, PERPL_TESTNET_AUSD, "Perpl AUSD"),
      requireContractCode(provider, PERPL_TESTNET_EXCHANGE, "Perpl exchange")]);
    const live = await readPerplContext();
    const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
    const [walletUnits, allowance, tokenDecimals] = await Promise.all([
      token.balanceOf(auth.ownerAddress, { blockTag: blockNumber }),
      token.allowance(auth.ownerAddress, PERPL_TESTNET_EXCHANGE, { blockTag: blockNumber }),
      token.decimals({ blockTag: blockNumber }),
    ]);
    if (Number(tokenDecimals) !== AUSD_DECIMALS || live.limits.collateralAddress.toLowerCase() !== PERPL_TESTNET_AUSD.toLowerCase()) {
      throw new PerplApiError("Perpl Testnet collateral differs from the pinned AUSD deployment.", 503, "perpl_collateral_mismatch");
    }
    const direct = await readDirectManualState(provider, auth.ownerAddress, live, blockNumber);
    let legacy: any = null; let legacyReadError: string | null = null;
    try { legacy = await readLegacyManualState(provider, auth.ownerAddress, saved?.legacy, live, blockNumber); }
    catch (error) { legacyReadError = error instanceof Error ? error.message : "Legacy recovery account could not be verified."; }
    const enabled = manualPerplEnabled(); const directOpen = Boolean(direct.accountId);
    const accountRead: any = direct.account;
    return context.json({ chainId: PERPL_CHAIN_ID, exchangeAddress: PERPL_TESTNET_EXCHANGE,
      ownerAddress: auth.ownerAddress, accountMode: directOpen ? "direct_wallet" : "not_created",
      accountAddress: directOpen ? auth.ownerAddress : null, accountId: direct.accountId,
      status: directOpen ? "open" : "not_created", collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD,
        decimals: AUSD_DECIMALS, balanceUnits: accountRead?.balanceUnits ?? "0", lockedUnits: accountRead?.lockedUnits ?? "0",
        walletBalanceUnits: String(walletUnits), allowanceUnits: String(allowance) },
      positions: direct.positions, orders: direct.orders,
      legacyRecovery: legacy ? { accountMode: "legacy_delegated", status: legacy.accountId ? "open" : "created",
        accountAddress: legacy.accountAddress, accountId: legacy.accountId, collateral: legacy.collateral,
        positions: legacy.positions, orders: legacy.orders,
        capabilities: { withdraw: enabled && Boolean(legacy.accountId), rescueTokens: enabled && BigInt(legacy.collateral.tokenBalanceUnits) > 0n,
          marketOrders: enabled && Boolean(legacy.accountId), limitOrders: enabled && Boolean(legacy.accountId),
          cancelOrders: enabled && Boolean(legacy.accountId), closePosition: enabled && Boolean(legacy.accountId),
          reducePosition: enabled && Boolean(legacy.accountId) } }
        : legacyReadError ? { accountMode: "legacy_delegated", status: "unavailable",
          accountAddress: saved?.legacy?.accountAddress ?? null, accountId: null,
          collateral: { balanceUnits: "0", lockedUnits: "0", tokenBalanceUnits: "0" }, positions: [], orders: [], error: legacyReadError,
          capabilities: { withdraw: false, rescueTokens: false, marketOrders: false, limitOrders: false,
            cancelOrders: false, closePosition: false, reducePosition: false } }
        : { accountMode: null, status: "none", accountAddress: null, accountId: null,
          collateral: { balanceUnits: "0", lockedUnits: "0", tokenBalanceUnits: "0" }, positions: [], orders: [],
          capabilities: { withdraw: false, rescueTokens: false, marketOrders: false, limitOrders: false,
            cancelOrders: false, closePosition: false, reducePosition: false } },
      observedAt: Date.now(), blockNumber: accountRead?.blockNumber ?? blockNumber,
      capabilities: { approve: enabled, open: enabled && !directOpen, createAccount: enabled && !directOpen,
        deposit: enabled && directOpen, withdraw: enabled && directOpen, marketOrders: enabled && directOpen,
        limitOrders: enabled && directOpen, cancelOrders: enabled && directOpen, closePosition: enabled && directOpen,
        reducePosition: enabled && directOpen } });
  } catch (error) {
    if (error instanceof MonadApiError) throw error;
    return context.json({ chainId: PERPL_CHAIN_ID, exchangeAddress: PERPL_TESTNET_EXCHANGE,
      ownerAddress: auth.ownerAddress, accountMode: "unavailable", accountAddress: null, accountId: null,
      status: "unavailable", collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: AUSD_DECIMALS,
        balanceUnits: "0", lockedUnits: "0", walletBalanceUnits: "0", allowanceUnits: "0" },
      positions: [], orders: [], legacyRecovery: { accountMode: null, status: "unavailable", accountAddress: null,
        accountId: null, collateral: { balanceUnits: "0", lockedUnits: "0", tokenBalanceUnits: "0" }, positions: [], orders: [],
        capabilities: { withdraw: false, rescueTokens: false, marketOrders: false, limitOrders: false,
          cancelOrders: false, closePosition: false, reducePosition: false } },
      observedAt: Date.now(), unavailable: true,
      capabilities: { approve: false, open: false, createAccount: false, deposit: false, withdraw: false,
        marketOrders: false, limitOrders: false, cancelOrders: false, closePosition: false, reducePosition: false } });
  } finally { await provider?.destroy(); }
}

async function prepareAccount(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  const action = String(body.action ?? "");
  if (!ACCOUNT_ACTIONS.has(action)) throw new MonadApiError("Manual Perpl account action is unsupported.", 400, "manual_perpl_action_invalid");
  const amount = integerUnits(body.amountUnits, "AUSD amount");
  const idempotencyKey = validateIdempotencyKey(body.idempotencyKey); requireManualPerplActions();
  const accountMode = LEGACY_ACTIONS.has(action) ? "legacy_delegated" : "direct_wallet";
  const intentHash = sha256Json({ owner: auth.ownerAddress.toLowerCase(), accountMode, action, amountUnits: amount.toString() });
  const prior = await storedIdempotentOperation(auth.token, idempotencyKey, intentHash);
  if (prior) return context.json(manualOperationDto(prior, action, prior.actionDetails ?? {}));
  const saved: any = await storedManualAccounts(auth.token); const provider = await monadProvider();
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(PERPL_CHAIN_ID)) {
      throw new MonadApiError("Manual Perpl account actions require Monad Testnet.", 503, "perpl_wrong_chain");
    }
    const live = await readPerplContext(); const checkpoint = await finalizedBlockNumber(provider);
    await Promise.all([requireContractCode(provider, PERPL_TESTNET_AUSD, "Perpl AUSD"),
      requireContractCode(provider, PERPL_TESTNET_EXCHANGE, "Perpl exchange")]);
    const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
    if (Number(await token.decimals({ blockTag: checkpoint })) !== AUSD_DECIMALS
        || live.limits.collateralAddress.toLowerCase() !== PERPL_TESTNET_AUSD.toLowerCase()) {
      throw new PerplApiError("Perpl Testnet collateral differs from the pinned AUSD deployment.", 503, "perpl_collateral_mismatch");
    }
    const direct = await readDirectManualState(provider, auth.ownerAddress, live, checkpoint);
    const legacy = await readLegacyManualState(provider, auth.ownerAddress, saved?.legacy, live, checkpoint);
    let operationAction = ""; let reviewAccountAddress = auth.ownerAddress;
    let accountId: number | undefined; let before: Record<string, unknown> = {};
    const walletUnits = BigInt(await token.balanceOf(auth.ownerAddress, { blockTag: checkpoint }));
    const allowance = BigInt(await token.allowance(auth.ownerAddress, PERPL_TESTNET_EXCHANGE, { blockTag: checkpoint }));
    if (accountMode === "direct_wallet") {
      if (action === "approve") {
        operationAction = "approve_collateral";
        before = { walletAusdUnits: walletUnits.toString(), allowanceUnits: allowance.toString() };
      } else if (action === "open") {
        if (direct.accountId) throw new MonadApiError("This Mera wallet already owns an open Perpl account.", 409, "manual_perpl_account_exists");
        if (amount < BigInt(live.limits.minAccountOpenUnits)) throw new MonadApiError(
          `Perpl account creation requires at least ${formatUnits(live.limits.minAccountOpenUnits, AUSD_DECIMALS)} AUSD.`,
          400, "manual_perpl_open_minimum");
        if (walletUnits < amount) throw new MonadApiError("Mera wallet has insufficient AUSD for the reviewed account deposit.", 409, "manual_perpl_ausd_insufficient");
        if (allowance !== amount) throw new MonadApiError(
          `The selected deposit is ${formatUnits(amount, AUSD_DECIMALS)} AUSD, but the finalized Perpl allowance is ${formatUnits(allowance, AUSD_DECIMALS)} AUSD. Use the approved amount or sign a new exact approval.`,
          409, "approval_required", { action: "approve", amountUnits: amount.toString(), tokenAddress: PERPL_TESTNET_AUSD,
            spender: PERPL_TESTNET_EXCHANGE });
        operationAction = "open_account";
        before = { walletAusdUnits: walletUnits.toString(), allowanceUnits: allowance.toString(),
          minAccountOpenUnits: live.limits.minAccountOpenUnits };
      } else {
        if (!direct.accountId) throw new MonadApiError("Create the direct Mera-owned Perpl account before managing collateral.", 409, "manual_perpl_account_missing");
        accountId = direct.accountId; reviewAccountAddress = auth.ownerAddress;
        const account: any = direct.account;
        if (action === "deposit") {
          if (amount < BigInt(live.limits.minDepositUnits)) throw new MonadApiError("Deposit is below Perpl's live minimum.", 400, "manual_perpl_deposit_minimum");
          if (walletUnits < amount) throw new MonadApiError("Mera wallet has insufficient AUSD for this deposit.", 409, "manual_perpl_ausd_insufficient");
          if (allowance !== amount) throw new MonadApiError(
            `The selected deposit is ${formatUnits(amount, AUSD_DECIMALS)} AUSD, but the finalized Perpl allowance is ${formatUnits(allowance, AUSD_DECIMALS)} AUSD. Use the approved amount or sign a new exact approval.`,
            409, "approval_required", { action: "approve", amountUnits: amount.toString(), tokenAddress: PERPL_TESTNET_AUSD,
              spender: PERPL_TESTNET_EXCHANGE });
          operationAction = "deposit_collateral";
        } else if (action === "withdraw") {
          const free = BigInt(account.balanceUnits) - BigInt(account.lockedUnits);
          if (amount > free || amount < BigInt(live.limits.minWithdrawalUnits)) throw new MonadApiError(
            "Withdrawal exceeds free collateral or is below Perpl's live minimum.", 409, "manual_perpl_withdraw_limits");
          operationAction = "withdraw_collateral";
        } else throw new MonadApiError("Action does not apply to a direct Perpl account.", 400, "manual_perpl_action_invalid");
        before = { accountId, balanceUnits: account.balanceUnits, lockedUnits: account.lockedUnits,
          walletAusdUnits: walletUnits.toString(), allowanceUnits: allowance.toString() };
      }
    } else {
      if (!legacy) throw new MonadApiError("No legacy delegated Perpl account is available for recovery.", 404, "manual_perpl_legacy_missing");
      reviewAccountAddress = legacy.accountAddress; accountId = legacy.accountId ?? undefined;
      const daTokenUnits = BigInt(legacy.collateral.tokenBalanceUnits);
      if (action === "legacy_withdraw") {
        if (!legacy.accountId || !legacy.account) throw new MonadApiError("Legacy Perpl account is not open.", 409, "manual_perpl_account_not_open");
        const free = BigInt(legacy.account.balanceUnits) - BigInt(legacy.account.lockedUnits);
        if (amount > free || amount < BigInt(live.limits.minWithdrawalUnits)) throw new MonadApiError(
          "Legacy withdrawal exceeds free collateral or is below Perpl's live minimum.", 409, "manual_perpl_withdraw_limits");
        operationAction = "legacy_withdraw_collateral";
        before = { accountId, balanceUnits: legacy.account.balanceUnits, lockedUnits: legacy.account.lockedUnits,
          delegatedTokenUnits: daTokenUnits.toString() };
      } else {
        if (amount > daTokenUnits) throw new MonadApiError("Legacy delegated account has insufficient stranded AUSD to rescue.",
          409, "manual_perpl_legacy_rescue_insufficient");
        operationAction = "legacy_rescue_tokens";
        before = { accountId, delegatedTokenUnits: daTokenUnits.toString(), rescueTokenAddress: PERPL_TESTNET_AUSD };
      }
    }
    const call = manualPerplAccountCall(action, amount, reviewAccountAddress);
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, call.to, call.data);
    const actionDetails = { action, accountMode, ownerAddress: auth.ownerAddress, chainId: PERPL_CHAIN_ID,
      venueId: PERPL_DIRECT_VENUE_ID, exchangeAddress: PERPL_TESTNET_EXCHANGE, accountAddress: reviewAccountAddress,
      ...(accountId ? { accountId } : {}), amountUnits: amount.toString(), ...before,
      ...(action === "approve" ? { tokenAddress: PERPL_TESTNET_AUSD, spender: PERPL_TESTNET_EXCHANGE }
        : action === "legacy_rescue" ? { tokenAddress: PERPL_TESTNET_AUSD } : {}), method: call.method,
      target: call.to, transactionValue: "0", gas: built.gas,
      collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: AUSD_DECIMALS } };
    const operationId = randomUUID(); const expiresAt = Date.now() + 240_000;
    const row: any = await persistPrepared(auth.token, { operationId, idempotencyKey, intentHash,
      action: operationAction, actionJson: JSON.stringify(actionDetails), transactionJson: JSON.stringify(built.transaction),
      nonce: built.transaction.nonce, expiresAt, accountAddress: reviewAccountAddress,
      accountMode, ...(accountId ? { accountId } : {}) });
    return context.json(manualOperationDto(row, action, actionDetails), 201);
  } finally { await provider.destroy(); }
}

export function registerManualPerplAccountRoutes(app: Hono<any>) {
  app.get("/api/mobile/manual/perpl/account", (c) => guard(c, account));
  app.post("/api/mobile/manual/perpl/account/prepare", (c) => guard(c, prepareAccount));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
