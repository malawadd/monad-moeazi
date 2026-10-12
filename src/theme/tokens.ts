import {Platform, TextStyle} from 'react-native';

export const colors = {
  paper: '#FFFDF5', paperAlt: '#FFF8E9', cream: '#FFF1CF', yellow: '#FFD23F',
  pink: '#FF7BA5', sky: '#74B9FF', skyTint: '#EEF7FF', mint: '#88D498',
  mintTint: '#EFFCEF', orange: '#FFA552', orangeTint: '#FFF1E5',
  lilac: '#B8A9FA', lilacTint: '#F1EDFF', rose: '#FF8BA7',
  roseTint: '#FFF0F4', red: '#FF6B6B', ink: '#111111', muted: '#3F3F46', white: '#FFFFFF',
} as const;

export const spacing = {xs: 6, sm: 12, md: 16, lg: 22, xl: 30} as const;
export const border = {quiet: 2, nested: 3, strong: 5} as const;
export const motion = {press: 120, reveal: 180, screen: 220} as const;
export const fonts = {display: 'Syne', body: 'PlusJakartaSans', mono: 'IBMPlexMono-Regular'} as const;
export const userFonts = Platform.OS === 'android'
  ? {display: 'MoeaziUserSyne', body: 'MoeaziUserJakarta', mono: 'MoeaziUserPlex'} as const
  : fonts;

export const type = {
  display: {fontFamily: fonts.display, fontWeight: '800'} as TextStyle,
  body: {fontFamily: fonts.body, fontWeight: '500'} as TextStyle,
  meta: {fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1.1} as TextStyle,
};
