import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {UserTheme} from '../../services/presentationPreferences';
import {userFonts} from '../../theme/tokens';
import {contrastRatio, USER_THEME_CATALOG, userThemeTokens} from '../../theme/userThemes';

export function UserThemePicker({selected, onSelect}: {selected: UserTheme; onSelect(theme: UserTheme): Promise<boolean>}) {
  const {fontScale} = useWindowDimensions();
  const [saveFailed, setSaveFailed] = useState(false);
  const [focusedId, setFocusedId] = useState<UserTheme | null>(null);
  const stacked = fontScale >= 1.35;
  const activeTokens = userThemeTokens(selected);
  async function choose(theme: UserTheme) {
    try { setSaveFailed(!(await onSelect(theme))); }
    catch { setSaveFailed(true); }
  }
  return <View style={styles.container}>
    <Text accessibilityRole="header" accessibilityLabel="Appearance"
      style={[styles.title, {color: activeTokens.ink}]}>{stacked ? 'Theme' : 'Appearance'}</Text>
    <Text style={[styles.help, {color: activeTokens.muted}]}>Choose a look for Moeazi on this device.</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance themes" style={styles.grid}>
      {USER_THEME_CATALOG.map(theme => {
        const original = theme.id === 'original';
        const focused = focusedId === theme.id;
        const focusColor = contrastRatio(theme.focus, theme.background) >= contrastRatio(theme.focusHalo, theme.background)
          ? theme.focus : theme.focusHalo;
        return <View key={theme.id} style={[styles.choiceWrap, original && styles.originalWrap, stacked && !original && styles.stackedWrap]}>
          <View pointerEvents="none" style={[styles.choiceShadow, {backgroundColor: theme.shadow}]} />
          <Pressable accessibilityRole="radio" accessibilityLabel={`${theme.label}. ${theme.description}`}
            focusable accessibilityState={{checked: selected === theme.id}} onFocus={() => setFocusedId(theme.id)}
            onBlur={() => setFocusedId(value => value === theme.id ? null : value)} onPress={() => { void choose(theme.id); }}
            style={({pressed}) => [styles.choice, original && styles.originalChoice, stacked && !original && styles.stackedChoice,
              {backgroundColor: theme.background, borderColor: theme.border},
              selected === theme.id && {borderColor: theme.border},
              focused && {borderWidth: 4, borderColor: focusColor}, pressed && styles.pressed]}>
            {!original && !stacked ? <ThemePreview theme={theme.id} /> : null}
            <View style={styles.choiceRow}>
              <View style={[styles.radio, {borderColor: selected === theme.id ? theme.accentBorder : theme.border, backgroundColor: selected === theme.id ? theme.accent : theme.background}]}>
                {selected === theme.id ? <View style={[styles.radioDot, {backgroundColor: theme.accentText}]} /> : null}
              </View>
              <View style={styles.copy}>
                <Text style={[styles.label, {color: theme.ink}]}>{theme.label}</Text>
                <Text style={[styles.description, {color: theme.muted}]}>{theme.description}</Text>
              </View>
              {original && !stacked ? <ThemePreview theme={theme.id} compact /> : null}
            </View>
          </Pressable>
        </View>;
      })}
    </View>
    {saveFailed ? <Text accessibilityRole="alert" style={[styles.failure, {color: activeTokens.ink, backgroundColor: activeTokens.warning, borderColor: activeTokens.border}]}>This look is active for now, but could not be saved on this device.</Text> : null}
  </View>;
}

