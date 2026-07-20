// Every sound here is synthesized on the fly with the Web Audio API rather
// than loaded from audio files - the same "no external assets" approach
// core/atlas.ts uses for graphics, so the game stays a pure code bundle.

type Ramp = { to: number; time: number };

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) {
      const ctx = new Ctor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(compressor);

      this.ctx = ctx;
      this.master = master;
      this.noiseBuffer = this.buildNoiseBuffer(ctx);
    }
    return this.ctx;
  }

  /** Must be called from inside a user-gesture handler (the very first tap
   * already does this) - browsers block audio until one fires. */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, opts: { glide?: Ramp; delay?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glide.to), t0 + opts.glide.time);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noiseBurst(duration: number, gain: number, opts: { filterFreq?: number; filterType?: BiquadFilterType; glideFilterTo?: number; delay?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? "lowpass";
    filter.frequency.setValueAtTime(opts.filterFreq ?? 2000, t0);
    if (opts.glideFilterTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glideFilterTo), t0 + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /** Ball makes contact with a flipper - punchier when it's actively swinging. */
  flipperHit(active: boolean) {
    this.tone(active ? 340 : 220, 0.09, "square", active ? 0.28 : 0.14, { glide: { to: active ? 640 : 260, time: 0.09 } });
    this.noiseBurst(0.05, active ? 0.18 : 0.08, { filterFreq: 3500 });
  }

  /** Ball dings a building without clearing it. */
  buildingHit() {
    this.tone(150, 0.09, "triangle", 0.22, { glide: { to: 90, time: 0.09 } });
    this.noiseBurst(0.06, 0.18, { filterFreq: 1200 });
  }

  /** A building drops to 0 HP and collapses. */
  buildingDestroy() {
    this.noiseBurst(0.35, 0.35, { filterFreq: 3000, glideFilterTo: 200 });
    this.tone(110, 0.3, "sawtooth", 0.25, { glide: { to: 40, time: 0.3 } });
  }

  /** A fleeing human gets caught. */
  humanPop() {
    this.tone(700, 0.08, "sine", 0.22, { glide: { to: 1100, time: 0.08 } });
    this.tone(1100, 0.06, "sine", 0.16, { delay: 0.05, glide: { to: 1400, time: 0.06 } });
  }

  /** Multiball kicks in - a bright rising arpeggio. */
  multiball() {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => this.tone(f, 0.18, "square", 0.22, { delay: i * 0.07 }));
  }

  /** Player picks a power-up card. */
  powerupPick() {
    this.tone(660, 0.1, "sine", 0.2, { glide: { to: 880, time: 0.1 } });
    this.tone(990, 0.14, "sine", 0.16, { delay: 0.08 });
  }

  /** A ball is served/launched onto the table. */
  launch() {
    this.noiseBurst(0.16, 0.16, { filterType: "highpass", filterFreq: 500, glideFilterTo: 3000 });
    this.tone(180, 0.16, "sawtooth", 0.18, { glide: { to: 420, time: 0.16 } });
  }

  /** A ball drains off the bottom of the table. */
  drain() {
    this.tone(260, 0.32, "sine", 0.22, { glide: { to: 70, time: 0.32 } });
  }

  /** Every reserve ball is gone - a short descending jingle. */
  gameOver() {
    const notes = [392, 349.23, 261.63]; // G4 F4 C4
    notes.forEach((f, i) => this.tone(f, 0.28, "triangle", 0.22, { delay: i * 0.16 }));
  }
}

export const sfx = new Sfx();
