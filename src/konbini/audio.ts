/**
 * 雨夜街角的声音：全部用 WebAudio 现场合成，没有音频文件。
 * 雨声（滤波噪声，进店后变闷）、入店提示音、贩卖机出货、收银"哔"、车铃、喇叭、咖啡机……
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private rainLp: BiquadFilterNode | null = null;
  private humGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** 浏览器要求用户点击后才能出声：第一次点击时调用 */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 雨声：两层噪声（沙沙的高频 + 低沉的底）
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    this.rainLp = ctx.createBiquadFilter();
    this.rainLp.type = 'lowpass';
    this.rainLp.frequency.value = 5000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(hp).connect(this.rainLp).connect(this.rainGain).connect(this.master);
    src.start();

    // 店里冰柜和日光灯的嗡嗡声
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 100;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    osc.connect(lp).connect(this.humGain).connect(this.master);
    osc.start();
  }

  /** 每帧：雨量 0..1、人在不在店里 */
  update(rain: number, indoor: boolean): void {
    if (!this.ctx || !this.rainGain || !this.rainLp || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * (indoor ? 0.12 : 0.3), t, 0.3);
    this.rainLp.frequency.setTargetAtTime(indoor ? 900 : 5000, t, 0.3);
    this.humGain.gain.setTargetAtTime(indoor ? 0.02 : 0, t, 0.5);
  }

  tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, slide = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, freq: number, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  /** 自动门开时的"叮——咚" */
  chime(): void {
    this.tone(1318, 0.9, 0.16, 'sine');
    this.tone(1046, 1.2, 0.16, 'sine', 0.32);
    this.tone(2636, 0.4, 0.03, 'sine');
  }
  doorSlide(): void {
    this.burst(0.5, 0.05, 700);
  }
  clunk(): void {
    this.burst(0.25, 0.5, 300);
    this.tone(80, 0.25, 0.3, 'sine', 0.02);
    this.burst(0.15, 0.25, 500, 0.18);
  }
  beep(delay = 0): void {
    this.tone(2400, 0.09, 0.12, 'square', delay);
  }
  bell(): void {
    for (const d of [0, 0.16]) {
      this.tone(2650, 0.6, 0.12, 'sine', d);
      this.tone(3980, 0.4, 0.06, 'sine', d);
    }
  }
  horn(): void {
    this.tone(415, 0.45, 0.12, 'sawtooth');
    this.tone(520, 0.45, 0.1, 'sawtooth');
  }
  pour(): void {
    this.burst(2.4, 0.12, 900, 0, 'bandpass');
    this.tone(180, 2.2, 0.05, 'triangle', 0, 0.6);
  }
  click(): void {
    this.burst(0.05, 0.25, 2000, 0, 'highpass');
  }
  swing(): void {
    this.burst(0.35, 0.08, 400);
  }
  pick(): void {
    this.burst(0.08, 0.12, 1500, 0, 'bandpass');
  }
  register(n: number): void {
    for (let i = 0; i < n; i++) this.beep(i * 0.22);
    this.tone(880, 0.3, 0.08, 'sine', n * 0.22 + 0.1);
    this.burst(0.3, 0.2, 3000, n * 0.22 + 0.3, 'highpass');
  }
  umbrella(): void {
    this.burst(0.3, 0.2, 1200, 0, 'bandpass');
  }
  plop(): void {
    this.tone(500, 0.15, 0.08, 'sine', 0, 0.5);
  }
}
