/**
 * AuraPad — application shell.
 *
 * Navigation is a hand-rolled tab switcher rather than a navigation library,
 * for reasons that are specific to this app:
 *
 *  - Native tabs read and write ONE live audio engine. Nothing is ever
 *    "unmounted and reloaded" — the pad must keep playing while you move
 *    between the mixer, the canvas and the setlist. The browser Perform tab
 *    uses its own lazy Web Audio sample engine. Keeping screens mounted preserves
 *    scroll and animation state while switching tabs.
 *  - Stage Mode has to take over the entire display with no chrome at all,
 *    which means the tab bar itself must be able to disappear.
 *  - Zero navigation state to get wrong mid-service, and no extra frames of
 *    work on a transition.
 *
 * Mounted-but-hidden screens keep their scroll position and their Reanimated
 * shared values, so switching tabs is instant.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { hexWithAlpha } from './components/ui/Primitives';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useSetlists } from './hooks/useSetlists';
import { CanvasScreen } from './screens/CanvasScreen';
import { PerformScreen } from './screens/PerformScreen';
import { SetlistScreen } from './screens/SetlistScreen';
import { StageScreen } from './screens/StageScreen';
import { audioService } from './services/AudioService';
import { TOUCH, colors, spacing, typography } from './theme';

type TabId = 'perform' | 'canvas' | 'setlist' | 'stage';

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: 'perform', label: 'PERFORM', glyph: '▦' },
  { id: 'canvas', label: 'CANVAS', glyph: '✥' },
  { id: 'setlist', label: 'SETLIST', glyph: '☰' },
  { id: 'stage', label: 'STAGE', glyph: '◉' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        {/* Desktop web gets a wider sound-bank workspace; native keeps the
            original full-width stage layout. */}
        <View style={styles.webShell}>
          <View style={styles.webFrame}>
            <AuraPad />
          </View>
        </View>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function AuraPad() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabId>('perform');

  const engine = useAudioEngine();
  const setlists = useSetlists();

  // Release every native player when the app is torn down.
  useEffect(() => () => audioService.dispose(), []);

  const goPerform = useCallback(() => setTab('perform'), []);

  const header = useMemo(
    () => (
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.brandRow}>
          <View style={styles.mark} />
          <Text style={styles.brand}>AURAPAD</Text>
        </View>
        <Text style={styles.brandMeta}>
          {Platform.OS === 'web' && tab === 'perform'
            ? 'SAMPLE LAYERS · WEB AUDIO'
            : engine.state.currentKey
              ? `${engine.state.currentKey} · ${engine.state.isPlaying ? 'LIVE' : 'PAUSED'}`
              : 'IDLE'}
        </Text>
      </View>
    ),
    [insets.top, tab, engine.state.currentKey, engine.state.isPlaying],
  );

  const isStage = tab === 'stage';

  return (
    <View style={styles.container}>
      {/* Stage Mode is deliberately chrome-free: no header, no tab bar. */}
      {!isStage ? header : null}

      <View style={styles.body}>
        <Screen visible={tab === 'perform'}>
          <PerformScreen engine={engine} />
        </Screen>
        <Screen visible={tab === 'canvas'}>
          <CanvasScreen engine={engine} />
        </Screen>
        <Screen visible={tab === 'setlist'}>
          <SetlistScreen engine={engine} setlists={setlists} />
        </Screen>
        <Screen visible={isStage} padTop={insets.top}>
          <StageScreen engine={engine} setlists={setlists} onExit={goPerform} />
        </Screen>
      </View>

      {!isStage ? (
        <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${item.label} tab`}
                style={({ pressed }) => [
                  styles.tab,
                  active && styles.tabActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.tabGlyph, active && styles.tabGlyphActive]}>
                  {item.glyph}
                </Text>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Keeps a screen mounted while hidden so the audio engine, scroll offsets and
 * UI-thread animation state all survive a tab change.
 *
 * `display: none` is used rather than conditional rendering because it removes
 * the subtree from layout entirely — hidden screens cost nothing to lay out.
 */
function Screen({
  visible,
  padTop = 0,
  children,
}: {
  visible: boolean;
  padTop?: number;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { paddingTop: padTop },
        visible ? styles.screenVisible : styles.screenHidden,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      // Hidden screens must also be invisible to screen readers.
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webShell: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? { alignItems: 'center' } : null),
  },
  webFrame: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web'
      ? { maxWidth: 1240, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border }
      : null),
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  brand: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 3,
    color: colors.textPrimary,
  },
  brandMeta: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  body: {
    flex: 1,
  },
  screenVisible: {
    display: 'flex',
  },
  screenHidden: {
    display: 'none',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    minHeight: TOUCH.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    gap: 3,
    paddingVertical: spacing.xs,
  },
  tabActive: {
    backgroundColor: hexWithAlpha(colors.accent, 0.12),
  },
  tabGlyph: {
    fontSize: 16,
    color: colors.textMuted,
    // Android renders these geometric glyphs a touch low without this nudge.
    marginTop: Platform.OS === 'android' ? -2 : 0,
  },
  tabGlyphActive: {
    color: colors.accent,
  },
  tabLabel: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.6,
  },
});
