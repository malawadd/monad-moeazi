import DeviceInfo from 'react-native-device-info';

export async function getDeviceIdentity() {
  return {deviceId: await DeviceInfo.getUniqueId(), deviceName: await DeviceInfo.getDeviceName()};
}
