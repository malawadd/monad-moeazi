import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {StyleSheet, Text, View} from 'react-native';
import {AccountScreen} from '../screens/AccountScreen';
import {WelcomeScreen} from '../screens/WelcomeScreen';
import {useApp} from '../state/AppContext';
import {colors, type} from '../theme/tokens';

const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const {mode} = useApp();
  if (mode === 'loading') return <View style={styles.loading}><Text style={styles.loadingText}>OPENING MOEAZI</Text></View>;
  return <Stack.Navigator screenOptions={{headerShown: false}}>
    {mode === 'authenticated'
      ? <Stack.Screen name="Account" component={AccountScreen} />
      : <Stack.Screen name="Welcome" component={WelcomeScreen} />}
  </Stack.Navigator>;
}

const styles = StyleSheet.create({
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper},
  loadingText: {...type.display, fontSize: 20, color: colors.ink},
});
