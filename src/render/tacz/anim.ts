import type { Channel, Clip } from './types';

/**
 * TACZ / 基岩版关键帧动画的播放器，规则照搬 TACZ 的实现（com.tacz.guns.api.client.animation）：
 * - 每帧先把所有骨骼清零，再按轨道顺序把各轨道的结果写进去；
 *   非混合轨道直接覆盖，混合轨道（开火后坐、走路晃动）在已有值上叠加；
 * - 片段长度 = 所有通道最后一个关键帧的时间（不看 animation_length）；
 * - 插值：两端任一帧是 catmullrom 就走三次样条，否则线性（起点取 post，终点取 pre）；
 * - 同一轨道换片段时可以过渡：旧值按 easeOutCubic 渐变到新片段（或渐变回下层轨道的值）。
 *
 * 这里的数值都是动画文件里的原始单位：位置 = 像素（1/16 格），旋转 = 度，缩放 = 倍数。
 */

export type PlayMode = 'once' | 'hold' | 'loop';
/** 0 = 位置，1 = 旋转，2 = 缩放 */
export type ChannelKind = 0 | 1 | 2;
const KINDS = ['position', 'rotation', 'scale'] as const;

interface Chan {
  bone: string;
  k: ChannelKind;
  ch: Channel;
  key: string;
}

export interface CompiledClip {
  name: string;
  end: number;
  chans: Chan[];
  byKey: Map<string, Chan>;
  sfx: Array<[number, string]>;
}

export function compileClip(name: string, c: Clip): CompiledClip {
  const chans: Chan[] = [];
  let end = 0;
  for (const [bone, b] of Object.entries(c.bones)) {
    KINDS.forEach((kind, k) => {
      const ch = b[kind];
      if (!ch) return;
      chans.push({ bone, k: k as ChannelKind, ch, key: `${bone}|${k}` });
      end = Math.max(end, ch.t[ch.t.length - 1] ?? 0);
    });
  }
  const sfx = c.sfx ?? [];
  for (const s of sfx) end = Math.max(end, s[0]);
  return { name, end, chans, byKey: new Map(chans.map((x) => [x.key, x])), sfx };
}

/** 一条通道在 time 秒时的值，写进 out[0..2] */
export function sampleChannel(ch: Channel, time: number, out: number[]): void {
  const t = ch.t;
  const n = t.length;
  // 最后一个 t[i] <= time 的帧
  let lo = 0;
  let hi = n - 1;
  if (time < (t[0] as number)) lo = 0;
  else {
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((t[mid] as number) <= time) lo = mid;
      else hi = mid - 1;
    }
  }
  const from = lo;
  const to = Math.min(n - 1, from + 1);
  let a: number;
  if (time <= (t[0] as number)) a = 0;
  else if (time >= (t[n - 1] as number)) a = 1;
  else a = (time - (t[from] as number)) / ((t[from + 1] as number) - (t[from] as number));

  const pre = ch.pre;
  const post = ch.post;
  if (ch.c[from] || ch.c[to]) {
    if (n === 1) {
      const src = a > 0 ? post : pre;
      out[0] = src[0] as number;
      out[1] = src[1] as number;
      out[2] = src[2] as number;
      return;
    }
    const prev = from === 0 ? 0 : from - 1;
    const next = to === n - 1 ? n - 1 : to + 1;
    const t2 = a * a;
    const t3 = t2 * a;
    const h1 = 2 * t3 - 3 * t2 + 1;
    const h2 = -2 * t3 + 3 * t2;
    const h3 = t3 - 2 * t2 + a;
    const h4 = t3 - t2;
    for (let i = 0; i < 3; i++) {
      const y0 = post[prev * 3 + i] as number;
      const y1 = pre[from * 3 + i] as number;
      const y2 = pre[to * 3 + i] as number;
      const y3 = pre[next * 3 + i] as number;
      out[i] = h1 * y1 + h2 * y2 + h3 * (y2 - y0) * 0.5 + h4 * (y3 - y1) * 0.5;
    }
    return;
  }
  if (from === to) {
    const src = a > 0 ? post : pre;
    out[0] = src[to * 3] as number;
    out[1] = src[to * 3 + 1] as number;
    out[2] = src[to * 3 + 2] as number;
    return;
  }
  for (let i = 0; i < 3; i++) out[i] = (post[from * 3 + i] as number) * (1 - a) + (pre[to * 3 + i] as number) * a;
}

export const CONSTRAINT = 'constraint';

/** 全部骨骼当前的动画值：每根骨骼 9 个数（位置 3、旋转 3、缩放 3） */
export class Pose {
  readonly v = new Map<string, Float32Array>();
  /** 这一帧被写过的骨骼（备用弹匣只有被动画驱动时才显示） */
  readonly touched = new Set<string>();

  constructor(bones: Iterable<string>) {
    for (const b of bones) this.v.set(b, new Float32Array(9));
    this.reset();
  }

  reset(): void {
    for (const a of this.v.values()) {
      a.fill(0);
      a[6] = a[7] = a[8] = 1;
    }
    this.touched.clear();
  }

  read(bone: string, k: ChannelKind, out: number[]): boolean {
    const a = this.v.get(bone);
    if (!a) return false;
    const o = k * 3;
    out[0] = a[o] as number;
    out[1] = a[o + 1] as number;
    out[2] = a[o + 2] as number;
    return true;
  }

