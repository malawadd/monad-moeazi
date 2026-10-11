import {useEffect, useRef, useState} from 'react';
import type {ManualPerplAccount} from '../types/manualPerpl';
import {formatMonadUnits} from './monadFormatting';

export function useManualPerplAccountAmounts(ownerAddress: string | null, account: ManualPerplAccount | null,
  minimumUnits: string | null, contextLoading: boolean, contextError: string) {
  const [amount, setAmount] = useState('');
  const [legacyAmount, setLegacyAmount] = useState('');
  const lastOwner = useRef(ownerAddress);
  const didAutoPrefill = useRef(false);

  useEffect(() => {
    if (lastOwner.current?.toLowerCase() === ownerAddress?.toLowerCase()) return;
    lastOwner.current = ownerAddress;
    didAutoPrefill.current = false;
    setAmount('');
    setLegacyAmount('');
  }, [ownerAddress]);

  useEffect(() => {
    if (didAutoPrefill.current || amount.trim() || !account || account.status !== 'not_created'
        || contextLoading || contextError || !minimumUnits) return;
    const allowance = BigInt(account.collateral.allowanceUnits);
    if (allowance < BigInt(minimumUnits) || allowance > BigInt(account.collateral.walletBalanceUnits)) return;
    didAutoPrefill.current = true;
    setAmount(formatMonadUnits(allowance.toString(), account.collateral.decimals));
  }, [account, amount, contextError, contextLoading, minimumUnits]);

  return {amount, setAmount, legacyAmount, setLegacyAmount};
}
