/**
 * useSetlists — CRUD + persistence for setlists and the live playhead.
 *
 * Storage is AsyncStorage, written behind a short debounce so dragging a fader
 * in the song editor does not hammer the disk. Reads happen once on mount.
 *
 * The hook also owns "where we are in the service": which setlist is active
 * and which song index is cued. Stage Mode reads that to render NOW / NEXT.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_STEM_MIX,
  type MusicalKey,
  type Setlist,
  type SongItem,
  type StemMix,
} from '../types/audio';

const STORAGE_KEY = '@aurapad/setlists/v1';
const ACTIVE_KEY = '@aurapad/active-setlist/v1';
const WRITE_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

let idCounter = 0;
/** Collision-resistant enough for local data, and no uuid dependency. */
export function createId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// seed data — a realistic Sunday set so the app is never an empty shell
// ---------------------------------------------------------------------------

function song(
  title: string,
  targetKey: MusicalKey,
  fadeDurationSeconds: number,
  tempoInfo: string,
  stemMix: Partial<StemMix> = {},
): SongItem {
  return {
    id: createId('song'),
    title,
    targetKey,
    fadeDurationSeconds,
    tempoInfo,
    stemMix: { ...DEFAULT_STEM_MIX, ...stemMix },
  };
}

export function buildStarterSetlist(): Setlist {
  return {
    id: createId('set'),
    name: 'Sunday Morning',
    songs: [
      song('Call To Worship', 'G', 5, '72 BPM · 4/4', {
        baseVolume: 0.8,
        shimmerVolume: 0.35,
        subBassVolume: 0.6,
        textureVolume: 0.45,
      }),
      song('Great Are You Lord', 'A', 5, '68 BPM · 4/4', {
        baseVolume: 0.9,
        shimmerVolume: 0.6,
        subBassVolume: 0.7,
        textureVolume: 0.3,
      }),
      song('Goodness Of God', 'C', 8, '63 BPM · 6/8', {
        baseVolume: 0.85,
        shimmerVolume: 0.75,
        subBassVolume: 0.65,
        textureVolume: 0.25,
      }),
      song('Spontaneous / Prayer', 'D', 8, 'Free time', {
        baseVolume: 0.7,
        shimmerVolume: 0.45,
        subBassVolume: 0.85,
        textureVolume: 0.55,
      }),
      song('Sending Out', 'E', 3, '78 BPM · 4/4', {
        baseVolume: 0.95,
        shimmerVolume: 0.8,
        subBassVolume: 0.75,
        textureVolume: 0.2,
      }),
    ],
  };
}

export function createEmptySong(index: number): SongItem {
  return {
    id: createId('song'),
    title: `New Song ${index + 1}`,
    targetKey: 'C',
    fadeDurationSeconds: 5,
    tempoInfo: '',
    stemMix: { ...DEFAULT_STEM_MIX },
  };
}

// ---------------------------------------------------------------------------
// validation — never trust what came back off disk
// ---------------------------------------------------------------------------

const KEY_SET = new Set<string>([
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]);

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function parseSong(raw: unknown): SongItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.targetKey === 'string' && KEY_SET.has(r.targetKey) ? r.targetKey : 'C';
  const mixRaw = (r.stemMix ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' ? r.id : createId('song'),
    title: typeof r.title === 'string' ? r.title : 'Untitled',
    targetKey: key as MusicalKey,
    fadeDurationSeconds: Math.max(0, num(r.fadeDurationSeconds, 5)),
    tempoInfo: typeof r.tempoInfo === 'string' ? r.tempoInfo : undefined,
    stemMix: {
      baseVolume: clamp01(num(mixRaw.baseVolume, DEFAULT_STEM_MIX.baseVolume)),
      shimmerVolume: clamp01(num(mixRaw.shimmerVolume, DEFAULT_STEM_MIX.shimmerVolume)),
      subBassVolume: clamp01(num(mixRaw.subBassVolume, DEFAULT_STEM_MIX.subBassVolume)),
      textureVolume: clamp01(num(mixRaw.textureVolume, DEFAULT_STEM_MIX.textureVolume)),
    },
  };
}

