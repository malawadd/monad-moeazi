export const MOBILE_ACTIVATION_CHAIN_ID = 42161 as const;

export class MobileActivationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503) { super(message); }
}

export type PreparedMobileActivation = {
  operationId: string;
  owner: string;
  universalAccount: string;
  chainId: typeof MOBILE_ACTIVATION_CHAIN_ID;
  contractAddress: string;
  nonce: number;
  transaction: { to: string; data: string; value: string };
  expiresAt: string;
  estimatedGasUsd: string;
};

export interface MobileActivationAdapter {
  prepare(owner: string): Promise<PreparedMobileActivation>;
  confirm(owner: string, operationId: string, transactionHash: string): Promise<unknown>;
  status(owner: string, operationId: string): Promise<unknown>;
}

class CertificationGatedActivationAdapter implements MobileActivationAdapter {
  private blocked(): never {
    throw new MobileActivationError(
      "Android account activation is disabled until the approved delegate and funded Type-4 flow are certified.",
      "MOBILE_MAGIC_7702_ACTIVATION_DISABLED",
    );
  }
  async prepare(): Promise<PreparedMobileActivation> { return this.blocked(); }
  async confirm() { return this.blocked(); }
  async status() { return this.blocked(); }
}

export const mobileActivationAdapter: MobileActivationAdapter = new CertificationGatedActivationAdapter();
