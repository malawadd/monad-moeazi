import React from 'react';
import {createBottomTabNavigator, type BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useNavigation} from '@react-navigation/native';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ActivityScreen} from '../screens/ActivityScreen';
import {MarketsScreen} from '../screens/MarketsScreen';
import {MonadHomeScreen} from '../screens/MonadHomeScreen';
import {StrategiesScreen} from '../screens/StrategiesScreen';
import {AccountScreen} from '../screens/AccountScreen';
import {UserHomeScreen} from '../screens/UserHomeScreen';
import {usePresentation} from '../state/PresentationContext';
import {colors, spacing, type, userFonts} from '../theme/tokens';
import {userThemeTokens} from '../theme/userThemes';
import {TypographicTabBar} from './TypographicTabBar';
import {UserModeTabBar} from './UserModeTabBar';

const Tabs = createBottomTabNavigator();
const renderDeveloperTabBar = (props: BottomTabBarProps) => <TypographicTabBar {...props} />;
const renderUserTabBar = (props: BottomTabBarProps) => <UserModeTabBar {...props} />;

/** One stable tab navigator preserves the shared tab state while presentation changes. */
export function PresentationTabs() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const largeText = useWindowDimensions().fontScale >= 1.35;
  const {presentationMode, effectiveTheme} = usePresentation();
  const userMode = presentationMode === 'user';
  const theme = userThemeTokens(effectiveTheme);
  const tabs = <Tabs.Navigator key="presentation-tabs" initialRouteName="Home" screenOptions={{headerShown: false}} tabBar={userMode ? renderUserTabBar : renderDeveloperTabBar}>
      <Tabs.Screen name="Home" component={userMode ? UserHomeScreen : MonadHomeScreen} />
      <Tabs.Screen name="Markets" component={MarketsScreen} />
      <Tabs.Screen name="Strategies" component={StrategiesScreen} />
      <Tabs.Screen name="Activity" component={ActivityScreen} />
      {userMode ? null : <Tabs.Screen name="Account" component={AccountScreen} />}
    </Tabs.Navigator>;
  return <View style={[styles.shell, userMode && {backgroundColor: theme.background}]}>
    <View style={[styles.header, userMode
      ? {paddingTop: Math.max(insets.top, spacing.sm)} : styles.hiddenHeader, userMode && largeText && styles.headerLargeText]}>
      {userMode ? <>
        <View style={largeText && styles.largeTextBrand}>
          <Text style={[styles.brand, {color: theme.ink}]}>MOEAZI</Text>
          <Text style={[styles.caption, {color: theme.muted}]}>MONAD TESTNET</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open account and settings"
          onPress={() => navigation.navigate('AccountSettings')} style={[styles.account, largeText && styles.largeTextAccount, {backgroundColor: theme.accent, borderColor: theme.accentBorder}]}>
          <Text style={[styles.accountText, {color: theme.accentText}]}>ACCOUNT</Text>
        </Pressable>
      </> : null}
    </View>
    {tabs}
  </View>;
}

const styles = StyleSheet.create({
  shell: {flex: 1, backgroundColor: colors.paper},
  header: {minHeight: 64, paddingHorizontal: spacing.md, paddingBottom: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  headerLargeText: {flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: spacing.xs},
  largeTextBrand: {alignSelf: 'flex-start'},
  largeTextAccount: {alignSelf: 'flex-end'},
  hiddenHeader: {height: 0, minHeight: 0, paddingHorizontal: 0, paddingBottom: 0},
  brand: {...type.display, fontFamily: userFonts.display, color: colors.ink, fontSize: 18},
  caption: {...type.meta, fontFamily: userFonts.mono, color: colors.ink, fontSize: 9},
  account: {minHeight: 48, minWidth: 80, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm},
  accountText: {...type.meta, fontFamily: userFonts.mono, color: colors.ink, fontSize: 10},
});
