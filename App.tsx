import React from 'react';
import {StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {RootNavigator} from './src/navigation/RootNavigator';
import {AppProvider} from './src/state/AppContext';
import {PresentationProvider, usePresentation} from './src/state/PresentationContext';
import {ConnectivityBanner} from './src/components/ConnectivityBanner';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from './src/services/queryCache';
import {createMobileLinking} from './src/navigation/linking';
import {colors, type} from './src/theme/tokens';

function AppNavigation() {
  const {ready, presentationMode, effectiveTheme} = usePresentation();
  const barStyle = presentationMode === 'user' && effectiveTheme === 'after-hours' ? 'light-content' : 'dark-content';
  if (!ready) return <><StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
    <View style={styles.loading}><Text style={styles.loadingText}>OPENING MOEAZI</Text></View></>;
  return <NavigationContainer
    linking={createMobileLinking(presentationMode)}
    fallback={<View style={styles.loading}><Text style={styles.loadingText}>OPENING MOEAZI</Text></View>}>
    <StatusBar barStyle={barStyle} backgroundColor="transparent" translucent />
    <RootNavigator />
  </NavigationContainer>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <PresentationProvider>
          <ConnectivityBanner />
          <AppProvider><AppNavigation /></AppProvider>
        </PresentationProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper},
  loadingText: {...type.display, fontSize: 20, color: colors.ink},
});
