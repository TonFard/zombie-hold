import type { WebGLRenderer } from 'three';
import type { Lighting } from '../render/core/lighting';
import type { PostFX } from '../render/core/postfx';

/**
 * 开放世界的画质：最低 / 低 / 中 / 高四档 + 自动（默认）。
 *
 * 为什么要分档：只降渲染分辨率救不了所有机器。像素多了卡（核显、高分屏）降分辨率有用；
 * 但树和草的顶点太多、绘制次数太多卡的时候，降分辨率一点用没有（实测 2133×1333 下分辨率降一半，帧时间没变）。
 * 所以每档除了分辨率上限，还管：阴影（贴图大小、范围，最低档不要阴影）、树的真模型画到多远、草的密度、
 * 屋里屋外的小东西画到多远、光晕。
 *
 * 自动：开局按显卡名字猜一档（核显 → 低，老独显 → 中，RTX 一类 → 高；上次自动落在哪就从哪开始），
 * 然后看帧时间：慢了先降分辨率，降到底发现没用（瓶颈不在像素上）就还回去、改降档；
 * 快了再一步一步升回来，升了又变慢就撤回，过一阵再试。
 * F4 在 自动 / 最低 / 低 / 中 / 高 之间切换，选择记在本机。
 * ?q=min|low|mid|high：固定档位，分辨率也不动（测量用，不保存）。
 */

export type Tier = 'min' | 'low' | 'mid' | 'high';
export const ORDER: Tier[] = ['min', 'low', 'mid', 'high'];
export const isTier = (v: unknown): v is Tier => v === 'min' || v === 'low' || v === 'mid' || v === 'high';

export interface TierSpec {
  label: string;
  /** 渲染分辨率上限（相对 CSS 像素；高分屏不按原生分辨率画） */
  maxRatio: number;
  /** 自动降分辨率最低降到多少（再低就改降档） */
  minScale: number;
  /** 阴影贴图边长（0 = 不要阴影）、覆盖身边 ± 多少米（两个一起缩，一个像素还是四五厘米） */
  shadowMap: number;
  shadowRange: number;
  /** 树 / 灌木 / 石头的真模型画到多远，面片树画到多远（米） */
  tree: number;
  bush: number;
  rock: number;
  far: number;
  /** 草的密度（1 = 全部） */
  grass: number;
  bloom: boolean;
  /** 地点里的小东西画多远、多远以内投影、多近换回原模型：相对默认值的倍率 */
  props: number;
  propShadow: number;
  lod: number;
  /** 雨 / 雪的粒子密度；丧尸的数量和动画距离（1 = 全部） */
  weather: number;
  horde: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { label: '高', maxRatio: 1.25, minScale: 0.7, shadowMap: 2048, shadowRange: 45, tree: 68, bush: 105, rock: 150, far: 1050, grass: 1, bloom: true, props: 1, propShadow: 1, lod: 1, weather: 1, horde: 1 },
  mid: { label: '中', maxRatio: 1, minScale: 0.65, shadowMap: 1536, shadowRange: 36, tree: 52, bush: 80, rock: 115, far: 1050, grass: 0.7, bloom: true, props: 0.8, propShadow: 0.75, lod: 0.8, weather: 0.7, horde: 0.85 },
  low: { label: '低', maxRatio: 1, minScale: 0.5, shadowMap: 1024, shadowRange: 26, tree: 38, bush: 55, rock: 80, far: 800, grass: 0.45, bloom: false, props: 0.6, propShadow: 0.5, lod: 0.65, weather: 0.45, horde: 0.7 },
  min: { label: '最低', maxRatio: 1, minScale: 0.5, shadowMap: 0, shadowRange: 26, tree: 30, bush: 40, rock: 60, far: 600, grass: 0.22, bloom: false, props: 0.5, propShadow: 0, lod: 0.5, weather: 0.25, horde: 0.5 },
};

