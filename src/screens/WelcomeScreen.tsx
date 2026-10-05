import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Kicker, Screen} from '../components/Ui';
import {CalmReveal} from '../components/Motion';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {haptics} from '../services/haptics';

export function WelcomeScreen() {
  const {signIn, busy} = useApp();
  const [error, setError] = useState('');
  async function submit(action: 'create' | 'signin') {
    setError('');
    try { await signIn(action); haptics.confirm(); }
    catch (reason) { haptics.reject(); setError(reason instanceof Error ? reason.message : 'Passkey sign-in could not be completed.'); }
  }
  return <Screen>
    <View style={styles.brand}>
      <Kicker tone="yellow">Your account, secured by a passkey</Kicker>
      <Text style={styles.wordmark}>MOEAZI</Text>
      <Text style={styles.promise}>Sign in securely with Mera.</Text>
    </View>
    <View style={styles.form}>
      {error ? <CalmReveal><Text accessibilityRole="alert" style={styles.error}>{error}</Text></CalmReveal> : null}
      <Button label="Create passkey" onPress={() => {void submit('create');}} loading={busy} hint="Create a new passkey and sign in to Moeazi." />
      <Button label="Sign in with passkey" variant="secondary" onPress={() => {void submit('signin');}} loading={busy} hint="Use a passkey already created for Moeazi." />
      <Text style={s.body}>Passkeys need a provider that supports the WebAuthn PRF extension, such as Google Password Manager or 1Password.</Text>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  brand: {minHeight: 285, justifyContent: 'flex-end', gap: spacing.md, backgroundColor: colors.sky, borderWidth: 5, borderColor: colors.ink, padding: spacing.lg, shadowColor: colors.ink, shadowOffset: {width: 8, height: 8}, shadowOpacity: 1, shadowRadius: 0, elevation: 8},
  wordmark: {...type.display, color: colors.ink, fontSize: 58, lineHeight: 60, letterSpacing: -3},
  promise: {...type.display, color: colors.ink, fontSize: 27, lineHeight: 30},
  form: {gap: spacing.md, paddingTop: spacing.md},
  error: {...type.body, color: colors.ink, backgroundColor: colors.red, borderWidth: 3, borderColor: colors.ink, padding: 10, fontWeight: '800'},
});
