export type SigningProofTypedData = {
  domain: {name: string; version: string; chainId: number};
  types: {
    EIP712Domain: Array<{name: string; type: string}>;
    SigningProof: Array<{name: string; type: string}>;
  };
  primaryType: 'SigningProof';
  message: {owner: string; proofId: string; rootHash: string; purpose: string; expiresAt: number};
};

export type SigningProofPrepared = {
  schemaVersion: '2026-09-01'; proofId: string; owner: string; chainId: 42161;
  expiresAt: string; typedData: SigningProofTypedData; rootHash: string;
};

export type SigningProofVerified = {
  status: 'verified'; owner: string; verifiedKinds: Array<'typed_data' | 'root_hash'>;
};

export type PreparedMobileActivation = {
  operationId: string; owner: string; universalAccount: string; chainId: 42161;
  contractAddress: string; nonce: number; transaction: {to: string; data: string; value: string};
  expiresAt: string; estimatedGasUsd: string;
};
