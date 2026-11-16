/**
 * 把一段动作音效（换弹、拉栓这类：几下清脆的响声，中间是很轻的摩擦声）改到 1/rate 的长度，音高不变。
 *
 * 换弹动画是按游戏里的换弹时间加速 / 放慢的。采样照原速放的话，采样里面那一下「咔」离采样开头还是原来那么久，
 * 动画里的手却早到了（或者还没到），声音就对不上；整段录音的换弹更糟，换完了还在响。
 * 直接加快播放速度能对上，但声音会变尖（×2 就是高八度）。
 *
 * 这里的做法和手工剪一个「快速换弹」版本一样：找到每一下响声的起点，这一下原样保留（一个采样点都不改），
 * 挪到「原来的时刻 ÷ rate」上；两下之间多出来的部分，挑最安静的那一截剪掉，接口处交叉淡化。
 * rate < 1（动画放慢）时反过来：在最安静的地方断开，中间空着。
 *
 * retime / findOnsets 是纯函数，不碰 AudioContext，Node 里也能跑（scripts/sims/retime.ts）。
 */

/** 音量包络：每 1 毫秒一格，每格看它后面 4 毫秒 */
const ENV_HOP = 0.001;
const ENV_WIN = 0.004;
/** 一下响声：这 4 毫秒的音量超过之前 20 毫秒里最响处的这么多倍，而且不低于整段最响处的这个比例 */
const ONSET_RATIO = 2.2;
const ONSET_FLOOR = 0.1;
const ONSET_BACK = 0.02;
/** 两下响声最少隔这么久（秒） */
const ONSET_GAP = 0.012;
/** 接口的交叉淡化（秒） */
const FADE = 0.006;
/** 一下响声之后至少原样留这么久、下一下之前至少留这么久（秒）；放不下时让位 */
const KEEP_AFTER = 0.015;
const KEEP_BEFORE = 0.003;
/** 最后一下响声的余音：压短时至少留这么久（本来没这么长就全留），免得最后一声像被掐断 */
const TAIL_KEEP = 0.2;
/** 余音被截短时，最后淡出最多这么久（秒） */
const TAIL_FADE = 0.06;

type Chans = readonly Float32Array[];

/** 各声道能量的前缀和：p[b] - p[a] = 采样点 [a, b) 的能量 */
function energyPrefix(chans: Chans): Float64Array {
  const n = chans[0]?.length ?? 0;
  const p = new Float64Array(n + 1);
  const k = 1 / Math.max(1, chans.length);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const c of chans) e += (c[i] as number) * (c[i] as number);
    p[i + 1] = (p[i] as number) + e * k;
  }
  return p;
}

/**
 * 每一下响声的起点（采样点下标，升序）：第一个「后面 4 毫秒突然变响」的格子。
 * 真正起音在它后面大约 3 毫秒（窗口刚好够到它的时候），这 3 毫秒正好当保留的前沿
 */
function onsetsOf(p: Float64Array, sr: number): number[] {
  const n = p.length - 1;
  const hop = Math.max(1, Math.round(sr * ENV_HOP));
  const win = Math.max(hop, Math.round(sr * ENV_WIN));
  const frames = n >= win ? Math.floor((n - win) / hop) + 1 : 0;
  const env = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const a = i * hop;
    const v = Math.sqrt(((p[a + win] as number) - (p[a] as number)) / win);
    env[i] = v;
    if (v > peak) peak = v;
  }
  if (peak <= 1e-5) return [];
  // 窗口完全落在这一格之前的最近一格
  const lead = Math.ceil(win / hop);
  const back = Math.round(ONSET_BACK / ENV_HOP);
  const gap = Math.round(ONSET_GAP / ENV_HOP);
  const out: number[] = [];
  let last = -gap;
  for (let i = 0; i < frames; i++) {
    const v = env[i] as number;
    if (v < peak * ONSET_FLOOR || i - last < gap) continue;
    let ref = 0;
    for (let j = Math.max(0, i - lead - back); j <= i - lead; j++) ref = Math.max(ref, env[j] as number);
    if (v > ref * ONSET_RATIO + peak * 0.01) {
      out.push(i * hop);
      last = i;
    }
  }
  return out;
}

/** 一段采样里每一下响声的起点（采样点下标）。给检查工具用 */
export function findOnsets(chans: Chans, sr: number): number[] {
  return onsetsOf(energyPrefix(chans), sr);
}

