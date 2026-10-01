# AuraPad

A multi-stem ambient pad and worship engine for live performance, built with Expo / React Native.

Four stems play in sync for any of the twelve musical keys. Changing key runs a logarithmic
crossfade between the outgoing and incoming loops, so the sound never stops and never clicks.

---

## Quick start

```bash
npm install
npm run generate:audio   # renders the 39-file sample library (~8 MB, ~12s)
npm start                # then press i / a / w, or scan the QR code
```

The audio library is committed, so `generate:audio` is only needed if you want to re-render it
or change the synthesis. Everything else runs straight from a clean clone.

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
npm test               # fade math + engine integration + loop integrity
npm run verify:audio   # prove every generated loop is click-free
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

## The sample library

`npm run generate:audio` renders a complete royalty-free placeholder library — 12 keys × 3
pitched stems, plus 3 ambience beds (vinyl, rain, warm room), 39 files and about 8 MB.

Seamless looping is the whole game, and the two stem families need different treatment:

**Tonal stems** (base / shimmer / sub) — every partial and every LFO frequency is quantised onto
the loop's harmonic grid, i.e. an integer number of cycles per loop. A waveform built only from
exact harmonics of the loop period is mathematically periodic at that period, so the last sample
flows into the first with no discontinuity. Worst-case detune from quantisation is well under a
cent, so it is inaudible.

There is a subtlety that is easy to get wrong: **a causal IIR filter started from a cold state
produces a start-up transient, which makes even a perfectly periodic input come out
non-periodic** — and a non-periodic buffer clicks. Every filter in the generator therefore runs
a full "warm-up" lap over the buffer purely to settle its state before the real pass. Skipping
that step made the sub-bass loop point jump *10× a normal sample step*; with it, the worst seam
in the whole library is 0.84× a normal step.

**Noise textures** cannot be harmonic-quantised, so they are rendered long and then
wrap-crossfaded: the tail is blended back over the head with an equal-power curve, so the end of
the loop already *is* the beginning.

`npm run verify:audio` proves it, and fails the build if any loop regresses:

```
AuraPad loop integrity — 39 files, pass threshold wrap/max <= 1
file              rate    len    peak   rms     wrapStep   maxStep    wrap/max  result
A/base            22050   6.00s  0.720  0.1947  5.09e-2    8.87e-2    0.5742    PASS
...
worst seam: Fs/sub at ratio 0.8423

All loops seamless.
```

The test measures the jump across the loop point against the loop's own largest internal step.
If the seam looks like ordinary waveform motion, you cannot hear it.

### Swapping in real audio

Drop your own loops into `src/assets/audio/pads/<Key>/{base,shimmer,sub}.wav` (use `Cs`, `Ds`…
for sharps) and `src/assets/audio/textures/*.wav`, then run `npm run verify:audio` to confirm
they loop cleanly. `src/assets/audio/index.ts` is generated, but its shape is stable — Metro only
understands static `require()` calls, which is why the library is spelled out literally.

---

## Project layout

```
src/
├── assets/audio/        # generated loops + the static require() registry
├── components/
│   ├── AudioControls/   # Fader, StemChannelStrip, MixerPanel, TransportBar
│   ├── KeyGrid/         # 12-key selector, crossfade status bar
│   ├── PerformCanvas/   # XYControlCanvas
│   ├── Setlist/         # SetlistBuilder, SongEditor, StageMode
│   └── ui/              # shared primitives
├── hooks/
│   ├── useAudioEngine.ts
│   └── useSetlists.ts
├── screens/             # one per tab
├── services/
│   ├── AudioService.ts  # native players, decks, crossfade scheduler
│   └── fades.ts         # pure gain math (no RN imports — directly testable)
├── types/audio.ts
├── theme.ts
└── App.tsx              # shell + tab switcher
scripts/                 # audio generator, loop verifier, test suites
```

Two deliberate departures from a stock Expo app:

- **No navigation library.** All four tabs read and write one live audio engine, and the pad has
  to keep playing while you move between them — so screens stay mounted and visibility is
  toggled. Stage Mode also needs to remove the tab bar entirely, and there is no navigation
  state to get wrong mid-service.
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
| `scripts/test-engine.mjs` | 21 tests. Runs the **real** `AudioService`, stubbing only `expo-audio` and the Metro asset registry via Node's `module.registerHooks`. Covers crossfade overlap, retargeting mid-fade, phase alignment, deck release, drone lock both ways, LRU eviction, pinning, preload, mute/master/canvas gain, and the zero-re-render guarantee. |
| `scripts/verify-audio.mjs` | 39 files. Loop-seam integrity, DC offset, peak ceiling. |

No jest, no transform step: `fades.ts` has no React Native imports, and Node strips the
TypeScript directly.
