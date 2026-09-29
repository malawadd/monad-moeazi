import React from 'react';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {border, colors, spacing, type} from '../theme/tokens';
import {haptics} from '../services/haptics';

export function TypographicTabBar({state, descriptors, navigation}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const {fontScale} = useWindowDimensions();
  const tall = fontScale >= 1.35;

  return (
    <View style={[tabStyles.shell, {paddingBottom: Math.max(insets.bottom, spacing.xs)}]}>
      <View style={[tabStyles.row, tall && tabStyles.rowTall]}>
        {state.routes.map((route, index) => {
          const active = state.index === index;
          const options = descriptors[route.key].options;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : route.name;
          const onPress = () => {
            const event = navigation.emit({type: 'tabPress', target: route.key, canPreventDefault: true});
            if (!active && !event.defaultPrevented) {
              haptics.selection();
              navigation.navigate(route.name, route.params);
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{selected: active}}
              accessibilityLabel={`${label} tab`}
              onPress={onPress}
              onLongPress={() => navigation.emit({type: 'tabLongPress', target: route.key})}
              style={({pressed}) => [tabStyles.item, tall && tabStyles.itemTall, active && tabStyles.active, pressed && tabStyles.pressed]}>
              <Text maxFontSizeMultiplier={2} numberOfLines={2} style={[tabStyles.label, tall && tabStyles.labelTall]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  shell: {backgroundColor: colors.paper, borderTopWidth: border.strong, borderColor: colors.ink},
  row: {height: 62, flexDirection: 'row', paddingHorizontal: spacing.xs, paddingTop: spacing.xs, gap: 3},
  rowTall: {height: 82},
  item: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2},
  itemTall: {minHeight: 66},
  active: {backgroundColor: colors.pink, borderWidth: border.nested, borderColor: colors.ink},
  pressed: {backgroundColor: colors.cream},
  label: {...type.meta, color: colors.ink, fontSize: 9, lineHeight: 12, textAlign: 'center', textTransform: 'uppercase'},
  labelTall: {fontSize: 10, lineHeight: 14, letterSpacing: 0.4},
});
