/**
 * 程序合成音效引擎：不用任何音频文件，所有声音都由振荡器和噪声实时合成。
 * 接受任意 BaseAudioContext，所以既能跑在 AudioContext 里发声，也能跑在 OfflineAudioContext 里做无声自检。
 */

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  /** 滤波器频率在整个声音时长内扫到这个值 */
  to?: number;
  q?: number;
}

export interface ToneOpts {
  freq: number;
  /** 指数滑向这个频率 */
  to?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  /** 相对当前时刻延后多少秒开始 */
  delay?: number;
  filter?: FilterSpec;
  /** 颤音：rate 为 Hz，depth 为频率的相对幅度（0.05 = ±5%） */
  vibrato?: { rate: number; depth: number };
  out?: AudioNode;
}

export interface NoiseOpts {
  dur: number;
  vol?: number;
  attack?: number;
  delay?: number;
  filter?: FilterSpec;
  out?: AudioNode;
}

/** 0.6 以内原样通过，再往上平滑地压向 1。WaveShaper 对 ±1 之外的输入取曲线两端的值，所以输出永远不会超过 1。 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const c = new Float32Array(n);
  const knee = 0.6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/**
 * 滑条 → 增益。以前是平方：滑条 20% 实际只有 4%，听起来像没声音（"新版本没有声音"的一个可能原因）。
 * 改成 1.5 次方：20% → 9%、50% → 35%，低端不至于听不见，高端变化仍然均匀
 */
export const volumeGain = (v: number): number => Math.pow(Math.min(1, Math.max(0, v)), 1.5);

/** 同时发声的音源数量上限，超过后新的次要声音会被丢弃 */
const MAX_VOICES = 56;
/** 听不到的距离（格） */
const MAX_HEAR = 55;

