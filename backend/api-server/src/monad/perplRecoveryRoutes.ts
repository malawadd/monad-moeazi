import { Contract, ZeroAddress, keccak256 } from "ethers";
import { Hono } from "hono";
import { meraMutation, meraQuery } from "./convex.js";
import { parseBody, requireMera, routeError } from "./auth.js";
import { MonadApiError } from "./config.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { finalizedBlockNumber, monadProvider, requireContractCode } from "./provider.js";
import { AUSD_ABI, PERPL_STRATEGY_FACTORY_ABI, PERPL_STRATEGY_VAULT_ABI } from "./perplContracts.js";
import { PERPL_TESTNET_AUSD, PERPL_VENUE_ID } from "./perplConfig.js";
import { PERPL_DA_ABI } from "./perplContracts.js";
import { operatorWallet } from "./vaultTrades.js";
import { perplMobileTransaction } from "./perplMobileTransaction.js";
import { PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";

type RecoveryAction = "recover_vault_funding" | "recover_available_ausd";
function fail(code: string, message: string): never { throw new MonadApiError(message, 409, code); }

async function prepare(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || !["recover_vault_funding", "recover_available_ausd"].includes(body.action)
    || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.idempotencyKey)) {
    throw new MonadApiError("Perpl recovery action, run and idempotency key are required.", 400, "perpl_recovery_terms_invalid");
  }
  const action = body.action as RecoveryAction;
  const row: any = await meraQuery(auth.token, "monadVenueRuns", "getRunForOwner", { runId: body.runId });
  if (!row || row.ownerAddress.toLowerCase() !== auth.ownerAddress.toLowerCase()) fail("perpl_run_not_found", "Perpl run was not found for this Mera wallet.");
  const provider = await monadProvider();
  try {
    let code = await provider.getCode(row.vaultAddress);
    if (code === "0x") {
      const deployed = await ensureRecoveryVault(context, auth, row, provider);
      if (!deployed) return context.json({ runId: row.runId, venueId: row.venueId, action,
        status: "vault_deploying", phase: "vault_deploying" }, 202);
      code = await provider.getCode(row.vaultAddress);
    }
    if (code === "0x") fail("perpl_recovery_vault_unavailable", "Perpl strategy vault is not deployed yet; its creation transaction is being reconciled.");
    const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
    const [owner, chainStatus, expired] = await Promise.all([vault.owner(), vault.runStatus(), vault.isExpired()]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()) fail("perpl_owner_mismatch", "Perpl vault owner differs from Mera wallet.");
    let amount = 0n; let callData: string;
    if (action === "recover_vault_funding") {
      if (![0, 4].includes(Number(chainStatus))) fail("perpl_recovery_run_active", "Vault funding can only be recovered while the strategy vault is idle or settled.");
      amount = BigInt(await vault.vaultAUSD());
      if (amount <= 0n) fail("perpl_recovery_balance_empty", "There is no AUSD prefunded in the Perpl strategy vault.");
      callData = vault.interface.encodeFunctionData("recoverVaultFunding");
    } else {
      if (!(Number(chainStatus) === 2 || Number(chainStatus) === 3 || Number(chainStatus) === 4 || expired)) {
        fail("perpl_recovery_run_not_stopped", "Available AUSD recovery requires a stopped or expired run.");
      }
      if (!row.delegatedAccountAddress || !row.accountId) fail("perpl_recovery_account_missing", "Perpl delegated account is unavailable.");
      const delegatedAccount = new Contract(row.delegatedAccountAddress, PERPL_DA_ABI.concat(["function accountId() view returns (uint256)",
        "function exchange() view returns (address)", "function owner() view returns (address)"]), provider);
      const [delegatedOwner, exchange, accountId] = await Promise.all([delegatedAccount.owner(), delegatedAccount.exchange(), delegatedAccount.accountId()]);
      if (String(delegatedOwner).toLowerCase() !== row.vaultAddress.toLowerCase() || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE) {
        fail("perpl_delegated_owner_mismatch", "Perpl delegated account owner or exchange differs from this strategy vault.");
      }
      if (Number(accountId) !== row.accountId) fail("perpl_account_id_mismatch", "Perpl delegated account ID differs from this run.");
      const exchangeView = new Contract(PERPL_TESTNET_EXCHANGE, [
        "function getAccountById(uint256) view returns ((uint256 accountId,uint256 balanceCNS,uint256 lockedBalanceCNS,uint8 frozen,address accountAddr,(uint256 bank1,uint256 bank2,uint256 bank3,uint256 bank4) positions))",
        "function getOrderLocks(uint256) view returns ((uint32 orderLockId,uint32 nextOrderLockId,uint32 prevOrderLockId,uint8 orderType,uint40 lotLNS,uint80 amountCNS)[])",
      ], provider);
      const checkpoint = await finalizedBlockNumber(provider);
      const [state, locks] = await Promise.all([exchangeView.getAccountById(accountId, { blockTag: checkpoint }), exchangeView.getOrderLocks(accountId, { blockTag: checkpoint })]);
      const bitmap = [state.positions.bank1, state.positions.bank2, state.positions.bank3, state.positions.bank4].some((item: any) => BigInt(item) !== 0n);
      if (bitmap || locks.length || BigInt(state.lockedBalanceCNS) !== 0n) {
        await meraMutation(auth.token, "monadVenueRuns", "setRecoveryReason", { runId: row.runId, reason: "perpl_positions_or_orders_open" });
        fail("perpl_recovery_exposure_open", "Perpl still reports an open position, order or locked balance; settlement remains incomplete.");
      }
      if (String(state.accountAddr).toLowerCase() !== row.delegatedAccountAddress.toLowerCase()) fail("perpl_account_address_mismatch", "Perpl exchange account does not belong to the delegated account.");
      amount = BigInt(state.balanceCNS);
      callData = vault.interface.encodeFunctionData("recoverWithdrawCollateral", [amount]);
    }
    const ownerAusdBeforeUnits = String(await new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).balanceOf(auth.ownerAddress));
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, row.vaultAddress, callData, 0n, 1_000_000n);
    const expiresAt = Date.now() + 240_000;
    await meraMutation(auth.token, "monadVenueRuns", "prepareRecoveryRun", { runId: row.runId, action,
      idempotencyKey: body.idempotencyKey, transactionJson: JSON.stringify(built.transaction), expiresAt, ownerAusdBeforeUnits });
    return context.json({ runId: row.runId, venueId: row.venueId, action, ownerAddress: auth.ownerAddress,
      vaultAddress: row.vaultAddress, amountUnits: amount.toString(), recoveryTransaction: perplMobileTransaction(built.transaction),
      preparedExpiresAt: expiresAt }, 201);
  } finally { await provider.destroy(); }
}

