import React from 'react';
import {Text} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {useProlongedRefreshFailure} from '../src/services/useProlongedRefreshFailure';

function Probe({failed, cached, owner = 'owner-a'}: {failed: boolean; cached: boolean; owner?: string}) {
  const show = useProlongedRefreshFailure(failed, cached, 120_000, owner);
  return <Text>{show ? 'saved-data notice' : 'quiet'}</Text>;
}

function value(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findByType(Text).props.children;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('does not show a notice for normal stale cache and waits two continuous error minutes', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<Probe failed={false} cached={true} />); });
  expect(value(renderer)).toBe('quiet');
  act(() => { renderer.update(<Probe failed={true} cached={true} />); });
  expect(value(renderer)).toBe('quiet');
  act(() => { jest.advanceTimersByTime(119_999); });
  expect(value(renderer)).toBe('quiet');
  act(() => { jest.advanceTimersByTime(1); });
  expect(value(renderer)).toBe('saved-data notice');
  act(() => { renderer.unmount(); });
});

it('resets the timer on recovery and surfaces an initial error without cached data', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<Probe failed={true} cached={false} />); });
  expect(value(renderer)).toBe('saved-data notice');
  act(() => { renderer.update(<Probe failed={false} cached={true} />); });
  expect(value(renderer)).toBe('quiet');
  act(() => { renderer.update(<Probe failed={true} cached={true} />); });
  act(() => { jest.advanceTimersByTime(119_999); });
  expect(value(renderer)).toBe('quiet');
  act(() => { renderer.unmount(); });
});

it('restarts the continuous-failure timer when the owner changes', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<Probe failed={true} cached={true} />); });
  act(() => { jest.advanceTimersByTime(70_000); });
  act(() => { renderer.update(<Probe failed={true} cached={true} owner="owner-b" />); });
  act(() => { jest.advanceTimersByTime(119_999); });
  expect(value(renderer)).toBe('quiet');
  act(() => { jest.advanceTimersByTime(1); });
  expect(value(renderer)).toBe('saved-data notice');
  act(() => { renderer.unmount(); });
});
