import {NativeModules, Platform} from 'react-native';

type NativeQrScanner = {scan(): Promise<string>};
const scanner = NativeModules.MoeaziQrScanner as NativeQrScanner | undefined;

export async function scanPaymentQr() {
  if (Platform.OS !== 'android' || !scanner) throw new Error('QR scanning is unavailable. Enter or paste the address instead.');
  return await scanner.scan();
}
