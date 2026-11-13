import baked from './hand-fit.json';

/**
 * TACZ 枪上程序手臂的摆放参数（每把枪一份，左右手各一套）。
 *
 * 手的位置来自枪包里的手臂方块（lefthand_pos / righthand_pos，会跟着动画动）。这里的参数都是相对那个方块的：
 * 位置单位是 TACZ 像素（1/16 格），方向按举枪待机时的画面说（右 / 上 / 前）；旋转单位是度，在手套自己的坐标里转。
 *
 * 数值来源：hand-fit.json（调好后烘焙进去的）← 本机 localStorage（F9 手部调节面板里改的，还没烘焙）。
 * 面板「复制全部」导出的 JSON 就是 hand-fit.json 的格式，直接替换即可。
 */
export interface HandFit {
  /** 手套位置偏移（像素）：右 / 上 / 前 */
  x: number;
  y: number;
  z: number;
  /** 手套旋转（度）：俯仰（绕手套左右轴）/ 偏转（绕手背法线）/ 翻滚（绕手指方向） */
  rx: number;
  ry: number;
  rz: number;
  /** 手指弯曲（1 = 默认握拳程度，0 = 伸直） */
  curl: number;
  /** 拇指张开角度（度，正 = 往外张） */
  thumb: number;
  /** 肩膀位置偏移（像素，画面方向：右 / 上 / 前）：决定前臂从哪个方向伸过来 */
  sx: number;
  sy: number;
  sz: number;
  /** 肘部往外撇多少（负 = 往里收） */
  elbow: number;
}

export interface GunFit {
  /** 手臂整体大小（1 = 默认） */
  scale: number;
  R: HandFit;
  L: HandFit;
}

export const HAND_KEYS: Array<keyof HandFit> = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'curl', 'thumb', 'sx', 'sy', 'sz', 'elbow'];

const hand = (left: boolean): HandFit => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, curl: 1, thumb: 0, sx: left ? -1.6 : 1.6, sy: -2.4, sz: 0, elbow: 0 });

export const defaultGunFit = (): GunFit => ({ scale: 1, R: hand(false), L: hand(true) });

type PartialFit = { scale?: number; R?: Partial<HandFit>; L?: Partial<HandFit> };

const LS_KEY = 'zombie-hold-handfit-v1';

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function mergeHand(base: HandFit, p: Partial<HandFit> | undefined): HandFit {
  const out = { ...base };
  if (p) for (const k of HAND_KEYS) out[k] = num(p[k], base[k]);
  return out;
}

function merge(base: GunFit, p: PartialFit | undefined): GunFit {
  if (!p) return base;
  return { scale: num(p.scale, base.scale), R: mergeHand(base.R, p.R), L: mergeHand(base.L, p.L) };
}

class HandFits {
  private readonly baked = baked as Record<string, PartialFit>;
  private local: Record<string, PartialFit> = {};
  private readonly cache = new Map<string, GunFit>();

  constructor() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
      const v = raw ? (JSON.parse(raw) as unknown) : null;
      if (v && typeof v === 'object' && !Array.isArray(v)) this.local = v as Record<string, PartialFit>;
    } catch {
      this.local = {};
    }
  }

  /** 某把枪现在生效的参数（默认 ← 烘焙的 '*' ← 烘焙的这把 ← 本机调的） */
  get(id: string): GunFit {
    let f = this.cache.get(id);
    if (!f) {
      f = merge(merge(merge(defaultGunFit(), this.baked['*']), this.baked[id]), this.local[id]);
      this.cache.set(id, f);
    }
    return f;
  }

  /** 只算烘焙值（面板里"恢复到已烘焙的"用） */
  bakedOf(id: string): GunFit {
    return merge(merge(defaultGunFit(), this.baked['*']), this.baked[id]);
  }

  set(id: string, f: GunFit): void {
    this.local[id] = JSON.parse(JSON.stringify(f)) as GunFit;
    this.cache.delete(id);
    this.persist();
  }

  /** 去掉本机对这把枪的修改 */
  reset(id: string): void {
    delete this.local[id];
    this.cache.delete(id);
    this.persist();
  }

  isTuned(id: string): boolean {
    return id in this.local;
  }

  /** 导出：烘焙的 + 本机调过的 + 当前这把，合并成 hand-fit.json 的格式 */
  exportAll(current = ''): string {
    const ids = new Set([...Object.keys(this.baked), ...Object.keys(this.local), ...(current ? [current] : [])]);
    const out: Record<string, GunFit | PartialFit> = {};
    for (const id of [...ids].sort()) out[id] = id === '*' ? (this.baked['*'] ?? {}) : this.get(id);
    return JSON.stringify(out, null, 2);
  }

  exportOne(id: string): string {
    return JSON.stringify({ [id]: this.get(id) }, null, 2);
  }

  private persist(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.local));
    } catch {
      // 存不了（隐私模式等）：只在这次运行里生效
    }
  }
}

export const handFits = new HandFits();
