import React, {useState} from 'react';
import {StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {UserButton, UserCard, UserDisclosure, UserPage, UserText} from '../components/user/UserPrimitives';
import {haptics} from '../services/haptics';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userFonts} from '../theme/tokens';
import {userThemeTokens} from '../theme/userThemes';

type SignInAction = 'signin' | 'create';

export function UserWelcomeScreen() {
  const {signIn, busy} = useApp();
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const {width, fontScale} = useWindowDimensions();
  const wordmarkSize = Math.min(48, Math.max(18, (width - 75) / (4.2 * fontScale)));
  const [error, setError] = useState('');
  const [providerHelpOpen, setProviderHelpOpen] = useState(false);

  async function continueWithPasskey(action: SignInAction) {
    setError('');
    try {
      await signIn(action);
      haptics.confirm();
    } catch (reason) {
      haptics.reject();
      setError(reason instanceof Error ? reason.message : 'Passkey sign-in could not be completed.');
    }
  }

  return <UserPage theme={theme}>
    <UserCard theme={theme} style={{backgroundColor: theme.accent, borderColor: theme.accentBorder}} texture>
      <Text style={[styles.wordmark, {color: theme.accentText, fontSize: wordmarkSize, lineHeight: wordmarkSize * 1.2}]}>MOEAZI</Text>
      <UserText theme={theme} kind="meta" style={{color: theme.accentText}}>MONAD TESTNET · PRACTICE ONLY</UserText>
      <Text style={[styles.promise, {color: theme.accentText}]}>Your wallet, secured by a passkey.</Text>
      <Text style={[styles.intro, {color: theme.accentText}]}>Use test tokens on Monad Testnet. They have no real-world value.</Text>
    </UserCard>

    <View style={styles.actions}>
      {busy ? <Text accessibilityLiveRegion="polite" style={[styles.status, {color: theme.muted}]}>Continue in your passkey provider. You can cancel there to return.</Text> : null}
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
        style={[styles.error, {color: theme.ink, backgroundColor: theme.danger, borderColor: theme.border}]}>{error}</Text> : null}
      <UserButton label="Sign in with passkey" onPress={() => continueWithPasskey('signin')} theme={theme}
        loading={busy} hint="Use a passkey already created for Moeazi." />
      <UserButton label="Create passkey" onPress={() => continueWithPasskey('create')} theme={theme}
        secondary disabled={busy} hint="Create a new passkey and sign in to Moeazi." />
    </View>

    <UserDisclosure theme={theme} label="Passkey provider help" value="Optional" expanded={providerHelpOpen}
      onPress={() => setProviderHelpOpen(value => !value)}>
      <UserText theme={theme}>Passkeys need a provider that supports the WebAuthn PRF extension, such as Google Password Manager or 1Password.</UserText>
    </UserDisclosure>
  </UserPage>;
}

const styles = StyleSheet.create({
  wordmark: {fontFamily: userFonts.display, fontWeight: '900', letterSpacing: -2, flexShrink: 1},
  promise: {fontFamily: userFonts.display, fontSize: 24, lineHeight: 31, fontWeight: '800'},
  intro: {fontFamily: userFonts.body, fontSize: 16, lineHeight: 24, fontWeight: '700'},
  actions: {gap: 12},
  status: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 21, fontWeight: '700'},
  error: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 23, fontWeight: '800', borderWidth: 3, padding: 12},
});
