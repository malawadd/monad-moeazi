import React from 'react';
import type {PerplRecoveryAction, PerplRecoveryReview} from '../../types/perpl';
import type {UserThemeTokens} from '../../theme/userThemes';
import {UserButton, UserCard, UserText, UserValueRow} from '../../components/user/UserPrimitives';
import {formatMonadTimestamp, formatMonadUnits, shortenAddress} from '../../services/monadFormatting';

export function UserPerplRecoveryView({theme, ownerAddress, canRecoverFunding, canRecoverAvailable,
  review, result, busy, uncertain, error, disabled, blockedReason, onPrepare, onSign, onCancel, onRefresh}: {
  theme: UserThemeTokens; ownerAddress: string | null;
  canRecoverFunding: boolean; canRecoverAvailable: boolean;
  review: PerplRecoveryReview | null; result: {action: PerplRecoveryAction; status: string; phase: string} | null;
  busy: boolean; uncertain: boolean; error: string; disabled: boolean; blockedReason: string;
  onPrepare(action: PerplRecoveryAction): void; onSign(): void; onCancel(): void; onRefresh(): void;
}) {
  if (!canRecoverFunding && !canRecoverAvailable && !review && !result && !uncertain && !error) return null;
  const maximumFee = review ? maxCost(review.recoveryTransaction.gasLimit, review.recoveryTransaction.maxFeePerGas) : null;
  const finalized = result?.phase === 'recovery_finalized' && result.status.toLowerCase() === 'completed';

  return <>
    {blockedReason ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Another signed action is still being checked</UserText>
      <UserText theme={theme}>{blockedReason}</UserText>
      <UserButton label="Refresh run status" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}
    {review ? <>
      <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Review AUSD return</UserText>
        <UserValueRow theme={theme} label="Action" value={actionLabel(review.action)} />
        <UserValueRow theme={theme} label="Returning to your Mera wallet" value={`${formatMonadUnits(review.amountUnits, 6)} AUSD`} />
        <UserValueRow theme={theme} label="From Perpl vault" value={shortenAddress(review.vaultAddress)} />
        <UserValueRow theme={theme} label="Maximum Mera network fee" value={maximumFee ? `${formatMonadUnits(maximumFee, 18)} MON` : 'Unavailable'} />
        <UserValueRow theme={theme} label="Network" value="Monad Testnet" />
        <UserValueRow theme={theme} label="Review expires" value={formatMonadTimestamp(review.preparedExpiresAt)} />
        <UserText theme={theme}>This request returns only the reviewed AUSD amount. Perpl and the vault recheck the run before the call can complete.</UserText>
        <UserValueRow theme={theme} label="Mera owner" value={shortenAddress(ownerAddress ?? review.ownerAddress)} />
      </UserCard>
      <UserButton label="Return AUSD with Mera" onPress={onSign} theme={theme}
        loading={busy} disabled={!maximumFee || disabled} />
      <UserButton label="Cancel recovery review" onPress={onCancel} theme={theme} secondary disabled={busy} />
    </> : null}

    {uncertain ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">AUSD return is still being checked</UserText>
      <UserText theme={theme}>Refresh this same run before preparing another return.</UserText>
      <UserButton label="Refresh run status" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}
    {result ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">{finalized ? 'AUSD return finalized' : 'AUSD return request sent'}</UserText>
      <UserText theme={theme}>{finalized ? 'The service confirmed this return. Refresh your wallet to see the updated balance.' : 'The service has not confirmed a final return yet. Check this run before taking another action.'}</UserText>
      {!finalized ? <UserValueRow theme={theme} label="Current status" value={humanize(result.status)} detail={humanize(result.phase)} /> : null}
      <UserButton label="Refresh run status" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}
    {error ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Return could not continue</UserText>
      <UserText theme={theme}>{uncertain ? 'The signed action may still be processing. Keep its saved reference and check the same run.' : 'Refresh this run before preparing a new review.'}</UserText>
      {!uncertain ? <UserText theme={theme} kind="meta">{error}</UserText> : null}
      <UserButton label="Refresh run status" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}

    {!review && !result && !uncertain && !error ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Review a possible AUSD return</UserText>
      <UserText theme={theme}>The current run state and a fresh review determine whether funds can return. Nothing is sent until you approve the exact Mera review.</UserText>
      {canRecoverFunding ? <UserButton label="Review setup-fund return" onPress={() => onPrepare('recover_vault_funding')}
        theme={theme} secondary loading={busy} disabled={disabled} /> : null}
      {canRecoverAvailable ? <UserButton label="Review available AUSD return" onPress={() => onPrepare('recover_available_ausd')}
        theme={theme} secondary loading={busy} disabled={disabled} /> : null}
      {!canRecoverFunding && !canRecoverAvailable ? <UserText theme={theme} kind="meta">AUSD is not currently available to return.</UserText> : null}
    </UserCard> : null}
  </>;
}

function actionLabel(action: PerplRecoveryAction) {
  return action === 'recover_vault_funding' ? 'Return setup funds' : 'Return available AUSD';
}
function maxCost(gasLimit: string, maxFee: string) {
  try { const value = BigInt(gasLimit) * BigInt(maxFee); return value > 0n ? value.toString() : null; } catch { return null; }
}
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
