import { BASE } from './model';
import type { VehicleDef } from './types';

/**
 * 车的声音（WebAudio）：发动机按转速分段录的循环（给油一套、收油一套），相邻两段等功率交叉淡化，
 * 播放速度 = 当前转速 / 录音转速；起动 / 熄火 / 喇叭；共用的开关门、碰撞、轮胎打滑、风噪、胎噪。
 * 只有正在开的那台车出声（别的车熄着火）。
 * 另外几样是合成的（没有录音）：往油箱里倒油、加油机、装改装件时的扳手声。
 * 没有 AudioContext 的环境（无头测试）里所有方法都什么也不做。
 */

/** 手上在干的活（按住 F 的那几秒里响着）：倒汽油桶 / 加油机 / 装改装件 */
export type WorkSound = 'can' | 'pump' | 'wrench';

interface Layer {
  rpm: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class VehicleAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private readonly bufs = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private on: Layer[] = [];
  private off: Layer[] = [];
  private engineGain: GainNode | null = null;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private horn: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private load = 0;
  private running = false;
  /** 正在出声的车 */
  private def: VehicleDef | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private work: { kind: WorkSound; gain: GainNode; stop: () => void } | null = null;

  /** 第一次上车 / 加油时建（按键算用户手势）。没有 WebAudio 返回 null */
  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    if (typeof AudioContext === 'undefined') return null;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.filter.connect(this.master).connect(ctx.destination);
    return ctx;
  }

  private buffer(url: string): Promise<AudioBuffer | null> {
    const hit = this.bufs.get(url);
    if (hit) return Promise.resolve(hit);
    let p = this.loading.get(url);
    if (!p) {
      const ctx = this.ensure();
      if (!ctx) return Promise.resolve(null);
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url} ${r.status}`))))
        .then((a) => ctx.decodeAudioData(a))
        .then((b) => {
          this.bufs.set(url, b);
          return b;
        })
        .catch((e) => {
          console.warn('[vehicle audio]', e);
          return null;
        });
      this.loading.set(url, p);
    }
    return p;
  }

  private common(name: string): string {
    return `${BASE}_common/${name}.ogg`;
  }

  /** 提前把这台车的声音解码好（上车前调用，不等） */
  preload(def: VehicleDef): Promise<unknown> {
    const dir = `${BASE}${def.id}/`;
    const s = def.sounds;
    const list = [...s.on.map((e) => dir + e[1]), ...s.off.map((e) => dir + e[1])];
    for (const f of [s.crank, s.start, s.stop, s.horn]) if (f) list.push(dir + f);
    for (const n of ['door_open', 'door_close', 'skid', 'wind_loop', 'tyre_asphalt', 'tyre_dirt', 'horn_loop', 'crash_heavy', 'crash_light_1', 'crash_light_2', 'handbrake_pull']) list.push(this.common(n));
    return Promise.all(list.map((u) => this.buffer(u)));
  }

  /** dur > 0：只放这么多秒（最后 0.12 秒淡出） */
  oneShot(url: string, gain = 1, rate = 1, dur = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    void this.buffer(url).then((b) => {
      if (!b) return;
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.filter);
      src.start();
      if (dur > 0) {
        g.gain.setTargetAtTime(0, ctx.currentTime + Math.max(0, dur - 0.12), 0.04);
        src.stop(ctx.currentTime + dur + 0.1);
      }
    });
  }

  door(open: boolean): void {
    this.oneShot(this.common(open ? 'door_open' : 'door_close'), 0.8);
  }

  /** 拉手刹（下车） */
  handbrake(): void {
    this.oneShot(this.common('handbrake_pull'), 0.7);
  }

  /** 没油：起动机转两下，着不了 */
  crankFail(def: VehicleDef): void {
    if (def.sounds.crank) this.oneShot(`${BASE}${def.id}/${def.sounds.crank}`, 0.7, 0.92, 0.9);
  }

  /** 人下车了：声音不再是「在车里」那种闷的 */
  outside(): void {
    if (this.ctx) this.filter.frequency.setTargetAtTime(16000, this.ctx.currentTime, 0.1);
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /** 一下金属的「咔」（装好改装件、油箱盖、加油枪） */
  clank(vol = 0.5, freq = 1900): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(f).connect(g).connect(this.filter);
    src.start(t, Math.random(), 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * 0.42, t);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(og).connect(this.filter);
    o.start(t);
    o.stop(t + 0.25);
  }

  /**
   * 按住 F 干活时一直响的声音；null = 停。
   *   can     往油箱里倒油：滤过的噪声 + 一下一下的「咕咚」
   *   pump    加油机：电机的嗡嗡声 + 油流的嘶嘶声
   *   wrench  装改装件：棘轮扳手一串一串的咔哒声
   */
  setWork(kind: WorkSound | null): void {
    if ((this.work?.kind ?? null) === kind) return;
    const ctx = kind ? this.ensure() : this.ctx;
    if (this.work && ctx) {
      this.work.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      const stop = this.work.stop;
      setTimeout(stop, 300);
    }
    this.work = null;
    if (!kind || !ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, t, 0.06);
    out.connect(this.filter);
    const nodes: Array<AudioScheduledSourceNode> = [];
    const noise = (freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass'): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random());
      nodes.push(src);
      return g;
    };
    /** 给一个音量加周期性的起伏（depth 0..1） */
    const wobble = (g: GainNode, hz: number, depth: number, type: OscillatorType = 'sine'): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = g.gain.value * depth;
      o.connect(d).connect(g.gain);
      o.start(t);
      nodes.push(o);
    };
    if (kind === 'can') {
      wobble(noise(520, 1.4, 0.3), 5.3, 0.85);
      wobble(noise(1500, 0.8, 0.1), 2.1, 0.5);
      // 桶里的空气「咕咚」
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 150;
      const g = ctx.createGain();
      g.gain.value = 0.09;
      o.connect(g).connect(out);
      o.start(t);
      nodes.push(o);
      wobble(g, 5.3, 1, 'square');
    } else if (kind === 'pump') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 58;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 260;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      o.connect(f).connect(g).connect(out);
      o.start(t);
      nodes.push(o);
      wobble(g, 9, 0.25);
      noise(2600, 0.7, 0.07);
      wobble(noise(700, 1.2, 0.12), 3.1, 0.4);
    } else {
      // 棘轮：很窄的高频噪声被 22 Hz 的方波切成一串咔哒，再每秒歇一下
      const g = noise(3200, 6, 0.22);
      wobble(g, 22, 1, 'square');
      const gate = ctx.createGain();
      gate.gain.value = 0.6;
      g.disconnect();
      g.connect(gate).connect(out);
      wobble(gate, 1.25, 0.95, 'square');
    }
    this.work = {
      kind,
      gain: out,
      stop: () => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {
            // 已经停了
          }
        }
        out.disconnect();
      },
    };
  }

  crash(strength: number): void {
    if (strength < 0.15) return;
    const name = strength > 0.6 ? 'crash_heavy' : Math.random() < 0.5 ? 'crash_light_1' : 'crash_light_2';
    this.oneShot(this.common(name), Math.min(1, 0.35 + strength * 0.7), 0.9 + Math.random() * 0.2);
  }

  /** 点火：起动机 → 着车 → 循环淡入 */
  async start(def: VehicleDef): Promise<void> {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stopNow();
    this.def = def;
    this.running = true;
    const dir = `${BASE}${def.id}/`;
    const s = def.sounds;
    const [onB, offB] = await Promise.all([Promise.all(s.on.map((e) => this.buffer(dir + e[1]))), Promise.all(s.off.map((e) => this.buffer(dir + e[1])))]);
    if (!this.running || this.def !== def) return;
    if (s.crank) this.oneShot(dir + s.crank, 0.8);
    const delay = s.crank ? 0.55 : 0.05;
    if (s.start) setTimeout(() => this.running && this.def === def && this.oneShot(dir + (s.start as string), 0.9), delay * 1000);
    const eg = ctx.createGain();
    eg.gain.value = 0;
    eg.gain.setTargetAtTime(1, ctx.currentTime + delay + 0.25, 0.15);
    eg.connect(this.filter);
    this.engineGain = eg;
    const mk = (b: AudioBuffer | null, rpm: number): Layer | null => {
      if (!b) return null;
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(eg);
      src.start(ctx.currentTime + Math.random() * 0.05, Math.random() * b.duration);
      return { rpm, src, gain };
    };
    this.on = s.on.map((e, i) => mk(onB[i] ?? null, e[0])).filter((l): l is Layer => !!l);
    this.off = s.off.map((e, i) => mk(offB[i] ?? null, e[0])).filter((l): l is Layer => !!l);
    for (const n of ['skid', 'wind_loop', 'tyre_asphalt']) {
      const b = await this.buffer(this.common(n));
      if (!b || !this.running) continue;
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.filter);
      src.start(0, Math.random() * b.duration);
      this.loops.set(n, { src, gain });
    }
  }

  /** 熄火 */
  stop(): void {
    if (!this.ctx || !this.def) return;
    const dir = `${BASE}${this.def.id}/`;
    if (this.running && this.def.sounds.stop) this.oneShot(dir + this.def.sounds.stop, 0.8);
    this.stopNow();
  }

  private stopNow(): void {
    this.running = false;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const l of [...this.on, ...this.off]) {
      l.gain.gain.setTargetAtTime(0, t, 0.08);
      l.src.stop(t + 0.5);
    }
    for (const l of this.loops.values()) {
      l.gain.gain.setTargetAtTime(0, t, 0.08);
      l.src.stop(t + 0.5);
    }
    this.on = [];
    this.off = [];
    this.loops.clear();
    this.engineGain?.gain.setTargetAtTime(0, t, 0.1);
    this.engineGain = null;
    this.setHorn(false);
  }

  setHorn(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) {
      if (this.horn) {
        this.horn.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        this.horn.src.stop(ctx.currentTime + 0.2);
        this.horn = null;
      }
      return;
    }
    if (this.horn || !this.def) return;
    const own = this.def.sounds.horn;
    const url = own ? `${BASE}${this.def.id}/${own}` : this.common('horn_loop');
    const b = this.bufs.get(url);
    if (!b) {
      void this.buffer(url);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain).connect(this.filter);
    src.start();
    this.horn = { src, gain };
  }

  /** 每帧：转速、油门（0..1）、车速（米/秒）、打滑（0..1）、在车里（闷一点） */
  update(dt: number, rpm: number, throttle: number, speed: number, skid: number, inside: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const t = ctx.currentTime;
    this.load += (throttle - this.load) * Math.min(1, dt * 8);
    const mix = (layers: Layer[], w: number) => {
      if (!layers.length) return;
      let i = 0;
      while (i < layers.length - 1 && rpm > (layers[i + 1] as Layer).rpm) i++;
      const a = layers[i] as Layer;
      const b = layers[Math.min(i + 1, layers.length - 1)] as Layer;
      const f = a === b || rpm <= a.rpm ? 0 : Math.min(1, (rpm - a.rpm) / (b.rpm - a.rpm));
      for (const l of layers) {
        let g = 0;
        if (l === a) g = Math.cos((f * Math.PI) / 2);
        if (l === b && b !== a) g = Math.sin((f * Math.PI) / 2);
        l.gain.gain.setTargetAtTime(g * w, t, 0.03);
        l.src.playbackRate.setTargetAtTime(Math.max(0.5, Math.min(2, rpm / l.rpm)), t, 0.03);
      }
    };
    const onW = Math.sin((Math.max(0.15, this.load) * Math.PI) / 2);
    mix(this.on, this.off.length ? onW : 1);
    mix(this.off, Math.cos((Math.max(0.15, this.load) * Math.PI) / 2));
    const sp = Math.abs(speed);
    const set = (n: string, g: number, rate: number) => {
      const l = this.loops.get(n);
      if (!l) return;
      l.gain.gain.setTargetAtTime(g, t, 0.06);
      l.src.playbackRate.setTargetAtTime(rate, t, 0.06);
    };
    set('skid', Math.min(1, skid) * Math.min(1, sp / 6) * 0.55, 0.9 + Math.min(0.3, sp / 60));
    set('wind_loop', Math.max(0, Math.min(1, (sp - 6) / 40)) * (inside ? 0.25 : 0.4), 0.8 + sp / 90);
    set('tyre_asphalt', Math.min(1, sp / 14) * 0.22, 0.7 + Math.min(0.8, sp / 40));
    this.filter.frequency.setTargetAtTime(inside ? 3200 : 16000, t, 0.1);
  }
}
