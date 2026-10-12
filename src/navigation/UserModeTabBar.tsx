import React from 'react';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {haptics} from '../services/haptics';
import {userThemeTokens} from '../theme/userThemes';
import {usePresentation} from '../state/PresentationContext';
import {userFonts} from '../theme/tokens';

export function UserModeTabBar({state, descriptors, navigation}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const {fontScale} = useWindowDimensions();
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const tall = fontScale >= 1.35;
  return <View style={[styles.shell, {backgroundColor: theme.background, borderColor: theme.border,
    paddingBottom: Math.max(insets.bottom, 6)}]}>
    <View style={[styles.row, tall && styles.rowTall]}>
      {state.routes.map((route, index) => {
        const selected = state.index === index;
        const options = descriptors[route.key].options;
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : route.name;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={`${label} tab`}
          accessibilityState={{selected}} onPress={() => {
            const event = navigation.emit({type: 'tabPress', target: route.key, canPreventDefault: true});
            if (!selected && !event.defaultPrevented) {haptics.selection(); navigation.navigate(route.name, route.params);}
          }} onLongPress={() => navigation.emit({type: 'tabLongPress', target: route.key})}
          style={({pressed}) => [styles.item, tall && styles.itemTall,
            pressed && styles.pressed]}>
          <View style={styles.iconWrap}>
            {selected ? <View pointerEvents="none" style={[styles.iconShadow, {backgroundColor: theme.shadow}]} /> : null}
            <View style={[styles.iconTile, {backgroundColor: selected ? theme.accent : 'transparent', borderColor: selected ? theme.accentBorder : 'transparent'}]}>
              <TabIcon name={route.name} color={selected ? theme.accentText : theme.muted} />
            </View>
          </View>
          <Text allowFontScaling maxFontSizeMultiplier={2}
            style={[styles.label, {color: selected ? theme.ink : theme.muted}, tall && styles.labelTall]}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function TabIcon({name, color}: {name: string; color: string}) {
  if (name === 'Home') return <View style={icons.house}>
    <View style={[icons.roof, {borderColor: color}]} /><View style={[icons.houseBox, {borderColor: color}]} /><View style={[icons.door, {backgroundColor: color}]} />
  </View>;
  if (name === 'Markets') return <View style={icons.candles}>
    {[0, 1, 2].map((item, index) => <View key={item} style={icons.candle}>
      <View style={[icons.wick, {backgroundColor: color}]} /><View style={[icons.candleBody, {borderColor: color, backgroundColor: index === 1 ? color : 'transparent'}]} />
    </View>)}
  </View>;
  if (name === 'Strategies') return <View style={[icons.target, {borderColor: color}]}>
    <View style={[icons.targetInner, {borderColor: color}]} /><View style={[icons.targetDot, {backgroundColor: color}]} />
  </View>;
  return <View style={icons.activity}>
    {[{w: 9, r: '-35deg'}, {w: 10, r: '32deg'}, {w: 9, r: '-42deg'}].map((line, index) =>
      <View key={index} style={[icons.activityLine, {width: line.w, backgroundColor: color, transform: [{rotate: line.r}]}]} />)}
  </View>;
}

const styles = StyleSheet.create({
  shell: {borderTopWidth: 3}, row: {minHeight: 68, flexDirection: 'row', paddingHorizontal: 4, paddingTop: 4, gap: 2},
  rowTall: {minHeight: 116, flexWrap: 'wrap'}, item: {flex: 1, minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, gap: 2},
  itemTall: {flexBasis: '44%', minHeight: 56}, iconWrap: {position: 'relative', width: 31, height: 29},
  iconTile: {width: 31, height: 29, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  iconShadow: {position: 'absolute', top: 2, left: 2, right: -2, bottom: -2},
  label: {fontFamily: userFonts.body, fontSize: 12, lineHeight: 16, fontWeight: '800', textAlign: 'center', flexShrink: 1},
  labelTall: {fontSize: 14, lineHeight: 19}, pressed: {transform: [{translateX: 2}, {translateY: 2}]},
});

const icons = StyleSheet.create({
  house: {width: 19, height: 18, alignItems: 'center', justifyContent: 'flex-end'},
  roof: {position: 'absolute', top: 1, width: 12, height: 12, borderTopWidth: 2, borderLeftWidth: 2, transform: [{rotate: '45deg'}]},
  houseBox: {width: 16, height: 11, borderWidth: 2, borderBottomWidth: 2}, door: {position: 'absolute', bottom: 1, width: 3, height: 6},
  candles: {width: 22, height: 20, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center'}, candle: {width: 5, height: 18, alignItems: 'center', justifyContent: 'center'},
  wick: {position: 'absolute', width: 2, height: 18}, candleBody: {width: 5, height: 8, borderWidth: 1},
  target: {width: 19, height: 19, borderWidth: 2, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  targetInner: {width: 10, height: 10, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center'},
  targetDot: {position: 'absolute', width: 4, height: 4, borderRadius: 2},
  activity: {width: 22, height: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  activityLine: {height: 2},
});
