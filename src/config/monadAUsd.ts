export const MONAD_AUSD_ADDRESS = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
export const MONAD_AUSD_FAUCET_ADDRESS = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C';
export const MONAD_AUSD_DECIMALS = 6;

export const MONAD_AUSD_FAUCET_ABI = [{
  type: 'function', name: 'requestFunds', stateMutability: 'nonpayable',
  inputs: [{name: 'callerAddress', type: 'address'}], outputs: [],
}] as const;
