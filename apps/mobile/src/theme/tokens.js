/*
 * EduTrack design tokens for the Staff mobile app. The brand palette and the semantic light/dark
 * values are the web app's (apps/web/src/index.css, docs/design/design-system.md), so both apps
 * share one look. Components use the semantic names only, never raw hex values.
 */

export const palette = {
  navy900: '#001D31',
  navy950: '#041521',
  navy800: '#0A2F4A',
  navy600: '#025584',
  navy400: '#4B9AD4',
  steel500: '#73819A',
  steel50: '#F3F7FB',
  gold500: '#D6982D',
  gold400: '#F1B237',
  gold600: '#C4871F',
  white: '#FFFFFF',
};

const light = {
  scheme: 'light',
  primary: palette.navy900,
  secondary: palette.steel500,
  accent: palette.gold500,
  accentPressed: palette.gold600,
  accentSoft: '#FDF6E7',
  // Gold for text and large labels on light surfaces (gold500 itself is too light for text).
  accentFg: '#9A6A12',
  onAccent: palette.navy900,
  interactive: palette.navy600,
  interactiveSoft: '#E0F0FE',
  page: palette.steel50,
  surface: '#FFFFFF',
  muted: '#EEF3F8',
  fg: '#0D1932',
  fgSecondary: '#4A566B',
  fgMuted: '#617087',
  fgInverse: '#FFFFFF',
  fgDisabled: '#9AA6B6',
  border: '#DCE3EB',
  borderSubtle: '#EAEFF4',
  borderInput: '#7F8EA3',
  success: '#16A36A',
  successSoft: '#D6F5E8',
  successFg: '#0F6B45',
  warning: '#E0A21B',
  warningSoft: '#FDECC7',
  warningFg: '#7A4F00',
  error: '#D0342F',
  errorSoft: '#FEE4E2',
  errorFg: '#B42318',
  info: '#2B7FC1',
  infoSoft: '#E0F0FE',
  infoFg: '#0B4F82',
  overlay: 'rgba(0, 29, 49, 0.55)',
  // Brand surfaces (splash, success header)
  brand: palette.navy900,
  onBrand: '#FFFFFF',
  onBrandMuted: '#B4C1D0',
  geofence: 'rgba(22, 163, 106, 0.18)',
  geofenceBorder: 'rgba(22, 163, 106, 0.55)',
  mapBackground: '#E8EEF4',
  mapLine: '#D3DCE6',
};

const dark = {
  scheme: 'dark',
  primary: palette.navy900,
  secondary: '#8E9DB1',
  accent: palette.gold400,
  accentPressed: '#F1C25A',
  accentSoft: 'rgba(241, 178, 55, 0.14)',
  accentFg: palette.gold400,
  onAccent: palette.navy900,
  interactive: palette.navy400,
  interactiveSoft: 'rgba(75, 154, 212, 0.16)',
  page: '#051622',
  surface: '#081E2E',
  muted: '#0B2232',
  fg: '#E8EEF5',
  fgSecondary: '#B4C1D0',
  fgMuted: '#8E9DB1',
  fgInverse: '#0D1932',
  fgDisabled: '#4E5D70',
  border: '#173049',
  borderSubtle: '#102739',
  borderInput: '#56708C',
  success: '#22C07E',
  successSoft: 'rgba(34, 192, 126, 0.15)',
  successFg: '#5FE0A8',
  warning: '#F1B237',
  warningSoft: 'rgba(241, 178, 55, 0.16)',
  warningFg: '#F5C45E',
  error: '#F0605A',
  errorSoft: 'rgba(240, 96, 90, 0.16)',
  errorFg: '#FF9994',
  info: '#4B9AD4',
  infoSoft: 'rgba(75, 154, 212, 0.16)',
  infoFg: '#8CC3EC',
  overlay: 'rgba(0, 0, 0, 0.6)',
  brand: palette.navy950,
  onBrand: '#E8EEF5',
  onBrandMuted: '#B4C1D0',
  geofence: 'rgba(34, 192, 126, 0.18)',
  geofenceBorder: 'rgba(34, 192, 126, 0.6)',
  mapBackground: '#0B2232',
  mapLine: '#173049',
};

export const themes = { light, dark };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = (n) => n * 4;

/** Type scale (sizes in dp). Inter is the web font; the app uses the system font. */
export const type = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  section: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  small: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
};

/** Minimum touch target (Android guideline). */
export const TOUCH = 48;
