import { Contract, Interface, keccak256, toUtf8Bytes } from "ethers";
import { assertMonadBroadcastEnabled, MonadApiError } from "./config.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import { AUSD_ABI, PERPL_DA_ABI, PERPL_STRATEGY_VAULT_ABI } from "./perplContracts.js";
import { finalizedBlockNumber, monadProvider } from "./provider.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { verifyExactSignedTransaction } from "./transactions.js";
import { removePerplSecret } from "./perplSecrets.js";
import { event, receiptState, signedOperatorTransaction, type TickResult, waitResult } from "./perplWorkerHelpers.js";
import { operatorWallet } from "./vaultTrades.js";
import { readPerplVenueAccount } from "./perplVenueOperations.js";

const exchangeAbi = [
  "function getAccountById(uint256) view returns ((uint256 accountId,uint256 balanceCNS,uint256 lockedBalanceCNS,uint8 frozen,address accountAddr,(uint256 bank1,uint256 bank2,uint256 bank3,uint256 bank4) positions))",
  "function getOrderLocks(uint256) view returns ((uint32 orderLockId,uint32 nextOrderLockId,uint32 prevOrderLockId,uint8 orderType,uint40 lotLNS,uint80 amountCNS)[])",
];
export async function finalizedPerplAccount(provider: any, accountId: number, daAddress: string) {
  const blockNumber = await finalizedBlockNumber(provider); const exchange = new Contract(PERPL_TESTNET_EXCHANGE, exchangeAbi, provider);
  const [state, locks] = await Promise.all([exchange.getAccountById(accountId, { blockTag: blockNumber }), exchange.getOrderLocks(accountId, { blockTag: blockNumber })]);
  const positions = [state.positions.bank1, state.positions.bank2, state.positions.bank3, state.positions.bank4].some((value: any) => BigInt(value) !== 0n);
  if (String(state.accountAddr).toLowerCase() !== daAddress.toLowerCase()) throw new MonadApiError("Finalized Perpl account belongs to a different delegated account.", 409, "perpl_account_address_mismatch");
  return { blockNumber, balance: BigInt(state.balanceCNS), locked: BigInt(state.lockedBalanceCNS), positions, locks: locks.length,
    stateHash: perplSettlementStateHash(accountId, daAddress, blockNumber, state, locks) };
}

export function perplSettlementStateHash(accountId: number, daAddress: string, blockNumber: number, state: any, locks: any[]) {
  const positions = Object.fromEntries(["bank1", "bank2", "bank3", "bank4"].map((key) => [key, String(state.positions[key])]));
  const normalizedLocks = locks.map((lock) => Object.fromEntries(Object.entries(lock).map(([key, value]) => [key, String(value)])));
  return keccak256(toUtf8Bytes(JSON.stringify({ accountId, daAddress: daAddress.toLowerCase(), blockNumber,
    balance: String(state.balanceCNS), locked: String(state.lockedBalanceCNS), positions, locks: normalizedLocks })));
}

