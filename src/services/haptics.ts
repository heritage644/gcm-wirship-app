/**
 * Haptic feedback.
 *
 * On a dark stage you are hitting these controls without looking at them, so a
 * tap you can *feel* is worth real money — it confirms the key changed without
 * making you glance down mid-song.
 *
 * Every call is fire-and-forget and failure-tolerant: haptics are unavailable
 * on web and on plenty of Android hardware, and a missing vibrator motor must
 * never surface as an error during a service.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

/** Key selection, fader detents — a light confirmation. */
export function tapLight(): void {
  if (!SUPPORTED) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** Committing a transition — NEXT SONG, drone lock. Deliberately heavier. */
export function tapCommit(): void {
  if (!SUPPORTED) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

/** A control that cannot act right now. */
export function tapRejected(): void {
  if (!SUPPORTED) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
