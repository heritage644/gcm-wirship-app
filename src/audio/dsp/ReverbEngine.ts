/**
 * Small convolution reverb bus for the procedural pad engine.
 *
 * The default impulse is generated locally (no network request or bundled
 * sample is required). A caller may replace it with a recorded room response
 * when one is available.
 */

export interface ReverbEngineOptions {
  wet?: number;
  dry?: number;
  decaySeconds?: number;
  preDelaySeconds?: number;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export class ReverbEngine {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly convolver: ConvolverNode;

  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly preDelay: DelayNode;
  private readonly context: BaseAudioContext;
  private disposed = false;

  constructor(context: BaseAudioContext, options: ReverbEngineOptions = {}) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.preDelay = context.createDelay(1);
    this.convolver = context.createConvolver();

    const wet = clamp01(options.wet ?? 0.28);
    const dry = clamp01(options.dry ?? 1 - wet);
    this.dryGain.gain.value = dry;
    this.wetGain.gain.value = wet;
    this.preDelay.delayTime.value = Math.max(0, Math.min(0.25, options.preDelaySeconds ?? 0.018));
    this.convolver.normalize = true;
    this.convolver.buffer = this.createImpulseResponse(options.decaySeconds ?? 2.6);

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.input.connect(this.preDelay);
    this.preDelay.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(this.output);
  }

  /** Smoothly change the wet/dry balance without interrupting the tail. */
  setMix(wet: number, dry = 1 - wet, rampSeconds = 0.035): void {
    if (this.disposed) return;
    const now = this.context.currentTime;
    const ramp = Math.max(0.005, Number.isFinite(rampSeconds) ? rampSeconds : 0.035);
    this.wetGain.gain.setTargetAtTime(clamp01(wet), now, ramp);
    this.dryGain.gain.setTargetAtTime(clamp01(dry), now, ramp);
  }

  /** Replace the generated room with an externally loaded impulse response. */
  setImpulseResponse(buffer: AudioBuffer): void {
    if (this.disposed) return;
    this.convolver.buffer = buffer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.disconnect();
    this.output.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.preDelay.disconnect();
    this.convolver.disconnect();
  }

  private createImpulseResponse(decaySeconds: number): AudioBuffer {
    const decay = Math.max(0.2, Math.min(8, decaySeconds));
    const sampleRate = this.context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * decay));
    const impulse = this.context.createBuffer(2, length, sampleRate);

    // Seeded noise makes the generated response reproducible for testing and
    // avoids doing anything surprising with global Math.random state.
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel);
      let seed = 0x6d2b79f5 ^ (channel * 0x9e3779b9);
      for (let i = 0; i < samples.length; i += 1) {
        seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
        seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
        const noise = ((seed ^ (seed >>> 14)) >>> 0) / 0xffffffff * 2 - 1;
        const progress = i / Math.max(1, samples.length - 1);
        const decayEnvelope = Math.exp(-6.9 * progress);
        const earlyReflection = i < sampleRate * 0.055 ? 1.35 : 1;
        samples[i] = noise * decayEnvelope * earlyReflection * 0.22;
      }
    }

    return impulse;
  }
}
