# Android trade notifications

Moeazi owns notification preferences, event selection, finality evidence, and the
idempotent outbox. Provider code is isolated behind `PushTransport` on the API
and `PushRegistrationAdapter` in the app. The current adapters are `fcm` and
`disabled`; neither adapter owns trade history or account preferences.
Replacing the phone SDK needs a new APK, but it does not require rebuilding
Moeazi notification preferences, event rules, or delivery history.

## Local Firebase setup

1. Use the Firebase Android app whose package is `com.moeazi.monad.mobile`.
2. Place its downloaded config at `android/app/google-services.json`. The file
   is ignored by Git. The Google services Gradle plugin is applied only when
   this local file exists, so builds without Firebase configuration remain
   possible.
   Root `firebase.json` keeps FCM auto-init and Analytics collection disabled.
   FCM auto-init is enabled only after the user opts in, the Moeazi backend
   reports FCM delivery available, and Android notification permission is
   granted. Turning alerts off or signing out deletes the local FCM token and
   disables auto-init again.
3. Put the backend service-account JSON at
   `backend/.data/firebase-service-account.json`. That directory is ignored by
   Git. Grant the service account the Firebase Cloud Messaging API Admin role
   in the sending project and enable the Firebase Cloud Messaging API (V1).
   Never put the JSON or its private key in source,
   `.env.local`, or app configuration.
4. Defaults remain `MOBILE_PUSH_ENABLED=false` and `PUSH_TRANSPORT=disabled`.
   To enable local delivery after approval, set these values in ignored
   `backend/.env.local`:

   ```env
   MOBILE_PUSH_ENABLED=true
   PUSH_TRANSPORT=fcm
   FIREBASE_SERVICE_ACCOUNT_PATH=.data/firebase-service-account.json
   ```

   Restart the scoped Monad API after changing the environment. The backend
   reads credentials only when FCM delivery is enabled. The Hono API uses the
   FCM HTTP v1 endpoint; the mobile app does not sign in to Firebase.

## Device and account behavior

- Trade alerts start off. Event choices cover autonomous entries, autonomous
  closes, settlement problems, and manual fills.
- Lock-screen amounts start hidden. Moeazi selects a redacted summary before
  handing a message to any provider.
- FCM token registration follows the Mera mobile session and rotates on token
  refresh. Sign-out unregisters device tokens. Tokens are stored with a
  provider identifier so another transport can run during a later migration.
- Android 13 and newer request notification permission when the user enables
  alerts. A device without Google Play services can keep using Moeazi and its
  in-app Activity; the FCM adapter reports that push registration is unavailable.
  On such a device, the app does not turn FCM auto-init on or block trading.
- Firebase Auth, Analytics, Firestore, and Cloud Functions are not included.

## Verification

Keep the KeePassDX x86 emulator on the disabled or unsupported path and verify
that account settings and Activity still work. Build the ARM phone APK, install
it on an Android phone with Google Play services, enable alerts in Account, and
verify token rotation and sign-out. Send a real push only during an explicitly
approved physical-phone check. Firebase's [Android setup guide](https://firebase.google.com/docs/android/setup)
and [FCM HTTP v1 guide](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
cover the provider-side configuration.

The current phone build is `android/app/build/outputs/apk/release/moeazi-monad-v1.3-arm.apk`
(`com.moeazi.monad.mobile`, version code 4, ARM64 and ARMv7). Its SHA-256 is
`31B673CAC795655CD97BEF9A7C61CAF2182FFE9FA3832E811F1728F3D0865CE5`.
The signing certificate fingerprint begins `93:05:40:B4` and matches the
public `assetlinks.json`. The x86 KeePassDX emulator verified Markets, manual
account navigation with its gate off, Activity, and the unsupported push path.
No physical phone was connected during this build, so actual FCM delivery and
Google Password Manager registration remain phone acceptance checks.