export async function runPerplRecoveryTick(provider: any, row: any): Promise<TickResult | null> {
  if (!row.recoveryRawTransaction || !row.recoveryTxHash || !row.recoveryAction) return null;
  const expected = JSON.parse(row.recoveryTransactionJson);
  const verified = verifyExactSignedTransaction(row.recoveryRawTransaction, expected, row.ownerAddress);
  if (verified.transactionHash.toLowerCase() !== row.recoveryTxHash.toLowerCase()) throw new MonadApiError("Perpl recovery hash differs from the signed owner transaction.", 409, "perpl_recovery_hash_mismatch");
  if (!await provider.getTransactionReceipt(row.recoveryTxHash) && !await provider.getTransaction(row.recoveryTxHash)) {
    await validateRecoveryIntent(provider, row, expected);
  }
  const receipt = await receiptState(provider, row.recoveryTxHash, verified.canonicalRawTransaction);
  if (receipt.state === "pending") return waitResult("incomplete_settlement", "recovery_finality_pending", { recoveryReason: "perpl_recovery_finality_pending" });
  if (receipt.state === "failed") return { status: "incomplete_settlement", phase: "recovery_failed",
    patch: { recoveryReason: "perpl_recovery_transaction_failed" },
    event: event(`recovery_failed:${row.recoveryTxHash}`, "perpl_recovery_failed", "failed", "Owner recovery transaction did not finalize", null, row.recoveryTxHash),
    continueAfter: false, nextDelayMs: 5_000 };
  const [ownerAfter, vault, token] = await Promise.all([new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).balanceOf(row.ownerAddress),
    Promise.resolve(new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider)),
    Promise.resolve(new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider))]);
  const [vaultBalance, daAddress, status] = await Promise.all([token.balanceOf(row.vaultAddress), vault.delegatedAccount(), vault.runStatus()]);
  if (BigInt(vaultBalance) !== 0n) throw new MonadApiError("Perpl recovery finalized but AUSD remains in the strategy vault.", 503, "perpl_recovery_incomplete");
  let forwardingEnabled = false; let operatorEnabled = false;
  if (String(daAddress).toLowerCase() !== "0x0000000000000000000000000000000000000000") {
    const da = new Contract(daAddress, [...PERPL_DA_ABI, "function accountId() view returns(uint256)"], provider);
    operatorEnabled = Boolean(await da.isOperator((await operatorWallet()).address));
    const accountId = Number(await da.accountId());
    if (accountId > 0) {
      const secret = await import("./perplSecrets.js").then((module) => module.getPerplSecret(row.runId));
      if (secret?.status === "active") forwardingEnabled = (await readPerplVenueAccount(accountId, {
        apiKey: secret.apiKey, privateKeyHex: secret.privateKeyHex, walletAddress: (await operatorWallet()).address })).forwardingEnabled;
    }
  }
  if (operatorEnabled || forwardingEnabled) throw new MonadApiError("Perpl recovery returned funds but left trading permission active.", 503, "perpl_operator_still_enabled");
  const before = BigInt(row.ownerAusdBeforeUnits ?? "0"); const delta = BigInt(ownerAfter) - before;
  const amount = delta > 0n ? delta : 0n;
  await removePerplSecret(row.runId);
  return { status: "completed", phase: "recovery_finalized", patch: { returnedUnits: amount.toString(), balanceUnits: "0",
    equityUnits: "0", settlementJson: JSON.stringify({ action: row.recoveryAction, txHash: row.recoveryTxHash,
      ownerBalanceAfterUnits: String(ownerAfter), onchainStatus: Number(status) }), recoveryReason: undefined },
    event: event(`recovery_finalized:${row.recoveryTxHash}`, "perpl_recovery_finalized", "completed",
      "Perpl owner recovery finalized and trading permission is disabled", { action: row.recoveryAction, returnedUnits: amount.toString() }, row.recoveryTxHash),
    continueAfter: false, nextDelayMs: 5_000 };
}

async function validateRecoveryIntent(provider: any, row: any, expected: any) {
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  if (String(expected.to).toLowerCase() !== row.vaultAddress.toLowerCase() || BigInt(expected.value ?? "0") !== 0n) {
    throw new MonadApiError("Perpl recovery transaction targets an unreviewed contract or value.", 409, "perpl_recovery_call_invalid");
  }
  if (row.recoveryAction === "recover_vault_funding") {
    const data = vault.interface.encodeFunctionData("recoverVaultFunding");
    const [status, amount] = await Promise.all([vault.runStatus(), vault.vaultAUSD()]);
    if (String(expected.data).toLowerCase() !== data.toLowerCase() || ![0, 4].includes(Number(status)) || BigInt(amount) <= 0n) {
      throw new MonadApiError("Perpl vault funding recovery does not match an idle prefunded vault.", 409, "perpl_recovery_call_invalid");
    }
    return;
  }
  if (row.recoveryAction !== "recover_available_ausd") throw new MonadApiError("Perpl recovery action is unsupported.", 400, "perpl_recovery_action_invalid");
  const decoded = vault.interface.parseTransaction({ data: expected.data });
  if (decoded?.name !== "recoverWithdrawCollateral" || decoded.args.length !== 1) {
    throw new MonadApiError("Perpl collateral recovery call is not the owner-only vault method.", 409, "perpl_recovery_call_invalid");
  }
  const [status, expired, daAddress] = await Promise.all([vault.runStatus(), vault.isExpired(), vault.delegatedAccount()]);
  if (!(Number(status) === 2 || Number(status) === 3 || Number(status) === 4 || expired)
    || !row.accountId || String(daAddress).toLowerCase() !== String(row.delegatedAccountAddress).toLowerCase()) {
    throw new MonadApiError("Perpl account is not stopped or does not match this run.", 409, "perpl_recovery_state_invalid");
  }
  const state = await finalizedPerplAccount(provider, row.accountId, daAddress);
  if (state.positions || state.locks || state.locked !== 0n || BigInt(decoded.args[0]) !== state.balance) {
    throw new MonadApiError("Perpl recovery amount differs from the finalized flat account balance.", 409, "perpl_recovery_balance_changed");
  }
}

export async function prepareSettlementTx(provider: any, row: any, phase: "ready" | "complete", data: string): Promise<TickResult> {
  assertMonadBroadcastEnabled(true);
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const signed = await signedOperatorTransaction(provider, row.vaultAddress, data);
  const fields = phase === "ready" ? { settlementReadyRawTransaction: signed.raw, settlementReadyTxHash: signed.hash, settlementReadyStatus: "signed" }
    : { settlementCompleteRawTransaction: signed.raw, settlementCompleteTxHash: signed.hash, settlementCompleteStatus: "signed" };
  return waitResult("settling", phase === "ready" ? "settlement_ready_prepared" : "settlement_complete_prepared", fields, 3_000);
}

