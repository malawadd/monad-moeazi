import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  type Secp256k1SigningSession,
} from '@category-labs/mera';
import {reactNativeWebAuthnClient} from '@category-labs/mera/react-native-webauthn-client';
import {HDKey} from '@scure/bip32';
import {entropyToMnemonic, mnemonicToSeedSync} from '@scure/bip39';
import {wordlist} from '@scure/bip39/wordlists/english.js';
import {hashMessage, hexToBytes, toHex} from 'viem';

export const MERA_RP_ID = 'moeazi-monad.kiyan.finance';
const RP_NAME = 'Moeazi Monad';
const USER_NAME = 'moeazi-mobile';
const EVM_PATH = "m/44'/60'/0'/0/0";

export type PasskeyAction = 'create' | 'signin';
export type MeraSigningSession = {
  address: string;
  signMessage(message: string): Promise<string>;
  end(): void;
};

/** Opens a short-lived EVM signing session; no PRF, phrase, seed, or key is persisted. */
export async function openMeraSigningSession(action: PasskeyAction): Promise<MeraSigningSession> {
  let result: getPasskeyPrfOutput.Result | undefined;
  let seed: Uint8Array | undefined;
  let privateKey: Uint8Array | null | undefined;
  let session: Secp256k1SigningSession | undefined;
  try {
    result = action === 'create'
      ? await createPasskeyWithPrfOutput({
        rp: {id: MERA_RP_ID, name: RP_NAME},
        user: {name: USER_NAME, displayName: 'Moeazi account'},
        webAuthnClient: reactNativeWebAuthnClient,
      })
      : await getPasskeyPrfOutput({rpId: MERA_RP_ID, webAuthnClient: reactNativeWebAuthnClient});
    const mnemonic = entropyToMnemonic(result.prfOutput, wordlist);
    result.prfOutput.fill(0);
    seed = mnemonicToSeedSync(mnemonic);
    privateKey = HDKey.fromMasterSeed(seed).derive(EVM_PATH).privateKey;
    if (!privateKey) throw new Error('Mera could not derive the account key.');
    session = createSecp256k1SigningSession({privateKey});
    const signingSession = session;
    return {
      address: getEvmAddress(signingSession.publicKey).toLowerCase(),
      async signMessage(message) {
        const digest = hexToBytes(hashMessage(message));
        const signature = await signingSession.signDigest(digest);
        const encoded = new Uint8Array(65);
        encoded.set(signature.compact);
        encoded[64] = signature.recovery + 27;
        return toHex(encoded);
      },
      end: () => signingSession.end(),
    };
  } catch (error) {
    session?.end();
    throw describePasskeyError(error);
  } finally {
    result?.prfOutput.fill(0);
    seed?.fill(0);
    privateKey?.fill(0);
  }
}

function describePasskeyError(error: unknown): Error {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as {code: unknown}).code) : '';
  if (code === 'PRF_UNAVAILABLE') {
    return new Error('This passkey provider does not support PRF. Use a PRF-capable provider such as Google Password Manager or 1Password.');
  }
  if (code === 'CRYPTO_UNAVAILABLE') return new Error('Secure random number generation is unavailable on this device.');
  if (code === 'PASSKEY_OPERATION_FAILED') return new Error('The passkey request failed or was cancelled. Check the app association for moeazi-monad.kiyan.finance.');
  return error instanceof Error ? error : new Error('The passkey request could not be completed.');
}
