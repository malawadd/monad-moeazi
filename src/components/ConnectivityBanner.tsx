import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {useNetInfo} from '@react-native-community/netinfo';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {border, colors, spacing, type, userFonts} from '../theme/tokens';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';

export function ConnectivityBanner() {
  const network = useNetInfo();
  const insets = useSafeAreaInsets();
  const {presentationMode, effectiveTheme} = usePresentation();
  if (network.isConnected !== false) return null;
  if (presentationMode === 'user') {
    const theme = userThemeTokens(effectiveTheme);
    return <Text accessibilityRole="alert" style={[styles.userBanner, {paddingTop: Math.max(0, insets.top) + 4,
      color: theme.ink, backgroundColor: theme.warning, borderColor: theme.border}]}>
      Offline · showing last known data
    </Text>;
  }
  return <Text accessibilityRole="alert" style={styles.banner}>You are offline. Displayed information may be out of date.</Text>;
}

const styles = StyleSheet.create({
  banner: {...type.body, backgroundColor: colors.orange, color: colors.ink, borderBottomWidth: border.strong, borderColor: colors.ink, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontWeight: '800', textAlign: 'center'},
  userBanner: {fontFamily: userFonts.body, fontSize: 13, lineHeight: 19, fontWeight: '800', textAlign: 'center',
    minHeight: 38, paddingHorizontal: 12, paddingBottom: 6, borderBottomWidth: 2},
});
