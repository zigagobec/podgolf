/** All sounds are synthesized with WebAudio, so the game ships no audio files. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private rolls: { gain: GainNode; filter: BiquadFilterNode }[] = [];
  private charge: ({ osc: OscillatorNode; gain: GainNode } | null)[] = [null, null];
  private musicGain!: GainNode;
  private musicTimer = 0;
  private nextBeat = 0;
  private beat = 0;
  muted = false;
  musicOn = true;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Rolling-ball rumble per ball, panned to its player's half.
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = i === 0 ? -0.5 : 0.5;
      src.connect(filter).connect(gain).connect(pan).connect(this.master);
      src.start();
      this.rolls.push({ gain, filter });
    }
    // Fridge hum.
    const hum = ctx.createOscillator();
    hum.frequency.value = 58;
    const hum2 = ctx.createOscillator();
    hum2.frequency.value = 117;
    const hg = ctx.createGain();
    hg.gain.value = 0.018;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 200;
    hum.connect(hf);
    hum2.connect(hf);
    hf.connect(hg).connect(this.master);
    hum.start();
    hum2.start();
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    this.nextBeat = ctx.currentTime + 0.1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private out(pan: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, pan = 0, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, dur);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(freq: number, q: number, dur: number, vol: number, pan = 0, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.002, dur);
    s.connect(f).connect(g).connect(this.out(pan));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  hit(power: number, player: number): void {
    const pan = player === 0 ? -0.4 : 0.4;
    this.burst(1800 + power * 1500, 1.2, 0.05, 0.35 + power * 0.5, pan);
    this.tone('sine', 220 + power * 120, 70, 0.14, 0.5 + power * 0.4, pan);
    this.tone('triangle', 900, 500, 0.06, 0.15, pan);
  }

  squeak(player: number, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = (player === 0 ? 2300 : 2800) * pitch;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.35, t + 0.05);
    o.frequency.linearRampToValueAtTime(base * 0.9, t + 0.13);
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vg = ctx.createGain();
    vg.gain.value = base * 0.04;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.01, 0.13);
    o.connect(g).connect(this.out(player === 0 ? -0.4 : 0.4));
    o.start(t);
    vib.start(t);
    o.stop(t + 0.2);
    vib.stop(t + 0.2);
  }

  bounce(tag: string, speed: number): void {
    const v = Math.min(1, speed / 14);
    switch (tag) {
      case 'can':
        this.tone('sine', 1250, 1180, 0.25, 0.12 + v * 0.25);
        this.tone('sine', 3130, 3000, 0.15, 0.05 + v * 0.1);
        break;
      case 'sponge':
        this.tone('sine', 180, 420, 0.22, 0.25 + v * 0.3);
        break;
      case 'glass':
        this.tone('sine', 2200, 2150, 0.3, 0.08 + v * 0.15);
        break;
      case 'spoon':
      case 'wood':
        this.burst(700, 4, 0.06, 0.2 + v * 0.4);
        this.tone('triangle', 420, 300, 0.06, 0.1 + v * 0.2);
        break;
      case 'floor':
        this.burst(2500, 2, 0.03, 0.05 + v * 0.2);
        break;
      default:
        this.burst(350, 2, 0.08, 0.15 + v * 0.35);
    }
  }

  clack(speed: number): void {
    this.tone('square', 1900, 1600, 0.03, 0.05 + Math.min(0.2, speed * 0.02));
    this.burst(4000, 3, 0.03, 0.2);
  }

  bonk(victim: number): void {
    this.tone('square', 160, 60, 0.16, 0.35);
    this.burst(500, 1, 0.12, 0.4);
    this.squeak(victim, 1.3);
    for (let i = 0; i < 3; i++) this.tone('sine', 1800 + i * 300, 1700 + i * 300, 0.08, 0.06, 0, 0.12 + i * 0.07);
  }

  lip(): void {
    for (let i = 0; i < 3; i++) this.tone('sine', 1500 + Math.random() * 300, 1400, 0.05, 0.12, 0, i * 0.045);
  }

  sink(player: number): void {
    const pan = player === 0 ? -0.3 : 0.3;
    this.tone('sine', 700, 160, 0.18, 0.5, pan);
    this.burst(900, 3, 0.15, 0.3, pan, 'bandpass', 0.12);
    this.tone('sine', 300, 280, 0.25, 0.3, pan, 0.18);
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => this.tone('triangle', f, f, i === notes.length - 1 ? 0.6 : 0.14, 0.22, 0, 0.35 + i * 0.11));
  }

  beep(high: boolean): void {
    this.tone('square', high ? 880 : 440, high ? 880 : 440, high ? 0.35 : 0.14, 0.16);
  }

  respawn(): void {
    this.tone('triangle', 300, 900, 0.2, 0.15);
  }

  setCharge(player: number, charge: number | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cur = this.charge[player];
    if (charge === null) {
      if (cur) {
        cur.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        cur.osc.stop(ctx.currentTime + 0.1);
        this.charge[player] = null;
      }
      return;
    }
    if (!cur) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.out(player === 0 ? -0.5 : 0.5));
      osc.start();
      this.charge[player] = { osc, gain };
    }
    const c = this.charge[player]!;
    c.osc.frequency.setTargetAtTime(260 + charge * 520, ctx.currentTime, 0.02);
    c.gain.gain.setTargetAtTime(0.03 + charge * 0.05, ctx.currentTime, 0.03);
  }

  setRoll(i: number, speed: number, grounded: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.rolls[i]) return;
    const v = grounded ? Math.min(1, speed / 12) : 0;
    this.rolls[i].gain.gain.setTargetAtTime(v * 0.22, ctx.currentTime, 0.05);
    this.rolls[i].filter.frequency.setTargetAtTime(180 + v * 900, ctx.currentTime, 0.05);
  }

  /** Sneaky pizzicato bass + brushes, scheduled a little ahead of time. */
  tickMusic(intense: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.musicGain.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, ctx.currentTime, 0.2);
    if (!this.musicOn) return;
    const bpm = intense ? 132 : 112;
    const step = 60 / bpm / 2;
    // Walking minor bass line (in semitones from A1).
    const line = [0, 3, 5, 7, 10, 7, 5, 3, 0, 3, 5, 6, 7, 5, 3, 2];
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const t = this.nextBeat;
      const b = this.beat;
      if (b % 2 === 0) {
        const semi = line[(b / 2) % line.length];
        const f = 55 * 2 ** (semi / 12);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 600;
        o.connect(lp).connect(g).connect(this.musicGain);
        o.start(t);
        o.stop(t + step * 2);
      }
      // Brush on the off-beats, a soft tick on every step.
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = ctx.createGain();
      const vol = b % 4 === 2 ? 0.12 : 0.04;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (b % 4 === 2 ? 0.12 : 0.04));
      s.connect(f).connect(g).connect(this.musicGain);
      s.start(t, Math.random() * 0.5);
      s.stop(t + 0.15);
      // Occasional vibraphone-ish note.
      if (b % 16 === 6 || b % 16 === 13) {
        const semi = [12, 15, 19, 22][(b >> 4) % 4];
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 220 * 2 ** (semi / 12);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        o.connect(g2).connect(this.musicGain);
        o.start(t);
        o.stop(t + 0.9);
      }
      this.beat++;
      this.nextBeat += step;
    }
    this.musicTimer++;
  }
}
