import type { AudioEngine } from './engine';

export type AmbienceMode = 'menu' | 'day' | 'night';

/** 环境声：持续的风声，夜里叠加低频嗡鸣和随威胁加快的心跳。 */
export class Ambience {
  private started = false;
  private windGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private mode: AmbienceMode = 'menu';
  private beat = 0;
  private nodes: AudioScheduledSourceNode[] = [];

  constructor(private readonly e: AudioEngine) {}

  /** 引擎解锁之后调用一次 */
  start(): void {
    const e = this.e;
    const ctx = e.ctx;
    const bus = e.bus;
    if (this.started || !ctx || !bus) return;
    const t = ctx.currentTime;
    this.started = true;

    // 风：噪声过带通，滤波中心慢慢飘
    const wind = e.loopNoise();
    if (wind) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 420;
      f.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0;
      wind.connect(f);
      f.connect(g);
      g.connect(bus);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const depth = ctx.createGain();
      depth.gain.value = 240;
      lfo.connect(depth);
      depth.connect(f.frequency);
      wind.start(t, Math.random() * 0.5);
      lfo.start(t);
      this.nodes.push(wind, lfo);
      this.windGain = g;
    }

    // 夜里的低频嗡鸣：两个略微失谐的锯齿波
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 130;
    droneFilter.Q.value = 2;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneFilter.connect(droneGain);
    droneGain.connect(bus);
    for (const f of [55, 55.8, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f > 80 ? 0.35 : 1;
      o.connect(og);
      og.connect(droneFilter);
      o.start(t);
      this.nodes.push(o);
    }
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.11;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 40;
    breath.connect(breathDepth);
    breathDepth.connect(droneFilter.frequency);
    breath.start(t);
    this.nodes.push(breath);
    this.droneGain = droneGain;
    this.droneFilter = droneFilter;
    this.apply();
  }

  setMode(m: AmbienceMode): void {
    this.mode = m;
    this.apply();
  }

  private apply(): void {
    const ctx = this.e.ctx;
    if (!ctx || !this.started) return;
    const t = ctx.currentTime;
    const night = this.mode === 'night';
    this.windGain?.gain.setTargetAtTime(this.mode === 'menu' ? 0.05 : night ? 0.07 : 0.04, t, 1.2);
    this.droneGain?.gain.setTargetAtTime(night ? 0.02 : 0, t, night ? 2.5 : 1.2);
  }

  /** threat：0–1，场上僵尸越多越高 */
  update(dt: number, threat: number): void {
    const ctx = this.e.ctx;
    if (!ctx || !this.started || this.mode !== 'night') return;
    this.droneFilter?.Q.setTargetAtTime(2 + threat * 6, ctx.currentTime, 0.5);
    this.beat -= dt;
    if (this.beat > 0) return;
    // 心跳：威胁越大越快
    this.beat = 1.25 - threat * 0.65;
    const e = this.e;
    const v = 0.06 + threat * 0.07;
    e.tone({ freq: 62, to: 38, dur: 0.2, vol: v });
    e.tone({ freq: 58, to: 36, dur: 0.22, vol: v * 0.7, delay: 0.2 });
  }

  dispose(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* 已经停了 */
      }
    }
    this.nodes = [];
    this.started = false;
  }
}
