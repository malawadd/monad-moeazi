const RP_ID = 'moeazi-monad.kiyan.finance';

type NativePasskeyError = {error?: unknown; message?: unknown};

function providerFailure(error: unknown): NativePasskeyError | null {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const value = current as NativePasskeyError & {cause?: unknown};
    if (typeof value.error === 'string') return value;
    current = value.cause;
  }
  return null;
}

function safeDetail(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
}

export function describePasskeyError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as {code: unknown}).code) : '';
  if (code === 'PRF_UNAVAILABLE') {
    return new Error('This passkey provider did not return a usable PRF output. Choose a PRF-capable passkey provider.');
  }
  if (code === 'CRYPTO_UNAVAILABLE') return new Error('Secure random number generation is unavailable on this device.');
  if (code !== 'PASSKEY_OPERATION_FAILED') {
    return error instanceof Error ? error : new Error('The passkey request could not be completed.');
  }

  const native = providerFailure(error);
  const providerCode = native?.error;
  const detail = safeDetail(native?.message);
  if (providerCode === 'UserCancelled') return new Error('The passkey request was cancelled. Try again when ready.');
  if (providerCode === 'NoCredentials') return new Error('No passkey was found for this app on the selected provider. Create a passkey first or choose the provider where you saved it.');
  if (providerCode === 'NoCreateOption') return new Error('No enabled passkey provider can create a passkey on this phone. Check your password manager and screen lock.');
  if (providerCode === 'NotSupported') return new Error('Passkeys are not supported on this Android device or OS version.');
  if (providerCode === 'TimedOut' || providerCode === 'Interrupted') return new Error('The passkey request was interrupted. Try again.');
  if (providerCode === 'BadConfiguration' || /RP ID cannot be validated|asset.?links|app association/i.test(detail)) {
    return new Error(`Android could not verify the passkey app association for ${RP_ID}.${detail ? ` Provider: ${detail}` : ''}`);
  }
  if (detail) return new Error(`The passkey provider rejected the request (${String(providerCode ?? 'unknown')}): ${detail}`);
  return new Error('The passkey provider rejected the request. Retry and check the phone’s passkey settings.');
}
