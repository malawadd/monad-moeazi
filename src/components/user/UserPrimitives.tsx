import React, {PropsWithChildren, useEffect, useRef} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextStyle, useWindowDimensions, View, ViewStyle} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {UserTheme} from '../../services/presentationPreferences';
import {userThemeTokens, type UserThemeTokens} from '../../theme/userThemes';
import {userFonts} from '../../theme/tokens';

export function UserPage({children, theme, safeTop = true, refreshing = false, onRefresh, scrollResetKey}: PropsWithChildren<{
  theme: UserThemeTokens; safeTop?: boolean; refreshing?: boolean; onRefresh?: () => void; scrollResetKey?: string;
}>) {
  const scrollRef = useRef<ScrollView>(null);
  const previousScrollResetKey = useRef(scrollResetKey);
  const edges = safeTop ? ['top', 'left', 'right', 'bottom'] as const : ['left', 'right', 'bottom'] as const;
  useEffect(() => {
    if (previousScrollResetKey.current !== scrollResetKey) {
      previousScrollResetKey.current = scrollResetKey;
      scrollRef.current?.scrollTo({y: 0, animated: false});
    }
  }, [scrollResetKey]);
  return <SafeAreaView edges={edges} style={[styles.safe, {backgroundColor: theme.background}]}>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content} refreshControl={onRefresh
        ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} colors={[theme.ink]} /> : undefined}>
      {children}
    </ScrollView>
  </SafeAreaView>;
}

export function UserHeading({kicker, title, copy, theme}: {kicker?: string; title: string; copy?: string; theme: UserThemeTokens}) {
  return <View style={styles.heading}>
    {kicker ? <Text style={[styles.kicker, {color: theme.muted}]}>{kicker}</Text> : null}
    <Text accessibilityRole="header" style={[styles.title, {color: theme.ink}]}>{title}</Text>
    {copy ? <Text style={[styles.body, {color: theme.muted}]}>{copy}</Text> : null}
  </View>;
}

export function UserCard({children, theme, style, texture = false}: PropsWithChildren<{
  theme: UserThemeTokens; style?: StyleProp<ViewStyle>; texture?: boolean;
}>) {
  return <View style={styles.cardWrap}>
    <View pointerEvents="none" style={[styles.cardShadow, {backgroundColor: theme.shadow}]} />
    <View style={[styles.card, {backgroundColor: theme.surface, borderColor: theme.border}, style]}>
      {texture ? <UserTexture theme={theme.id} height={5} /> : null}{children}
    </View>
  </View>;
}

export function UserText({children, theme, kind = 'body', style}: PropsWithChildren<{
  theme: UserThemeTokens; kind?: 'body' | 'meta' | 'value' | 'title'; style?: StyleProp<TextStyle>;
}>) {
  const base = kind === 'meta' ? styles.meta : kind === 'value' ? styles.value : kind === 'title' ? styles.cardTitle : styles.body;
  return <Text style={[base, {color: kind === 'meta' ? theme.muted : theme.ink}, style]}>{children}</Text>;
}

export function UserButton({label, onPress, theme, secondary = false, disabled = false, loading = false, hint}: {
  label: string; onPress: () => void; theme: UserThemeTokens; secondary?: boolean; disabled?: boolean; loading?: boolean; hint?: string;
}) {
  return <View style={styles.buttonWrap}>
    <View pointerEvents="none" style={[styles.buttonShadow, {backgroundColor: theme.shadow}]} />
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{disabled: disabled || loading, busy: loading}} disabled={disabled || loading} onPress={onPress}
      style={({pressed}) => [styles.button, {backgroundColor: secondary ? theme.raised : theme.accent,
        borderColor: secondary ? theme.border : theme.accentBorder, opacity: disabled || loading ? 0.55 : 1}, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, {color: secondary ? theme.ink : theme.accentText}]}>{loading ? 'Please wait…' : label}</Text>
    </Pressable>
  </View>;
}

export function UserValueRow({label, value, theme, detail}: {label: string; value: string; theme: UserThemeTokens; detail?: string}) {
  const stack = useWindowDimensions().fontScale >= 1.35 || value.length > 26 || label.length > 28;
  return <View style={[styles.valueRow, stack && styles.valueRowStacked, {borderBottomColor: theme.border}]}>
    <View style={[styles.rowCopy, stack && styles.rowCopyStacked]}><Text style={[styles.meta, {color: theme.muted}]}>{label}</Text>
      {detail ? <Text style={[styles.body, {color: theme.muted}]}>{detail}</Text> : null}</View>
    <Text style={[styles.rowValue, stack && styles.rowValueStacked, {color: theme.ink}]}>{value}</Text>
  </View>;
}

