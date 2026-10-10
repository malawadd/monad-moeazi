import { Contract, Interface, ZeroAddress, formatUnits, getAddress } from "ethers";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { meraMutation } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { MonadApiError } from "./config.js";
import { AUSD_DECIMALS, ERC20_ABI } from "./constants.js";
import { buildEip1559Transaction } from "./transactions.js";
import { monadProvider, finalizedBlockNumber, requireContractCode } from "./provider.js";
import { PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE, PERPL_DIRECT_VENUE_ID,
  PerplApiError } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { readDirectAccount, readDirectOrder } from "./perplDirectState.js";
import { storedAccount, persistPrepared, storedIdempotentOperation, sha256Json, integerUnits, validateIdempotencyKey,
  manualOperationDto, manualPerplEnabled, MANUAL_DA_ABI, MANUAL_DA_FACTORY_ABI, MANUAL_PERPL_FACTORY,
  requireManualPerplActions } from "./manualPerplShared.js";

function walletAUsdAbi() { return ERC20_ABI; }
function daFactory(provider: any) { return new Contract(MANUAL_PERPL_FACTORY, MANUAL_DA_FACTORY_ABI, provider); }
function decimalsToNumber(value: any) { return Number.isSafeInteger(Number(value)) ? Number(value) : 0; }

async function account(context: any) {
  const auth = await requireMera(context); const saved: any = await storedAccount(auth.token);
  let provider: any;
  try {
    provider = await monadProvider(); const blockNumber = await finalizedBlockNumber(provider);
    await requireContractCode(provider, PERPL_TESTNET_AUSD, "Perpl AUSD");
    const token = new Contract(PERPL_TESTNET_AUSD, walletAUsdAbi(), provider);
    const [walletUnits, tokenDecimals] = await Promise.all([token.balanceOf(auth.ownerAddress, { blockTag: blockNumber }), token.decimals({ blockTag: blockNumber })]);
    if (Number(tokenDecimals) !== AUSD_DECIMALS) throw new PerplApiError("AUSD decimals differ from the pinned Perpl Testnet deployment.", 503, "perpl_collateral_mismatch");
    const live = await readPerplContext();
    const enabled = manualPerplEnabled();
    if (!saved) return context.json({ chainId: PERPL_CHAIN_ID, ownerAddress: auth.ownerAddress, accountAddress: null, accountId: null,
      status: "not_created", collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: 6,
        balanceUnits: "0", lockedUnits: "0", walletBalanceUnits: String(walletUnits), delegatedTokenUnits: "0" },
      positions: [], orders: [], observedAt: Date.now(), blockNumber, capabilities: { createAccount: enabled, fundAccount: false, openAccount: false,
        deposit: false, withdraw: false, marketOrders: false, limitOrders: false, cancelOrders: false, closePosition: false, reducePosition: false } });
    const daAddress = getAddress(saved.accountAddress);
    await requireContractCode(provider, daAddress, "Perpl manual delegated account");
    const da = new Contract(daAddress, MANUAL_DA_ABI, provider);
    const [owner, exchange, accountIdRaw, daUnits] = await Promise.all([da.owner({ blockTag: blockNumber}), da.exchange({ blockTag: blockNumber}),
      da.accountId({ blockTag: blockNumber }), token.balanceOf(daAddress, { blockTag: blockNumber })]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()
        || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE.toLowerCase()) {
      throw new MonadApiError("Stored Perpl delegated account owner or exchange differs from the Mera review.", 409, "manual_perpl_account_mismatch");
    }
    const accountId = Number(accountIdRaw); let accountRead: any = null;
    if (Number.isSafeInteger(accountId) && accountId > 0) accountRead = await readDirectAccount(provider, accountId,
      live.markets.filter((market) => market.isOpen).map((market) => market.id), daAddress);
    const marketById = new Map(live.markets.map((market) => [market.id, market]));
    const positions = (accountRead?.positions ?? []).map((position: any) => {
      const market = marketById.get(Number(position.mkt)); const priceScale = 10n ** BigInt(market?.priceDecimals ?? 0);
      const sizeScale = 10n ** BigInt(market?.sizeDecimals ?? 0); const deposit = BigInt(position.depositUnits ?? "0");
      const notional = priceScale && sizeScale ? BigInt(position.ep) * BigInt(position.s) * 1_000_000n / (priceScale * sizeScale) : 0n;
      const leverage = deposit > 0n ? Number(notional * 100n / deposit) / 100 : null;
      return { marketId: String(position.mkt), symbol: market?.symbol ?? String(position.mkt), side: Number(position.sd) === 2 ? "short" : "long",
        sizeUnits: String(position.s), entryPrice: String(position.ep), markPrice: String(position.markPrice), leverage,
        unrealizedPnlUnits: String(position.pnlUnits), fundingPnlUnits: String(position.fundingPnlUnits ?? "0"),
        priceDecimals: market?.priceDecimals ?? null, sizeDecimals: market?.sizeDecimals ?? null };
    });
    const orders = await readOpenOrders(provider, accountRead, live.markets, accountId);
    const open = accountId > 0;
    return context.json({ chainId: PERPL_CHAIN_ID, ownerAddress: auth.ownerAddress, accountAddress: daAddress, accountId: open ? accountId : null,
      status: open ? "open" : "created", collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: 6,
        balanceUnits: accountRead?.balanceUnits ?? "0", lockedUnits: accountRead?.lockedUnits ?? "0",
        walletBalanceUnits: String(walletUnits), delegatedTokenUnits: String(daUnits) }, positions, orders,
      observedAt: Date.now(), blockNumber: accountRead?.blockNumber ?? blockNumber,
      capabilities: { createAccount: false, fundAccount: enabled, openAccount: enabled && !open, deposit: enabled && open, withdraw: enabled && open,
        marketOrders: enabled && open, limitOrders: enabled && open, cancelOrders: enabled && open, closePosition: enabled && open,
        reducePosition: enabled && open } });
  } catch (error) {
    if (error instanceof MonadApiError) throw error;
    return context.json({ chainId: PERPL_CHAIN_ID, ownerAddress: auth.ownerAddress,
      accountAddress: saved?.accountAddress ?? null, accountId: saved?.accountId ?? null, status: "unavailable",
      collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: 6, balanceUnits: saved?.balanceUnits ?? "0",
        lockedUnits: saved?.lockedUnits ?? "0", walletBalanceUnits: "0", delegatedTokenUnits: "0" }, positions: [], orders: [],
      observedAt: Date.now(), unavailable: true,
      capabilities: { createAccount: manualPerplEnabled() && !saved, fundAccount: false, openAccount: false, deposit: false, withdraw: false,
        marketOrders: false, limitOrders: false, cancelOrders: false, closePosition: false, reducePosition: false } });
  } finally { await provider?.destroy(); }
}

