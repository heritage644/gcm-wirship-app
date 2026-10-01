import { Platform, type TextStyle } from 'react-native';

/**
 * AuraPad — stage theme tokens.
 *
 * Designed for a dark auditorium with a phone or tablet on a music stand:
 *  - Pure #000000 background. On OLED the pixels are genuinely off, so the
 *    device throws almost no light onto the platform and the battery lasts.
 *  - High-contrast neon accents that stay legible at a glance from arm's
 *    length, with colour used to identify stems rather than to decorate.
 *  - TOUCH.min = 48 everywhere. Nothing on this screen should ever need a
 *    careful aim mid-service.
 */

export const colors = {
  background: '#000000',
  surface: '#0A0A0C',
  surfaceRaised: '#131318',
  surfaceActive: '#1C1C24',
  border: '#1F1F28',
  borderBright: '#33333F',

  textPrimary: '#FFFFFF',
  textSecondary: '#9A9AAB',
  textMuted: '#5C5C6B',
  textInverse: '#000000',

  accent: '#00E5FF',
  accentDim: '#0097AD',
  accentGlow: 'rgba(0, 229, 255, 0.18)',

  danger: '#FF4D6D',
  warning: '#FFB454',
  success: '#39E6A8',

  // Per-stem identity — mirrored in STEM_DESCRIPTORS.
  base: '#4DA3FF',
  shimmer: '#9D7BFF',
  sub: '#FF7A59',
  texture: '#39E6A8',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

/** Minimum interactive size, in dp. Non-negotiable for live use. */
export const TOUCH = {
  min: 48,
  comfortable: 56,
  large: 72,
} as const;

export const typography = {
  /** Wide-tracked caps used for every label — reads fast in low light. */
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
  },
  labelSmall: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
  },
  body: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  title: {
    fontSize: 20,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  display: {
    fontSize: 56,
    fontWeight: '800' as const,
    letterSpacing: -2,
  },
} as const;

/**
 * Monospaced numeric style. Tabular figures stop readouts from shuffling
 * sideways as digits change, which is distracting on a dark stage.
 * iOS has no family literally called "monospace", hence the per-platform pick.
 */
export const MONO: Pick<TextStyle, 'fontFamily' | 'fontVariant'> = {
  fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  fontVariant: ['tabular-nums'],
};
