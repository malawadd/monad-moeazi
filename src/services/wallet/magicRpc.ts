export function magicTypedDataRequest(payload: unknown, address: string) {
  return {
    method: 'eth_signTypedData_v4' as const,
    params: [address, payload],
  };
}

export function magicRootHashRequest(rootHash: string, address: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(rootHash)) {
    throw new Error('The prepared root hash is invalid.');
  }
  return {
    method: 'personal_sign' as const,
    params: [rootHash, address],
  };
}
