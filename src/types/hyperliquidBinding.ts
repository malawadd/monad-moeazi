export type HyperliquidBindingChallenge = {
  challengeId: string;
  message: string;
  expiresAt: number;
  requiredSigner: string;
};

export type HyperliquidCredentialRegistration = {
  credentialId: string;
  venueAccountId: string;
  protocolBinding: 'verified';
  status: 'authorization_required';
  routingEnabled: false;
  targetKind: 'master' | 'subaccount';
  targetAddress: string;
};

export type HyperliquidBindingScope = {
  attemptId: string;
  targetKind: 'master' | 'subaccount';
  targetAddress: string;
  apiWalletAddress: string;
};
