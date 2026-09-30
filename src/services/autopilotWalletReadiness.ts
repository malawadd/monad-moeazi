export type AutopilotWalletReadiness = {
  schemaVersion: 'wallet-execution-readiness-v1';
  chainId: 42161;
  owner: string;
  expectedImplementation: string;
  finalized: {
    blockNumber: string;
    blockHash: string;
    usdcUnits: string;
    ethWei: string;
    delegation: {kind: 'undelegated' | 'other_code' | 'kernel' | 'other_delegation'; target: string | null};
  };
  latest: {
    blockNumber: string;
    blockHash: string;
    usdcUnits: string;
    ethWei: string;
    delegation: {kind: 'undelegated' | 'other_code' | 'kernel' | 'other_delegation'; target: string | null};
  };
  executionDelegateReady: boolean;
};

export function verifiedWalletReadiness(value: AutopilotWalletReadiness, ownerAddress: string) {
  const address = /^0x[a-fA-F0-9]{40}$/;
  const units = /^(0|[1-9][0-9]*)$/;
  const hash = /^0x[a-fA-F0-9]{64}$/;
  if (value.schemaVersion !== 'wallet-execution-readiness-v1' || value.chainId !== 42161
      || !address.test(ownerAddress) || value.owner.toLowerCase() !== ownerAddress.toLowerCase()
      || !address.test(value.owner) || !address.test(value.expectedImplementation)
      || !units.test(value.finalized.usdcUnits) || !units.test(value.finalized.ethWei)
      || !units.test(value.finalized.blockNumber)
      || !hash.test(value.finalized.blockHash) || !units.test(value.latest.usdcUnits)
      || !units.test(value.latest.ethWei)
      || !units.test(value.latest.blockNumber) || !hash.test(value.latest.blockHash)) {
    throw new Error('The account read did not match the signed-in Arbitrum wallet.');
  }
  const delegation = value.finalized.delegation;
  if (!['undelegated', 'other_code', 'kernel', 'other_delegation'].includes(delegation.kind)
      || (delegation.target !== null && !address.test(delegation.target))
      || value.executionDelegateReady !== (delegation.kind === 'kernel')) {
    throw new Error('The finalized delegation read is inconsistent.');
  }
  return value;
}
