import {NativeModules, Platform} from 'react-native';

type NativeScreenSecurity = {setSecure(enabled: boolean): void};
const security = NativeModules.MoeaziScreenSecurity as NativeScreenSecurity | undefined;

export function setSensitiveScreen(enabled: boolean) {
  if (Platform.OS === 'android') security?.setSecure(enabled);
}
