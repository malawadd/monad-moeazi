import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Field, Kicker, Screen} from '../components/Ui';
import {CalmReveal} from '../components/Motion';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {haptics} from '../services/haptics';

export function WelcomeScreen() {
  const {signIn, enterPreview, busy} = useApp();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  async function submit() {
    setError('');
    try { await signIn(email.trim()); haptics.confirm(); } catch (reason) { haptics.reject(); setError(reason instanceof Error ? reason.message : 'Sign-in could not be completed.'); }
  }
  return <Screen>
    <View style={styles.brand}><Kicker tone="yellow">AI trading, made understandable</Kicker><Text style={styles.wordmark}>MOEAZI</Text><Text style={styles.promise}>An AI trader that works within limits you control.</Text></View>
    <View style={styles.form}>
      <Field label="Your email" value={email} onChangeText={setEmail} onSubmitEditing={submit} returnKeyType="done" autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
      {error ? <CalmReveal><Text accessibilityRole="alert" style={styles.error}>{error}</Text></CalmReveal> : null}
      <Button label="Continue with Magic" onPress={submit} disabled={!email.includes('@')} loading={busy} hint="Signs in and recovers your existing Moeazi account" />
      <Text style={s.body}>Use the same Magic login on web and mobile to recover the same funds, AI settings, credits, and history.</Text>
    </View>
    {__DEV__ ? <View style={styles.preview}><Text style={s.strong}>Developer preview</Text><Text style={s.body}>Explore with local fixtures. Preview actions never submit trades or grant credits.</Text><Button variant="secondary" label="Explore preview" onPress={enterPreview} /></View> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  brand: {minHeight: 285, justifyContent: 'flex-end', gap: spacing.md, backgroundColor: colors.sky, borderWidth: 5, borderColor: colors.ink, padding: spacing.lg, shadowColor: colors.ink, shadowOffset: {width: 8, height: 8}, shadowOpacity: 1, shadowRadius: 0, elevation: 8},
  wordmark: {...type.display, color: colors.ink, fontSize: 58, lineHeight: 60, letterSpacing: -3}, promise: {...type.display, color: colors.ink, fontSize: 27, lineHeight: 30},
  form: {gap: spacing.md, paddingTop: spacing.md}, error: {...type.body, color: colors.ink, backgroundColor: colors.red, borderWidth: 3, borderColor: colors.ink, padding: 10, fontWeight: '800'},
  preview: {gap: spacing.sm, borderTopWidth: 3, borderColor: colors.ink, paddingTop: spacing.md},
});
