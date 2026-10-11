export const THEME_STORAGE_KEY = 'moeazi.monad.prototype.theme.v1';
export const THEME_OPTIONS = Object.freeze([
  {id: 'original', label: 'Original', note: 'Cream and ink'},
  {id: 'after-hours', label: 'After Hours', note: 'Charcoal, lime, violet'},
  {id: 'citrus-press', label: 'Citrus Press', note: 'Ivory, orange, yellow'},
  {id: 'blueprint', label: 'Blueprint', note: 'Pale blue, drafting navy'},
  {id: 'candy-riot', label: 'Candy Riot', note: 'Pink, lilac, plum'},
]);

const ids = new Set(THEME_OPTIONS.map(theme => theme.id));
export const normalizeTheme = value => ids.has(value) ? value : 'original';

export function readThemePreference(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    return normalizeTheme(target.getItem(THEME_STORAGE_KEY));
  } catch { return 'original'; }
}

export function saveThemePreference(value, storage) {
  const theme = normalizeTheme(value);
  try {
    const target = storage ?? globalThis.localStorage;
    target.setItem(THEME_STORAGE_KEY, theme);
  } catch { /* Keep the current selection for this session when storage is blocked. */ }
  return theme;
}

export function connectThemePreferences(deviceShell, announce = () => {}) {
  let selected = readThemePreference();
  const apply = value => {
    selected = value;
    document.documentElement.dataset.theme = value;
    deviceShell.dataset.theme = value;
  };
  apply(selected);
  deviceShell.addEventListener('change', event => {
    const control = event.target.closest('[data-theme-select]');
    if (!control || !control.checked) return;
    apply(saveThemePreference(control.value));
    announce(`${THEME_OPTIONS.find(theme => theme.id === selected)?.label ?? 'Original'} theme applied.`);
  });
  return () => selected;
}
