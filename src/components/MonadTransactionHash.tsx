import React from 'react';
import {Linking, StyleProp, Text, TextStyle} from 'react-native';

const TRANSACTION_HASH = /^0x[a-f0-9]{64}$/i;

export function isMonadTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && TRANSACTION_HASH.test(value);
}

export function monadTransactionExplorerUrl(hash: string) {
  return isMonadTransactionHash(hash) ? `https://testnet.monadexplorer.com/tx/${hash}` : null;
}

export function MonadTransactionHash({hash, style, prefix = '', full = false}: {
  hash: string; style?: StyleProp<TextStyle>; prefix?: string; full?: boolean;
}) {
  const url = monadTransactionExplorerUrl(hash);
  const display = url && !full ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
  return <Text selectable style={[{textDecorationLine: 'underline'}, style]} onPress={url ? () => { void Linking.openURL(url).catch(() => undefined); } : undefined}
    accessibilityRole={url ? 'link' : undefined}
    accessibilityLabel={url ? `Open transaction ${hash} on Monad Testnet explorer` : undefined}
    accessibilityHint={url ? 'Opens the transaction in your browser' : undefined}>{`${prefix}${display}`}</Text>;
}
