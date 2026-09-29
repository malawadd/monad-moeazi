import React from 'react';
import {Magic} from '@magic-sdk/react-native-bare';
import type {Send7702TransactionRequest, Sign7702AuthorizationRequest} from '@magic-sdk/react-native-bare';
import DeviceInfo from 'react-native-device-info';
import {encodeFunctionData} from 'viem';
import {ARBITRUM_CHAIN_ID, ARBITRUM_RPC_URL, MAGIC_PUBLISHABLE_KEY} from '../../config';
import {WalletAdapter, WalletIdentity} from './WalletAdapter';
import {magicRootHashRequest, magicTypedDataRequest} from './magicRpc';
import type {PreparedWithdrawalTransaction} from '../../types/withdrawal';
import {buildCappedApprovalData, MANAGED_TOKENS, validMagicOwner} from '../managedAutopilot';
import type {ManagedProgramGrantContext} from '../../types/mobile';

const magic = MAGIC_PUBLISHABLE_KEY && ARBITRUM_RPC_URL ? new Magic(MAGIC_PUBLISHABLE_KEY, {network: {rpcUrl: ARBITRUM_RPC_URL, chainId: ARBITRUM_CHAIN_ID}}) : null;
const releaseAbi = [{type: 'function', name: 'withdrawUsdc', stateMutability: 'nonpayable',
  inputs: [], outputs: [{type: 'uint256'}]}] as const;
const releaseData = encodeFunctionData({abi: releaseAbi, functionName: 'withdrawUsdc'});

export class MagicWalletAdapter implements WalletAdapter {
  isConfigured() { return Boolean(magic); }
  private async identity(fallbackEmail?: string): Promise<WalletIdentity> {
    if (!magic) throw new Error('Magic is not configured for this build.');
    const info = await magic.user.getInfo();
    const publicAddress = info.wallets.ethereum?.publicAddress;
    if (!publicAddress) throw new Error('Magic did not return an Ethereum wallet address.');
    return {address: publicAddress.toLowerCase(), email: info.email ?? fallbackEmail};
  }
  async loginWithEmail(email: string): Promise<WalletIdentity> {
    if (!magic) throw new Error('Magic is not configured for this build.');
    await magic.auth.loginWithEmailOTP({email, showUI: true});
    return await this.identity(email);
  }
  async restoreIdentity() {
    if (!magic || !await magic.user.isLoggedIn()) return null;
    return await this.identity();
  }
  async signMessage(message: string, address: string) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    return String(await magic.rpcProvider.request({method: 'personal_sign', params: [message, address]}));
  }
  async signTypedData(payload: unknown, address: string) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    return String(await magic.rpcProvider.request(magicTypedDataRequest(payload, address)));
  }
  async signRootHash(rootHash: string, address: string) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    return String(await magic.rpcProvider.request(magicRootHashRequest(rootHash, address)));
  }
  async signEip7702Authorization(input: Sign7702AuthorizationRequest) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    return await magic.wallet.sign7702Authorization(input);
  }
  async sendEip7702Transaction(input: Send7702TransactionRequest) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    return await magic.wallet.send7702Transaction(input);
  }
  async sendPreparedTransaction(input: PreparedWithdrawalTransaction) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    return String(await magic.rpcProvider.request({method: 'eth_sendTransaction', params: [input]}));
  }
  async releaseManagedVault(input: {from: string; to: string; data: string; value: string}) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    const identity = await this.identity();
    if (identity.address !== input.from.toLowerCase()
        || !/^0x[a-fA-F0-9]{40}$/.test(input.to) || input.to.toLowerCase() === identity.address
        || input.data.toLowerCase() !== releaseData.toLowerCase()
        || input.value !== '0x0') {
      throw new Error('The vault return call differs from the reviewed Magic owner transaction.');
    }
    const chainId = Number(await magic.rpcProvider.request({method: 'eth_chainId'}));
    if (chainId !== ARBITRUM_CHAIN_ID) throw new Error('Magic must be on Arbitrum to return managed USDC.');
    const hash = String(await magic.rpcProvider.request({method: 'eth_sendTransaction', params: [input]}));
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Magic did not return a valid vault return transaction hash.');
    return hash;
  }
  async sendScopedTokenApproval(input: {owner: string; scope: 'buy' | 'exit'; context: ManagedProgramGrantContext}) {
    if (!magic) throw new Error('Magic is not configured for this build.');
    if (input.scope !== 'buy' && input.scope !== 'exit') throw new Error('Only the reviewed buy or exit allowance can be approved.');
    const identity = await this.identity();
    if (!input.context.contextAvailable || !validMagicOwner(identity.address, input.owner)
        || !validMagicOwner(input.context.ownerAddress, input.owner)) throw new Error('The Magic owner changed; refresh the grant review before approving.');
    const token = input.scope === 'buy' ? MANAGED_TOKENS.usdc : MANAGED_TOKENS.weth;
    const amount = input.scope === 'buy' ? input.context.bounds.maxUsdcUnits : input.context.bounds.maxWethUnits;
    const chainId = Number(await magic.rpcProvider.request({method: 'eth_chainId'}));
    if (chainId !== ARBITRUM_CHAIN_ID) throw new Error('Switch Magic to Arbitrum before approving the managed token cap.');
    const data = buildCappedApprovalData(token, amount);
    const hash = String(await magic.rpcProvider.request({method: 'eth_sendTransaction', params: [{
      from: identity.address, to: token, data, value: '0x0',
    }]}));
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Magic did not return a valid approval transaction hash.');
    return hash;
  }
  async logout() { if (magic) await magic.user.logout(); }
}

export async function getDeviceIdentity() {
  return {deviceId: await DeviceInfo.getUniqueId(), deviceName: await DeviceInfo.getDeviceName()};
}

export function MagicRelayer() { return magic ? <magic.Relayer /> : null; }

export const magicWallet = new MagicWalletAdapter();
