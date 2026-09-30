import type {ManagedSpotMandate} from '../types/managedSpotMandate';

type FundingStatus = {status: string; funded: boolean};
type Activation = {mandateId: string; sourceAccountId: string};

export async function continueManagedFunding(
  mandate: Pick<ManagedSpotMandate, 'mandateId' | 'vaultAddress' | 'fundingOperation'>,
  api: {
    managedSpotFundingStatus(operationId: string): Promise<FundingStatus>;
    activateManagedSpotVault(): Promise<Activation>;
  },
) {
  const operationId = mandate.fundingOperation?.operationId;
  if (!operationId || !mandate.vaultAddress) {
    throw new Error('This Magic mandate has no prepared vault funding operation.');
  }
  const status = await api.managedSpotFundingStatus(operationId);
  if (status.status !== 'confirmed' || !status.funded) {
    return {state: 'pending' as const, status: status.status};
  }
  const activation = await api.activateManagedSpotVault();
  if (activation.mandateId !== mandate.mandateId
    || activation.sourceAccountId !== `arbitrum:42161:vault:${mandate.vaultAddress}`) {
    throw new Error('The native finance account differs from this Magic mandate.');
  }
  return {state: 'activated' as const, status: status.status};
}
