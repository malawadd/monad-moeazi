import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {RootNavigator} from './src/navigation/RootNavigator';
import {AppProvider} from './src/state/AppContext';
import {MagicRelayer} from './src/services/wallet/MagicWalletAdapter';
import {ConnectivityBanner} from './src/components/ConnectivityBanner';
import {linking} from './src/navigation/linking';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ConnectivityBanner />
      <AppProvider>
        <NavigationContainer linking={linking}>
          <RootNavigator />
        </NavigationContainer>
        <MagicRelayer />
      </AppProvider>
    </SafeAreaProvider>
  );
}
