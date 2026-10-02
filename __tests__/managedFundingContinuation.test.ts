import {continueManagedFunding} from '../src/services/managedFundingContinuation';

const mandate = {
  mandateId: 'mandate-1', vaultAddress: '0x1111111111111111111111111111111111111111',
  fundingOperation: {operationId: 'fund:one', status: 'submitted', particleTransactionId: null},
};

test('a submitted Magic funding operation cannot activate finance before observed settlement', async () => {
  const activateManagedSpotVault = jest.fn();
  const result = await continueManagedFunding(mandate, {
    managedSpotFundingStatus: async () => ({status: 'submitted', funded: false}),
    activateManagedSpotVault,
  });
  expect(result).toEqual({state: 'pending', status: 'submitted'});
  expect(activateManagedSpotVault).not.toHaveBeenCalled();
});

test('confirmed vault funding activates only the same Magic mandate and vault finance account', async () => {
  const activateManagedSpotVault = jest.fn(async () => ({mandateId: mandate.mandateId,
    sourceAccountId: `arbitrum:42161:vault:${mandate.vaultAddress}`}));
  const result = await continueManagedFunding(mandate, {
    managedSpotFundingStatus: async () => ({status: 'confirmed', funded: true}),
    activateManagedSpotVault,
  });
  expect(result.state).toBe('activated');
  expect(activateManagedSpotVault).toHaveBeenCalledTimes(1);
  await expect(continueManagedFunding(mandate, {
    managedSpotFundingStatus: async () => ({status: 'confirmed', funded: true}),
    activateManagedSpotVault: async () => ({mandateId: 'another',
      sourceAccountId: `arbitrum:42161:vault:${mandate.vaultAddress}`}),
  })).rejects.toThrow(/differs from this Magic mandate/);
});