/** 按显卡名字猜一档（只是起点，之后按帧时间自动调）。认不出来的给中档 */
export function guessTier(gpu: string): Tier {
  const g = gpu.toLowerCase();
  if (!g) return 'mid';
  if (/swiftshader|llvmpipe|softpipe|basic render/.test(g)) return 'min';
  if (/rtx|gtx 1[0-9][78]0|gtx 9[78]0|titan|rx [5-9][789]00|rx [6-9]\d00|radeon vii/.test(g)) return 'high';
  if (/gtx|rx \d{3,4}|rx vega|arc|apple m\d|quadro|radeon pro|firepro/.test(g)) return 'mid';
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega|mali|adreno|powervr|geforce (gt|mx|[1-9]\d\dm)/.test(g)) return 'low';
  return 'mid';
}

/** 浏览器给的显卡名字很长（ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x…) Direct3D11 …)）：只留中间那段 */
export function gpuName(raw: string): string {
  const m = /^ANGLE \([^,]*, ([^,]+?)(?: \(0x[0-9a-f]+\))?(?: Direct3D| OpenGL| Vulkan|,|$)/i.exec(raw);
  return (m?.[1] ?? raw).trim() || '未知';
}

/** 帧时间超过这么多毫秒算慢（不到 48 帧）：开始往下调 */
const SLOW = 21;
/** 往上调了以后，帧时间得在这以内（54 帧以上）才留着：和 SLOW 之间留一段，不会来回跳 */
const KEEP = 18.5;
/** 慢到这个程度（22 帧以下）：能降的全降，降了看不出效果也不还回去（「调了没用就还回去」是给帧率被限在 30 的机器准备的） */
const HOPELESS = 45;
/** 慢得没法玩（10 帧以下）持续 6 秒：不一步一步试了，直接降到底 */
const PANIC = 100;

export interface GovernorHooks {
  /** 分辨率倍率变了 */
  scale(): void;
  /** 档位变了 */
  tier(): void;
}

/** 一轮「往下调」：从哪开始的、降分辨率那一段是从哪开始的（用来判断降了有没有用） */
interface Episode {
  tier: Tier;
  scale: number;
  avg: number;
  scaleFrom: number;
  scaleAvg: number;
  scaleTried: boolean;
  /** 已经调到底了，还是慢：不再动 */
  floor: boolean;
}

/**
 * 自动调节的逻辑（纯计算，不碰页面，.logs/open/qualitytest.ts 拿各种假机器跑它）。
 * - 帧时间是按时间加权的滑动平均（约 0.35 秒）：一秒画 200 帧还是 2 帧，都是一两秒内跟上；单帧的尖峰最多按平均值的两倍计。
 * - 连续慢了三秒才动手（加载时卡一秒不算）。
 * - 往下：先降分辨率，一步 0.1，一直降到这一档的下限。到底了帧时间没少一成 → 瓶颈不在像素上：
 *   分辨率还回去（一段时间内不再试），改降档。不能降一步就下结论——有垂直同步时帧时间是一档一档的
 *   （33 → 33 → 33 → 16.7），中间几步看着都「没用」。
 *   档位也降到底了，帧时间还是没少一成（比如浏览器把帧率限在 30）→ 全部还回去，过几分钟再试。
 *   但慢到 22 帧以下时不还：能降的全降，停在最低。10 帧以下持续 6 秒：直接到底，不一步一步试。
 * - 往上：帧时间够快（高刷屏 83 帧以上；60 Hz 屏是跑满刷新率——到不了 12 毫秒，不能拿 12 当标准）就一步一步升分辨率；
 *   分辨率满了并且稳了 20 秒，试着升一档。升完 6 秒内掉到 54 帧以下：撤回，过一阵（翻倍）再试。
 */
export class Governor {
  tier: Tier;
  auto: boolean;
  scale: number;
  /** 平滑后的帧间隔（毫秒） */
  avg = 16;
  /** 见过的最短帧间隔：约等于屏幕的刷新间隔（卡的机器上只是「最好的时候」，所以用的时候不超过 16.7） */
  fast = 16.7;
  /** 距上次调整多久（秒）；开局先等几秒，加载的卡顿不算 */
  private t = -3;
  private slowT = 0;
  /** 连续「够快」了多久 */
  private calm = 0;
  private probe: { kind: 'scale' | 'tier'; scale: number; tier: Tier } | null = null;
  private ep: Episode | null = null;
  private upFails = 0;
  private upBlock = 0;
  private tierUpFails = 0;
  private tierUpBlock = 0;
  private scaleDead = 0;
  private scaleDeadN = 0;
  private dead = 0;
  private deadN = 0;
  private deadAvg = 0;

  constructor(
    tier: Tier,
    auto: boolean,
    private readonly hooks: GovernorHooks,
    scale = 1,
  ) {
    this.tier = tier;
    this.auto = auto;
    this.scale = Math.min(1, Math.max(TIERS[tier].minScale, scale));
  }

  /** 换一种方式重新开始（F4）：分辨率回到满的，之前记的「试过没用」都清掉 */
  reset(tier: Tier, auto: boolean): void {
    this.tier = tier;
    this.auto = auto;
    this.scale = 1;
    this.t = -2;
    this.slowT = 0;
    this.calm = 0;
    this.probe = null;
    this.ep = null;
    this.upFails = 0;
    this.upBlock = 0;
    this.tierUpFails = 0;
    this.tierUpBlock = 0;
    this.scaleDead = 0;
    this.scaleDeadN = 0;
    this.dead = 0;
    this.deadN = 0;
  }

  private setScale(v: number): void {
    this.scale = Math.round(v * 100) / 100;
    this.hooks.scale();
  }

  private setTier(v: Tier): void {
    this.tier = v;
    this.hooks.tier();
  }

  /** dt：这一帧和上一帧真实隔了多久（秒，调用方最多给 1 秒；不是主循环里截到 0.1 秒的那个） */
  frame(dt: number): void {
    // 单帧的尖峰（加载、切回前台）最多按平均值的两倍计：零星卡一下不算慢
    const ms = Math.min(dt * 1000, this.avg * 2 + 4);
    this.avg += (ms - this.avg) * (1 - Math.exp(-dt / 0.35));
    this.fast = Math.min(this.fast * 1.0002, this.avg);
    this.t += dt;
    this.upBlock = Math.max(0, this.upBlock - dt);
    this.tierUpBlock = Math.max(0, this.tierUpBlock - dt);
    this.scaleDead = Math.max(0, this.scaleDead - dt);
    this.dead = Math.max(0, this.dead - dt);
    this.slowT = this.avg > SLOW ? this.slowT + dt : 0;
    const quick = Math.max(12, Math.min(this.fast, 16.7) * 1.1);
    this.calm = this.avg < quick ? this.calm + dt : 0;
    // 「怎么调都没用」之后又明显更慢了（走进了更重的地方）：不等了，重新试
    if (this.dead > 0 && this.avg > this.deadAvg * 1.3) this.dead = 0;

    // 刚升了一步：观察 6 秒，掉到 54 帧以下就撤回
    const p = this.probe;
    if (p) {
      if (this.t > 1.5 && this.avg > KEEP) {
        this.probe = null;
        if (p.kind === 'scale') {
          this.upBlock = Math.min(600, 30 * 2 ** this.upFails++);
          this.setScale(p.scale);
        } else {
          this.tierUpBlock = Math.min(3600, 600 * 2 ** this.tierUpFails++);
          this.setTier(p.tier);
        }
        this.t = p.kind === 'tier' ? -2 : 0;
        this.calm = 0;
        this.slowT = 0;
        return;
      }
      if (this.t < 6) return;
      if (p.kind === 'scale') this.upFails = 0;
      else this.tierUpFails = 0;
      this.probe = null;
    }
    if (this.t < 2) return;

    if (this.slowT > 3) {
      this.descend();
      return;
    }
    // 刚开始慢：再看看
    if (this.slowT > 0) return;
    this.ep = null;

    if (this.calm > 3 && this.scale < 1 - 0.005 && this.upBlock <= 0) {
      this.probe = { kind: 'scale', scale: this.scale, tier: this.tier };
      this.setScale(Math.min(1, this.scale + 0.1));
      this.t = 0;
      this.calm = 0;
      return;
    }
    if (this.auto && this.calm > 20 && this.scale >= 1 - 0.005 && this.tierUpBlock <= 0 && this.tier !== 'high') {
      this.probe = { kind: 'tier', scale: this.scale, tier: this.tier };
      this.setTier(ORDER[ORDER.indexOf(this.tier) + 1] as Tier);
      // 换档要重填植被、重分道具（最低 → 低还要重新编译着色器）：多等两秒再看
      this.t = -2;
      this.calm = 0;
    }
  }

  private descend(): void {
    if (this.dead > 0) return;
    const e = (this.ep ??= { tier: this.tier, scale: this.scale, avg: this.avg, scaleFrom: this.scale, scaleAvg: this.avg, scaleTried: false, floor: false });
    if (e.floor) return;
    const hopeless = this.avg > HOPELESS;
    if (this.avg > PANIC) {
      // 可能只是加载卡了几秒：再等等
      if (this.slowT < 6) return;
      const low = this.auto ? (ORDER[0] as Tier) : this.tier;
      const floor = TIERS[low].minScale;
      e.floor = true;
      if (this.tier !== low) this.setTier(low);
      if (Math.abs(this.scale - floor) > 0.005) this.setScale(floor);
      this.t = -2;
      return;
    }
    const spec = TIERS[this.tier];
    // 1. 降分辨率，一直降到这一档的下限
    if (this.scaleDead <= 0 && this.scale > spec.minScale + 0.005) {
      if (!e.scaleTried) {
        e.scaleTried = true;
        e.scaleFrom = this.scale;
        e.scaleAvg = this.avg;
      }
      this.setScale(Math.max(spec.minScale, this.scale - 0.1));
      this.t = 0;
      return;
    }
    // 2. 分辨率降到底了：有没有用？没用就还回去
    if (e.scaleTried) {
      e.scaleTried = false;
      if (!hopeless && this.avg > e.scaleAvg * 0.9) {
        this.scaleDead = Math.min(3600, 120 * 2 ** this.scaleDeadN++);
        this.setScale(e.scaleFrom);
      }
    }
    // 3. 降一档
    if (this.auto && this.tier !== ORDER[0]) {
      this.setTier(ORDER[ORDER.indexOf(this.tier) - 1] as Tier);
      this.t = -2;
      return;
    }
    // 4. 没得降了。从头到尾都没用（帧率被限住了，或者卡在别的地方）：全部还回去，过几分钟再试
    if (!hopeless && this.avg > e.avg * 0.9) {
      this.dead = Math.min(3600, 300 * 2 ** this.deadN++);
      this.deadAvg = this.avg;
      this.ep = null;
      if (this.scale !== e.scale) this.setScale(e.scale);
      if (this.tier !== e.tier) this.setTier(e.tier);
      this.t = -2;
      return;
    }
    e.floor = true;
  }
}

export interface QualityTargets {
  lighting: Lighting;
  post: PostFX;
  flora: { setQuality(q: { tree: number; bush: number; rock: number; far: number }): void };
  grass: { setDensity(k: number): void };
  sites: { setQuality(q: { props: number; shadow: number; lod: number }): void };
  weather?: { setQuality(k: number): void };
  horde?: { setQuality(k: number): void };
  raiders?: { setQuality(k: number): void };
  /** 按 ratio 重设渲染分辨率 */
  resize(): void;
}

const KEY = 'zh.open.quality';
const KEY_AUTO = 'zh.open.quality.auto';
const read = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string): void => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    // 存不了（隐私模式）：这次用着就行
  }
};

