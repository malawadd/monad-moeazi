import React from 'react';
import {View} from 'react-native';
import {Button, Notice} from '../components/Ui';
import {spacing} from '../theme/tokens';
import {formatUnits} from 'viem';

type Release = {status: string; vaultUsdcUnits?: string};

export function ManagedVaultReleaseControl({release, sent, busy, onSend, onRefresh}: {
  release: Release | null; sent: boolean; busy: boolean;
  onSend: () => void; onRefresh: () => void;
}) {
  if (release?.status === 'released') return <Notice live tone="mint"
    title="Managed capital returned" message="Finalized vault and USDC transfer evidence confirm the return to Magic. Review the refreshed wallet balance below." />;
  if (release?.status === 'awaiting_finality') return <View style={{gap: spacing.sm}}>
    <Notice live tone="sky" title="Checking vault return" message="The vault is empty. Moeazi is verifying the finalized owner transaction and USDC transfer before withdrawal." />
    <Button label="Check finalized return" loading={busy} onPress={onRefresh} />
  </View>;
  if (release?.status === 'reconciliation_needed') return <View style={{gap: spacing.sm}}>
    <Notice live tone="orange" title="Return confirmed, accounting pending"
      message="Magic's finalized USDC transfer is verified. Moeazi is reconciling the financial account before withdrawal review." />
    <Button label="Check finance reconciliation" loading={busy} onPress={onRefresh} />
  </View>;
  if (release?.status !== 'ready' && !sent) return null;
  const amount = formatUnits(BigInt(release?.vaultUsdcUnits ?? '0'), 6);
  return <View style={{gap: spacing.sm}}>
    <Notice live tone="orange" title="Return managed USDC to Magic"
      message={`${amount} USDC is in your stopped, flat vault. Magic must sign its return before the wallet withdrawal.`} />
    <Button label={sent ? 'Check finalized return' : 'Return to Magic wallet'}
      loading={busy} onPress={sent ? onRefresh : onSend} />
  </View>;
}
