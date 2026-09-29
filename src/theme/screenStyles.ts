import {StyleSheet} from 'react-native';
import {colors, spacing, type} from './tokens';

export const screenStyles = StyleSheet.create({
  stack: {gap: spacing.md}, row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm},
  heading: {...type.display, color: colors.ink, fontSize: 25, lineHeight: 27, letterSpacing: -0.6},
  subheading: {...type.display, color: colors.ink, fontSize: 20, lineHeight: 23},
  heroValue: {...type.display, color: colors.ink, fontSize: 49, lineHeight: 52, letterSpacing: -1.7},
  body: {...type.body, color: colors.muted, fontSize: 15, lineHeight: 22},
  strong: {...type.body, color: colors.ink, fontWeight: '800', fontSize: 16, lineHeight: 22},
  meta: {...type.meta, color: colors.muted, fontSize: 11, textTransform: 'uppercase'},
  divider: {height: 3, backgroundColor: colors.ink},
  alert: {borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.orangeTint, padding: spacing.sm, gap: 6},
  danger: {borderWidth: 5, borderColor: colors.ink, backgroundColor: colors.roseTint, padding: spacing.md, gap: spacing.sm},
});
