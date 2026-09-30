export const WITHDRAWAL_USDC_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

export type PreparedWithdrawalTransaction = {
  from: string; to: string; data: string; value: string;
  gas: string; maxFeePerGas: string; nonce: string;
};

export type PreparedWithdrawal = {
  schemaVersion: '2026-09-14'; operationId: string; idempotencyKey: string;
  owner: string; chainId: 42161; network: 'Arbitrum';
  asset: {symbol: 'USDC'; contractAddress: string; decimals: 6};
  amount: string; amountRaw: string; destination: string;
  destinationKind: 'wallet' | 'contract'; remainingAmount: string;
  estimatedFeeWei: string; observedBlock: number;
  transaction: PreparedWithdrawalTransaction; preparedHash: string; expiresAt: number;
};

export type WithdrawalStatus = {
  schemaVersion: '2026-09-14'; operationId: string;
  status: 'prepared' | 'submitted' | 'confirming' | 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'expired' | 'needs_attention';
  amount: string; destination: string; destinationKind: 'wallet' | 'contract';
  network: 'Arbitrum'; asset: 'USDC'; estimatedFeeWei: string;
  remainingAmount: string; transactionHash?: string; failureCode?: string;
  failureMessage?: string; expiresAt: number; updatedAt: number;
};

export type ParsedPaymentQr = {destination: string; suggestedAmount?: string};