function ThemePreview({theme: id, compact = false}: {theme: UserTheme; compact?: boolean}) {
  const theme = userThemeTokens(id);
  const count = compact ? 4 : 6;
  return <View accessibilityElementsHidden importantForAccessibility="no"
    style={[styles.preview, compact && styles.previewCompact, {backgroundColor: theme.background, borderColor: theme.border}]}>
    {theme.texture === 'grid' ? <View pointerEvents="none" style={styles.pattern}>
      {Array.from({length: count}, (_, index) => <View key={`v${index}`} style={[styles.gridLine, {left: `${(index + 1) * (100 / (count + 1))}%`, backgroundColor: theme.accent}]} />)}
      {Array.from({length: 3}, (_, index) => <View key={`h${index}`} style={[styles.gridLineHorizontal, {top: `${(index + 1) * 25}%`, backgroundColor: theme.accent}]} />)}
    </View> : null}
    {theme.texture === 'dots' ? <View pointerEvents="none" style={styles.pattern}>
      {Array.from({length: count * 3}, (_, index) => <View key={`d${index}`} style={[styles.dot,
        {left: `${6 + (index % count) * (88 / Math.max(1, count - 1))}%`, top: `${17 + Math.floor(index / count) * 30}%`, backgroundColor: theme.ink}]} />)}
    </View> : null}
    {theme.texture === 'checker' ? <View pointerEvents="none" style={styles.pattern}>
      {Array.from({length: 6}, (_, index) => {
        const row = Math.floor(index / 3), column = index % 3;
        return (row + column) % 2 === 0 ? <View key={`c${index}`} style={[styles.check,
          {left: `${column * 34}%`, top: `${row * 50}%`, backgroundColor: theme.ink}]} /> : null;
      })}
    </View> : null}
    <View style={[styles.swatch, {backgroundColor: theme.accent, borderColor: theme.accentBorder}]} />
    <View style={[styles.swatch, styles.swatchTall, {backgroundColor: theme.pink, borderColor: theme.border}]} />
    <View style={[styles.swatch, styles.swatchShort, {backgroundColor: theme.ink, borderColor: theme.border}]} />
  </View>;
}

const styles = StyleSheet.create({
  container: {gap: 6}, title: {fontFamily: userFonts.display, fontSize: 20, lineHeight: 26, fontWeight: '800'},
  help: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 20}, grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 9},
  choiceWrap: {position: 'relative', width: '46%'},
  originalWrap: {width: '100%'}, stackedWrap: {width: '100%'},
  choiceShadow: {position: 'absolute', top: 4, left: 4, right: -4, bottom: -4},
  choice: {width: '100%', minHeight: 132, padding: 8, borderWidth: 2, borderRadius: 0, justifyContent: 'flex-start', gap: 7},
  originalChoice: {width: '100%', minHeight: 64, justifyContent: 'center'}, stackedChoice: {width: '100%', minHeight: 104},
  choiceRow: {flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34}, copy: {flex: 1, minWidth: 0, gap: 2},
  label: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 19, fontWeight: '800'}, description: {fontFamily: userFonts.body, fontSize: 12, lineHeight: 16},
  radio: {width: 20, height: 20, borderWidth: 2, borderRadius: 11, alignItems: 'center', justifyContent: 'center'}, radioDot: {width: 8, height: 8, borderRadius: 5},
  preview: {height: 70, borderWidth: 1, position: 'relative', flexDirection: 'row', alignItems: 'flex-end', gap: 5, padding: 6, overflow: 'hidden'},
  previewCompact: {width: 94, height: 38, flexShrink: 0, gap: 3, padding: 4},
  swatch: {width: 12, height: 18, borderWidth: 1}, swatchTall: {height: 27}, swatchShort: {height: 13},
  pattern: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.28},
  gridLine: {position: 'absolute', top: 0, bottom: 0, width: 1}, gridLineHorizontal: {position: 'absolute', left: 0, right: 0, height: 1},
  dot: {position: 'absolute', width: 2, height: 2, borderRadius: 1},
  check: {position: 'absolute', width: '32%', height: '48%', opacity: 0.34},
  pressed: {transform: [{translateX: 2}, {translateY: 2}]},
  failure: {borderWidth: 2, padding: 10, fontFamily: userFonts.body, fontSize: 14, lineHeight: 20},
});