/** 分类音量（M20）：每个声音属于哪一类，设置页每类一个滑条 */
export type Channel = 'weapons' | 'zombies' | 'world' | 'ui';
export const CHANNELS: Channel[] = ['weapons', 'zombies', 'world', 'ui'];

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  /** 音效总线（经过压缩器）。下面挂 4 条分类子总线；音效默认进「当前分类」那一条 */
  private main: GainNode | null = null;
  private readonly sub: Partial<Record<Channel, GainNode>> = {};
  private readonly chVol: Record<Channel, number> = { weapons: 1, zombies: 1, world: 1, ui: 1 };
  /** 当前分类：Sfx 每个方法开头设一下，之后 spatial / flat / tone / noise 都进这条子总线 */
  channel: Channel = 'world';
  /** 当前分类的子总线（没有上下文时为 null） */
  get bus(): GainNode | null {
    return this.sub[this.channel] ?? this.main;
  }

  /** 某一类的音量 0–1（曲线和主音量一样） */
  setChannel(ch: Channel, v: number): void {
    this.chVol[ch] = Math.min(1, Math.max(0, v));
    const g = this.sub[ch];
    if (g && this.ctx) g.gain.setTargetAtTime(volumeGain(this.chVol[ch]), this.ctx.currentTime, 0.03);
  }
  private noiseBuf: AudioBuffer | null = null;
  private voices = 0;
  private last = new Map<string, number>();
  private vol = 0.6;
  /** 听者位置（玩家）和朝向（0 = 面向 +Z） */
  lx = 0;
  lz = 0;
  lyaw = 0;

  constructor(ctx?: BaseAudioContext) {
    if (ctx) this.attach(ctx);
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** 必须在用户手势（点击 / 按键）里调用，浏览器才允许发声 */
  unlock(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.attach(new Ctor());
    }
    const c = this.ctx;
    if (c && 'resume' in c && c.state === 'suspended') void (c as AudioContext).resume();
  }

  private attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    // 总线 → 压缩器 → 补偿增益 → 软削波（保证不超过 ±1，不会爆音）→ 主音量 → 输出
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.8;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    const master = ctx.createGain();
    master.gain.value = volumeGain(this.vol);
    const bus = ctx.createGain();
    bus.connect(comp);
    comp.connect(makeup);
    makeup.connect(clip);
    clip.connect(master);
    master.connect(ctx.destination);
    this.master = master;
    this.main = bus;
    for (const ch of CHANNELS) {
      const g = ctx.createGain();
      g.gain.value = volumeGain(this.chVol[ch]);
      g.connect(bus);
      this.sub[ch] = g;
    }

    // 一秒钟的白噪声，所有噪声类声音共用
    const len = Math.floor(ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      // xorshift，保证离线自检每次的噪声一样
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    this.noiseBuf = buf;
  }

  /** 采样音效（TACZ 枪的 ogg）：先 load，加载好之后 sample 才会响 */
  private readonly samples = new Map<string, AudioBuffer | null>();

  load(url: string): void {
    const ctx = this.ctx;
    if (!ctx || this.samples.has(url)) return;
    this.samples.set(url, null);
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => this.samples.set(url, buf))
      .catch((e: unknown) => console.warn('音效加载失败', url, e));
  }

  /** 播放已加载的采样；还没加载就先加载，这一次不响 */
  sample(url: string, gain = 1, out?: AudioNode): void {
    const ctx = this.ctx;
    const dest = out ?? this.bus;
    if (!ctx || !dest) return;
    const buf = this.samples.get(url);
    if (buf === undefined) this.load(url);
    if (!buf || this.busy()) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(dest);
    this.voices++;
    src.onended = () => {
      this.voices--;
    };
    src.start();
  }

  /** 0–1，映射成增益见 volumeGain */
  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volumeGain(this.vol), this.ctx.currentTime, 0.03);
  }

  /** 上下文状态（设置页显示）：none = 还没创建（从没点过鼠标 / 按过键） */
  get state(): 'none' | 'running' | 'suspended' | 'closed' | 'interrupted' {
    return this.ctx ? ((this.ctx as AudioContext).state as 'running' | 'suspended' | 'closed') : 'none';
  }

  /**
   * 切回窗口、换了输出设备之后调用：挂起了就恢复；被关掉了（有的系统换设备会让上下文报废）就重建，
   * 已经解码的采样要在新上下文里重新加载
   */
  revive(): void {
    const c = this.ctx as AudioContext | null;
    if (!c) return;
    if (c.state === 'suspended') {
      void c.resume();
      return;
    }
    if (c.state === 'closed') {
      const urls = [...this.samples.keys()];
      this.samples.clear();
      this.ctx = null;
      this.voices = 0;
      this.unlock();
      for (const u of urls) this.load(u);
    }
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** 同一个 key 在 minGap 秒内只放一次。返回 true 表示可以放。 */
  gate(key: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < minGap) return false;
    this.last.set(key, t);
    return true;
  }

  /** 音源太多时，次要声音直接放弃 */
  busy(limit = MAX_VOICES): boolean {
    return this.voices >= limit;
  }

  /**
   * 给一个声音创建带距离衰减和左右声像的出口。
   * 太远听不到时返回 null，调用者应直接不放。
   */
  spatial(x: number, z: number, gain = 1): AudioNode | null {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return null;
    const dx = x - this.lx;
    const dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d > MAX_HEAR) return null;
    // 第一人称：左右按"我面朝的方向"算（右方 = (-cos yaw, sin yaw)），身后的声音稍微闷一点
    const sy = Math.sin(this.lyaw);
    const cy = Math.cos(this.lyaw);
    const side = -cy * dx + sy * dz;
    const front = d > 0.01 ? (sy * dx + cy * dz) / d : 1;
    const g = ctx.createGain();
    g.gain.value = (gain * (0.8 + 0.2 * front)) / (1 + (d / 14) * (d / 14));
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.85, Math.min(0.85, side / 22));
    g.connect(pan);
    pan.connect(bus);
    return g;
  }

  /** 听者所在位置的出口（玩家自己的声音、界面音） */
  flat(gain = 1): AudioNode | null {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return null;
    if (gain === 1) return bus;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(bus);
    return g;
  }

  private shape(ctx: BaseAudioContext, t: number, vol: number, attack: number, dur: number): GainNode {
    const g = ctx.createGain();
    const peak = Math.max(0.0002, vol);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private filterNode(ctx: BaseAudioContext, spec: FilterSpec, t: number, dur: number): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = spec.type;
    f.frequency.setValueAtTime(spec.freq, t);
    if (spec.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t + dur);
    f.Q.value = spec.q ?? 0.8;
    return f;
  }

  tone(o: ToneOpts): void {
    const ctx = this.ctx;
    const out = o.out ?? this.bus;
    if (!ctx || !out || this.busy()) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.to), t + o.dur);

    let lfo: OscillatorNode | null = null;
    if (o.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibrato.rate;
      const depth = ctx.createGain();
      depth.gain.value = o.freq * o.vibrato.depth;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.05);
    }

    const env = this.shape(ctx, t, o.vol ?? 0.3, o.attack ?? 0.004, o.dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = this.filterNode(ctx, o.filter, t, o.dur);
      node.connect(f);
      node = f;
    }
    node.connect(env);
    env.connect(out);
    this.voices++;
    osc.onended = () => {
      this.voices--;
    };
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    const out = o.out ?? this.bus;
    if (!ctx || !out || !this.noiseBuf || this.busy()) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const env = this.shape(ctx, t, o.vol ?? 0.3, o.attack ?? 0.003, o.dur);
    let node: AudioNode = src;
    if (o.filter) {
      const f = this.filterNode(ctx, o.filter, t, o.dur);
      node.connect(f);
      node = f;
    }
    node.connect(env);
    env.connect(out);
    this.voices++;
    src.onended = () => {
      this.voices--;
    };
    // 每次从噪声的不同位置开始，连发的枪声不会听起来一模一样
    src.start(t, Math.random() * 0.8);
    src.stop(t + o.dur + 0.05);
  }

  /** 一个循环播放的噪声音源（环境风声用），调用者负责 start() */
  loopNoise(): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  dispose(): void {
    const c = this.ctx;
    this.ctx = null;
    this.main = null;
    for (const ch of CHANNELS) delete this.sub[ch];
    this.master = null;
    if (c && 'close' in c) void (c as AudioContext).close().catch(() => undefined);
  }
}
