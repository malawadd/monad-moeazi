import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useNetInfo} from '@react-native-community/netinfo';
import {connectorsApi} from './connectorsApi';
import {quoteKey, validFiatAmount, validateFundingQuote} from './fundingQuote';
import {previewQuote} from '../fixtures/fundingQuote';
import type {FundingQuote, FundingQuoteInput} from '../types/fundingQuote';

export function useFundingQuote(input: FundingQuoteInput, owner: string | null, preview: boolean, available: boolean, version?: string) {
  const {provider, amount, fiatCurrency} = input;
  const focused = useIsFocused(), {isConnected} = useNetInfo();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{key: string; quote: FundingQuote | null; loading: boolean}>({key: '', quote: null, loading: false});
  const key = `${owner}:${preview}:${version}:${quoteKey(input)}`;
  const generation = useRef(0), current = useRef(key); current.current = key;
  const retry = useCallback(() => {setState({key: '', quote: null, loading: false}); setRevision(v => v + 1);}, []);
  useEffect(() => {const listener = AppState.addEventListener('change', next => setForeground(next === 'active')); return () => listener.remove();}, []);
  useEffect(() => {
    const id = ++generation.current;
    const requestInput = {provider, amount, fiatCurrency};
    if (!focused || !foreground || !available || !provider || !validFiatAmount(amount)) {setState({key, quote: null, loading: false}); return;}
    if (isConnected === false && !preview) {
      setState({key, loading: false, quote: {schemaVersion: '2026-09-29', provider: {id: provider, version: version ?? ''}, environment: 'sandbox', status: 'unavailable', code: 'UNAVAILABLE', message: 'You are offline. Reconnect to see an estimate or open checkout.'}}); return;
    }
    let disposed = false, expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setState({key, quote: null, loading: true});
    const timer = setTimeout(async () => {
      try {
        const quote = validateFundingQuote(preview ? previewQuote(requestInput) : await connectorsApi.quote(requestInput, controller.signal), requestInput, version);
        if (disposed || generation.current !== id || current.current !== key) return;
        setState({key, quote, loading: false});
        if (quote.status === 'ready') expiry = setTimeout(() => {
          if (!disposed && current.current === key) setState({key, loading: false, quote: {...quote, status: 'unavailable', code: 'EXPIRED', message: 'This estimate has expired. Check again or review the final amount in checkout.'}});
        }, Math.max(0, quote.expiresAt - Date.now()));
      } catch {
        if (!disposed && generation.current === id && current.current === key) setState({key, loading: false, quote: {schemaVersion: '2026-09-29', provider: {id: provider, version: version ?? ''}, environment: 'sandbox', status: 'unavailable', code: 'UNAVAILABLE', message: 'The estimate could not be loaded. Retry or check pricing in checkout.'}});
      }
    }, 750);
    return () => {disposed = true; controller.abort(); clearTimeout(timer); if (expiry) clearTimeout(expiry);};
  // Scalar keys prevent fetching again on unrelated screen renders.
  }, [key, provider, amount, fiatCurrency, focused, foreground, available, isConnected, preview, revision, version]);
  const eligible = focused && foreground && available && Boolean(input.provider) && validFiatAmount(input.amount);
  const visible = state.key === key && focused && foreground ? state : {quote: null, loading: eligible};
  return {quote: visible.quote, loading: visible.loading, retry};
}
