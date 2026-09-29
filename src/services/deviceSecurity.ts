import {NativeModules} from 'react-native';
export async function verifyDeviceSecurity(reason: string): Promise<boolean> {
  if (!NativeModules.MoeaziDeviceSecurity?.confirm) throw new Error('Secure device confirmation is unavailable. Install the latest Android build.');
  return NativeModules.MoeaziDeviceSecurity.confirm(reason);
}
