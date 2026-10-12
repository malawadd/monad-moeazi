import {contrastRatio, USER_THEME_CATALOG} from '../src/theme/userThemes';
import {UserTheme} from '../src/services/presentationPreferences';

test('all approved user themes maintain readable text, controls, and primary actions on semantic surfaces', () => {
  expect(USER_THEME_CATALOG.map(theme => theme.id)).toEqual([
    'original', 'after-hours', 'citrus-press', 'blueprint', 'candy-riot',
  ] satisfies UserTheme[]);
  for (const theme of USER_THEME_CATALOG) {
    for (const surface of [theme.background, theme.surface, theme.raised, theme.neutralSurface,
      theme.insetSurface, theme.success, theme.warning, theme.danger]) {
      expect(contrastRatio(theme.ink, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.muted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.border, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(theme.accentText, theme.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.accentBorder, theme.accent)).toBeGreaterThanOrEqual(3);
    const visibleFocus = Math.max(contrastRatio(theme.focus, theme.background), contrastRatio(theme.focusHalo, theme.background));
    expect(visibleFocus).toBeGreaterThanOrEqual(3);
  }
});

test('Blueprint keeps its approved cobalt accent and white accent text', () => {
  const blueprint = USER_THEME_CATALOG.find(theme => theme.id === 'blueprint')!;
  expect(blueprint.accent).toBe('#2448D8');
  expect(blueprint.accentText).toBe('#FFFFFF');
  expect(blueprint.shadow).toBe('#2448D8');
});