/** 起点格子到真正起音的距离（采样点）：要对上的是起音那一刻 */
export const onsetLead = (sr: number): number => Math.round(sr * (ENV_WIN - ENV_HOP));

/**
 * 把 src 的 [from, to) 叠加到 out 的 at 处；开头 fadeIn 个点淡入、结尾 fadeOut 个点淡出。
 * 淡化用等功率曲线：接口两边是不相干的两段声音，线性淡化中间会凹下去
 */
function add(out: Float32Array[], src: Chans, from: number, to: number, at: number, fadeIn: number, fadeOut: number): void {
  const len = to - from;
  if (len <= 0) return;
  const h = Math.PI / 2;
  for (let c = 0; c < out.length; c++) {
    const o = out[c] as Float32Array;
    const s = src[c] as Float32Array;
    for (let i = 0; i < len; i++) {
      const j = at + i;
      if (j < 0 || j >= o.length) continue;
      let g = 1;
      if (i < fadeIn) g = Math.sin((h * (i + 0.5)) / fadeIn);
      if (i >= len - fadeOut) g *= Math.cos((h * (i - (len - fadeOut) + 0.5)) / fadeOut);
      o[j] = (o[j] as number) + (s[from + i] as number) * g;
    }
  }
}

/**
 * rate > 1 = 压短（动画被加速了这么多倍），rate < 1 = 拉长。返回新的各声道数据；用不着改时原样拷一份。
 * until（秒）= 采样的前这么长一段按 rate 改，之后的部分保持原速（换弹动画到「可以开火」那一刻之后是按原速播完的）。
 * 每一下响声在结果里的时刻 = 原来的时刻按上面的规则换算，响声本身和原来逐点相同
 */
export function retime(chans: Chans, sr: number, rate: number, until = Infinity): Float32Array<ArrayBuffer>[] {
  const n = chans[0]?.length ?? 0;
  const edge = Math.min(n, Math.max(0, until * sr));
  if (n === 0 || !(rate > 0) || Math.abs(rate - 1) < 1e-3 || edge < 1) return chans.map((c) => new Float32Array(c));
  /** 原来的时刻 → 新的时刻（采样点） */
  const map = (t: number): number => (t <= edge ? t / rate : edge / rate + (t - edge));
  const p = energyPrefix(chans);
  const marks = onsetsOf(p, sr);
  // 锚点：开头、每一下响声、结尾。开头 / 结尾不是响声（除非采样一上来就响）
  const startReal = marks[0] === 0;
  const at = [0, ...marks.filter((m) => m > 0), n];
  const last = at.length - 1;
  const lead = onsetLead(sr);
  const pos = at.map((a, k) => (k === 0 ? 0 : k === last ? Math.round(map(n)) : Math.max(0, Math.round(map(a + lead)) - lead)));
  for (let k = 1; k <= last; k++) pos[k] = Math.max(pos[k] as number, pos[k - 1] as number);
  if (last > 1 || startReal) {
    // 最后一下响声之后的余音不用对任何东西：拉长时原样放完，压短时别短过 TAIL_KEEP
    const tailIn = n - (at[last - 1] as number);
    const tailOut = (pos[last] as number) - (pos[last - 1] as number);
    pos[last] = (pos[last - 1] as number) + (rate < 1 ? tailIn : Math.max(tailOut, Math.min(tailIn, Math.round(sr * TAIL_KEEP))));
  } else if (rate < 1) {
    // 整段没有一下响声（一直很轻的摩擦声）：没有要对的点，不拉
    pos[last] = n;
  }
  const out = chans.map(() => new Float32Array(Math.max(1, pos[last] as number)));

  const fade = Math.round(sr * FADE);
  const keepAfter = Math.round(sr * KEEP_AFTER);
  const keepBefore = Math.round(sr * KEEP_BEFORE);
  const step = Math.max(1, Math.round(sr * 0.0005));

  for (let k = 0; k < last; k++) {
    const a = at[k] as number;
    const b = at[k + 1] as number;
    const oa = pos[k] as number;
    const ob = pos[k + 1] as number;
    const dIn = b - a;
    const dOut = ob - oa;
    if (dIn <= 0 || dOut <= 0) continue;
    const headReal = k > 0 || startReal;
    const tailReal = k + 1 < last;

    if (dOut === dIn) {
      add(out, chans, a, b, oa, 0, 0);
    } else if (dOut < dIn) {
      if (!headReal && tailReal) {
        // 第一下之前：留紧挨着它的那一截
        add(out, chans, b - dOut, b, oa, Math.min(fade, dOut), 0);
      } else if (headReal && !tailReal) {
        // 最后一下之后：留它的余音，截断处淡出
        add(out, chans, a, a + dOut, oa, 0, Math.min(dOut, Math.max(fade, Math.round(Math.min(dOut * 0.4, sr * TAIL_FADE)))));
      } else {
        // 两下之间（或者整段没有响声）：前面留 h1、后面留 h2，中间最安静的那一截剪掉，接口重叠 x 个点
        const x = Math.max(0, Math.min(fade, dOut >> 1, dIn - dOut));
        const total = dOut + x;
        const cut = dIn - total;
        const lo = Math.min(headReal ? keepAfter + x : x, total - x);
        const hi = Math.max(lo, total - x - (tailReal ? keepBefore : 0));
        let h1 = lo;
        let best = Infinity;
        for (let h = lo; h <= hi; h += step) {
          const e = (p[a + h + cut] as number) - (p[a + h] as number);
          if (e < best) {
            best = e;
            h1 = h;
          }
        }
        const h2 = total - h1;
        add(out, chans, a, a + h1, oa, 0, x);
        add(out, chans, b - h2, b, ob - h2, x, 0);
      }
    } else if (!headReal || !tailReal) {
      // 拉长，第一下之前：整段往后挪，开头空着
      add(out, chans, a, b, tailReal ? ob - dIn : oa, 0, 0);
    } else {
      // 拉长，两下之间：在最安静的地方断开，中间空着
      const lo = Math.min(keepAfter, dIn >> 1);
      const hi = Math.max(lo, dIn - Math.min(keepBefore, dIn >> 1));
      const w = Math.max(1, Math.round(sr * 0.002));
      let c = lo;
      let best = Infinity;
      for (let h = lo; h <= hi; h += step) {
        const e = (p[Math.min(n, a + h + w)] as number) - (p[Math.max(0, a + h - w)] as number);
        if (e < best) {
          best = e;
          c = h;
        }
      }
      const x = Math.min(fade, c, dIn - c);
      add(out, chans, a, a + c, oa, 0, x);
      add(out, chans, a + c, b, ob - (dIn - c), x, 0);
    }
  }
  return out;
}

