# AuraPad

A multi-stem ambient pad and worship engine for live performance, built with Expo / React Native.

On iOS/Android, four legacy stems play in sync across the twelve musical keys with logarithmic
crossfades. In the browser, Perform streams multisamples from public audio hosts; an internet
connection is required. Optional ambience beds can still be supplied locally.

---

## Quick start

```bash
npm install
npm start                # then press i / a / w, or scan the QR code
```

The browser Perform screen downloads real instrument multisamples from public hosts at runtime;
no local pad recordings are required. The old key-loop assets remain only for the native Expo Audio
compatibility path, and optional ambience loops can be added under `src/assets/audio/beds/`.

| Target | Command |
| --- | --- |
| iOS simulator | `npm run ios` |
| Android emulator | `npm run android` |
| Browser | `npm run web` |

> **Expo Go vs. development build** — Expo Go bundles `expo-audio`, Reanimated and
> Gesture Handler, so AuraPad runs in Expo Go as-is. A development build
> (`npx expo run:ios` / `npx expo run:android`) is only needed if you add a library with
> native code that Expo Go does not ship.

### Checks

```bash
npm run check          # typecheck + lint + the full test suite
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # fade math + audio engines + sequencer + legacy loop integrity
npm run verify:audio   # verify the pre-existing native compatibility loops
```

---

## How it works

### The audio engine

`src/services/AudioService.ts` owns every native player in the app. There are four mixer
channels — `base`, `shimmer`, `sub`, `texture` — and **each one is its own two-slot
crossfader**, like a pair of DJ decks. One slot holds the loop you can hear; selecting a new
key loads the incoming loop into the idle slot at zero gain, starts it, and ramps the two
slots past each other.

Giving every channel its own crossfader (rather than crossfading whole "decks") is what makes
**Drone Lock** fall out for free: locking the sub simply means *don't run a fade job on the sub
channel*, so it keeps holding the old key underneath while base and shimmer move to the new one.

The incoming loop is also seeked to the outgoing loop's playhead, so the slow LFO motion of the
pad continues through the transition instead of restarting.

#### Gain graph

```
player.volume  =  master × fader × mute × canvasXY × fadeGain
```

That formula lives in exactly one function — `resolveChannelGain()` in
`src/services/fades.ts` — so the meters in the UI cannot drift from what is actually being sent
to the hardware.

#### Fade curves

The default is **logarithmic**: gain is linear in *decibels*, which is how hearing works, so the
swell sounds even from start to finish. A linear amplitude ramp appears to leap to near-full
loudness in the first third and then crawl. Also available:

| Curve | Behaviour |
| --- | --- |
| `logarithmic` | dB-linear. Default. 6 dB per 10% of travel; -30 dB at the midpoint. |
| `equalPower` | sin/cos pair. Holds constant total power — used automatically when switching ambience beds, which are uncorrelated noise. |
| `linear` | Raw amplitude ramp. Sags ~3 dB through the crossover. |

One shared ~24 ms ticker drives every in-flight fade, with elapsed time read from the clock
rather than counted in ticks — so a fade lasts the requested number of seconds even if the JS
thread stalls.

#### Resource management

Native players are expensive, so loaded keys sit in a small LRU cache (3 keys ≈ 9 players, plus
2 texture players). Keys that are audible, mid-fade, drone-locked or explicitly preloaded are
pinned and never evicted. Stage Mode calls `preloadKey()` on the upcoming song, so **NEXT SONG**
never waits on a decoder.

### The X/Y performance canvas

`src/components/PerformCanvas/XYControlCanvas.tsx`.

- **X** — simulated low-pass cutoff. Left is warm and dark (shimmer closed, body pushed up),
  right is bright and open (shimmer wide, body eased back to leave room on top). Real filtering
  is not available through a stock player API, so brightness is produced by rebalancing a dark
  stem against a bright one — which is how the effect reads to a listener anyway.
- **Y** — weight. Down is soft and minimal, up is full and heavy (sub and ambience in).

Two things keep this at 120 fps:

1. **The visuals never touch React.** Finger position lives in a Reanimated shared value and the
   puck, crosshairs and colour washes are all driven by `useAnimatedStyle` on the UI thread.
2. **JS is woken as little as possible.** Audio is a JS-thread API, so gain updates cross via
   `runOnJS` — but only when the finger has actually moved by a perceptible amount, and
   `audioService.setXY()` deliberately does *not* notify React. It writes new volumes straight to
   the players and stale-marks the snapshot, so a drag causes **zero re-renders**. There is a
   regression test for this (`setXY does not wake React; commitXY does`).

### Setlists

`useSetlists` handles CRUD and persistence (AsyncStorage, debounced writes, validated on read so
a corrupt payload degrades to the seed set instead of crashing). Tapping a song applies its stem
preset first, then crossfades to its key at that song's own fade time.

**Stage Mode** is the hands-free view: enormous current key, the next song, and one full-width
**NEXT SONG** slab that fires the whole transition in a single tap. The slab doubles as a live
progress bar during the fade, and the screen is kept awake while the tab is open.

---

## Public sample bank (Web Audio)

