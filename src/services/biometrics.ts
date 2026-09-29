import * as Keychain from 'react-native-keychain';

const SERVICE = 'moeazi.monad.mobile.biometric-gate';

export async function confirmSensitiveAction(reason: string) {
  await Keychain.setGenericPassword('gate', 'enabled', {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
  });
  const result = await Keychain.getGenericPassword({
    service: SERVICE,
    authenticationPrompt: {title: 'Confirm with device security', subtitle: reason},
  });
  return Boolean(result);
}
