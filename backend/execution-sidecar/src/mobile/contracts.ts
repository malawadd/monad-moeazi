import type { Address, Hex } from "viem";
import type {AdapterQuote, QuoteCapabilities, QuoteInput} from "./quoteContracts.js";

export const CHAIN = 42161 as const;
export const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831" as Address;
export const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
export const KERNEL = "0xd6cedde84be40893d153be9d467cd6ad37875b28" as Address;
export const VERSION = "2026-09-29" as const;
export type Environment = Record<string, string | undefined>;
export type FailureCode = "UNAVAILABLE" | "UNSUPPORTED" | "EXPIRED" | "CANCELLED" | "RATE_LIMITED" | "INVALID" | "CONFLICT" | "UNCERTAIN";
export class ConnectorError extends Error {
  constructor(readonly code: FailureCode, message: string, readonly status = 503) { super(message); }
}
export type ProviderPin = { id: string; version: string };
export type ProviderOption = ProviderPin & { name: string; available: boolean; reason?: string; checkoutHosts: string[] };
export type PurchaseState = "creating" | "checkout_ready" | "processing" | "delivery_pending" | "received" | "cancelled" | "failed" | "needs_attention";
export type CheckoutInput = { purchaseId: string; customerId: string; owner: Address; fiatCurrency: string; amount: string; returnUrl: string; clientIp?: string; quote?: AdapterQuote };
export type CheckoutSession = { externalId: string; url: string; expiresAt: number };
export type PurchaseObservation = { externalId: string; purchaseId?: string; state: PurchaseState; occurredAt: number; transactionHash?: Hex; eventId: string };
export interface OnRampAdapter {
  readonly pin: ProviderPin;
  capabilities(): ProviderOption;
  quoteCapabilities?(): QuoteCapabilities;
  getQuote?(input: QuoteInput): Promise<AdapterQuote>;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  getOrder(externalId: string, purchaseId: string): Promise<PurchaseObservation | null>;
  verifyWebhook(rawBody: string, headers: Record<string, string>, path: string): Promise<PurchaseObservation>;
}
export type UserOperation = {
  sender: Address; nonce: Hex; callData: Hex; callGasLimit: Hex; verificationGasLimit: Hex;
  preVerificationGas: Hex; maxFeePerGas: Hex; maxPriorityFeePerGas: Hex;
  paymaster?: Address; paymasterVerificationGasLimit?: Hex; paymasterPostOpGasLimit?: Hex; paymasterData?: Hex;
};
export type Authorization = { contractAddress: Address; chainId: 42161; nonce: number };
export type SignedAuthorization = { address: Address; chainId: Hex; nonce: Hex; r: Hex; s: Hex; yParity: Hex };
export type SponsoredIntent = { kind: "activation" | "withdrawal"; owner: Address; destination?: Address; amountRaw?: string };
export type PreparedSponsoredOperation = {
  schemaVersion: typeof VERSION; transport: "erc4337"; operationId: string; idempotencyKey: string;
  owner: Address; chainId: 42161; entryPoint: Address; account: ProviderPin;
  implementation: Address; intent: SponsoredIntent; userOperation: UserOperation;
  userOperationHash: Hex; reviewHash: Hex; expiresAt: number; observedBlock: number;
  feeCeilingWei: string; networkFeePayer: "moeazi"; bundler: ProviderPin; paymaster: ProviderPin;
  authorization?: Authorization;
  withdrawal?: { amount: string; destination: Address; destinationKind: "wallet" | "contract"; remainingAmount: string };
};
export type SubmissionOutcome = { status: "submitted" | "uncertain"; userOperationHash: Hex };
export type Settlement = { state: "pending" | "completed" | "failed"; transactionHash?: Hex; actualGasCost?: string; failureCode?: string };
export type InfrastructureCapabilities = { chainId: 42161; entryPoint: Address; accountId: string; eip7702: boolean };
export interface BundlerAdapter {
  readonly pin: ProviderPin; capabilities(): InfrastructureCapabilities;
  estimate(operation: UserOperation, authorization?: SignedAuthorization): Promise<Partial<UserOperation>>;
  submit(operation: UserOperation, signature: Hex, authorization?: SignedAuthorization): Promise<Hex>;
  locate(hash: Hex): Promise<{ transactionHash?: Hex } | null>;
}
export interface PaymasterAdapter {
  readonly pin: ProviderPin; capabilities(): InfrastructureCapabilities;
  sponsor(operation: UserOperation, authorization?: SignedAuthorization): Promise<{ operation: UserOperation; expiresAt: number; feeCeilingWei: string }>;
  settlementCostWei(actualGasCost: string): string;
}
export interface AccountExecutionAdapter {
  readonly pin: ProviderPin; readonly implementation: Address; readonly entryPoint: Address;
  nonceKey(): bigint;
  build(intent: SponsoredIntent, nonce: bigint, initialize: boolean): Promise<Hex>;
  hash(operation: UserOperation): Hex;
  verifyReceipt(prepared: PreparedSponsoredOperation, receipt: unknown): Settlement;
}
export type AccountContext = { userId: string; strategyAccountId?: string; ownerAddress: Address; profilePaused: boolean; strategyStatus?: string; hasPendingExecution: boolean; emergencyStop: boolean };
export type OperationRecord = { operationId: string; userId: string; subject: string; kind: "purchase" | "activation" | "withdrawal"; status: string; providerPinsJson: string; payloadJson: string; idempotencyKey: string; createdAt: number; updatedAt: number; externalId?: string; transactionHash?: string; expiresAt: number; reservedWei?: string; actualCoverageCostWei?: string; transitionApplied?: boolean };
export interface OperationStore {
  context(subject: string): Promise<AccountContext>;
  byIdempotency(subject: string, idempotencyKey: string): Promise<OperationRecord | null>;
  find(subject: string, operationId: string): Promise<OperationRecord | null>;
  reserve(subject: string, input: Omit<OperationRecord, "subject" | "userId" | "createdAt" | "updatedAt"> & { bindingHash: string; nonceKey?: string; reservedWei?: string; globalLimitWei?: string; ownerLimitWei?: string }): Promise<{ created: boolean; row: OperationRecord }>;
  transition(subject: string, operationId: string, expected: string[], patch: { status: string; payloadJson?: string; externalId?: string; transactionHash?: string; actualGasCost?: string; actualCoverageCostWei?: string; eventId?: string; observedAt?: number }): Promise<OperationRecord>;
  byExternal(provider: ProviderPin, externalId?: string, operationId?: string): Promise<OperationRecord | null>;
}