export async function submitSettlementReady(provider: any, row: any): Promise<TickResult> {
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const tx = await receiptState(provider, row.settlementReadyTxHash, row.settlementReadyRawTransaction);
  if (tx.state === "pending") return waitResult("settling", "settlement_ready_finality_pending", { settlementReadyStatus: "submitted" });
  if (tx.state === "failed") return incomplete("settlement_ready_failed", "perpl_settlement_ready_failed", row.settlementReadyTxHash);
  const status = Number(await vault.runStatus());
  if (status !== 3) throw new MonadApiError("Perpl vault did not reach SettlementReady after its finalized transaction.", 503, "perpl_settlement_ready_mismatch");
  const amount = BigInt(await vault.settlementBalanceCNS());
  const data = vault.interface.encodeFunctionData("completeSettlement", [amount]);
  return await prepareSettlementTx(provider, row, "complete", data);
}

export async function submitSettlementComplete(provider: any, row: any): Promise<TickResult> {
  const tx = await receiptState(provider, row.settlementCompleteTxHash, row.settlementCompleteRawTransaction);
  if (tx.state === "pending") return waitResult("settling", "settlement_complete_finality_pending", { settlementCompleteStatus: "submitted" });
  if (tx.state === "failed") return incomplete("settlement_complete_failed", "perpl_settlement_withdrawal_failed", row.settlementCompleteTxHash);
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const [status, ownerBalance, daAddress] = await Promise.all([vault.runStatus(), new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).balanceOf(row.ownerAddress), vault.delegatedAccount()]);
  if (Number(status) !== 4) throw new MonadApiError("Perpl settlement transaction finalized but the vault is not Settled.", 503, "perpl_settlement_incomplete");
  const da = new Contract(daAddress, [...PERPL_DA_ABI, "function accountId() view returns(uint256)"], provider);
  const [operator] = await Promise.all([(await operatorWallet()).address]);
  if (await da.isOperator(operator)) throw new MonadApiError("Perpl settlement left the operator enabled.", 503, "perpl_operator_still_enabled");
  const receipt: any = tx.receipt; const iface = new Interface(["event SettlementCompleted(address indexed owner,uint256 indexed nonce,uint256 returnedAUSD)"]);
  let returnedUnits = "0";
  for (const log of receipt?.logs ?? []) { try { const parsed = iface.parseLog(log); if (parsed?.name === "SettlementCompleted") returnedUnits = String(parsed.args.returnedAUSD); } catch { /* unrelated contract log */ } }
  if (BigInt(returnedUnits) > 0n && BigInt(ownerBalance) <= BigInt(row.ownerAusdBeforeUnits ?? "0")) {
    throw new MonadApiError("Perpl settlement receipt reports AUSD return but owner balance did not increase.", 503, "perpl_owner_balance_mismatch");
  }
  await removePerplSecret(row.runId);
  return { status: "completed", phase: "settlement_finalized", patch: { settlementCompleteStatus: "finalized",
    returnedUnits, balanceUnits: "0", equityUnits: returnedUnits, feesUnits: row.feesUnits ?? "0",
    settlementJson: JSON.stringify({ returnedUnits, txHash: row.settlementCompleteTxHash,
      ownerBalanceAfterUnits: String(ownerBalance), finalizedBlock: receipt?.blockNumber }) },
    event: event("settlement_finalized", "perpl_settlement_finalized", "completed",
      "Perpl exposure is flat, forwarding is disabled, and returned AUSD is finalized", { returnedUnits }, row.settlementCompleteTxHash),
    continueAfter: false, nextDelayMs: 5_000 };
}

export async function settleFlatPerplRun(provider: any, row: any) {
  const state = await finalizedPerplAccount(provider, row.accountId, row.delegatedAccountAddress);
  if (state.positions || state.locks || state.locked !== 0n) return { ready: false, state };
  if (!row.settlementReadyRawTransaction) {
    const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
    return { ready: false, state, result: await prepareSettlementTx(provider, row, "ready",
      vault.interface.encodeFunctionData("markSettlementReady", [state.stateHash])) };
  }
  const runStatus = Number(await new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider).runStatus());
  if (runStatus < 3) return { ready: false, state, result: await submitSettlementReady(provider, row) };
  if (!row.settlementCompleteRawTransaction) {
    const result = await submitSettlementReady(provider, row);
    return { ready: false, state, result };
  }
  return { ready: false, state, result: await submitSettlementComplete(provider, row) };
}

function incomplete(phase: string, reason: string, txHash: string) {
  return { status: "incomplete_settlement", phase, patch: { recoveryReason: reason },
    event: event(phase, "perpl_settlement_incomplete", "blocked", "Perpl settlement is incomplete; owner recovery remains available", { reason }, txHash),
    continueAfter: false, nextDelayMs: 5_000 } as TickResult;
}