function parseSetlists(json: string | null): Setlist[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const lists = parsed
      .map((raw): Setlist | null => {
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        const songs = Array.isArray(r.songs)
          ? r.songs.map(parseSong).filter((s): s is SongItem => s !== null)
          : [];
        return {
          id: typeof r.id === 'string' ? r.id : createId('set'),
          name: typeof r.name === 'string' ? r.name : 'Untitled Set',
          songs,
        };
      })
      .filter((s): s is Setlist => s !== null);
    return lists;
  } catch {
    return null; // corrupt payload — fall back to seed rather than crash
  }
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

export interface SetlistsApi {
  setlists: Setlist[];
  activeSetlist: Setlist | null;
  activeSetlistId: string | null;
  hydrated: boolean;

  /** Index of the cued song inside the active setlist, or -1. */
  currentIndex: number;
  currentSong: SongItem | null;
  nextSong: SongItem | null;

  selectSetlist: (setlistId: string) => void;
  createSetlist: (name?: string) => Setlist;
  renameSetlist: (setlistId: string, name: string) => void;
  deleteSetlist: (setlistId: string) => void;
  duplicateSetlist: (setlistId: string) => void;

  addSong: (setlistId: string, song?: SongItem) => SongItem;
  updateSong: (setlistId: string, songId: string, patch: Partial<SongItem>) => void;
  deleteSong: (setlistId: string, songId: string) => void;
  moveSong: (setlistId: string, songId: string, direction: -1 | 1) => void;

  cueIndex: (index: number) => void;
  advance: () => SongItem | null;
  rewind: () => SongItem | null;
  resetToStart: () => void;
}

