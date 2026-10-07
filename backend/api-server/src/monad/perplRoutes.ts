import { Contract, ZeroAddress, getAddress } from "ethers";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { meraMutation, meraQuery } from "./convex.js";
import { parseBody, requireMera, routeError } from "./auth.js";
import { assertMonadPerplAutonomyEnabled, configuredPerplStrategyFactory, MonadApiError } from "./config.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { monadProvider, requireContractCode } from "./provider.js";
import { preparePerplVenueEnrollment, readPerplVenueContext, readPerplVenueMarkets } from "./perplVenueOperations.js";
import { PERPL_CHAIN_ID, PERPL_DIRECT_VENUE_ID, PERPL_TESTNET_AUSD, PERPL_VENUE_ID, PerplApiError, perplDirectExecutionEnabled, perplExecutionEnabled, perplFundingBounds, perplMaxSlippageBps } from "./perplConfig.js";
import { checkPerplOriginWhitelist } from "./perplOriginPreflight.js";
import { AUSD_ABI, PERPL_DA_ABI, PERPL_STRATEGY_VAULT_ABI, PERPL_STRATEGY_FACTORY_ABI,
  buildAusdFundingTransaction, buildOperatorConsent, buildPerplMandate, openPerplStrategy, perplMandateHash } from "./perplContracts.js";
import { operatorWallet } from "./vaultTrades.js";
import { perplMobileTransaction } from "./perplMobileTransaction.js";

const activeStatuses = ["prepared", "activation_pending", "active", "stopping", "settling", "uncertain", "incomplete_settlement"];
function validKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value); }
function apiError(error: unknown): never {
  if (error instanceof PerplApiError) throw new MonadApiError(error.message, error.status, error.code);
  throw error;
}

async function originCheck() {
  try { const operator = await operatorWallet(); return await checkPerplOriginWhitelist(operator.address); }
  catch (error) { return { ready: false, reasonCode: "perpl_origin_preflight_unavailable",
    message: error instanceof Error ? error.message : "Perpl Origin could not be checked.", checkedAt: Date.now() }; }
}

async function venues(context: any) {
  let live: any; let markets: any[] = [];
  try { live = await readPerplVenueContext(); markets = await readPerplVenueMarkets(); }
  catch (error) {
    const code = error instanceof PerplApiError ? error.code : "perpl_context_unavailable";
    return context.json({ venues: [PERPL_DIRECT_VENUE_ID, PERPL_VENUE_ID].map((venueId) => ({ venueId,
      displayName: venueId === PERPL_DIRECT_VENUE_ID ? "Perpl Testnet · Direct" : "Perpl Testnet · API", chainId: PERPL_CHAIN_ID,
      executionModel: venueId === PERPL_DIRECT_VENUE_ID ? "onchain_exchange" : "offchain_exchange",
      enabled: false, status: "unavailable", reason: code, capabilities: [] })) });
  }
  const origin = await originCheck();
  const factoryConfigured = Boolean(configuredPerplStrategyFactory());
  const enabled = origin.ready && factoryConfigured && perplExecutionEnabled();
  const reason = !origin.ready ? origin.reasonCode : !factoryConfigured ? "perpl_factory_unconfigured"
    : !perplExecutionEnabled() ? "perpl_autonomy_disabled" : null;
  const apiVenue = { venueId: PERPL_VENUE_ID, displayName: "Perpl Testnet · API", chainId: live.chainId,
    executionModel: "offchain_exchange", enabled, status: enabled ? "ready" : "blocked", reason,
    reasonMessage: !origin.ready ? origin.message : reason === "perpl_autonomy_disabled" ? "Perpl execution is disabled by the local Testnet gate."
      : reason === "perpl_factory_unconfigured" ? "Perpl strategy vault factory is not configured." : null,
    capabilities: ["market_data", "order_book", "account_read", "history", "market_orders", "limit_orders", "linked_exits", "margin_changes"],
    collateral: { symbol: "AUSD", address: live.limits.collateralAddress, decimals: live.limits.collateralDecimals,
      minAccountOpenUnits: live.limits.minAccountOpenUnits, minFundingUnits: live.limits.minFundingUnits },
      limits: { ...live.limits, backendMaxMarketSlippageBps: perplMaxSlippageBps() }, markets };
  const directEnabled = factoryConfigured && perplDirectExecutionEnabled();
  const directReason = !factoryConfigured ? "perpl_factory_unconfigured" : !directEnabled ? "perpl_direct_execution_disabled" : null;
  return context.json({ venues: [{ ...apiVenue, venueId: PERPL_DIRECT_VENUE_ID,
    displayName: "Perpl Testnet · Direct", executionModel: "onchain_exchange", enabled: directEnabled,
    capabilities: ["market_data", "order_book", "account_read", "history", "market_orders", "limit_orders", "owner_withdrawal"],
    status: directEnabled ? "ready" : "blocked", reason: directReason,
    reasonMessage: directReason === "perpl_direct_execution_disabled" ? "Direct Perpl execution is disabled by the local Testnet gate." :
      directReason === "perpl_factory_unconfigured" ? "Perpl strategy vault factory is not configured." : null }, apiVenue] });
}

