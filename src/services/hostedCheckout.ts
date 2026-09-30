import {NativeModules, Platform} from 'react-native';
export function validateCheckoutUrl(value: string, hosts: string[]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw new Error('The purchase link is not trusted.');
  return url.toString();
}
export async function openHostedCheckout(url: string, hosts: string[]) {
  const checked = validateCheckoutUrl(url, hosts);
  if (Platform.OS !== 'android' || !NativeModules.MoeaziHostedCheckout?.open) throw new Error('Secure browser checkout is unavailable. You can transfer USDC instead.');
  await NativeModules.MoeaziHostedCheckout.open(checked);
}
