import { createHash, randomUUID } from "node:crypto";
import { Contract, Interface, getAddress, verifyTypedData } from "ethers";
import { hashTypedData } from "viem";
import { Hono } from "hono";
import { meraQuery, operatorMutation, operatorQuery } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { assertMonadActionsEnabled, configuredAdapter, configuredVault, MonadApiError } from "./config.js";
import { ASSETS, MANDATE_DOMAIN, MANDATE_TYPES, MONAD_CHAIN_ID, USDC_ADDRESS, VAULT_ABI, WMON_ADDRESS } from "./constants.js";
import { finalizedBlockNumber, monadProvider, readTokenBalance, requireContractCode } from "./provider.js";
import { amountUnits, buildEip1559Transaction } from "./transactions.js";
import { operationDto, reconcileOwnerPendingOperations } from "./operations.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const day = 24 * 60 * 60;

async function mandates(context: any) {
  const auth = await requireMera(context);
  await reconcileOwnerPendingOperations(auth.token, auth.ownerAddress);
  const rows: any[] = await meraQuery(auth.token, "monadMandates", "getMandates", {});
  const row = rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!row) return context.json({ mandate: null });
  let status = row.status === "signed" && row.expiresAt <= Math.floor(Date.now() / 1000) ? "expired" : row.status;
  const provider = await monadProvider();
  try {
    const blockNumber = await finalizedBlockNumber(provider);
    const block = await provider.getBlock(blockNumber);
    const stale = !block || Date.now() - Number(block.timestamp) * 1000 > 60_000;
    const vaultAddress = getAddress(row.vaultAddress);
    await requireContractCode(provider, vaultAddress, "Monad managed vault");
    const vault = new Contract(vaultAddress, VAULT_ABI, provider);
    const [vaultOwner, active, stopped] = await Promise.all([vault.owner(), vault.isMandateActive(row.typedDataHash), vault.stopped()]);
    if (String(vaultOwner).toLowerCase() !== auth.ownerAddress.toLowerCase()) {
      throw new MonadApiError("Configured mandate vault belongs to another wallet.", 403, "vault_owner_mismatch");
    }
    if (status === "active" && stopped) status = "stopped";
    else if (status === "active" && !active) status = row.expiresAt <= Math.floor(Date.now() / 1000) ? "expired" : "revoked";
    const vaultBalances = await Promise.all([
      readTokenBalance(provider, USDC_ADDRESS, vaultAddress, blockNumber),
      readTokenBalance(provider, WMON_ADDRESS, vaultAddress, blockNumber),
    ]);
    return context.json({ mandate: { mandateId: row.mandateId, ownerAddress: row.ownerAddress,
      vaultAddress, status, vaultStopped: Boolean(stopped), expiresAt: row.expiresAt,
      authorizedAt: status === "active" ? new Date(row.updatedAt).toISOString() : null,
      limits: { asset: row.tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? "USDC" : "WMON",
        maxTotalInput: row.maxTotalInput, maxInputPerTrade: row.maxInputPerTrade,
        tokenIn: row.tokenIn, tokenOut: row.tokenOut },
      vaultBalances: vaultBalances.map((balance) => ({ asset: balance.tokenAddress.toLowerCase() === USDC_ADDRESS.toLowerCase() ? "USDC" : "WMON",
        tokenAddress: balance.tokenAddress, amountUnits: balance.amountUnits, decimals: balance.decimals,
        observedBlock: blockNumber, stale })) } });
  } finally { await provider.destroy(); }
}