/** 页面上用的那一层：读显卡名字、记住选择、把档位落到各个模块上 */
export class QualityControl {
  /** 显卡名字（F3 面板里显示：笔记本上能看出是不是跑在核显上） */
  readonly gpu: string;
  /** 没有用上显卡（浏览器关了硬件加速、显卡驱动被拉黑、远程桌面）：怎么调都很卡，开局提示一下 */
  readonly software: boolean;
  private readonly rawGpu: string;
  private mode: 'auto' | Tier;
  /** ?q= 固定：什么都不自动调 */
  private fixed: boolean;
  private readonly gov: Governor;
  private targets: QualityTargets | null = null;
  private toastEl: HTMLElement | null = null;
  private toastT = 0;

  constructor(renderer: WebGLRenderer, url: string | null) {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.rawGpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    this.gpu = gpuName(this.rawGpu);
    this.software = /swiftshader|llvmpipe|softpipe|basic render/i.test(this.rawGpu);
    const saved = read(KEY);
    this.fixed = isTier(url);
    this.mode = isTier(url) ? url : isTier(saved) ? saved : 'auto';
    // 自动模式从哪开始：上次自动落在哪档、哪个分辨率；没有就按显卡猜。
    // 上次可能是被别的程序拖慢的（别的程序占着显卡时同一个画面能慢两三倍）：最低只从「猜的那档的下一档」、×0.7 开始，
    // 真跑不动的机器十几秒内自己会再降下去
    const [lastTier, lastScale] = (read(KEY_AUTO) ?? '').split(':');
    const auto = this.mode === 'auto';
    const guess = guessTier(this.rawGpu);
    const start: Tier = this.mode !== 'auto' ? this.mode : isTier(lastTier) ? (ORDER[Math.max(ORDER.indexOf(lastTier), ORDER.indexOf(guess) - 1, 0)] as Tier) : guess;
    this.gov = new Governor(
      start,
      auto,
      {
        scale: () => {
          this.targets?.resize();
          this.remember();
        },
        tier: () => {
          this.apply();
          this.remember();
          this.toast(`画质自动调到：${TIERS[this.gov.tier].label}（F4 手动选）`);
        },
      },
      auto && isTier(lastTier) ? Math.max(0.7, Number(lastScale) || 1) : 1,
    );
  }

