import type {Send7702TransactionRequest, Send7702TransactionResponse, Sign7702AuthorizationRequest, Sign7702AuthorizationResponse} from '@magic-sdk/react-native-bare';
import type {PreparedWithdrawalTransaction} from '../../types/withdrawal';
import type {ManagedProgramGrantContext} from '../../types/mobile';

export type WalletIdentity = {address: string; email?: string};

export interface WalletAdapter {
  isConfigured(): boolean;
  loginWithEmail(email: string): Promise<WalletIdentity>;
  restoreIdentity(): Promise<WalletIdentity | null>;
  signMessage(message: string, address: string): Promise<string>;
  signRootHash(rootHash: string, address: string): Promise<string>;
  signTypedData(payload: unknown, address: string): Promise<string>;
  signEip7702Authorization(input: Sign7702AuthorizationRequest): Promise<Sign7702AuthorizationResponse>;
  sendEip7702Transaction(input: Send7702TransactionRequest): Promise<Send7702TransactionResponse>;
  sendPreparedTransaction(input: PreparedWithdrawalTransaction): Promise<string>;
  releaseManagedVault(input: {from: string; to: string; data: string; value: string}): Promise<string>;
  sendScopedTokenApproval(input: {owner: string; scope: 'buy' | 'exit'; context: ManagedProgramGrantContext}): Promise<string>;
  logout(): Promise<void>;
}