async function prepareMandate(context: any) {
  const auth = await requireMera(context); assertMonadActionsEnabled();
  const body = parseBody(await context.req.json());
  if (!Number.isInteger(body.durationDays) || body.durationDays < 1 || body.durationDays > 7
      || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.idempotencyKey)) {
    throw new MonadApiError("Mandate duration must be 1–7 days with a valid idempotency key.");
  }
  const asset = body.asset === "WMON" ? "WMON" : body.asset === "USDC" ? "USDC" : null;
  if (!asset) throw new MonadApiError("Mandate input asset must be USDC or WMON.");
  const tokenIn = asset === "USDC" ? USDC_ADDRESS : WMON_ADDRESS;
  const tokenOut = asset === "USDC" ? WMON_ADDRESS : USDC_ADDRESS;
  const total = amountUnits(body.amount, ASSETS[asset].decimals);
  const existing: any[] = await meraQuery(auth.token, "monadMandates", "getMandates", {});
  const prior = existing.find((item) => item.idempotencyKey === body.idempotencyKey);
  if (prior) {
    const typedData = prior.typedData ?? JSON.parse(prior.typedDataJson);
    const message = typedData.message;
    if (BigInt(message.maxTotalInput) !== total || String(message.tokenIn).toLowerCase() !== tokenIn.toLowerCase()
        || Number(message.expiresAt) - Number(message.validAfter) !== body.durationDays * day) {
      throw new MonadApiError("Mandate idempotency key was reused for different terms.", 409, "idempotency_conflict");
    }
    return context.json(preparedMandateDto(prior, body.amount, body.durationDays));
  }
  const vaultAddress = configuredVault();
  if (!vaultAddress) throw new MonadApiError("Monad managed vault is not configured.", 503, "vault_unavailable");
  const provider = await monadProvider();
  try {
    await requireContractCode(provider, vaultAddress, "Monad managed vault");
    const vault = new Contract(vaultAddress, VAULT_ABI, provider);
    const [owner, usdc, wmon, stopped, active, nonce] = await Promise.all([
      vault.owner(), vault.usdc(), vault.wmon(), vault.stopped(), vault.mandateActive(), vault.mandateNonce(),
    ]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Configured vault owner differs from this Mera wallet.", 403, "vault_owner_mismatch");
    if (String(usdc).toLowerCase() !== USDC_ADDRESS.toLowerCase() || String(wmon).toLowerCase() !== WMON_ADDRESS.toLowerCase()) {
      throw new MonadApiError("Configured vault assets differ from reviewed Monad Testnet assets.", 503, "vault_asset_mismatch");
    }
    if (stopped || active) throw new MonadApiError("Stop or revoke the current vault mandate before creating another.", 409, "mandate_already_active");
    const allowedAdapters: string[] = [];
    for (const venue of ["uniswap_v4_testnet", "moeazi_test_amm"] as const) {
      const adapter = configuredAdapter(venue);
      if (adapter && await vault.adapterAllowed(adapter).catch(() => false)) allowedAdapters.push(adapter);
    }
    if (!allowedAdapters.length || allowedAdapters.length > 4) throw new MonadApiError("No configured, vault-approved testnet adapter is available.", 503, "venue_disabled");
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now; const expiresAt = now + body.durationDays * day;
    const perTrade = total / 4n || 1n;
    const message = { chainId: MONAD_CHAIN_ID, vault: vaultAddress, allowedAdapters,
      tokenIn, tokenOut, maxInputPerTrade: perTrade.toString(),
      maxTotalInput: total.toString(), validAfter, expiresAt, nonce: nonce.toString() };
    const typedData = { domain: { ...MANDATE_DOMAIN, verifyingContract: vaultAddress }, types: MANDATE_TYPES,
      primaryType: "Mandate" as const, message };
    const mandateId = randomUUID(); const typedDataHash = hashTypedData(typedData as any);
    const args = { mandateId, idempotencyKey: body.idempotencyKey, subject: auth.subject,
      ownerAddress: auth.ownerAddress, chainId: MONAD_CHAIN_ID, verifyingContract: vaultAddress,
      vaultAddress, allowedAdaptersJson: JSON.stringify(allowedAdapters), usdcAddress: USDC_ADDRESS,
      wmonAddress: WMON_ADDRESS, tokenIn, tokenOut,
      maxInputPerTrade: perTrade.toString(), maxTotalInput: total.toString(), validAfter,
      expiresAt, nonce: nonce.toString(), typedDataJson: JSON.stringify(typedData), typedDataHash };
    const row: any = await operatorMutation("monadMandates", "prepareMandate", args);
    return context.json(preparedMandateDto(row, body.amount, body.durationDays), 201);
  } finally { await provider.destroy(); }
}

