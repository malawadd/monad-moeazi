import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {useNetInfo} from '@react-native-community/netinfo';
import {border, colors, spacing, type} from '../theme/tokens';

export function ConnectivityBanner() {
  const network = useNetInfo();
  if (network.isConnected !== false) return null;
  return <Text accessibilityRole="alert" style={styles.banner}>You are offline. Displayed information may be out of date.</Text>;
}

const styles = StyleSheet.create({
  banner: {...type.body, backgroundColor: colors.orange, color: colors.ink, borderBottomWidth: border.strong, borderColor: colors.ink, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontWeight: '800', textAlign: 'center'},
});
