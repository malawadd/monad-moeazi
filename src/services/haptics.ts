import {NativeModules, Platform} from 'react-native';

type NativeHaptics = {
  selection(): void;
  confirm(): void;
  reject(): void;
};

const native = NativeModules.MoeaziHaptics as NativeHaptics | undefined;
const call = (kind: keyof NativeHaptics) => {
  if (Platform.OS === 'android' && native) native[kind]();
};

export const haptics = {
  selection: () => call('selection'),
  confirm: () => call('confirm'),
  reject: () => call('reject'),
};