async function prepare(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  const allowed = new Set(["venueId", "chainId", "amountUnits", "durationSeconds", "idempotencyKey"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new MonadApiError("Market and exposure limits are set by the signed server policy.", 400, "perpl_policy_client_widening");
  const direct = body.venueId === PERPL_DIRECT_VENUE_ID;
  if (![PERPL_DIRECT_VENUE_ID, PERPL_VENUE_ID].includes(body.venueId) || body.chainId !== PERPL_CHAIN_ID || !/^\d+$/.test(String(body.amountUnits))
    || !Number.isSafeInteger(body.durationSeconds) || !validKey(body.idempotencyKey)) throw new MonadApiError("Choose Perpl Testnet, a valid AUSD amount, duration and idempotency key.", 400, "perpl_terms_invalid");
  if (!direct) { const origin = await originCheck();
    if (!origin.ready) throw new MonadApiError(origin.message ?? "Perpl Origin is not whitelisted.", 503, origin.reasonCode ?? "perpl_origin_preflight_unavailable"); }
  assertMonadPerplAutonomyEnabled(false);
  if (direct && !perplDirectExecutionEnabled()) throw new MonadApiError("Direct Perpl execution is disabled.", 503, "perpl_direct_execution_disabled");
  let provider: any;
  try {
    provider = await monadProvider();
    const deployment = await openPerplStrategy(provider); const { factory, operator, live } = deployment;
    if (!await factory.enrollmentEnabled()) throw new MonadApiError("Perpl strategy factory enrollment is disabled onchain.", 503, "perpl_factory_disabled");
    const bounds = perplFundingBounds(); const amount = BigInt(body.amountUnits);
    if (amount > bounds.maxUnits) throw new MonadApiError("AUSD amount is outside Perpl's live and server policy bounds.", 400, "perpl_funding_limits");
    if (body.durationSeconds < live.limits.minDurationSeconds || body.durationSeconds > live.limits.maxDurationSeconds) {
      throw new MonadApiError("Perpl run duration is outside the allowed policy range.", 400, "perpl_duration_limits");
    }
    const vaultAddress = getAddress(await factory.predictVault(auth.ownerAddress));
    const [currentVault, nonce, accountAddress, runStatus] = await Promise.all([factory.vaultFor(auth.ownerAddress),
      factory.mandateNonce(auth.ownerAddress), factory.delegatedAccount(auth.ownerAddress), factory.runStatus(auth.ownerAddress)]);
    if (String(currentVault).toLowerCase() !== ZeroAddress.toLowerCase() && String(currentVault).toLowerCase() !== vaultAddress.toLowerCase()) {
      throw new MonadApiError("Perpl owner vault differs from the deterministic address.", 503, "perpl_vault_mismatch");
    }
    if (![0, 4].includes(Number(runStatus))) throw new MonadApiError("This Mera owner already has an active or unsettled Perpl run.", 409, "perpl_run_active");
    const delegatedAccountAddress = String(accountAddress).toLowerCase() === ZeroAddress.toLowerCase() ? null : getAddress(accountAddress);
    let accountId = 0;
    if (delegatedAccountAddress) {
      await requireContractCode(provider, delegatedAccountAddress, "Perpl delegated account");
      accountId = Number(await new Contract(delegatedAccountAddress, [...PERPL_DA_ABI, "function accountId() view returns (uint256)"], provider).accountId());
    }
    const minFunding = BigInt(accountId > 0 ? live.limits.minDepositUnits : live.limits.minAccountOpenUnits);
    if (amount < minFunding) throw new MonadApiError(`Perpl requires at least ${accountId > 0 ? "the live deposit minimum" : "the live account-opening minimum"} AUSD.`, 400, "perpl_funding_below_minimum");
    const maxLeverage = Math.min(3, live.limits.maxLeverage); const maxPositionExposure = amount * BigInt(maxLeverage);
    const marketIds = live.markets.filter((market: any) => market.isOpen).slice(0, 16).map((market: any) => market.id);
    if (!marketIds.length) throw new MonadApiError("Perpl has no currently open markets for enrollment.", 503, "perpl_markets_unavailable");
    const enrollmentReview = await preparePerplVenueEnrollment({ ownerAddress: auth.ownerAddress,
      terms: { amountUnits: amount.toString(), durationSeconds: body.durationSeconds, marketIds } });
    const now = Math.floor(Date.now() / 1000); const setupDeadline = now + 240;
    const mandateTypedData = buildPerplMandate({ owner: auth.ownerAddress, vault: vaultAddress, operator: operator.address,
      transport: direct ? 1 : 2,
      amountUnits: amount.toString(), maxExposureUnits: maxPositionExposure.toString(), maxLeverage,
      durationSeconds: body.durationSeconds, deadline: setupDeadline, nonce: String(nonce), marketIds });
    const typedHash = perplMandateHash(mandateTypedData);
    const contractHash = String(await factory.mandateDigest(mandateTypedData.message)).toLowerCase();
    if (typedHash !== contractHash) throw new MonadApiError("Perpl mandate digest differs from the deployed factory verifier.", 503, "perpl_mandate_digest_mismatch");
    const operatorConsent = await buildOperatorConsent(factory, vaultAddress, delegatedAccountAddress ?? undefined);
    const funding = await buildAusdFundingTransaction(auth.ownerAddress, vaultAddress, amount);
    const runId = randomUUID(); const preparedExpiresAt = Date.now() + 240_000;
    const saved: any = await meraMutation(auth.token, "monadVenueRuns", "prepareRun", {
      runId, venueId: body.venueId, chainId: PERPL_CHAIN_ID, ownerAddress: auth.ownerAddress.toLowerCase(),
      factoryAddress: deployment.address, vaultAddress, nonce: String(nonce), idempotencyKey: body.idempotencyKey,
      amountUnits: amount.toString(), minFundingUnits: minFunding.toString(), durationSeconds: body.durationSeconds, setupDeadline, preparedExpiresAt,
      maxPositionExposureUnits: maxPositionExposure.toString(), maxLeverage, marketIdsJson: JSON.stringify(marketIds),
      marketsJson: JSON.stringify(live.markets), mandateJson: JSON.stringify(mandateTypedData.message),
      mandateTypedDataJson: JSON.stringify(mandateTypedData), mandateHash: typedHash,
      operatorSignature: operatorConsent.signature, operatorDeadline: operatorConsent.deadline,
      fundingTransactionJson: JSON.stringify(funding.transaction), ownerAusdBeforeUnits: funding.balanceBeforeUnits, policyVersion: 2,
    });
    return context.json({ runId: saved.runId, venueId: body.venueId, chainId: PERPL_CHAIN_ID,
      ownerAddress: auth.ownerAddress, vaultAddress, ...(delegatedAccountAddress ? { delegatedAccountAddress, accountId } : {}),
      amountUnits: saved.amountUnits, collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: 6,
        minAccountOpenUnits: live.limits.minAccountOpenUnits }, durationSeconds: saved.durationSeconds,
      maxPositionExposureUnits: saved.maxPositionExposureUnits, maxLeverage: saved.maxLeverage,
      markets: await readPerplVenueMarkets({ marketIds }), limits: { ...enrollmentReview.limits, minFundingUnits: minFunding.toString(),
        backendMaxMarketSlippageBps: perplMaxSlippageBps() }, maxSlippageBps: perplMaxSlippageBps(),
      operatorPermission: { address: operator.address, scope: "trade", withdrawals: false,
        perOrderCapsEnforcedBy: "Moeazi backend; Perpl contracts do not enforce per-order caps" },
      fundingTransaction: perplMobileTransaction(saved.fundingTransaction ?? funding.transaction),
      mandateTypedData: saved.mandateTypedData ?? mandateTypedData, walletBalanceBeforeUnits: saved.ownerAusdBeforeUnits,
      preparedExpiresAt: saved.preparedExpiresAt }, 201);
  } catch (error) { apiError(error); }
  finally { await provider?.destroy(); }
}

async function enroll(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || typeof body.fundingRawTransaction !== "string" || typeof body.mandateSignature !== "string") {
    throw new MonadApiError("Perpl enrollment requires the exact owner-signed AUSD transfer and run mandate.", 400, "perpl_signature_missing");
  }
  const row: any = await meraQuery(auth.token, "monadVenueRuns", "getEnrollmentForOwner", { runId: body.runId });
  if (row?.venueId === PERPL_VENUE_ID) { const origin = await originCheck();
    if (!origin.ready) throw new MonadApiError(origin.message ?? "Perpl Origin is not whitelisted.", 503, origin.reasonCode ?? "perpl_origin_preflight_unavailable"); }
  assertMonadPerplAutonomyEnabled(true);
  if (row?.venueId === PERPL_DIRECT_VENUE_ID && !perplDirectExecutionEnabled()) throw new MonadApiError("Direct Perpl execution is disabled.", 503, "perpl_direct_execution_disabled");
  if (!row || row.ownerAddress !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Prepared Perpl enrollment was not found for this Mera wallet.", 404, "perpl_enrollment_not_found");
  if (row.status === "activation_pending") return context.json({ runId: row.runId, venueId: row.venueId, status: row.status, phase: row.phase }, 202);
  if (row.status !== "prepared" || row.preparedExpiresAt <= Date.now()) throw new MonadApiError("Perpl preparation expired. Start a fresh review.", 409, "perpl_preparation_expired");
  const expected = row.fundingTransaction;
  const verified = verifyExactSignedTransaction(body.fundingRawTransaction, expected, auth.ownerAddress);
  const provider = await monadProvider();
  try {
    const deployment = await openPerplStrategy(provider);
    if (deployment.address.toLowerCase() !== row.factoryAddress.toLowerCase()) throw new MonadApiError("Perpl strategy factory changed after review.", 409, "perpl_factory_changed");
    const typedHash = perplMandateHash(row.mandateTypedData);
    const contractHash = String(await deployment.factory.mandateDigest(row.mandate)).toLowerCase();
    if (typedHash !== row.mandateHash.toLowerCase() || contractHash !== typedHash) throw new MonadApiError("Perpl mandate digest failed deployed factory verification.", 409, "perpl_mandate_digest_mismatch");
    await assertOwnerSignature(provider, row.mandateTypedData, body.mandateSignature, auth.ownerAddress);
    const fundedTransfer = await new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).interface.parseTransaction({ data: expected.data });
    if (fundedTransfer?.name !== "transfer" || String(fundedTransfer.args[0]).toLowerCase() !== row.vaultAddress.toLowerCase()
      || String(fundedTransfer.args[1]) !== row.amountUnits || verified.recoveredSender.toLowerCase() !== auth.ownerAddress.toLowerCase()) {
      throw new MonadApiError("Signed AUSD transfer differs from this Perpl review.", 409, "perpl_funding_terms_mismatch");
    }
    const result = await meraMutation(auth.token, "monadVenueRuns", "queueEnrollment", { runId: row.runId,
      rawTransaction: verified.canonicalRawTransaction, txHash: verified.transactionHash.toLowerCase(), mandateSignature: body.mandateSignature });
    return context.json({ ...result, venueId: row.venueId }, 202);
  } finally { await provider.destroy(); }
}

