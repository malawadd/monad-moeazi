import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {RootNavigator} from './src/navigation/RootNavigator';
import {AppProvider} from './src/state/AppContext';
import {ConnectivityBanner} from './src/components/ConnectivityBanner';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from './src/services/queryCache';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
        <ConnectivityBanner />
        <AppProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </AppProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