function preparedMandateDto(row: any, amount: string, durationDays: number) {
  const typedData = row.typedData ?? JSON.parse(row.typedDataJson);
  const message = typedData.message;
  const asset = String(message.tokenIn).toLowerCase() === USDC_ADDRESS.toLowerCase() ? "USDC" : "WMON";
  return { mandateId: row.mandateId, ownerAddress: row.ownerAddress, vaultAddress: row.vaultAddress,
    chainId: MONAD_CHAIN_ID, expiresAt: message.expiresAt, validAfter: message.validAfter, nonce: String(message.nonce),
    review: { amount, amountUnits: String(message.maxTotalInput), amountPerTradeUnits: String(message.maxInputPerTrade),
      asset, durationDays, validAfter: message.validAfter, expiresAt: message.expiresAt,
      assets: [message.tokenIn, message.tokenOut], adapters: [...message.allowedAdapters],
      allowedAdapters: [...message.allowedAdapters], caps: [String(message.maxInputPerTrade), String(message.maxTotalInput)],
      tokenIn: message.tokenIn, tokenOut: message.tokenOut }, typedData };
}

async function submitMandate(context: any) {
  const auth = await requireMera(context); const mandateId = context.req.param("mandateId");
  const body = parseBody(await context.req.json());
  if (typeof body.signature !== "string" || !/^0x[0-9a-f]+$/i.test(body.signature) || body.signature.length > 1024) {
    throw new MonadApiError("EIP-712 mandate signature is invalid.");
  }
  const row: any = await operatorQuery("monadMandates", "getOperatorMandate", { mandateId });
  if (!row || row.ownerAddress.toLowerCase() !== auth.ownerAddress.toLowerCase()
      || row.subject !== auth.subject) {
    throw new MonadApiError("Monad mandate was not found.", 404, "mandate_not_found");
  }
  if (row.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new MonadApiError("Monad mandate expired.", 409, "mandate_expired");
  }
  const typedData = row.typedData ?? JSON.parse(row.typedDataJson);
  const typedDataHash = hashTypedData(typedData as any).toLowerCase();
  if (typedDataHash !== row.typedDataHash.toLowerCase()) {
    throw new MonadApiError("Stored mandate terms failed integrity verification.", 409, "mandate_integrity_failed");
  }
  let recovered: string;
  try { recovered = verifyTypedData(typedData.domain, typedData.types, typedData.message, body.signature); }
  catch { throw new MonadApiError("EIP-712 mandate signature is invalid.", 400, "invalid_signature"); }
  if (recovered.toLowerCase() !== auth.ownerAddress.toLowerCase()) {
    throw new MonadApiError("EIP-712 mandate signature does not match its owner.", 403, "signer_mismatch");
  }
  const result = await operatorMutation("monadMandates", "authorizeMandate", {
    mandateId, subject: auth.subject, ownerAddress: auth.ownerAddress,
    signature: body.signature, typedDataHash,
  });
  return context.json(result);
}

async function prepareOwnerControl(context: any, kind: "mandate_authorize" | "mandate_revoke" | "vault_stop" | "vault_resume") {
  const auth = await requireMera(context); assertMonadActionsEnabled();
  const body = parseBody(await context.req.json());
  if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.idempotencyKey)) {
    throw new MonadApiError("A valid operation idempotency key is required.");
  }
  const mandateId = kind === "mandate_authorize" || kind === "mandate_revoke" ? context.req.param("mandateId") : undefined;
  let mandate: any = null;
  if (mandateId) {
    const rows: any[] = await meraQuery(auth.token, "monadMandates", "getMandates", {});
    mandate = rows.find((item) => item.mandateId === mandateId && item.ownerAddress.toLowerCase() === auth.ownerAddress.toLowerCase());
    if (!mandate) throw new MonadApiError("Monad mandate was not found.", 404, "mandate_not_found");
  }
  const vaultAddress = mandate?.vaultAddress ?? configuredVault();
  if (!vaultAddress) throw new MonadApiError("Monad managed vault is not configured.", 503, "vault_unavailable");
  if (kind === "mandate_authorize" && mandate.status !== "signed") throw new MonadApiError("A verified signed mandate is required for on-chain authorization.", 409, "mandate_signature_required");
  const intent = { kind, ownerAddress: auth.ownerAddress, vaultAddress, ...(mandateId ? { mandateId } : {}),
    ...(mandate?.typedDataHash ? { typedDataHash: mandate.typedDataHash } : {}) };
  return await prepareVaultOperation(context, auth, kind, vaultAddress, intent, body.idempotencyKey, mandate);
}