async function current(context: any) { const auth = await requireMera(context); return context.json(await meraQuery(auth.token, "monadVenueRuns", "getCurrent", {})); }
async function history(context: any) {
  const auth = await requireMera(context); const limit = Number(context.req.query("limit") ?? 20); const cursor = context.req.query("cursor");
  return context.json(await meraQuery(auth.token, "monadVenueRuns", "getHistory", { limit, ...(cursor ? { cursor } : {}) }));
}
async function runHistory(context: any) {
  const auth = await requireMera(context); const result = await meraQuery(auth.token, "monadVenueRuns", "getRunHistory", {
    runId: context.req.param("runId"), limit: Number(context.req.query("limit") ?? 50), ...(context.req.query("cursor") ? { cursor: context.req.query("cursor") } : {}) });
  if (!result) throw new MonadApiError("Perpl run was not found for this Mera wallet.", 404, "perpl_run_not_found");
  return context.json(result);
}

async function prepareStop(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || !validKey(body.idempotencyKey)) throw new MonadApiError("Perpl run and stop idempotency key are required.");
  const row: any = await meraQuery(auth.token, "monadVenueRuns", "getRunForOwner", { runId: body.runId });
  if (!row || !["active", "uncertain", "stopping"].includes(row.status)) throw new MonadApiError("Perpl run is not ready for owner stop.", 409, "perpl_run_not_active");
  const provider = await monadProvider();
  try {
    const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
    if (String(await vault.owner()).toLowerCase() !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Perpl vault owner differs from Mera session.", 403, "perpl_owner_mismatch");
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, row.vaultAddress, vault.interface.encodeFunctionData("requestStop"), 0n, 1_000_000n);
    const expiresAt = Date.now() + 240_000;
    await meraMutation(auth.token, "monadVenueRuns", "prepareStopRun", { runId: row.runId, idempotencyKey: body.idempotencyKey,
      transactionJson: JSON.stringify(built.transaction), expiresAt });
    return context.json({ runId: row.runId, venueId: row.venueId,
      stopTransaction: perplMobileTransaction(built.transaction), preparedExpiresAt: expiresAt });
  } finally { await provider.destroy(); }
}