export function useSetlists(): SetlistsApi {
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [activeSetlistId, setActiveSetlistId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [hydrated, setHydrated] = useState(false);

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // --- load once -----------------------------------------------------------
  useEffect(() => {
    mounted.current = true;
    (async () => {
      let loaded: Setlist[] | null = null;
      let active: string | null = null;
      try {
        const [rawLists, rawActive] = await AsyncStorage.multiGet([STORAGE_KEY, ACTIVE_KEY]);
        loaded = parseSetlists(rawLists[1]);
        active = rawActive[1];
      } catch {
        loaded = null; // storage unavailable — run from seed, in-memory only
      }

      if (!mounted.current) return;

      if (!loaded || loaded.length === 0) {
        const starter = buildStarterSetlist();
        setSetlists([starter]);
        setActiveSetlistId(starter.id);
      } else {
        setSetlists(loaded);
        const exists = loaded.some((s) => s.id === active);
        setActiveSetlistId(exists ? active : loaded[0].id);
      }
      setHydrated(true);
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  // --- persist on change (debounced) --------------------------------------
  useEffect(() => {
    if (!hydrated) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      AsyncStorage.multiSet([
        [STORAGE_KEY, JSON.stringify(setlists)],
        [ACTIVE_KEY, activeSetlistId ?? ''],
      ]).catch(() => undefined); // persistence is best-effort, never fatal
    }, WRITE_DEBOUNCE_MS);

    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [setlists, activeSetlistId, hydrated]);

  const activeSetlist = useMemo(
    () => setlists.find((s) => s.id === activeSetlistId) ?? null,
    [setlists, activeSetlistId],
  );

  const mutateSetlist = useCallback(
    (setlistId: string, updater: (setlist: Setlist) => Setlist) => {
      setSetlists((prev) => prev.map((s) => (s.id === setlistId ? updater(s) : s)));
    },
    [],
  );

  // --- setlist CRUD --------------------------------------------------------

  const selectSetlist = useCallback((setlistId: string) => {
    setActiveSetlistId(setlistId);
    setCurrentIndex(-1);
  }, []);

  const createSetlist = useCallback((name?: string) => {
    const created: Setlist = { id: createId('set'), name: name?.trim() || 'New Setlist', songs: [] };
    setSetlists((prev) => [...prev, created]);
    setActiveSetlistId(created.id);
    setCurrentIndex(-1);
    return created;
  }, []);

  const renameSetlist = useCallback(
    (setlistId: string, name: string) => {
      mutateSetlist(setlistId, (s) => ({ ...s, name: name.trim() || s.name }));
    },
    [mutateSetlist],
  );

  const deleteSetlist = useCallback(
    (setlistId: string) => {
      setSetlists((prev) => {
        const remaining = prev.filter((s) => s.id !== setlistId);
        // Never leave the app with nothing to show.
        const next = remaining.length > 0 ? remaining : [buildStarterSetlist()];
        setActiveSetlistId((currentActive) =>
          currentActive === setlistId ? next[0].id : currentActive,
        );
        return next;
      });
      setCurrentIndex(-1);
    },
    [],
  );

  const duplicateSetlist = useCallback((setlistId: string) => {
    setSetlists((prev) => {
      const source = prev.find((s) => s.id === setlistId);
      if (!source) return prev;
      const copy: Setlist = {
        id: createId('set'),
        name: `${source.name} (copy)`,
        songs: source.songs.map((s) => ({ ...s, id: createId('song'), stemMix: { ...s.stemMix } })),
      };
      return [...prev, copy];
    });
  }, []);

  // --- song CRUD -----------------------------------------------------------

  const addSong = useCallback(
    (setlistId: string, provided?: SongItem) => {
      const target = setlists.find((s) => s.id === setlistId);
      const created = provided ?? createEmptySong(target?.songs.length ?? 0);
      mutateSetlist(setlistId, (s) => ({ ...s, songs: [...s.songs, created] }));
      return created;
    },
    [mutateSetlist, setlists],
  );

  const updateSong = useCallback(
    (setlistId: string, songId: string, patch: Partial<SongItem>) => {
      mutateSetlist(setlistId, (s) => ({
        ...s,
        songs: s.songs.map((song_) => (song_.id === songId ? { ...song_, ...patch } : song_)),
      }));
    },
    [mutateSetlist],
  );

  const deleteSong = useCallback(
    (setlistId: string, songId: string) => {
      mutateSetlist(setlistId, (s) => ({ ...s, songs: s.songs.filter((x) => x.id !== songId) }));
      setCurrentIndex((i) => (i > 0 ? i - 1 : -1));
    },
    [mutateSetlist],
  );

  const moveSong = useCallback(
    (setlistId: string, songId: string, direction: -1 | 1) => {
      mutateSetlist(setlistId, (s) => {
        const index = s.songs.findIndex((x) => x.id === songId);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= s.songs.length) return s;
        const songs = [...s.songs];
        const [moved] = songs.splice(index, 1);
        songs.splice(target, 0, moved);
        return { ...s, songs };
      });
    },
    [mutateSetlist],
  );

  // --- playhead ------------------------------------------------------------

  // Memoised so `?? []` does not mint a fresh array on every render and
  // invalidate every callback that depends on it.
  const songs = useMemo(() => activeSetlist?.songs ?? [], [activeSetlist]);
  const currentSong = currentIndex >= 0 ? (songs[currentIndex] ?? null) : null;
  const nextSong = songs[currentIndex + 1] ?? null;

  const cueIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= songs.length) return;
      setCurrentIndex(index);
    },
    [songs.length],
  );

  const advance = useCallback(() => {
    if (songs.length === 0) return null;
    const target = Math.min(currentIndex + 1, songs.length - 1);
    if (target === currentIndex && currentIndex !== -1) return null; // already at the end
    setCurrentIndex(target);
    return songs[target] ?? null;
  }, [currentIndex, songs]);

  const rewind = useCallback(() => {
    if (songs.length === 0) return null;
    const target = Math.max(currentIndex - 1, 0);
    if (target === currentIndex) return null;
    setCurrentIndex(target);
    return songs[target] ?? null;
  }, [currentIndex, songs]);

  const resetToStart = useCallback(() => setCurrentIndex(-1), []);

  return {
    setlists,
    activeSetlist,
    activeSetlistId,
    hydrated,
    currentIndex,
    currentSong,
    nextSong,
    selectSetlist,
    createSetlist,
    renameSetlist,
    deleteSetlist,
    duplicateSetlist,
    addSong,
    updateSong,
    deleteSong,
    moveSong,
    cueIndex,
    advance,
    rewind,
    resetToStart,
  };
}
