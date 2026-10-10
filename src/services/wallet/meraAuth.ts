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
import {hashMessage, hashTypedData, hexToBytes, toHex} from 'viem';
import type {Hex, TypedDataDefinition} from 'viem';
import type {MonadEip1559Transaction} from '../../types/monad';
import {signPreparedMonadTransaction} from '../monadTransaction';
import {describePasskeyError} from './meraPasskeyError';

export const MERA_RP_ID = 'moeazi-monad.kiyan.finance';
const RP_NAME = 'Moeazi Monad';
const USER_NAME = 'moeazi-mobile';
const EVM_PATH = "m/44'/60'/0'/0/0";

export type PasskeyAction = 'create' | 'signin';
export type MeraSigningSession = {
  address: string;
  signMessage(message: string): Promise<string>;
  signEip1559Transaction(chainId: number, transaction: MonadEip1559Transaction): Promise<string>;
  signTypedData(chainId: number, payload: TypedDataDefinition): Promise<string>;
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
    const signDigest = async (digest: Hex) => signingSession.signDigest(hexToBytes(digest));
    return {
      address: getEvmAddress(signingSession.publicKey).toLowerCase(),
      async signMessage(message) {
        const signature = await signDigest(hashMessage(message));
        const encoded = new Uint8Array(65);
        encoded.set(signature.compact);
        encoded[64] = signature.recovery + 27;
        return toHex(encoded);
      },
      async signEip1559Transaction(chainId, transaction) {
        return signPreparedMonadTransaction(chainId, transaction, digest => signingSession.signDigest(digest));
      },
      async signTypedData(chainId, payload) {
        if (chainId !== 10143) throw new Error('The mandate is not for Monad Testnet (10143).');
        const domainChainId = payload.domain?.chainId;
        if (Number(domainChainId) !== chainId) {
          throw new Error('The mandate signing domain does not match Monad Testnet.');
        }
        const signature = await signDigest(hashTypedData(payload));
        const encoded = new Uint8Array(65);
        encoded.set(signature.compact);
        encoded[64] = signature.recovery + 27;
        signature.compact.fill(0);
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
