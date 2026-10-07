import { Contract, ZeroAddress } from "ethers";
import { assertMonadPerplAutonomyEnabled, MonadApiError } from "./config.js";
import { PERPL_CHAIN_ID, PERPL_DIRECT_VENUE_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE, perplDirectExecutionEnabled } from "./perplConfig.js";
import { checkPerplOriginWhitelist } from "./perplOriginPreflight.js";
import { buildOperatorConsent, openPerplStrategy, PERPL_DA_ABI, PERPL_STRATEGY_VAULT_ABI } from "./perplContracts.js";
import { verifyPerplRunMandate } from "./perplMandateVerification.js";
import { enrollPerplRunKey } from "./perplKeyEnrollment.js";
import { getPerplSecret } from "./perplSecrets.js";
import { readPerplVenueAccount, readPerplVenueContext } from "./perplVenueOperations.js";
import { assertMonadBroadcastEnabled } from "./config.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { verifyExactSignedTransaction } from "./transactions.js";
import { AUSD_ABI } from "./perplContracts.js";
import { operatorWallet } from "./vaultTrades.js";
import { event, receiptState, signedOperatorTransaction, type TickResult, waitResult } from "./perplWorkerHelpers.js";
import { readDirectAccount } from "./perplDirectState.js";

const delay = 3_000;
export async function runPerplEnrollmentTick(provider: any, row: any): Promise<TickResult> {
  const deployment = await openPerplStrategy(provider);
  if (row.chainId !== PERPL_CHAIN_ID || row.factoryAddress.toLowerCase() !== deployment.address.toLowerCase()) {
    throw new MonadApiError("Stored Perpl enrollment points at a different chain or factory.", 409, "perpl_factory_changed");
  }
  const direct = row.venueId === PERPL_DIRECT_VENUE_ID;
  if (!direct) { const origin = await checkPerplOriginWhitelist(deployment.operator.address);
    if (!origin.ready) return waitResult("activation_pending", origin.reasonCode ?? "perpl_origin_not_whitelisted",
      { recoveryReason: origin.reasonCode ?? "perpl_origin_not_whitelisted" }, 60_000); }
  assertMonadPerplAutonomyEnabled(true);
  if (direct && !perplDirectExecutionEnabled()) return waitResult("activation_pending", "perpl_direct_execution_disabled", {}, 60_000);
  const mandate = await verifyPerplRunMandate(provider, row, deployment);
  const expected = JSON.parse(row.fundingTransactionJson);
  const verified = verifyExactSignedTransaction(row.fundingRawTransaction, expected, row.ownerAddress);
  if (verified.transactionHash.toLowerCase() !== row.fundingTxHash?.toLowerCase()) throw new MonadApiError("Stored owner funding transaction hash differs from its bytes.", 409, "perpl_funding_hash_mismatch");
  const transfer = new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).interface.parseTransaction({ data: expected.data });
  if (expected.to.toLowerCase() !== PERPL_TESTNET_AUSD || transfer?.name !== "transfer"
    || String(transfer.args[0]).toLowerCase() !== row.vaultAddress.toLowerCase()
    || String(transfer.args[1]) !== row.amountUnits) throw new MonadApiError("Stored owner funding transaction differs from the signed Perpl mandate.", 409, "perpl_funding_terms_mismatch");
  const funding = await receiptState(provider, row.fundingTxHash, verified.canonicalRawTransaction);
  if (funding.state === "pending") return waitResult("activation_pending", "funding_finality_pending", { fundingStatus: "submitted" }, delay);
  if (funding.state === "failed") return { status: "incomplete_settlement", phase: "funding_failed",
    patch: { fundingStatus: "failed", recoveryReason: "perpl_funding_transaction_failed" },
    event: event("funding_failed", "perpl_funding_failed", "failed", "Perpl AUSD funding did not finalize", null, row.fundingTxHash),
    continueAfter: false, nextDelayMs: delay };
  if (!row.activationRawTransaction) {
    const finalized = await finalizedBlockNumber(provider);
    const vaultBalance = BigInt(await new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).balanceOf(row.vaultAddress, { blockTag: finalized }));
    if (vaultBalance < BigInt(row.amountUnits)) throw new MonadApiError("Finalized Perpl vault AUSD balance is below the signed funding amount.", 409, "perpl_funding_balance_mismatch");
  }
  if (!row.activationRawTransaction && Number(row.setupDeadline) <= Math.floor(Date.now() / 1000)) {
    return { status: "incomplete_settlement", phase: "activation_authorization_expired",
      patch: { fundingStatus: "finalized", recoveryReason: "perpl_activation_authorization_expired" },
      event: event("activation_expired", "perpl_activation_blocked", "blocked",
        "Perpl setup authorization expired after AUSD funding; owner vault funding recovery is available",
        { vaultAddress: row.vaultAddress }, row.fundingTxHash), continueAfter: false, nextDelayMs: delay };
  }
  if (!row.activationRawTransaction) {
    const [nonce, currentVault, account] = await Promise.all([deployment.factory.mandateNonce(row.ownerAddress),
      deployment.factory.vaultFor(row.ownerAddress), deployment.factory.delegatedAccount(row.ownerAddress)]);
    if (String(nonce) !== String(row.nonce) || String(currentVault).toLowerCase() !== ZeroAddress.toLowerCase() && String(currentVault).toLowerCase() !== row.vaultAddress.toLowerCase()) {
      throw new MonadApiError("Perpl vault or mandate nonce changed since Mera review.", 409, "perpl_mandate_nonce_changed");
    }
    const existing = String(account).toLowerCase() === ZeroAddress.toLowerCase() ? undefined : String(account);
    if ((row.delegatedAccountAddress ?? undefined)?.toLowerCase() !== existing?.toLowerCase()) {
      throw new MonadApiError("Perpl delegated account changed since Mera review.", 409, "perpl_account_changed");
    }
    const consent = await buildOperatorConsent(deployment.factory, row.vaultAddress, existing);
    const data = deployment.factory.interface.encodeFunctionData("activateRun", [mandate.typed.message,
      row.mandateSignature, consent.deadline, consent.signature]);
    const signed = await signedOperatorTransaction(provider, deployment.address, data, 10_000_000n);
    return waitResult("activation_pending", "activation_transaction_prepared", { activationRawTransaction: signed.raw,
      activationTxHash: signed.hash, activationStatus: "signed", operatorSignature: consent.signature,
      operatorDeadline: consent.deadline }, delay);
  }
  const activationHash = String(row.activationTxHash ?? "").toLowerCase();
  if (!activationHash) throw new MonadApiError("Perpl activation transaction hash is missing.", 409, "perpl_activation_hash_missing");
  const activation = await receiptState(provider, activationHash, row.activationRawTransaction);
  if (activation.state === "pending") return waitResult("activation_pending", "activation_finality_pending", { activationStatus: "submitted" }, delay);
  if (activation.state === "failed") return { status: "incomplete_settlement", phase: "activation_failed",
    patch: { activationStatus: "failed", recoveryReason: "perpl_activation_transaction_failed" },
    event: event("activation_failed", "perpl_activation_failed", "failed", "Perpl delegated account activation did not finalize", null, activationHash),
    continueAfter: false, nextDelayMs: delay };
  await requireContractCode(provider, row.vaultAddress, "Perpl strategy vault");
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const daAddress = String(await vault.delegatedAccount());
  if (daAddress.toLowerCase() === ZeroAddress.toLowerCase()) throw new MonadApiError("Perpl vault activation finalized without a delegated account.", 503, "perpl_account_setup_failed");
  const da = new Contract(daAddress, [...PERPL_DA_ABI, "function owner() view returns(address)", "function exchange() view returns(address)",
    "function accountId() view returns(uint256)"], provider);
  const [daOwner, exchange, accountIdRaw, expiresAt, runStatus] = await Promise.all([da.owner(), da.exchange(), da.accountId(), vault.expiresAt(), vault.runStatus()]);
  const accountId = Number(accountIdRaw);
  if (String(daOwner).toLowerCase() !== row.vaultAddress.toLowerCase() || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE
    || !Number.isSafeInteger(accountId) || accountId <= 0 || Number(runStatus) !== 1) {
    throw new MonadApiError("Finalized Perpl delegated account does not match the activated vault.", 503, "perpl_account_setup_failed");
  }
  if (direct) {
    const account = await readDirectAccount(provider, accountId, JSON.parse(row.marketIdsJson), daAddress);
    return { status: "active", phase: "perpl_direct_account_ready", patch: { delegatedAccountAddress: daAddress,
      accountId, instanceId: deployment.live.instanceId, expiresAt: Number(expiresAt) * 1000,
      activatedAt: Date.now(), fundingStatus: "finalized", activationStatus: "finalized",
      balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits, lastRequestId: 0,
      lastAccountBlock: account.blockNumber, lastObservedAt: account.observedAt,
      positionsJson: JSON.stringify(account.positions), ordersJson: JSON.stringify(account.orders) },
      event: event("activated", "perpl_direct_run_activated", "active",
        "Perpl delegated account is funded; direct onchain trading is active without API forwarding or an API key",
        { accountId, delegatedAccountAddress: daAddress }, activationHash), continueAfter: true, nextDelayMs: delay };
  }
  const key = await getPerplSecret(row.runId);
  if (key && key.status !== "active") return { status: "incomplete_settlement", phase: "api_key_enrollment_uncertain",
    patch: { delegatedAccountAddress: daAddress, accountId, recoveryReason: "perpl_key_enrollment_uncertain" },
    event: event("key_uncertain", "perpl_key_enrollment_uncertain", "blocked", "Perpl API-key enrollment needs owner recovery"),
    continueAfter: false, nextDelayMs: delay };
  if (!key) {
    const secondCheck = await checkPerplOriginWhitelist(deployment.operator.address);
    if (!secondCheck.ready) return { status: "incomplete_settlement", phase: "key_enrollment_blocked",
      patch: { delegatedAccountAddress: daAddress, accountId, recoveryReason: secondCheck.reasonCode ?? "perpl_origin_not_whitelisted" },
      event: event("key_blocked", "perpl_key_enrollment_blocked", "blocked", secondCheck.message ?? "Perpl key enrollment is blocked by Origin allowlisting"),
      continueAfter: false, nextDelayMs: delay };
    try { await enrollPerplRunKey({ runId: row.runId, ownerAddress: row.ownerAddress,
      operatorPrivateKey: (await operatorWallet()).privateKey, delegatedAccount: daAddress, expiresAt: Number(expiresAt) + 300,
      validateOperator: async (operator) => await da.isOperator(operator) }); }
    catch (error) {
      const code = (error as any)?.code ?? "perpl_key_enrollment_failed";
      return { status: "incomplete_settlement", phase: "key_enrollment_blocked",
        patch: { delegatedAccountAddress: daAddress, accountId, recoveryReason: String(code) },
        event: event("key_failed", "perpl_key_enrollment_blocked", "blocked", error instanceof Error ? error.message : "Perpl key enrollment failed", { code }),
        continueAfter: false, nextDelayMs: delay };
    }
  }
  const activeKey = await getPerplSecret(row.runId);
  if (!activeKey || activeKey.status !== "active") throw new MonadApiError("Perpl API key is not active after enrollment.", 503, "perpl_key_enrollment_incomplete");
  const credentials = { apiKey: activeKey.apiKey,
    privateKeyHex: activeKey.privateKeyHex, walletAddress: deployment.operator.address };
  const [account, context] = await Promise.all([readPerplVenueAccount(accountId, credentials), readPerplVenueContext()]);
  return { status: "active", phase: "perpl_account_ready", patch: { delegatedAccountAddress: daAddress,
    accountId, instanceId: context.instanceId, expiresAt: Number(expiresAt) * 1000,
    activatedAt: Date.now(), keyExpiresAt: activeKey.expiresAt, fundingStatus: "finalized", activationStatus: "finalized",
    balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits, lastRequestId: account.lastRequestId,
    lastAccountBlock: account.blockNumber, lastObservedAt: account.observedAt, positionsJson: JSON.stringify(account.positions),
    ordersJson: JSON.stringify(account.orders) }, event: event("activated", "perpl_run_activated", "active",
      "Perpl delegated account is funded, forwarding is enabled, and the trade-only key is active", { accountId, delegatedAccountAddress: daAddress }, activationHash),
    continueAfter: true, nextDelayMs: delay };
}
