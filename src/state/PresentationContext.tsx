import React, {createContext, PropsWithChildren, useContext, useEffect, useRef, useState} from 'react';
import {loadPresentationPreferences, PresentationMode, savePresentationMode, saveShowAutonomousActivity, saveUserTheme, UserTheme} from '../services/presentationPreferences';

type ChangeResult = 'saved' | 'busy' | 'unavailable' | 'unchanged';
type PresentationState = {
  ready: boolean;
  presentationMode: PresentationMode;
  userTheme: UserTheme;
  showAutonomousActivity: boolean;
  effectiveTheme: UserTheme;
  setPresentationMode(mode: PresentationMode): Promise<ChangeResult>;
  setUserTheme(theme: UserTheme): Promise<boolean>;
  setShowAutonomousActivity(show: boolean): Promise<boolean>;
};
const Context = createContext<PresentationState | null>(null);

export function PresentationProvider({children}: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [presentationMode, setMode] = useState<PresentationMode>('user');
  const [userTheme, setTheme] = useState<UserTheme>('original');
  const [showAutonomousActivity, setShowAutonomousActivity] = useState(true);
  const modeCommitResolver = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    void loadPresentationPreferences().then(value => {
      if (!active) return;
      setMode(value.mode); setTheme(value.theme); setShowAutonomousActivity(value.showAutonomousActivity); setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const resolve = modeCommitResolver.current;
    if (resolve) { modeCommitResolver.current = null; resolve(); }
  }, [presentationMode]);

  async function changeMode(next: PresentationMode): Promise<ChangeResult> {
    if (next === presentationMode) return 'unchanged';
    return savePresentationMode(next, () => new Promise<void>(resolve => {
      modeCommitResolver.current = resolve;
      setMode(next);
    }));
  }

  async function changeTheme(next: UserTheme) {
    if (presentationMode !== 'user') return false;
    setTheme(next);
    return saveUserTheme(next);
  }

  async function changeShowAutonomousActivity(next: boolean) {
    setShowAutonomousActivity(next);
    return saveShowAutonomousActivity(next);
  }

  const value: PresentationState = {ready, presentationMode, userTheme, showAutonomousActivity,
    effectiveTheme: presentationMode === 'user' ? userTheme : 'original',
    setPresentationMode: changeMode, setUserTheme: changeTheme, setShowAutonomousActivity: changeShowAutonomousActivity};
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePresentation() {
  const value = useContext(Context);
  if (!value) throw new Error('usePresentation must be used inside PresentationProvider.');
  return value;
}
