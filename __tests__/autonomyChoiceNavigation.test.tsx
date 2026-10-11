import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Button = ({label, onPress}: {label: string; onPress: () => void}) => ReactRuntime.createElement(Native.Pressable,
    {accessibilityRole: 'button', accessibilityLabel: label, onPress}, ReactRuntime.createElement(Native.Text, null, label));
  const Label = ({title, copy, children}: {title?: string; copy?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? copy ?? children);
  return {Button, Card: Container, PageHeader: Label, Screen: Container};
});

import {AutonomyChoiceScreen} from '../src/screens/AutonomyChoiceScreen';

test('Perpl choice opens autonomous setup and keeps a separate status action', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<AutonomyChoiceScreen />); });
  const setup = renderer.root.findAll(node => node.props.accessibilityLabel === 'Set up autonomous Perpl')[0];
  const status = renderer.root.findAll(node => node.props.accessibilityLabel === 'Perpl run status and history')[0];
  expect(setup).toBeDefined(); expect(status).toBeDefined();
  await act(async () => { setup.props.onPress(); status.props.onPress(); });
  expect(mockNavigation.navigate).toHaveBeenNthCalledWith(1, 'PerplSetup');
  expect(mockNavigation.navigate).toHaveBeenNthCalledWith(2, 'PerplStatus');
  await act(async () => renderer.unmount());
});
