import {TAB_NAMES} from '../src/navigation/routes';
import {safeMobileDeepLink} from '../src/navigation/linking';

test('keeps the five beginner navigation tabs', () => {
  expect(TAB_NAMES).toEqual(['Home', 'Markets', 'Strategies', 'Activity', 'Account']);
});

test('rejects malformed and unbounded notification links', () => {
  expect(safeMobileDeepLink('moeazi-monad://activity/item_123')).toBe('moeazi-monad://activity/item_123');
  expect(safeMobileDeepLink('moeazi-monad://activity/%E0%A4%A')).toBeNull();
  expect(safeMobileDeepLink(`moeazi-monad://activity/${'x'.repeat(150)}`)).toBeNull();
});
