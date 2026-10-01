/** Selectable browser-synth profiles. These are procedural approximations, not factory samples. */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { YAMAHA_PRESET_LIST, type YamahaPresetCategory, type YamahaPresetId } from '../../audio/dsp/YamahaEngine';
import { colors, radius, spacing, typography } from '../../theme';

const CATEGORY_ORDER: readonly YamahaPresetCategory[] = [
  'Atmospheric & Analog Pads',
  'Motion & Bell Pads',
  'Orchestral Strings & Layered Brass',
  'Harmonic Comps',
];

export interface YamahaPresetGridProps {
  selectedPresetId: YamahaPresetId;
  onSelect: (presetId: YamahaPresetId) => void;
}

export function YamahaPresetGrid({ selectedPresetId, onSelect }: YamahaPresetGridProps) {
  return (
    <View style={styles.container}>
      {CATEGORY_ORDER.map((category) => (
        <View key={category} style={styles.category}>
          <Text style={styles.categoryTitle}>{category}</Text>
          <View style={styles.grid}>
            {YAMAHA_PRESET_LIST.filter((preset) => preset.category === category).map((preset) => {
              const selected = selectedPresetId === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => onSelect(preset.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Select ${preset.name} sound profile`}
                  style={({ pressed }) => [
                    styles.card,
                    selected && styles.cardSelected,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={2}>
                    {preset.name}
                  </Text>
                  <Text style={styles.description} numberOfLines={2}>
                    {preset.description}
                  </Text>
                  {selected ? <Text style={styles.selectedTag}>SELECTED</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  category: {
    gap: spacing.sm,
  },
  categoryTitle: {
    ...typography.labelSmall,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    flexBasis: '23%',
    flexGrow: 1,
    minWidth: 150,
    minHeight: 106,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0, 229, 255, 0.09)',
  },
  cardPressed: {
    opacity: 0.68,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  nameSelected: {
    color: colors.accent,
  },
  description: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  selectedTag: {
    ...typography.labelSmall,
    color: colors.accent,
  },
});
