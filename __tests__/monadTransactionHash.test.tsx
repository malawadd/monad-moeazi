import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import * as Native from 'react-native';
import {MonadTransactionHash, monadTransactionExplorerUrl} from '../src/components/MonadTransactionHash';

const hash = `0x${'ab'.repeat(32)}`;

test('links only validated 32-byte hashes to the Monad Testnet explorer and keeps the full hash accessible', async () => {
  const openURL = jest.spyOn(Native.Linking, 'openURL').mockResolvedValueOnce(undefined);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<MonadTransactionHash hash={hash} prefix="Tx · " />); });
  const text = renderer.root.findByType(Native.Text);
  expect(text.props.accessibilityRole).toBe('link');
  expect(text.props.accessibilityLabel).toContain(hash);
  expect(String(text.props.children)).toContain('…');
  await act(async () => { text.props.onPress(); });
  expect(openURL).toHaveBeenCalledWith(`https://testnet.monadexplorer.com/tx/${hash}`);
  expect(monadTransactionExplorerUrl('0x1234')).toBeNull();
  await act(async () => renderer.unmount());
  openURL.mockRestore();
});

test('does not create an explorer link for malformed hashes', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<MonadTransactionHash hash="0x1234" />); });
  const text = renderer.root.findByType(Native.Text);
  expect(text.props.children).toBe('0x1234');
  expect(text.props.onPress).toBeUndefined();
  expect(text.props.accessibilityRole).toBeUndefined();
  await act(async () => renderer.unmount());
});
