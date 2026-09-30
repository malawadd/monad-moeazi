import React, {createContext, PropsWithChildren, useContext, useEffect, useState} from 'react';
import {previewActivity, previewHome, previewLimits, previewMarkets} from '../data/fixtures';
import {AccountBootstrap, mobileApi, refreshSession} from '../services/apiClient';
import {clearSession} from '../services/sessionStore';
import {getDeviceIdentity, magicWallet} from '../services/wallet/MagicWalletAdapter';
import {ActivityItem, AutopilotLimits, MarketSummary, MobileHomeSnapshot} from '../types/mobile';

export type MobileStopResult = Awaited<ReturnType<typeof mobileApi.stopAutopilot>>;

type Mode = 'loading' | 'signed-out' | 'preview' | 'authenticated';
type AppState = {
  mode: Mode; ownerAddress: string | null; account: AccountBootstrap | null; home: MobileHomeSnapshot; limits: AutopilotLimits | null; markets: MarketSummary[]; activity: ActivityItem[]; busy: boolean;
  signIn(email: string): Promise<void>; enterPreview(): void; signOut(): Promise<void>; refreshHome(): Promise<MobileHomeSnapshot | undefined>; refreshActivity(): Promise<void>;
  refreshMagicChain(): Promise<{delegationState: 'required' | 'active'; blockNumber: number}>;
  loadLimits(): Promise<void>; startAutopilot(): Promise<void>; stopAutopilot(idempotencyKeys?: string[]): Promise<MobileStopResult | undefined>;
};

const Context = createContext<AppState | null>(null);

export function AppProvider({children}: PropsWithChildren) {
  const [mode, setMode] = useState<Mode>('loading');
  const [home, setHome] = useState(previewHome);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [limits, setLimits] = useState<AutopilotLimits | null>(null);
  const [account, setAccount] = useState<AccountBootstrap | null>(null);
  const [activityRows, setActivityRows] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function createBackendSession(identity: {address: string; email?: string}) {
    const device = await getDeviceIdentity();
    const challenge = await mobileApi.challenge(identity.address, device.deviceId);
    const signature = await magicWallet.signMessage(challenge.message, identity.address);
    await mobileApi.createSession({address: identity.address, signature, challengeToken: challenge.challengeToken, ...device, email: identity.email});
  }

  async function loadAuthenticated(identity: {address: string}) {
    const nextAccount = await mobileApi.bootstrapAccount();
    await mobileApi.refreshFunding().catch(() => undefined);
    const [nextHome, nextActivity] = await Promise.all([mobileApi.home(), mobileApi.activity()]);
    if (nextAccount.ownerAddress !== identity.address) throw new Error('The Moeazi account does not match the current Magic wallet.');
    setAccount(nextAccount); setHome(nextHome); setActivityRows(nextActivity); setOwnerAddress(identity.address); setLimits(null); setMode('authenticated');
  }

  useEffect(() => {
    (async () => {
      try {
        const identity = await magicWallet.restoreIdentity();
        if (!identity) return setMode('signed-out');
        const session = await refreshSession();
        if (session && session.session.walletAddress.toLowerCase() !== identity.address) {
          await clearSession(); await magicWallet.logout(); return setMode('signed-out');
        }
        if (!session) await createBackendSession(identity);
        await loadAuthenticated(identity);
      } catch { setMode('signed-out'); }
    })().catch(() => setMode('signed-out'));
  }, []);

  async function signIn(email: string) {
    setBusy(true);
    try {
      const identity = await magicWallet.loginWithEmail(email);
      await createBackendSession(identity);
      await loadAuthenticated(identity);
    } finally { setBusy(false); }
  }

  async function refreshHome(): Promise<MobileHomeSnapshot | undefined> {
    if (mode !== 'authenticated') return undefined;
    await mobileApi.refreshFunding().catch(() => undefined);
    const nextHome = await mobileApi.home();
    setHome(nextHome);
    return nextHome;
  }
  async function refreshActivity() { if (mode === 'authenticated') setActivityRows(await mobileApi.activity()); }
  async function refreshMagicChain() {
    if (mode !== 'authenticated' || !ownerAddress) throw new Error('Sign in with Magic first.');
    const result = await mobileApi.verifyMagicChain();
    if (result.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error('Arbitrum returned a different Magic owner.');
    }
    setAccount(current => current ? {...current, delegationState: result.delegationState,
      chainVerification: 'finalized', chainBlockNumber: result.blockNumber} : current);
    await refreshHome();
    return {delegationState: result.delegationState, blockNumber: result.blockNumber};
  }
  async function loadLimits() {
    if (mode === 'preview') { setLimits(previewLimits); return; }
    const current = await mobileApi.currentManagedSpotMandate();
    if (current.mandate?.status === 'active'
      && current.mandate.fundingOperation?.status === 'confirmed') {
      await mobileApi.activateManagedSpotVault();
    }
    setLimits(await mobileApi.autopilotLimits());
  }
  async function startAutopilot() {
    setBusy(true);
    try {
      if (mode === 'preview') setHome({...home, aiState: 'running', primaryAction: 'stop', statusMessage: 'The AI trader is working.'});
      else {
        setHome((await mobileApi.startAutopilot()).snapshot);
        await Promise.all([refreshHome(), refreshActivity()]).catch(() => undefined);
      }
    } finally { setBusy(false); }
  }
  async function stopAutopilot(idempotencyKeys: string[] = []) {
    setBusy(true);
    try {
      if (mode === 'preview') setHome({...home, aiState: 'paused', primaryAction: 'start', statusMessage: 'The AI trader is paused.'});
      else {
        const result = await mobileApi.stopAutopilot(idempotencyKeys);
        setHome(result.snapshot);
        await refreshActivity().catch(() => undefined);
        return result;
      }
    } finally { setBusy(false); }
  }
  async function signOut() {
    if (mode === 'authenticated') await mobileApi.logout();
    await magicWallet.logout(); setMode('signed-out'); setOwnerAddress(null); setAccount(null); setLimits(null); setActivityRows([]); setHome(previewHome);
  }

  const value = {mode, ownerAddress, account, home, limits, markets: mode === 'preview' ? previewMarkets : [], activity: mode === 'preview' ? previewActivity : activityRows, busy, signIn, enterPreview: () => { setLimits(previewLimits); setOwnerAddress(`0x${'1'.repeat(40)}`); setMode('preview'); }, signOut, refreshHome, refreshActivity, refreshMagicChain, loadLimits, startAutopilot, stopAutopilot};
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}

export {previewLimits};
