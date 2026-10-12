import React, {createContext, PropsWithChildren, useContext, useEffect, useState} from 'react';
import {previewActivity, previewHome, previewLimits, previewMarkets} from '../data/fixtures';
import {AccountBootstrap, mobileApi, refreshSession} from '../services/apiClient';
import {getNotificationPreferences, getPushRegistrationAdapter} from '../services/notifications/NotificationClient';
import {publishNotificationActivityRefresh} from '../services/notifications/NotificationEvents';
import {clearSession} from '../services/sessionStore';
import {getDeviceIdentity} from '../services/deviceIdentity';
import {openMeraSigningSession, type PasskeyAction} from '../services/wallet/meraAuth';
import {ActivityItem, AutopilotLimits, MarketSummary, MobileHomeSnapshot} from '../types/mobile';
import {clearOwnerScopedQueryCache} from '../services/queryCache';

export type MobileStopResult = Awaited<ReturnType<typeof mobileApi.stopAutopilot>>;
type Mode = 'loading' | 'signed-out' | 'preview' | 'authenticated';
type AppState = {
  mode: Mode; ownerAddress: string | null; account: AccountBootstrap | null; home: MobileHomeSnapshot; limits: AutopilotLimits | null; markets: MarketSummary[]; activity: ActivityItem[]; busy: boolean;
  signIn(action: PasskeyAction): Promise<void>; enterPreview(): void; signOut(): Promise<void>; refreshHome(): Promise<MobileHomeSnapshot | undefined>; refreshActivity(): Promise<void>;
  refreshMagicChain(): Promise<{delegationState: 'required' | 'active'; blockNumber: number}>;
  loadLimits(): Promise<void>; startAutopilot(): Promise<void>; stopAutopilot(idempotencyKeys?: string[]): Promise<MobileStopResult | undefined>;
};

const Context = createContext<AppState | null>(null);
const validAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);

async function restorePushRegistration() {
  try {
    const preferences = await getNotificationPreferences();
    if (preferences.enabled) await getPushRegistrationAdapter().registerDevice();
  } catch {
    // Push is optional; offline and Google-services-free devices remain usable.
  }
}

export function AppProvider({children}: PropsWithChildren) {
  const [mode, setMode] = useState<Mode>('loading');
  const [home, setHome] = useState(previewHome);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [limits, setLimits] = useState<AutopilotLimits | null>(null);
  const [account, setAccount] = useState<AccountBootstrap | null>(null);
  const [activityRows, setActivityRows] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadAuthenticated(address: string) {
    // Clear the previous owner's in-memory data before committing the new owner.
    // A post-commit effect can cancel queries started by a cold deep-linked screen.
    clearOwnerScopedQueryCache();
    setAccount(null); setHome(previewHome); setActivityRows([]); setLimits(null);
    setOwnerAddress(address.toLowerCase()); setMode('authenticated');
  }

  useEffect(() => {
    let active = true;
    void refreshSession().then(session => {
      if (!active) return;
      const address = session?.session.walletAddress;
      if (!validAddress(address) || session?.session.subject !== `mera:${address.toLowerCase()}`) {
        void clearSession(); clearOwnerScopedQueryCache(); setMode('signed-out'); return;
      }
      void loadAuthenticated(address);
    }).catch(() => { if (active) { clearOwnerScopedQueryCache(); setMode('signed-out'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (mode !== 'authenticated') return;
    void restorePushRegistration();
    return getPushRegistrationAdapter().subscribeForeground(() => {
      // The finalized event remains in Activity; refresh its Mera timeline in foreground.
      publishNotificationActivityRefresh();
    });
  }, [mode]);

  async function signIn(action: PasskeyAction) {
    setBusy(true);
    let wallet: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    try {
      wallet = await openMeraSigningSession(action);
      const device = await getDeviceIdentity();
      const challenge = await mobileApi.challenge(wallet.address, device.deviceId);
      const signature = await wallet.signMessage(challenge.message);
      const result = await mobileApi.createSession({address: wallet.address, signature,
        challengeToken: challenge.challengeToken, ...device});
      await loadAuthenticated(result.session.walletAddress);
    } finally {
      wallet?.end();
      setBusy(false);
    }
  }

  async function refreshHome(): Promise<MobileHomeSnapshot | undefined> {
    if (mode !== 'authenticated') return undefined;
    return await mobileApi.home();
  }
  async function refreshActivity() {
    if (mode === 'authenticated') setActivityRows(await mobileApi.activity());
  }
  async function refreshMagicChain(): Promise<{delegationState: 'required' | 'active'; blockNumber: number}> {
    throw new Error('Chain actions are paused during the Mera sign-in rollout.');
  }
  async function loadLimits() { throw new Error('Trading actions are paused during the Mera sign-in rollout.'); }
  async function startAutopilot() { throw new Error('Trading actions are paused during the Mera sign-in rollout.'); }
  async function stopAutopilot(_idempotencyKeys: string[] = []): Promise<MobileStopResult> { throw new Error('Trading actions are paused during the Mera sign-in rollout.'); }

  async function signOut() {
    if (mode === 'authenticated') await getPushRegistrationAdapter().unregisterDevice().catch(() => undefined);
    if (mode === 'authenticated') await mobileApi.logout().catch(() => undefined);
    await clearSession(); clearOwnerScopedQueryCache(); setMode('signed-out'); setOwnerAddress(null); setAccount(null);
    setLimits(null); setActivityRows([]); setHome(previewHome);
  }

  const value: AppState = {mode, ownerAddress, account, home,
    limits, markets: mode === 'preview' ? previewMarkets : [],
    activity: mode === 'preview' ? previewActivity : activityRows, busy,
    signIn, enterPreview: () => { clearOwnerScopedQueryCache(); setLimits(previewLimits); setOwnerAddress(null); setMode('preview'); },
    signOut, refreshHome, refreshActivity, refreshMagicChain, loadLimits, startAutopilot, stopAutopilot};
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}

export {previewLimits};
