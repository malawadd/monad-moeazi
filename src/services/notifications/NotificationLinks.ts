import {Platform} from 'react-native';

type OpenMessage = {data?: Record<string, string | object>};

async function messagingClient() {
  const [app, messaging] = await Promise.all([
    import('@react-native-firebase/app'),
    import('@react-native-firebase/messaging'),
  ]);
  return messaging.getMessaging(app.getApp());
}

function stringUrl(message: OpenMessage | null) {
  const url = message?.data?.url;
  return typeof url === 'string' ? url : null;
}

export async function getInitialNotificationUrl(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const [instance, messaging] = await Promise.all([messagingClient(), import('@react-native-firebase/messaging')]);
    return stringUrl(await messaging.getInitialNotification(instance));
  } catch {
    return null;
  }
}

export function subscribeNotificationOpened(callback: (url: string) => void) {
  if (Platform.OS !== 'android') return () => undefined;
  let active = true;
  let unsubscribe: () => void = () => undefined;
  void Promise.all([messagingClient(), import('@react-native-firebase/messaging')]).then(([instance, messaging]) => {
    if (!active) return;
    unsubscribe = messaging.onNotificationOpenedApp(instance, message => {
      const url = stringUrl(message);
      if (url) callback(url);
    });
  }).catch(() => undefined);
  return () => { active = false; unsubscribe(); };
}
