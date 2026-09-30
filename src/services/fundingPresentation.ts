import type {FundingSnapshot} from '../types/mobile';

export function hasPositiveAmount(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
  return value.replace('.', '').replace(/^0+/, '').length > 0;
}

export type FundingJourneyStage = {
  number: string;
  title: string;
  detail: string;
  active: boolean;
  complete: boolean;
};

export function fundingGuideChecks(progress: number, accepted = false) {
  const value = Math.max(0, Math.min(1, progress));
  return [accepted || value >= 0.28, accepted || value >= 0.56, accepted || value >= 0.85];
}

export function fundingJourney(snapshot: FundingSnapshot, guideAccepted: boolean): FundingJourneyStage[] {
  const available = snapshot.status === 'available';
  if (available) return [
    {number: '01', title: 'Sending step complete', detail: 'USDC is already in your wallet.', active: false, complete: true},
    {number: '02', title: 'USDC available', detail: 'Your trading balance has been detected.', active: false, complete: true},
    {number: '03', title: 'Ready to start AI', detail: 'Return Home to review the managed amount.', active: true, complete: false},
  ];
  return [
    {number: '01', title: guideAccepted ? 'Safe sending confirmed' : 'Review safe sending', detail: guideAccepted ? 'USDC on Arbitrum is unlocked.' : 'Confirm the asset and network first.', active: !guideAccepted, complete: guideAccepted},
    {number: '02', title: 'Waiting for USDC', detail: 'Moeazi watches your Magic wallet.', active: guideAccepted, complete: false},
    {number: '03', title: 'Ready to start AI', detail: 'Available after USDC arrives.', active: false, complete: false},
  ];
}

export function fundingPresentation(snapshot: FundingSnapshot, guideAccepted = false) {
  const usdcAvailable = snapshot.status === 'available';
  return {
    usdcAvailable,
    ethOnly: hasPositiveAmount(snapshot.feeAsset.amount) && !usdcAvailable,
    primaryLabel: usdcAvailable ? 'Return home' : guideAccepted ? 'Copy USDC address' : 'Review before copying',
    message: usdcAvailable
      ? 'Your USDC is ready. Start AI will ask how much it may manage.'
      : 'Send USDC on Arbitrum.',
  };
}
