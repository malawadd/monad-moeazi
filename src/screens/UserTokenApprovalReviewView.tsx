import React, {useState} from 'react';
import type {MonadApprovalRequirement} from '../services/monadApi';
import {formatMonadUnits, shortenAddress} from '../services/monadFormatting';
import type {UserThemeTokens} from '../theme/userThemes';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';

export function UserTokenApprovalReviewView({theme, ownerAddress, approval, symbol, decimals, error, busy, returnRoute, onBack, onPrepare}: {
  theme: UserThemeTokens; ownerAddress: string | null; approval: MonadApprovalRequirement | null; symbol: string; decimals: number;
  error: string; busy: boolean; returnRoute?: string; onBack(): void; onPrepare(): void;
}) {
  const [details, setDetails] = useState(false);
  if (!approval) return <UserPage theme={theme}><UserButton label="Back" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="SPOT · APPROVAL" title="Approval unavailable" copy="Return to the swap and request a fresh quote." /></UserPage>;
  return <UserPage theme={theme}>
    <UserButton label="Back to swap" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="SPOT · TOKEN APPROVAL" title={`Approve ${symbol}`} copy="This sets the exact allowance requested for the original swap." />
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">Approval needs attention</UserText><UserText theme={theme}>{error}</UserText></UserCard> : null}
    <UserCard theme={theme} texture>
      <UserValueRow theme={theme} label="Allowance" value={`${formatMonadUnits(approval.amountUnits, decimals)} ${symbol}`} />
      <UserValueRow theme={theme} label="Network" value="Monad Testnet" />
      <UserText theme={theme}>This approval does not execute a swap. The service checks this exact allowance before preparing the original action.</UserText>
      <UserDisclosure theme={theme} label="Token and spender" value="Show addresses" expanded={details} onPress={() => setDetails(value => !value)}>
        <UserValueRow theme={theme} label="Token address" value={approval.tokenAddress} />
        <UserValueRow theme={theme} label="Spender" value={approval.spender} />
        <UserValueRow theme={theme} label="Network chain ID" value="10143" />
        <UserValueRow theme={theme} label="Exact allowance · base units" value={approval.amountUnits} />
        <UserValueRow theme={theme} label="Mera wallet" value={ownerAddress ? shortenAddress(ownerAddress) : 'Unavailable'} detail="The active wallet is confirmed again during preparation." />
      </UserDisclosure>
      {returnRoute ? <UserText theme={theme} kind="meta">After the approval finalizes, return to the original action for a fresh review.</UserText> : null}
      <UserButton label="Review exact approval" onPress={onPrepare} theme={theme} loading={busy} />
    </UserCard>
  </UserPage>;
}