  private remember(): void {
    if (this.mode === 'auto' && !this.fixed) write(KEY_AUTO, `${this.gov.tier}:${this.gov.scale.toFixed(2)}`);
  }

  get tier(): Tier {
    return this.gov.tier;
  }

  /** 现在的渲染分辨率倍率（相对 CSS 像素） */
  get ratio(): number {
    return Math.min(window.devicePixelRatio, TIERS[this.gov.tier].maxRatio) * this.gov.scale;
  }

  get label(): string {
    const name = TIERS[this.gov.tier].label;
    return this.mode === 'auto' ? `自动（${name}）` : this.fixed ? `${name}（固定）` : name;
  }

  bind(t: QualityTargets): void {
    this.targets = t;
    this.apply();
    if (this.software) this.toast('没有用上显卡（软件渲染），会非常卡：请打开浏览器的「硬件加速」，或者更新显卡驱动', 20);
  }

  frame(dt: number): void {
    if (!this.fixed) this.gov.frame(dt);
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0 && this.toastEl) this.toastEl.style.opacity = '0';
    }
  }

  /** F4：自动 → 最低 → 低 → 中 → 高 → 自动 */
  cycle(): void {
    const seq: Array<'auto' | Tier> = ['auto', ...ORDER];
    this.mode = seq[(seq.indexOf(this.mode) + 1) % seq.length] as 'auto' | Tier;
    this.fixed = false;
    write(KEY, this.mode);
    this.gov.reset(this.mode === 'auto' ? guessTier(this.rawGpu) : this.mode, this.mode === 'auto');
    this.apply();
    this.toast(`画质：${this.label}`);
  }

  private apply(): void {
    const t = this.targets;
    if (!t) return;
    const s = TIERS[this.gov.tier];
    const sun = t.lighting.sun;
    const on = s.shadowMap > 0;
    if (sun.castShadow !== on) sun.castShadow = on;
    const sh = sun.shadow;
    if (on && sh.mapSize.x !== s.shadowMap) {
      sh.mapSize.set(s.shadowMap, s.shadowMap);
      // 旧的阴影贴图扔掉，下一帧按新尺寸重建
      if (sh.map) {
        sh.map.depthTexture?.dispose();
        sh.map.dispose();
        sh.map = null;
      }
    }
    const c = sh.camera;
    c.left = c.bottom = -s.shadowRange;
    c.right = c.top = s.shadowRange;
    c.updateProjectionMatrix();
    t.post.bloom.enabled = s.bloom;
    t.flora.setQuality({ tree: s.tree, bush: s.bush, rock: s.rock, far: s.far });
    t.grass.setDensity(s.grass);
    t.sites.setQuality({ props: s.props, shadow: s.propShadow, lod: s.lod });
    t.weather?.setQuality(s.weather);
    t.horde?.setQuality(s.horde);
    t.raiders?.setQuality(s.horde);
    t.resize();
  }

  private toast(text: string, seconds = 3): void {
    if (!this.toastEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:13px/1.4 system-ui,sans-serif;pointer-events:none;transition:opacity .3s;z-index:30;opacity:0';
      document.body.appendChild(el);
      this.toastEl = el;
    }
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastT = seconds;
  }
}
