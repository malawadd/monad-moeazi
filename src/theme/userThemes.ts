import type {UserTheme} from '../services/presentationPreferences';

export type UserThemeTokens = {
  id: UserTheme; label: string; description: string; texture: 'none' | 'grid' | 'dots' | 'checker';
  background: string; surface: string; raised: string; ink: string; muted: string; border: string;
  accent: string; accentText: string; accentSoft: string; accentBorder: string; success: string; warning: string; danger: string;
  focus: string; focusHalo: string; shadow: string; whiteSurface: string; neutralSurface: string; insetSurface: string;
  pink: string; sky: string; mint: string; orange: string; lilac: string;
};

export const USER_THEME_CATALOG: readonly UserThemeTokens[] = [
  {id: 'original', label: 'Original', description: 'Paper, ink and bright accents.', texture: 'none',
    background: '#FFFDF5', surface: '#FFF8E9', raised: '#FFFFFF', ink: '#111111', muted: '#54545A', border: '#111111',
    accent: '#FFD23F', accentText: '#111111', accentSoft: '#FFF1CF', accentBorder: '#111111', success: '#D6F2DC', warning: '#FFF0DF', danger: '#FFE3EB',
    focus: '#111111', focusHalo: '#FFD23F', shadow: '#111111', whiteSurface: '#FFFFFF', neutralSurface: '#F2EEE3', insetSurface: '#FFFAF0',
    pink: '#FF7BA5', sky: '#74B9FF', mint: '#88D498', orange: '#FFA552', lilac: '#B8A9FA'},
  {id: 'after-hours', label: 'After Hours', description: 'Charcoal, lime and violet.', texture: 'grid',
    background: '#151519', surface: '#151519', raised: '#222229', ink: '#F5F3EA', muted: '#B8B5C0', border: '#D0CCC3',
    accent: '#D9FF43', accentText: '#151519', accentSoft: '#24242B', accentBorder: '#151519', success: '#28331F', warning: '#3A3028', danger: '#31293C',
    focus: '#151519', focusHalo: '#D9FF43', shadow: '#000000', whiteSurface: '#222229', neutralSurface: '#202026', insetSurface: '#1D1D23',
    pink: '#A995FF', sky: '#9EB8C8', mint: '#D9FF43', orange: '#D9A67B', lilac: '#403854'},
  {id: 'citrus-press', label: 'Citrus Press', description: 'Warm ivory, orange and lemon.', texture: 'dots',
    background: '#FFF8EC', surface: '#FFF8EC', raised: '#FFFDF8', ink: '#34231A', muted: '#6D594D', border: '#533829',
    accent: '#FFE45B', accentText: '#34231A', accentSoft: '#F3E5CC', accentBorder: '#34231A', success: '#DCEBD0', warning: '#FFF0D9', danger: '#FAE2D5',
    focus: '#34231A', focusHalo: '#FFE45B', shadow: '#34231A', whiteSurface: '#FFFDF8', neutralSurface: '#F1E8D9', insetSurface: '#FFFAF1',
    pink: '#FF843D', sky: '#D3E6E3', mint: '#B4D09E', orange: '#FF843D', lilac: '#E5C5AD'},
  {id: 'blueprint', label: 'Blueprint', description: 'Pale blue, navy and cobalt.', texture: 'grid',
    background: '#EAF4FF', surface: '#EAF4FF', raised: '#FFFFFF', ink: '#172D5B', muted: '#50658C', border: '#172D5B',
    accent: '#2448D8', accentText: '#FFFFFF', accentSoft: '#D9E8F8', accentBorder: '#FFFFFF', success: '#D9EEE3', warning: '#FFF0D6', danger: '#FFF0CB',
    focus: '#172D5B', focusHalo: '#FFFFFF', shadow: '#2448D8', whiteSurface: '#FFFFFF', neutralSurface: '#E0EBF8', insetSurface: '#F4F8FF',
    pink: '#EFC84F', sky: '#BFD4F3', mint: '#B8DCCC', orange: '#E5B76E', lilac: '#D5E1F5'},
  {id: 'candy-riot', label: 'Candy Riot', description: 'Pink, plum and lavender.', texture: 'checker',
    background: '#FFF0F7', surface: '#FFF0F7', raised: '#FFFAFD', ink: '#4C214A', muted: '#75526F', border: '#683461',
    accent: '#FF82BC', accentText: '#4C214A', accentSoft: '#F9DEED', accentBorder: '#4C214A', success: '#DCEFE4', warning: '#FFEADB', danger: '#FFE0EF',
    focus: '#4C214A', focusHalo: '#FF82BC', shadow: '#4C214A', whiteSurface: '#FFFAFD', neutralSurface: '#F5E5EF', insetSurface: '#FFF8FC',
    pink: '#FF82BC', sky: '#C4B0FF', mint: '#B7E2CF', orange: '#F0B267', lilac: '#C4B0FF'},
] as const;

const byId = new Map(USER_THEME_CATALOG.map(theme => [theme.id, theme]));
export function userThemeTokens(theme: UserTheme): UserThemeTokens {
  return byId.get(theme) ?? USER_THEME_CATALOG[0];
}

export function hexLuminance(color: string): number {
  const hex = color.replace('#', '');
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [hexLuminance(first), hexLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
