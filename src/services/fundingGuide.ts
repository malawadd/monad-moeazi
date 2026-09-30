import AsyncStorage from '@react-native-async-storage/async-storage';

export const FUNDING_GUIDE_VERSION = 'arbitrum-usdc-2026-09-14';

type FundingGuideAcknowledgement = {
  version: typeof FUNDING_GUIDE_VERSION;
  acceptedAt: number;
};

export function fundingGuideStorageKey(ownerAddress: string) {
  const owner = ownerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new Error('The Magic wallet address is invalid.');
  return `moeazi.monad.mobile.funding-guide.${FUNDING_GUIDE_VERSION}.${owner}`;
}

export function parseFundingGuideAcknowledgement(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<FundingGuideAcknowledgement>;
    if (parsed.version !== FUNDING_GUIDE_VERSION
      || !Number.isSafeInteger(parsed.acceptedAt)
      || Number(parsed.acceptedAt) <= 0) return null;
    return parsed as FundingGuideAcknowledgement;
  } catch {
    return null;
  }
}

export async function hasAcceptedFundingGuide(ownerAddress: string) {
  const stored = await AsyncStorage.getItem(fundingGuideStorageKey(ownerAddress));
  return Boolean(parseFundingGuideAcknowledgement(stored));
}

export async function acceptFundingGuide(ownerAddress: string, acceptedAt = Date.now()) {
  if (!Number.isSafeInteger(acceptedAt) || acceptedAt <= 0) {
    throw new Error('The confirmation time is invalid.');
  }
  const acknowledgement: FundingGuideAcknowledgement = {
    version: FUNDING_GUIDE_VERSION,
    acceptedAt,
  };
  await AsyncStorage.setItem(fundingGuideStorageKey(ownerAddress), JSON.stringify(acknowledgement));
  return acknowledgement;
}