export function UserDisclosure({label, value, expanded, onPress, children, theme}: PropsWithChildren<{
  label: string; value: string; expanded: boolean; onPress: () => void; theme: UserThemeTokens;
}>) {
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`${label}: ${value}`}
      onPress={onPress} style={[styles.disclosure, {backgroundColor: theme.surface, borderColor: theme.border}]}>
      <Text style={[styles.buttonText, {color: theme.ink, flex: 1}]}>{label}</Text>
      <Text style={[styles.meta, {color: theme.ink}]}>{expanded ? 'HIDE' : 'SHOW'}</Text>
    </Pressable>
    {expanded ? <View accessibilityLiveRegion="polite" style={[styles.disclosureBody, {borderColor: theme.border, backgroundColor: theme.raised}]}>{children}</View> : null}
  </View>;
}

export function UserTexture({theme: themeId, height = 54}: {theme: UserTheme; height?: number}) {
  const theme = userThemeTokens(themeId);
  if (theme.texture === 'none') return null;
  const color = theme.ink;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no"
    style={[styles.texture, {height, backgroundColor: theme.background, borderBottomColor: theme.border}]}>
    {theme.texture === 'grid' ? Array.from({length: 10}, (_, index) => <View key={`g${index}`}
      style={[styles.patternLine, {left: `${index * 11}%`, backgroundColor: color, opacity: 0.24}]} />) : null}
    {theme.texture === 'dots' ? Array.from({length: 16}, (_, index) => <View key={`d${index}`}
      style={[styles.dot, {left: `${3 + (index % 8) * 13}%`, top: index < 8 ? 1 : 3, backgroundColor: color}]} />) : null}
    {theme.texture === 'checker' ? Array.from({length: 2}, (_, index) => <View key={`c${index}`}
      style={[styles.check, {right: index ? 1 : 7, top: 0, backgroundColor: color}]} />) : null}
  </View>;
}

const styles = StyleSheet.create({
  safe: {flex: 1}, content: {flexGrow: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 30, gap: 16},
  heading: {gap: 8}, kicker: {fontFamily: userFonts.mono, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase'},
  title: {fontFamily: userFonts.display, fontSize: 34, lineHeight: 40, fontWeight: '800'},
  body: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 23, fontWeight: '500'},
  meta: {fontFamily: userFonts.mono, fontSize: 11, lineHeight: 17, fontWeight: '700', letterSpacing: 0.25},
  value: {fontFamily: userFonts.display, fontSize: 26, lineHeight: 34, fontWeight: '800'},
  cardTitle: {fontFamily: userFonts.display, fontSize: 20, lineHeight: 26, fontWeight: '800'},
  cardWrap: {position: 'relative', marginRight: 5, marginBottom: 5},
  cardShadow: {position: 'absolute', top: 5, left: 5, right: -5, bottom: -5},
  card: {borderWidth: 3, borderRadius: 0, padding: 14, gap: 12, overflow: 'hidden'},
  buttonWrap: {position: 'relative', marginRight: 4, marginBottom: 5, overflow: 'visible'},
  button: {minHeight: 52, borderWidth: 3, borderRadius: 0, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10},
  buttonShadow: {position: 'absolute', top: 5, left: 5, right: -4, bottom: -5},
  buttonText: {fontFamily: userFonts.body, fontWeight: '800', fontSize: 15, lineHeight: 22, textAlign: 'center'}, pressed: {transform: [{translateX: 2}, {translateY: 2}]},
  valueRow: {minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9},
  rowCopy: {flex: 1, minWidth: 0, gap: 2}, rowCopyStacked: {flex: 0, alignSelf: 'stretch'},
  rowValue: {fontFamily: userFonts.body, fontSize: 16, lineHeight: 22, fontWeight: '800', flexBasis: '58%', maxWidth: '58%', minWidth: 0, flexShrink: 1, textAlign: 'right'},
  valueRowStacked: {flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 5},
  rowValueStacked: {flexBasis: 'auto', maxWidth: '100%', alignSelf: 'stretch', textAlign: 'left'},
  disclosure: {minHeight: 54, borderWidth: 3, borderRadius: 0, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10},
  disclosureBody: {borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 14, gap: 10},
  texture: {position: 'relative', marginTop: -14, marginHorizontal: -14, marginBottom: 5, borderBottomWidth: 1, overflow: 'hidden'},
  patternLine: {position: 'absolute', top: 0, bottom: 0, width: 1}, dot: {position: 'absolute', width: 1.5, height: 1.5, borderRadius: 1},
  check: {position: 'absolute', width: 5, height: 5, opacity: 0.35},
});
