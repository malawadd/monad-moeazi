/**
 * @format
 */

// Hermes needs UTF-8 encoding before viem's validation modules are evaluated.
import 'fast-text-encoding';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