async function prepareVaultOperation(context: any, auth: any, kind: string, vaultAddress: string,
  intent: Record<string, unknown>, idempotencyKey: string, mandate?: any) {
  const intentHash = hash(JSON.stringify(intent));
  const prior: any = await meraQuery(auth.token, "monad", "getOperationByIdempotency", { idempotencyKey });
  if (prior) {
    if (prior.intentHash !== intentHash) throw new MonadApiError("Idempotency key was reused for different vault terms.", 409, "idempotency_conflict");
    return context.json(operationDto(prior));
  }
  const provider = await monadProvider();
  try {
    await requireContractCode(provider, vaultAddress, "Monad managed vault");
    const vault = new Contract(vaultAddress, VAULT_ABI, provider);
    if (String(await vault.owner()).toLowerCase() !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Vault owner differs from this Mera wallet.", 403, "vault_owner_mismatch");
    let data: string;
    if (kind === "mandate_authorize") {
      const serviceRow: any = await operatorQuery("monadMandates", "getOperatorMandate", { mandateId: mandate.mandateId });
      if (!serviceRow?.signature || serviceRow.status !== "signed") throw new MonadApiError("Mandate signature is unavailable or already authorized.", 409, "mandate_signature_required");
      const typedData = serviceRow.typedData ?? JSON.parse(serviceRow.typedDataJson);
      if (hashTypedData(typedData as any).toLowerCase() !== mandate.typedDataHash.toLowerCase()) throw new MonadApiError("Stored mandate terms failed integrity verification.", 409, "mandate_integrity_failed");
      const tuple = typedData.message;
      data = new Interface(VAULT_ABI).encodeFunctionData("authorizeMandate", [tuple, serviceRow.signature]);
    } else data = new Interface(VAULT_ABI).encodeFunctionData(kind === "mandate_revoke" ? "revokeMandate"
      : kind === "vault_resume" ? "resume" : "stop", []);
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, vaultAddress, data);
    const operationId = randomUUID(); const now = Date.now();
    const row: any = await operatorMutation("monad", "prepareOperation", { operationId, idempotencyKey,
      subject: auth.subject, ownerAddress: auth.ownerAddress, submitterAddress: auth.ownerAddress,
      kind, chainId: MONAD_CHAIN_ID, intentHash, intentJson: JSON.stringify(intent),
      transactionJson: JSON.stringify(built.transaction), metadataJson: JSON.stringify({ gas: built.gas }),
      expiresAt: now + 5 * 60_000, nonce: built.transaction.nonce, mandateId: mandate?.mandateId });
    return context.json(operationDto(row), 201);
  } finally { await provider.destroy(); }
}

export function registerMonadMandateRoutes(app: Hono<any>) {
  app.get("/api/mobile/monad/mandates", (c) => guard(c, mandates));
  app.post("/api/mobile/monad/mandates/prepare", (c) => guard(c, prepareMandate));
  app.post("/api/mobile/monad/mandates/:mandateId/submit", (c) => guard(c, submitMandate));
  app.post("/api/mobile/monad/mandates/:mandateId/authorize/prepare", (c) => guard(c, (ctx) => prepareOwnerControl(ctx, "mandate_authorize")));
  app.post("/api/mobile/monad/mandates/:mandateId/revoke/prepare", (c) => guard(c, (ctx) => prepareOwnerControl(ctx, "mandate_revoke")));
  app.post("/api/mobile/monad/vault/stop/prepare", (c) => guard(c, (ctx) => prepareOwnerControl(ctx, "vault_stop")));
  app.post("/api/mobile/monad/vault/resume/prepare", (c) => guard(c, (ctx) => prepareOwnerControl(ctx, "vault_resume")));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