async function ensureRecoveryVault(context: any, auth: any, row: any, provider: any): Promise<boolean> {
  const factory = new Contract(row.factoryAddress, PERPL_STRATEGY_FACTORY_ABI, provider);
  const predicted = String(await factory.predictVault(auth.ownerAddress));
  if (predicted.toLowerCase() !== row.vaultAddress.toLowerCase()) fail("perpl_vault_mismatch", "Recovery vault differs from the deterministic Perpl owner vault.");
  const registered = String(await factory.vaultFor(auth.ownerAddress));
  if (registered !== ZeroAddress && registered.toLowerCase() !== row.vaultAddress.toLowerCase()) fail("perpl_vault_mismatch", "Perpl factory has a different vault for this owner.");
  const refreshed: any = await meraQuery(auth.token, "monadVenueRuns", "getRunForOwner", { runId: row.runId });
  if (refreshed.vaultDeploymentTxHash) {
    const receipt = await provider.getTransactionReceipt(refreshed.vaultDeploymentTxHash);
    if (!receipt) {
      if (await provider.getTransaction(refreshed.vaultDeploymentTxHash)) return false;
      fail("perpl_vault_deployment_uncertain", "Vault creation response is uncertain; reconcile its saved transaction hash before retrying.");
    }
    if (receipt.status !== 1) {
      await meraMutation(auth.token, "monadVenueRuns", "recordVaultDeployment", { runId: row.runId,
        txHash: refreshed.vaultDeploymentTxHash, status: "failed" });
      fail("perpl_vault_deployment_failed", "Perpl vault creation failed; recovery can be prepared again after review.");
    }
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()
      || receipt.blockNumber > await finalizedBlockNumber(provider)) return false;
    await meraMutation(auth.token, "monadVenueRuns", "recordVaultDeployment", { runId: row.runId,
      txHash: refreshed.vaultDeploymentTxHash, status: "finalized" });
    return (await provider.getCode(row.vaultAddress)) !== "0x";
  }
  const wallet = (await operatorWallet()).connect(provider);
  if (wallet.address.toLowerCase() !== String(await factory.operator()).toLowerCase()) fail("perpl_operator_mismatch", "Local operator differs from the configured Perpl strategy operator.");
  const data = factory.interface.encodeFunctionData("createVault", [auth.ownerAddress]);
  const built = await buildEip1559Transaction(provider, wallet.address, row.factoryAddress, data, 0n, 10_000_000n);
  const signed = await wallet.signTransaction({ ...built.transaction, type: 2 } as any);
  const txHash = keccak256(signed);
  // Persist before sending so timeouts can only reconcile this exact hash.
  await meraMutation(auth.token, "monadVenueRuns", "recordVaultDeployment", { runId: row.runId, txHash, status: "pending" });
  try { await provider.broadcastTransaction(signed); } catch { /* uncertain: the persisted hash is reconciled on the next request */ }
  return false;
}

async function submit(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || typeof body.action !== "string" || typeof body.signedTransaction !== "string") {
    throw new MonadApiError("Owner-signed Perpl recovery transaction is required.", 400, "perpl_recovery_signature_missing");
  }
  const [row, prepared]: any[] = await Promise.all([meraQuery(auth.token, "monadVenueRuns", "getRunForOwner", { runId: body.runId }),
    meraQuery(auth.token, "monadVenueRuns", "getRecoveryPreparation", { runId: body.runId })]);
  if (!row || !prepared || prepared.action !== body.action) fail("perpl_recovery_not_prepared", "Perpl recovery review is missing or does not match the selected action.");
  const verified = verifyExactSignedTransaction(body.signedTransaction, prepared.transaction, auth.ownerAddress);
  const result = await meraMutation(auth.token, "monadVenueRuns", "queueRecovery", { runId: row.runId, action: prepared.action,
    rawTransaction: verified.canonicalRawTransaction, txHash: verified.transactionHash.toLowerCase() });
  return context.json({ runId: row.runId, venueId: row.venueId, action: prepared.action,
    status: result.status, phase: result.phase }, 202);
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); } catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}

export function registerPerplRecoveryRoutes(app: Hono<any>) {
  app.post("/api/mobile/perp/recovery/prepare", (c) => guard(c, prepare));
  app.post("/api/mobile/perp/recovery", (c) => guard(c, submit));
}
