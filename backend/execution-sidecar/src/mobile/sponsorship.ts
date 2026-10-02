import {randomUUID} from "node:crypto";
import {formatUnits, keccak256, toHex, verifyMessage, type Address, type Hex, type PublicClient} from "viem";
import {recoverAuthorizationAddress} from "viem/utils";
import {CHAIN, ConnectorError, USDC, VERSION, type Environment, type OperationRecord, type OperationStore, type PreparedSponsoredOperation, type SignedAuthorization, type SponsoredIntent, type UserOperation} from "./contracts.js";
import {infrastructure, type Registries} from "./configuration.js";
import {address, amount, digest, recipient, requestId} from "./validation.js";
import type {Authorization} from "./contracts.js";
import {networkFeeCeiling} from "./gas.js";

const balanceAbi = [{type: "function", name: "balanceOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256"}]}] as const;
export function reviewHash(prepared: Omit<PreparedSponsoredOperation, "reviewHash">): Hex { return digest(prepared); }
const gasFields = ["callGasLimit", "verificationGasLimit", "preVerificationGas"] as const;
const immutableFields = ["sender", "nonce", "callData", "maxFeePerGas", "maxPriorityFeePerGas"] as const;
function gasValue(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new ConnectorError("INVALID", "Network fee estimate was invalid.");
  return value as Hex;
}
export function applyEstimate(operation: UserOperation, estimate: Partial<UserOperation>): UserOperation {
  for (const field of immutableFields) if (estimate[field] !== undefined && estimate[field] !== operation[field]) throw new ConnectorError("INVALID", "The estimate changed the approved operation.");
  return {...operation, ...Object.fromEntries(gasFields.map(field => [field, gasValue(estimate[field])]))};
}
export function applySponsorship(operation: UserOperation, quote: {operation: UserOperation; expiresAt: number}): UserOperation {
  if (!Number.isFinite(quote.expiresAt) || quote.expiresAt <= Date.now()) throw new ConnectorError("EXPIRED", "Network fee coverage expired. Review again.");
  for (const field of immutableFields) if (quote.operation[field] !== operation[field]) throw new ConnectorError("INVALID", "Sponsorship altered the approved operation.");
  const paymaster = address(quote.operation.paymaster);
  if (BigInt(paymaster) === 0n || !/^0x(?:[0-9a-fA-F]{2})*$/.test(quote.operation.paymasterData ?? "")) throw new ConnectorError("INVALID", "Network fee coverage data was invalid.");
  return {...operation, ...Object.fromEntries(gasFields.map(field => [field, gasValue(quote.operation[field])])), paymaster,
    paymasterData: quote.operation.paymasterData, paymasterVerificationGasLimit: gasValue(quote.operation.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: gasValue(quote.operation.paymasterPostOpGasLimit)};
}
export class SponsorshipService {
  constructor(private store: OperationStore, private registries: Registries, private env: Environment, private client: PublicClient) {}
  private async context(subject: string, sessionOwner: string) {
    const context = await this.store.context(subject), owner = address(context.ownerAddress);
    if (owner.toLowerCase() !== sessionOwner.toLowerCase() || subject !== `magic:${owner.toLowerCase()}`) throw new ConnectorError("INVALID", "Wallet identity changed.", 403);
    if (!context.profilePaused || context.strategyStatus === "running" || context.hasPendingExecution) throw new ConnectorError("CONFLICT", "Pause the AI and wait for pending work before continuing.", 409);
    if (context.emergencyStop) throw new ConnectorError("CONFLICT", "Review the account safety stop first.", 423);
    return {context, owner};
  }
  private async artifacts(account: ReturnType<typeof infrastructure>["account"]) {
    if (await this.client.getChainId() !== CHAIN) throw new ConnectorError("INVALID", "Network configuration does not match Arbitrum.");
    for (const [contract, expected] of [[account.implementation, this.env.MOBILE_KERNEL_CODE_HASH], [account.entryPoint, this.env.MOBILE_ENTRY_POINT_CODE_HASH]] as const) {
      const code = await this.client.getCode({address: contract});
      if (!code || keccak256(code).toLowerCase() !== expected?.toLowerCase()) throw new ConnectorError("UNSUPPORTED", "Wallet execution artifacts have not been verified.");
    }
  }
  async readiness(subject: string, sessionOwner: string) {
    try {
      const {account} = infrastructure(this.registries, this.env);
      await this.artifacts(account);
      const context = await this.store.context(subject);
      if (context.ownerAddress.toLowerCase() !== sessionOwner.toLowerCase()) throw new ConnectorError("INVALID", "Wallet identity changed.");
      const code = await this.client.getCode({address: address(context.ownerAddress)});
      const delegation = code && code !== "0x";
      if (delegation && code?.toLowerCase() !== `0xef0100${account.implementation.slice(2)}`) throw new ConnectorError("UNSUPPORTED", "This wallet needs a separate execution migration review.");
      return {schemaVersion: VERSION, available: true, activated: Boolean(delegation), networkFeePayer: "moeazi", requiresActivation: !delegation};
    } catch (error) { return {schemaVersion: VERSION, available: false, activated: false, requiresActivation: false, reason: error instanceof ConnectorError ? error.message : "Covered network fees are unavailable."}; }
  }
  async prepare(subject: string, sessionOwner: string, kind: "activation" | "withdrawal", input: Record<string, unknown>) {
    const idempotencyKey = requestId(input.idempotencyKey);
    const existing = await this.store.byIdempotency(subject, idempotencyKey);
    if (existing) {
      const payload = JSON.parse(existing.payloadJson);
      if (existing.kind !== kind || payload.owner.toLowerCase() !== sessionOwner.toLowerCase() || kind === "withdrawal" && (payload.intent.amountRaw !== amount(input.amount, 6).toString() || payload.intent.destination.toLowerCase() !== address(input.destination).toLowerCase())) throw new ConnectorError("CONFLICT", "The request ID belongs to another operation.", 409);
      if (!["prepared", "authorization_required"].includes(existing.status)) throw new ConnectorError("CONFLICT", "This operation is already being checked. Open its status before preparing another.", 409);
      if (Math.min(existing.expiresAt, payload.expiresAt ?? existing.expiresAt) <= Date.now()) throw new ConnectorError("EXPIRED", "This unsigned review expired. Start a fresh review.", 409);
      if (kind === "activation" && payload.transport === "erc4337") return {schemaVersion: VERSION, stage: "authorization_required", operationId: existing.operationId,
        owner: payload.owner, intent: payload.intent, authorization: payload.authorization, expiresAt: payload.expiresAt, implementation: payload.implementation,
        networkFeePayer: "moeazi", grantsAiTradingAuthority: false};
      return payload;
    }
    const {account, bundler, paymaster} = infrastructure(this.registries, this.env);
    const {owner} = await this.context(subject, sessionOwner);
    await this.artifacts(account);
    const operationId = randomUUID();
    const code = await this.client.getCode({address: owner});
    const delegated = code && code !== "0x";
    if (delegated && code!.toLowerCase() !== `0xef0100${account.implementation.slice(2)}`) throw new ConnectorError("UNSUPPORTED", "Unknown wallet delegation. Migration review is required.");
    if (kind === "withdrawal" && !delegated) throw new ConnectorError("CONFLICT", "Enable covered network fees before withdrawing.", 409);
    if (kind === "activation" && delegated) throw new ConnectorError("CONFLICT", "Covered network fees are already enabled.", 409);
    const intent: SponsoredIntent = {kind, owner};
    if (kind === "withdrawal") { intent.destination = recipient(input.destination, owner); intent.amountRaw = amount(input.amount, 6).toString(); }
    const expiresAt = Date.now() + 120_000;
    const authorization = kind === "activation" ? {contractAddress: account.implementation, chainId: CHAIN, nonce: await this.client.getTransactionCount({address: owner, blockTag: "pending"})} : undefined;
    const bindings = {schemaVersion: VERSION, stage: "authorization_required", operationId, owner, intent, authorization, expiresAt,
      implementation: account.implementation, networkFeePayer: "moeazi", grantsAiTradingAuthority: false};
    const ceiling = this.env.MOBILE_GAS_OPERATION_LIMIT_WEI!;
    const reservation = await this.store.reserve(subject, {operationId, kind, idempotencyKey, status: kind === "activation" ? "authorization_required" : "prepared",
      providerPinsJson: JSON.stringify([account.pin, bundler.pin, paymaster.pin]), payloadJson: JSON.stringify(bindings),
      bindingHash: digest({kind, amount: input.amount, destination: intent.destination, owner}), expiresAt,
      nonceKey: `${CHAIN}:${owner.toLowerCase()}:owner-execution`, reservedWei: ceiling,
      ownerLimitWei: this.env.MOBILE_GAS_ACCOUNT_LIMIT_WEI!, globalLimitWei: this.env.MOBILE_GAS_GLOBAL_LIMIT_WEI!});
    if (!reservation.created) return JSON.parse(reservation.row.payloadJson);
    if (kind === "activation") return bindings;
    try { return await this.finishPreparation(reservation.row); }
    catch (error) { await this.store.transition(subject, operationId, ["prepared"], {status: "expired"}); throw error; }
  }
  async finishPreparation(row: OperationRecord, signed?: SignedAuthorization) {
    if (this.env.MOBILE_SPONSORSHIP_ENABLED !== "true" || this.env.MOBILE_SPONSORSHIP_CERTIFIED !== "true") throw new ConnectorError("UNAVAILABLE", "New sponsored preparations are disabled.");
    const [accountPin, bundlerPin, paymasterPin] = JSON.parse(row.providerPinsJson);
    const account = this.registries.accounts.resolve(accountPin), bundler = this.registries.bundlers.resolve(bundlerPin), paymaster = this.registries.paymasters.resolve(paymasterPin);
    const {intent, authorization} = JSON.parse(row.payloadJson);
    if (row.expiresAt < Date.now()) throw new ConnectorError("EXPIRED", "Review expired. Start again.", 409);
    if (authorization) await this.verifyAuthorization(intent.owner, authorization, signed);
    await this.context(row.subject, intent.owner);
    await this.artifacts(account);
    const block = await this.client.getBlockNumber();
    const nonce = await this.client.readContract({address: account.entryPoint, abi: [{type: "function", name: "getNonce", stateMutability: "view", inputs: [{type: "address"}, {type: "uint192"}], outputs: [{type: "uint256"}]}], functionName: "getNonce", args: [intent.owner, account.nonceKey()], blockNumber: block}) as bigint;
    let withdrawal: PreparedSponsoredOperation["withdrawal"];
    if (intent.kind === "withdrawal") {
      const balance = await this.client.readContract({address: USDC, abi: balanceAbi, functionName: "balanceOf", args: [intent.owner], blockNumber: block});
      if (balance < BigInt(intent.amountRaw)) throw new ConnectorError("INVALID", "Not enough USDC is available.", 409);
      const destinationCode = await this.client.getCode({address: intent.destination, blockNumber: block});
      withdrawal = {amount: formatUnits(BigInt(intent.amountRaw), 6), destination: intent.destination, destinationKind: destinationCode && destinationCode !== "0x" ? "contract" : "wallet", remainingAmount: formatUnits(balance - BigInt(intent.amountRaw), 6)};
    }
    const fees = await this.client.estimateFeesPerGas();
    let operation: UserOperation = {sender: intent.owner, nonce: toHex(nonce), callData: await account.build(intent, nonce, Boolean(authorization)),
      callGasLimit: "0x0", verificationGasLimit: "0x0", preVerificationGas: "0x0", maxFeePerGas: toHex(fees.maxFeePerGas ?? 0n), maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas ?? 0n)};
    operation = applyEstimate(operation, await bundler.estimate(operation, signed));
    const sponsorship = await paymaster.sponsor(operation, signed);
    operation = applySponsorship(operation, sponsorship);
    if (!/^[1-9][0-9]*$/.test(sponsorship.feeCeilingWei)) throw new ConnectorError("INVALID", "Network-fee coverage cost was invalid.");
    const ceiling = BigInt(sponsorship.feeCeilingWei);
    if (ceiling < networkFeeCeiling(operation) || ceiling > BigInt(row.reservedWei ?? this.env.MOBILE_GAS_OPERATION_LIMIT_WEI!)) throw new ConnectorError("UNAVAILABLE", "This network fee exceeds the coverage limit.");
    const prepared = {schemaVersion: VERSION, transport: "erc4337", operationId: row.operationId, idempotencyKey: row.idempotencyKey,
      owner: intent.owner, chainId: CHAIN, entryPoint: account.entryPoint, account: account.pin, implementation: account.implementation,
      intent, userOperation: operation, userOperationHash: account.hash(operation), expiresAt: Math.min(row.expiresAt, sponsorship.expiresAt), observedBlock: Number(block),
      feeCeilingWei: ceiling.toString(), networkFeePayer: "moeazi", bundler: bundler.pin, paymaster: paymaster.pin,
      ...(authorization ? {authorization} : {}), ...(withdrawal ? {withdrawal} : {})} as Omit<PreparedSponsoredOperation, "reviewHash">;
    const result = {...prepared, reviewHash: reviewHash(prepared)};
    await this.store.transition(row.subject, row.operationId, ["prepared", "authorization_required"], {status: "prepared", payloadJson: JSON.stringify(result)});
    return result;
  }
  private async verifyAuthorization(owner: Address, expected: Authorization, signed?: SignedAuthorization) {
    if (!signed || signed.address.toLowerCase() !== expected.contractAddress.toLowerCase() || BigInt(signed.chainId) !== BigInt(CHAIN) || BigInt(signed.nonce) !== BigInt(expected.nonce)) throw new ConnectorError("INVALID", "Wallet authorization did not match the review.", 400);
    const recovered = await recoverAuthorizationAddress({authorization: {...signed, chainId: CHAIN, nonce: Number(BigInt(signed.nonce)), yParity: Number(BigInt(signed.yParity)) as 0 | 1}});
    if (recovered.toLowerCase() !== owner.toLowerCase()) throw new ConnectorError("INVALID", "Authorization owner did not match.", 403);
  }
  async submit(subject: string, sessionOwner: string, input: {operationId: string; reviewHash: Hex; signature: Hex; authorization?: SignedAuthorization}) {
    if (this.env.MOBILE_SPONSORSHIP_ENABLED !== "true" || this.env.MOBILE_SPONSORSHIP_CERTIFIED !== "true") throw new ConnectorError("UNAVAILABLE", "New submissions are disabled.");
    const row = await this.store.find(subject, input.operationId);
    if (!row || row.kind === "purchase") throw new ConnectorError("INVALID", "Operation not found.", 404);
    if (row.status !== "prepared") return {operationId: row.operationId, status: row.status};
    const prepared: PreparedSponsoredOperation = JSON.parse(row.payloadJson);
    const {reviewHash: storedHash, ...fields} = prepared;
    if (prepared.expiresAt < Date.now()) throw new ConnectorError("EXPIRED", "Review expired. Prepare and verify again.", 409);
    if (storedHash !== input.reviewHash || reviewHash(fields) !== storedHash) throw new ConnectorError("INVALID", "The reviewed operation changed.", 400);
    await this.context(subject, sessionOwner);
    const account = this.registries.accounts.resolve(prepared.account);
    await this.artifacts(account);
    if (account.hash(prepared.userOperation) !== prepared.userOperationHash || !await verifyMessage({address: prepared.owner, message: {raw: prepared.userOperationHash}, signature: input.signature})) throw new ConnectorError("INVALID", "Wallet signature is invalid.", 403);
    if (prepared.authorization) await this.verifyAuthorization(prepared.owner, prepared.authorization, input.authorization);
    else if (input.authorization) throw new ConnectorError("INVALID", "Unexpected wallet authorization.", 400);
    if (prepared.owner.toLowerCase() !== sessionOwner.toLowerCase()) throw new ConnectorError("INVALID", "Operation owner changed.", 403);
    const delegation = await this.client.getCode({address: prepared.owner});
    if (prepared.authorization) {
      if (delegation && delegation !== "0x") throw new ConnectorError("CONFLICT", "Wallet execution changed. Review again.", 409);
      const nonce = await this.client.getTransactionCount({address: prepared.owner, blockTag: "pending"});
      if (nonce !== prepared.authorization.nonce) throw new ConnectorError("CONFLICT", "Wallet authorization expired. Review again.", 409);
    } else if (delegation?.toLowerCase() !== `0xef0100${prepared.implementation.slice(2).toLowerCase()}`) throw new ConnectorError("INVALID", "The approved wallet implementation changed.", 409);
    const nonce = await this.client.readContract({address: account.entryPoint, abi: [{type: "function", name: "getNonce", stateMutability: "view", inputs: [{type: "address"}, {type: "uint192"}], outputs: [{type: "uint256"}]}], functionName: "getNonce", args: [prepared.owner, account.nonceKey()]}) as bigint;
    if (nonce !== BigInt(prepared.userOperation.nonce) || prepared.userOperation.callData !== await account.build(prepared.intent, nonce, Boolean(prepared.authorization))) throw new ConnectorError("CONFLICT", "Wallet state changed. Prepare again.", 409);
    if (prepared.intent.kind === "withdrawal") {
      const balance = await this.client.readContract({address: USDC, abi: balanceAbi, functionName: "balanceOf", args: [prepared.owner]});
      if (balance < BigInt(prepared.intent.amountRaw!)) throw new ConnectorError("CONFLICT", "USDC balance changed. Prepare again.", 409);
    }
    // Atomic claim is persisted before broadcast. A second submission can only read status.
    const claimed = await this.store.transition(subject, row.operationId, ["prepared"], {status: "submitting"});
    if (!claimed.transitionApplied) return {operationId: row.operationId, status: claimed.status};
    try {
      const hash = await this.registries.bundlers.resolve(prepared.bundler).submit(prepared.userOperation, input.signature, input.authorization);
      if (hash.toLowerCase() !== prepared.userOperationHash.toLowerCase()) throw new Error("Hash mismatch");
      await this.store.transition(subject, row.operationId, ["submitting"], {status: "submitted"});
    } catch { await this.store.transition(subject, row.operationId, ["submitting"], {status: "uncertain"}); }
    return {operationId: row.operationId, status: "checking"};
  }
}