/**
 * 压好的版本按速度分档留着（1/1024 一档）。一把枪的换弹速度只在升级、选卡、换另一把枪时才变，
 * 所以档数很少；分得细是因为整段录音的换弹有三四秒长，差 0.4% 到结尾就偏出 10 毫秒了
 */
const STEP = 1024;
const RATE_MIN = 0.5;
const RATE_MAX = 6;
/** 最多留这么多份改好的采样（一把枪的换弹大约 10–40 个采样），再多就把最久没用的丢掉 */
const KEEP = 160;

/** 按动画速度取一份改好长度的采样：算过的留着，下次同样的速度直接用 */
export class Retimer {
  private readonly cache = new Map<string, AudioBuffer>();

  /** 返回要播的那份采样。用不着改时就是原来那份。rate / until 的意思见 retime */
  fit(ctx: BaseAudioContext, key: string, buf: AudioBuffer, rate: number, until = Infinity): AudioBuffer {
    const q = Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, rate > 0 ? rate : 1)) * STEP) / STEP;
    // 采样比 until 短：整段都按 rate 改
    const u = until >= buf.duration ? Infinity : Math.round(until * 1000) / 1000;
    if (q === 1 || u <= 0) return buf;
    const id = `${key}|${q}|${u}`;
    let fitted = this.cache.get(id);
    if (fitted) {
      // 挪到最后：丢的时候从最久没用的丢起
      this.cache.delete(id);
    } else {
      const src: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) src.push(buf.getChannelData(c));
      const data = retime(src, buf.sampleRate, q, u);
      fitted = ctx.createBuffer(data.length, (data[0] as Float32Array).length, buf.sampleRate);
      for (let c = 0; c < data.length; c++) fitted.copyToChannel(data[c] as Float32Array<ArrayBuffer>, c);
      if (this.cache.size >= KEEP) this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(id, fitted);
    return fitted;
  }

  clear(): void {
    this.cache.clear();
  }
}