The browser **PERFORM** tab fetches and decodes instrument MP3 samples directly from public hosts.
The Web Audio sampler maps each played key to the nearest listed root and transposes that buffer;
there is no oscillator or synthetic fallback. No local pad WAVs are required. The browser must be
online and the remote hosts must allow cross-origin audio requests.

| Layer | Base URL | Mapped roots |
| --- | --- | --- |
| Warm Pad | [`tonejs.github.io/audio/salamander/`](https://tonejs.github.io/audio/salamander/) | `C2.mp3`, `C4.mp3`, `C6.mp3` |
| Shimmer Pad | [`FluidR3_GM/pad_2_warm-mp3/`](https://github.com/gleitz/midi-js-soundfonts/tree/gh-pages/FluidR3_GM/pad_2_warm-mp3) | `C2.mp3`, `C4.mp3`, `C6.mp3` |
| Sub Drone | [`FluidR3_GM/synth_bass_1-mp3/`](https://github.com/gleitz/midi-js-soundfonts/tree/gh-pages/FluidR3_GM/synth_bass_1-mp3) | `C2.mp3`, `C4.mp3`, `C6.mp3` |

The FluidR3 GM library names its warm pad program `pad_2_warm-mp3`; the similarly named
`synth_pad_1_warm-mp3` directory from an earlier proposed URL is not present there, so AuraPad uses
the actual GM `Pad 2 Warm` folder. Samples load when their layer is enabled. Fetch and decode
failures are shown on that layer; one unavailable source does not block other playable layers.
The first note button and the progression play button resume the browser `AudioContext` from the
user gesture, as required by autoplay policies.

### Optional ambience beds

The ambience sources remain optional local loops. Place a loop at the matching path if you want to
use one; a missing ambience file does not prevent pad playback:

```text
src/assets/audio/beds/
├── room-bed/loop.wav
├── rain-bed/loop.wav
└── vinyl-bed/loop.wav
```

These loops should be prepared as seamless WAVs. Remote samples and soundfont-derived assets have
separate licenses and attribution terms; review those terms before distributing the app.

### Legacy native audio

The original key-specific loops under `src/assets/audio/pads/<key>/` and ambience files under
`src/assets/audio/textures/` remain for the existing iOS/Android Expo Audio mixer. They are legacy
assets and are **not used by the browser multisampler**. The former `scripts/generate-audio.mjs`
renderer has been removed; no script in the app creates replacement audio. The optional
`npm run verify:audio` check only validates those pre-existing native compatibility loops.

## Project layout

```
src/
├── assets/audio/
│   ├── beds/<bed-id>/   # optional local ambience loops
│   └── pads/<key>/      # legacy native loop assets
├── audio/
│   ├── SampleSamplerEngine.ts  # Web Audio sample player and layer crossfades
│   └── SequencerEngine.ts      # audio-clock progression scheduler
├── components/
│   ├── AudioControls/   # native mixer controls
│   ├── KeyGrid/         # 12-key selector, crossfade status bar
│   ├── PerformCanvas/   # XYControlCanvas
│   ├── Setlist/         # SetlistBuilder, SongEditor, StageMode
│   └── ui/              # shared primitives
├── config/padPresets.ts # pad, bed, and layer catalog
├── hooks/               # audio and setlist bindings
├── screens/             # tab screens, including the browser sampler
├── services/            # native AudioService and shared fade helpers
└── App.tsx              # shell + tab switcher
scripts/                 # verification and test suites; no audio generator
```

Two deliberate departures from a stock Expo app:

- **No navigation library.** Native tabs share the existing live audio engine; on web, Perform
  owns the browser sample rack. Screens stay mounted and visibility is toggled, preserving state
  while switching tabs. Stage Mode also needs to remove the tab bar entirely.

- **No slider library.** `Fader` is built on Reanimated so it animates on the UI thread, can be a
  tall vertical mixer fader, and — importantly for live use — drags **relatively**. Touching a
  fader never makes the level jump to your finger.

## Design notes

Pure `#000000` background: on OLED those pixels are genuinely off, so the device throws almost no
light onto the platform and the battery lasts. Stems are identified by colour rather than
decorated with it, every interactive element clears 48 dp, and numeric readouts use tabular
figures so they do not shuffle sideways as they tick.

## Testing

| Suite | What it covers |
| --- | --- |
| `scripts/test-fades.mjs` | 18 tests. Curve endpoints, monotonicity, symmetry, dB linearity, equal-power constancy, X/Y mapping, gain graph clamping. |
| `scripts/test-engine.mjs` | Runs the **real** native `AudioService`, stubbing only `expo-audio` and the Metro asset registry. Covers crossfades, drone lock, cache eviction, mixer gain, and preload behavior. |
| `scripts/test-sequencer.mjs` | Audio-clock progression scheduling, pause/resume, looping, tempo changes, time signatures, and invalid step handling. |
| `scripts/test-sampler.mjs` | Public sample URL mapping, pitch transposition, simultaneous layers, fetch errors, crossfades, and disposal. |
| `scripts/verify-audio.mjs` | Checks the 39 pre-existing native compatibility loops; it does not generate audio or validate newly added multisamples. |

No jest, no transform step: `fades.ts` has no React Native imports, and Node strips the
TypeScript directly.