async function readOpenOrders(provider: any, account: any, markets: any[], accountId: number) {
  if (!account || !account.orders?.length) return [];
  const block = account.blockNumber; const rows: any[] = [];
  for (const lock of account.orders) {
    for (const market of markets) {
      try {
        const order = await readDirectOrder(provider, market.id, Number(lock.lockId), block);
        if (order.accountId !== accountId || order.orderId !== Number(lock.lockId)) continue;
        rows.push({ orderId: String(order.orderId), marketId: String(market.id), symbol: market.symbol,
          side: order.orderType === 0 ? "long" : order.orderType === 1 ? "short" : "unknown",
          sizeUnits: String(order.size), price: String(order.price), status: "open", filledUnits: "0" });
        break;
      } catch { /* this lock ID belongs to a different market or is no longer live */ }
    }
  }
  return rows;
}

async function prepareAccount(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  const action = String(body.action ?? ""); const amount = ["fund", "open", "deposit", "withdraw"].includes(action)
    ? integerUnits(body.amountUnits, "AUSD amount") : 0n;
  const idempotencyKey = validateIdempotencyKey(body.idempotencyKey); requireManualPerplActions();
  if (!["create", "fund", "open", "deposit", "withdraw"].includes(action)) throw new MonadApiError("Manual Perpl account action is unsupported.", 400, "manual_perpl_action_invalid");
  const intentHash = sha256Json({ owner: auth.ownerAddress.toLowerCase(), action, amountUnits: amount.toString() });
  const prior = await storedIdempotentOperation(auth.token, idempotencyKey, intentHash);
  if (prior) return context.json(manualOperationDto(prior, action, prior.actionDetails ?? {}));
  const saved: any = await storedAccount(auth.token);
  if (action !== "create" && !saved) throw new MonadApiError("Create the Mera-owned delegated account before managing AUSD or orders.", 409, "manual_perpl_account_missing");
  const provider = await monadProvider();
  try {
    const live = await readPerplContext(); const checkpoint = await finalizedBlockNumber(provider);
    let to: string; let data: string; let accountAddress = saved?.accountAddress ? getAddress(saved.accountAddress) : undefined;
    let accountId: number | undefined; let before: any = {};
    const token = new Contract(PERPL_TESTNET_AUSD, walletAUsdAbi(), provider);
    const factory = daFactory(provider); const daInterface = new Interface(MANUAL_DA_ABI);
    if (action === "create") {
      if (saved) throw new MonadApiError("This Mera owner already has a manual Perpl delegated account.", 409, "manual_perpl_account_exists");
      await requireContractCode(provider, MANUAL_PERPL_FACTORY, "Perpl delegated-account factory");
      accountAddress = getAddress(await factory.create.staticCall(ZeroAddress, 0, "0x", { from: auth.ownerAddress }));
      if ((await provider.getCode(accountAddress)) !== "0x") throw new MonadApiError("Predicted Perpl account already exists; reconcile it before preparing another.", 409, "manual_perpl_account_exists");
      to = MANUAL_PERPL_FACTORY; data = factory.interface.encodeFunctionData("create", [ZeroAddress, 0, "0x"]);
    } else {
      await requireContractCode(provider, accountAddress!, "Perpl manual delegated account");
      const da = new Contract(accountAddress!, MANUAL_DA_ABI, provider);
      const [owner, exchange, id, daAusd, walletAusd] = await Promise.all([da.owner({ blockTag: checkpoint }), da.exchange({ blockTag: checkpoint }),
        da.accountId({ blockTag: checkpoint }), token.balanceOf(accountAddress!, { blockTag: checkpoint }), token.balanceOf(auth.ownerAddress, { blockTag: checkpoint })]);
      if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase() || String(exchange).toLowerCase() !== live.exchangeAddress.toLowerCase()) {
        throw new MonadApiError("Perpl delegated account owner or exchange does not match the live Mera account.", 409, "manual_perpl_account_mismatch");
      }
      accountId = Number(id); before = { accountId, daAusdUnits: String(daAusd), walletAusdUnits: String(walletAusd) };
      if (action === "fund") {
        if (BigInt(walletAusd) < amount) throw new MonadApiError("Mera wallet has insufficient AUSD to fund the manual account.", 409, "manual_perpl_ausd_insufficient");
        to = PERPL_TESTNET_AUSD; data = token.interface.encodeFunctionData("transfer", [accountAddress, amount]);
      } else if (action === "open") {
        if (accountId > 0) throw new MonadApiError("Manual Perpl account is already open.", 409, "manual_perpl_account_open");
        if (amount < BigInt(live.limits.minAccountOpenUnits)) throw new MonadApiError(`Perpl account opening requires at least ${live.limits.minAccountOpenUnits} AUSD base units.`, 400, "manual_perpl_open_minimum");
        if (BigInt(daAusd) < amount) throw new MonadApiError("Fund the delegated account with the exact AUSD amount before opening the exchange account.", 409, "manual_perpl_fund_required");
        to = accountAddress!; data = daInterface.encodeFunctionData("createAccount", [amount]);
      } else if (action === "deposit") {
        if (accountId <= 0) throw new MonadApiError("Open the Perpl exchange account before depositing collateral.", 409, "manual_perpl_account_not_open");
        if (amount < BigInt(live.limits.minDepositUnits)) throw new MonadApiError("Deposit is below Perpl's live minimum.", 400, "manual_perpl_deposit_minimum");
        if (BigInt(daAusd) < amount) throw new MonadApiError("Fund the delegated account with AUSD before depositing it to Perpl.", 409, "manual_perpl_fund_required");
        const snapshot = await readDirectAccount(provider, accountId, live.markets.filter((m) => m.isOpen).map((m) => m.id), accountAddress!);
        before = { ...before, balanceUnits: snapshot.balanceUnits, lockedUnits: snapshot.lockedUnits };
        to = accountAddress!; data = daInterface.encodeFunctionData("depositCollateral", [amount]);
      } else {
        if (accountId <= 0) throw new MonadApiError("Open the Perpl exchange account before withdrawing collateral.", 409, "manual_perpl_account_not_open");
        const snapshot = await readDirectAccount(provider, accountId, live.markets.filter((m) => m.isOpen).map((m) => m.id), accountAddress!);
        const free = BigInt(snapshot.balanceUnits) - BigInt(snapshot.lockedUnits);
        if (amount > free || amount < BigInt(live.limits.minWithdrawalUnits)) throw new MonadApiError("Withdrawal exceeds free collateral or is below Perpl's live minimum.", 409, "manual_perpl_withdraw_limits");
        before = { ...before, balanceUnits: snapshot.balanceUnits, lockedUnits: snapshot.lockedUnits };
        to = accountAddress!; data = daInterface.encodeFunctionData("withdrawCollateral", [amount]);
      }
    }
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, to!, data!);
    const actionDetails = { action, ownerAddress: auth.ownerAddress, chainId: PERPL_CHAIN_ID, venueId: PERPL_DIRECT_VENUE_ID,
      accountAddress: accountAddress ?? null, ...(accountId ? { accountId } : {}), ...(amount > 0n ? { amountUnits: amount.toString() } : {}),
      ...before, ...(action === "create" ? { operator: ZeroAddress, accountOwner: auth.ownerAddress } : {}),
      method: action === "create" ? "create(address,uint256,bytes)" : action === "fund" ? "transfer(address,uint256)"
        : action === "open" ? "createAccount(uint256)" : action === "deposit" ? "depositCollateral(uint256)" : "withdrawCollateral(uint256)",
      gas: built.gas, collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: 6 } };
    const operationId = randomUUID(); const expiresAt = Date.now() + 240_000;
    const row: any = await persistPrepared(auth.token, { operationId, idempotencyKey, intentHash, action: action === "create" ? "create_account"
      : action === "open" ? "open_account" : action === "deposit" ? "deposit_collateral" : action === "withdraw" ? "withdraw_collateral" : "fund_account",
      actionJson: JSON.stringify(actionDetails), transactionJson: JSON.stringify(built.transaction), nonce: built.transaction.nonce,
      expiresAt, accountAddress, ...(accountId ? { accountId } : {}) });
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