  write(bone: string, k: ChannelKind, x: number, y: number, z: number, blend: boolean): void {
    const a = this.v.get(bone);
    if (!a) return;
    const o = k * 3;
    if (bone === CONSTRAINT) {
      // 约束组存的是"瞄准时保留多少动画位移 / 旋转"的系数：取绝对值，混合轨道取较大的那个
      x = Math.abs(x);
      y = Math.abs(y);
      z = Math.abs(z);
      if (blend) {
        x = Math.max(x, a[o] as number);
        y = Math.max(y, a[o + 1] as number);
        z = Math.max(z, a[o + 2] as number);
      }
      blend = false;
    }
    if (!blend) {
      a[o] = x;
      a[o + 1] = y;
      a[o + 2] = z;
    } else if (k === 2) {
      a[o] = (a[o] as number) * x;
      a[o + 1] = (a[o + 1] as number) * y;
      a[o + 2] = (a[o + 2] as number) * z;
    } else {
      a[o] = (a[o] as number) + x;
      a[o + 1] = (a[o + 1] as number) + y;
      a[o + 2] = (a[o + 2] as number) + z;
    }
    this.touched.add(bone);
  }
}

export type SfxFn = (path: string) => void;

export class Runner {
  time = 0;
  state: 'run' | 'hold' | 'stop' = 'run';
  speed = 1;

  constructor(
    readonly clip: CompiledClip,
    readonly mode: PlayMode,
  ) {}

  /** 播放音效：触发 (from, to] 区间内的关键帧 */
  private sfx(from: number, to: number, fn: SfxFn | null): void {
    if (!fn) return;
    for (const [t, p] of this.clip.sfx) if (t > from && t <= to) fn(p);
  }

  advance(dt: number, fn: SfxFn | null): void {
    if (this.state === 'stop') return;
    const prev = this.time;
    let next = prev + dt * this.speed;
    const end = this.clip.end;
    if (this.mode === 'loop' && next > end) {
      this.sfx(prev, end, fn);
      next = end > 0 ? next % end : 0;
      this.sfx(-1, next, fn);
    } else this.sfx(prev, next, fn);
    this.time = next;
    if (this.mode === 'once' && next > end) this.state = 'stop';
    else if (this.mode === 'hold' && next > end) this.state = 'hold';
  }

  /** 直接跳到某个时间（换弹进度由游戏逻辑驱动）；往前跳时触发经过的音效 */
  seek(t: number, fn: SfxFn | null): void {
    if (t > this.time) this.sfx(this.time, t, fn);
    this.time = t;
    this.state = 'run';
  }
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const tmp = [0, 0, 0];
const tmp2 = [0, 0, 0];

/** 一条轨道：同一时间只播一个片段，换片段时可以平滑过渡 */
export class Track {
  cur: Runner | null = null;
  private trans: { dur: number; t: number; snap: Map<string, { bone: string; k: ChannelKind; v: number[] }> } | null = null;
  /** 上一帧这条轨道写出的值（过渡的起点） */
  private last = new Map<string, { bone: string; k: ChannelKind; v: number[] }>();

  constructor(readonly blend: boolean) {}

  get clipName(): string | null {
    return this.cur && this.cur.state !== 'stop' ? this.cur.clip.name : null;
  }

  isStopped(): boolean {
    return (!this.cur || this.cur.state === 'stop') && !this.trans;
  }

  isHolding(): boolean {
    return this.cur?.state === 'hold';
  }

  play(clip: CompiledClip, mode: PlayMode, transition = 0): Runner {
    this.beginTransition(transition);
    this.cur = new Runner(clip, mode);
    return this.cur;
  }

  stop(transition = 0): void {
    this.beginTransition(transition);
    this.cur = null;
  }

  private beginTransition(dur: number): void {
    if (dur > 0 && this.last.size > 0) {
      const snap = new Map<string, { bone: string; k: ChannelKind; v: number[] }>();
      for (const [key, e] of this.last) snap.set(key, { bone: e.bone, k: e.k, v: [...e.v] });
      this.trans = { dur, t: 0, snap };
    } else this.trans = null;
  }

  advance(dt: number, fn: SfxFn | null): void {
    this.cur?.advance(dt, fn);
    if (this.trans) {
      this.trans.t += dt;
      if (this.trans.t >= this.trans.dur) this.trans = null;
    }
  }

  apply(pose: Pose): void {
    this.last.clear();
    const cur = this.cur && this.cur.state !== 'stop' ? this.cur : null;
    const time = cur ? Math.min(cur.time, cur.clip.end) : 0;
    const tr = this.trans;
    if (tr) {
      const e = easeOutCubic(Math.min(1, tr.t / tr.dur));
      for (const [key, s] of tr.snap) {
        const target = cur?.clip.byKey.get(key);
        if (target) sampleChannel(target.ch, time, tmp);
        else if (this.blend) {
          tmp[0] = tmp[1] = tmp[2] = s.k === 2 ? 1 : 0;
        } else if (!pose.read(s.bone, s.k, tmp)) continue; // 渐变回下层轨道的值
        for (let i = 0; i < 3; i++) tmp2[i] = (s.v[i] as number) + ((tmp[i] as number) - (s.v[i] as number)) * e;
        this.out(pose, key, s.bone, s.k, tmp2);
      }
    }
    if (!cur) return;
    for (const c of cur.clip.chans) {
      if (tr && tr.snap.has(c.key)) continue;
      sampleChannel(c.ch, time, tmp);
      this.out(pose, c.key, c.bone, c.k, tmp);
    }
  }

  private out(pose: Pose, key: string, bone: string, k: ChannelKind, v: number[]): void {
    pose.write(bone, k, v[0] as number, v[1] as number, v[2] as number, this.blend);
    this.last.set(key, { bone, k, v: [v[0] as number, v[1] as number, v[2] as number] });
  }
}