async function stop(context: any) {
  const auth = await requireMera(context); const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || typeof body.signedTransaction !== "string") throw new MonadApiError("Perpl stop requires the owner-signed transaction.");
  const [row, prepared]: any[] = await Promise.all([meraQuery(auth.token, "monadVenueRuns", "getRunForOwner", { runId: body.runId }),
    meraQuery(auth.token, "monadVenueRuns", "getStopPreparation", { runId: body.runId })]);
  if (!row || !prepared || !["active", "uncertain", "stopping"].includes(row.status)) throw new MonadApiError("Perpl stop review is missing or expired.", 409, "perpl_stop_not_prepared");
  const verified = verifyExactSignedTransaction(body.signedTransaction, prepared.transaction, auth.ownerAddress);
  const result = await meraMutation(auth.token, "monadVenueRuns", "queueStop", { runId: row.runId,
    rawTransaction: verified.canonicalRawTransaction, txHash: verified.transactionHash.toLowerCase() });
  return context.json({ ...result, venueId: row.venueId }, 202);
}

async function assertOwnerSignature(provider: any, typed: any, signature: string, owner: string) {
  let digest: string; try { digest = perplMandateHash(typed); } catch { throw new MonadApiError("Perpl mandate typed data is invalid.", 409, "perpl_mandate_invalid"); }
  if (await provider.getCode(owner) !== "0x") {
    const result = await provider.call({ to: owner, data: new Contract(owner, ["function isValidSignature(bytes32,bytes) view returns (bytes4)"], provider)
      .interface.encodeFunctionData("isValidSignature", [digest, signature]) });
    if (String(result).slice(0, 10).toLowerCase() !== "0x1626ba7e") throw new MonadApiError("Mera contract wallet rejected the Perpl mandate signature.", 403, "perpl_signature_invalid");
  } else {
    const { verifyTypedData } = await import("ethers"); const { EIP712Domain: _domain, ...types } = typed.types;
    void _domain;
    let recovered = ""; try { recovered = verifyTypedData(typed.domain, types, typed.message, signature); } catch { /* rejected below */ }
    if (recovered.toLowerCase() !== owner.toLowerCase()) throw new MonadApiError("Perpl mandate signature does not match this Mera wallet.", 403, "perpl_signature_invalid");
  }
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); } catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
export function registerPerplRoutes(app: Hono<any>) {
  app.get("/api/mobile/perp/venues", (c) => guard(c, venues));
  app.post("/api/mobile/perp/prepare", (c) => guard(c, prepare));
  app.post("/api/mobile/perp/enroll", (c) => guard(c, enroll));
  app.get("/api/mobile/perp/current", (c) => guard(c, current));
  app.get("/api/mobile/perp/history", (c) => guard(c, history));
  app.get("/api/mobile/perp/history/:runId", (c) => guard(c, runHistory));
  app.post("/api/mobile/perp/stop/prepare", (c) => guard(c, prepareStop));
  app.post("/api/mobile/perp/stop", (c) => guard(c, stop));
}
