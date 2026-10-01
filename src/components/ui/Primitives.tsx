/**
 * Small shared building blocks. Every interactive element here respects the
 * 48dp minimum touch target.
 */

import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MONO, TOUCH, colors, radius, spacing, typography } from '../../theme';

// ---------------------------------------------------------------------------

export function Panel({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function SectionLabel({
  children,
  accessory,
  style,
}: {
  children: ReactNode;
  accessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionLabelRow, style]}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {accessory}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function Chip({
  label,
  selected = false,
  onPress,
  tint = colors.accent,
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
}: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        selected && { borderColor: tint, backgroundColor: hexWithAlpha(tint, 0.14) },
        pressed && !disabled && styles.chipPressed,
        disabled && styles.chipDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          selected && { color: tint },
          disabled && { color: colors.textMuted },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export function IconButton({
  glyph,
  onPress,
  tint = colors.textPrimary,
  size = TOUCH.min,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  glyph: string;
  onPress?: () => void;
  tint?: string;
  size?: number;
  disabled?: boolean;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, borderRadius: radius.md },
        pressed && !disabled && styles.chipPressed,
        disabled && styles.chipDisabled,
        style,
      ]}
    >
      <Text style={[styles.iconGlyph, { color: disabled ? colors.textMuted : tint }]}>{glyph}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

/** Numeric readout. Tabular figures so the text does not shuffle as it ticks. */
export function Readout({
  value,
  style,
}: {
  value: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.readout, style]}>{value}</Text>;
}

// ---------------------------------------------------------------------------

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

/**
 * Expand a #RRGGBB string into rgba(). Used for translucent tints derived from
 * a stem's identity colour, so colours live in exactly one place.
 */
export function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    minHeight: 20,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  chip: {
    minHeight: TOUCH.min,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPressed: {
    opacity: 0.6,
  },
  chipDisabled: {
    opacity: 0.35,
  },
  chipText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconGlyph: {
    fontSize: 18,
    fontWeight: '700',
  },
  readout: {
    ...MONO,
    fontSize: 12,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  empty: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.title,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
