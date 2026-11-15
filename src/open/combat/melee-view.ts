import { Box3, Euler, Group, Quaternion, Vector3, type Material, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Arm } from '../../render/weapons/arms';
import { armMaterial } from '../../render/weapons/hand-mesh';
import { MELEE_LIST, type MeleeId } from '../game/api';

/**
 * 近战武器和空手的第一人称表现：手臂（主游戏的程序手臂）+ 道具模型（public/props 里的球棒、撬棍……），
 * 挂在视角模型的那个独立场景里（相机空间：相机在原点，朝 -Z，+X 右，+Y 上，单位米、真人比例）。
 * 动作是几组关键帧（握着武器的手的位置 + 手的朝向），这里只管「进度 → 姿势」；
 * 什么时候挥、哪一帧算打中、打中以后顿一下由 arsenal.ts 决定。
 *
 * 摆姿势的两条规矩（调的时候吃过亏）：
 *   手指的方向（手背 → 指节）要大致朝前，偏离不超过 50° 左右——前臂是从右下角伸过来的，手腕最多弯 57°，
 *   超了前臂就会被扳到从上面 / 侧面戳进来，一大截袖子横在画面中间；
 *   手留在画面右下那一块、离镜头 0.32 米以上，靠武器自己扫过画面，不靠手横穿屏幕。
 */

export type MeleeKind = MeleeId | 'fists';
type Style = 'punch' | 'slash' | 'chop' | 'heavy';

export interface MeleeSpec {
  id: MeleeKind;
  name: string;
  damage: number;
  /** 够得着多远（米）、左右各多宽（弧度） */
  reach: number;
  arc: number;
  /** 一下挥完要多久（秒）、挥到第几成算打中 */
  time: number;
  hitAt: number;
  /** 一下耗多少体力（0–1） */
  stamina: number;
  /** 有多沉 0–1（声音、镜头震动、打在墙上溅多少灰） */
  heavy: number;
  style: Style;
}

/** 每种动作里「打中」的那一帧（关键帧表里挥到最前面的时刻） */
const HIT_AT: Record<Style, number> = { punch: 0.36, slash: 0.47, chop: 0.49, heavy: 0.57 };
const DEG = Math.PI / 180;

const spec = (id: MeleeKind, name: string, damage: number, reach: number, time: number, stamina: number, heavy: number, style: Style): MeleeSpec => ({ id, name, damage, reach, arc: 35 * DEG, time, hitAt: HIT_AT[style], stamina, heavy, style });
const nameOf = (id: MeleeId): string => MELEE_LIST.find((m) => m.id === id)?.name ?? id;

export const MELEE: Record<MeleeKind, MeleeSpec> = {
  fists: spec('fists', '拳头', 12, 1.7, 0.42, 0.03, 0, 'punch'),
  bat: spec('bat', nameOf('bat'), 34, 2.1, 0.62, 0.06, 0.35, 'slash'),
  crowbar: spec('crowbar', nameOf('crowbar'), 38, 2.0, 0.66, 0.065, 0.45, 'slash'),
  hatchet: spec('hatchet', nameOf('hatchet'), 46, 1.9, 0.58, 0.06, 0.4, 'chop'),
  machete: spec('machete', nameOf('machete'), 52, 2.1, 0.56, 0.055, 0.3, 'slash'),
  sledge: spec('sledge', nameOf('sledge'), 85, 2.3, 0.95, 0.14, 1, 'heavy'),
};

/**
 * 模型怎么握：这五个道具都是竖着的、握把在下头在上。grip = 握点离最下面多远（米），r = 握把多粗（半径），
 * roll = 绕自己的长轴转多少（大锤的锤头是横着的，转 90° 让锤面朝前），scale = 第一人称里放大多少（手斧本身只有 29 厘米），
 * tint = 颜色压暗多少（大锤的黄色柄在视角模型的灯下亮得泛光）。
 * 大锤握在柄的中段：握在末端的话要两只手，左臂从左下角伸过来会挡掉半个画面；握中段时下半截柄朝左下出画面，看着就是双手端着
 */
const HOLD: Record<MeleeId, { grip: number; r: number; roll: number; scale: number; tint: number }> = {
  bat: { grip: 0.11, r: 0.016, roll: 0, scale: 1, tint: 1 },
  crowbar: { grip: 0.1, r: 0.011, roll: 0, scale: 1.15, tint: 1 },
  hatchet: { grip: 0.055, r: 0.012, roll: 0, scale: 1.45, tint: 0.9 },
  machete: { grip: 0.13, r: 0.018, roll: 0, scale: 1, tint: 1 },
  sledge: { grip: 0.5, r: 0.022, roll: Math.PI / 2, scale: 0.9, tint: 0.5 },
};

/** 握在手里的棍子上端往手指那边斜多少（弧度）：握拳时棍子和前臂本来就不垂直；有了它劈到底时手腕不用折成直角 */
const CANT = 0.4;

/** 一帧姿势：握着武器的手（手心）的位置 x y z，手的朝向 俯仰 / 偏转 / 翻滚（弧度，全是 0 = 手指朝前、手背朝右、武器朝上略往前斜） */
type Pose = readonly [number, number, number, number, number, number];
/** 关键帧：时刻（0–1）、姿势、到这一帧的缓动（0 线性 · 1 先快后慢 · 2 先慢后快 · 3 两头慢） */
type Key = readonly [number, Pose, number];

const IDLE_1H: Pose = [0.19, -0.17, -0.38, -0.55, 0, 0.05];
const IDLE_HEAVY: Pose = [0.15, -0.15, -0.4, -0.6, 0.1, -0.35];
const GUARD: Pose = [0.13, -0.1, -0.36, 0.45, 0.2, 0.2];
/** 没出拳的那只手稍微收着 */
const GUARD_BACK: Pose = [0.15, -0.12, -0.32, 0.45, 0.25, 0.2];

/** 从右往左横扫：手往右后收，再转腕带着武器扫到左边 */
const SLASH_A: readonly Key[] = [
  [0, IDLE_1H, 0],
  [0.28, [0.3, -0.08, -0.32, 0.15, -0.55, -0.5], 1],
  [0.4, [0.22, -0.1, -0.42, -0.3, -0.1, 0.5], 2],
  [0.47, [0.12, -0.09, -0.5, -0.4, 0.35, 1.0], 0],
  [0.62, [0.03, -0.2, -0.45, -0.6, 0.6, 1.45], 1],
  [1, IDLE_1H, 3],
];
/** 反手从左往右 */
const SLASH_B: readonly Key[] = [
  [0, IDLE_1H, 0],
  [0.28, [0.04, -0.1, -0.42, -0.2, 0.7, 1.2], 1],
  [0.4, [0.1, -0.1, -0.46, -0.7, 0.4, 0.8], 2],
  [0.47, [0.14, -0.1, -0.48, -0.9, 0.1, 0.4], 0],
  [0.62, [0.3, -0.16, -0.42, -0.6, -0.6, -0.9], 1],
  [1, IDLE_1H, 3],
];
/** 从上往下劈 */
const CHOP: readonly Key[] = [
  [0, IDLE_1H, 0],
  [0.32, [0.22, -0.02, -0.32, 0.55, 0, -0.1], 1],
  [0.44, [0.17, -0.06, -0.44, -0.4, 0.05, 0.05], 2],
  [0.49, [0.12, -0.14, -0.5, -1.0, 0.05, 0.1], 0],
  [0.64, [0.1, -0.26, -0.46, -1.25, 0.05, 0.1], 1],
  [1, IDLE_1H, 3],
];
/** 大锤：抡到右肩上面再砸下来，蓄力长 */
const HEAVY: readonly Key[] = [
  [0, IDLE_HEAVY, 0],
  [0.42, [0.2, 0, -0.36, 0.5, -0.1, -0.5], 3],
  [0.52, [0.14, -0.04, -0.44, -0.4, 0, -0.2], 2],
  [0.57, [0.08, -0.14, -0.5, -1.0, 0.1, 0.1], 0],
  [0.7, [0.06, -0.26, -0.46, -1.2, 0.1, 0.1], 1],
  [1, IDLE_HEAVY, 3],
];
/** 直拳：先往回收一点，再转成掌心朝下打出去 */
const PUNCH: readonly Key[] = [
  [0, GUARD, 0],
  [0.12, [0.15, -0.12, -0.31, 0.45, 0.25, 0.3], 1],
  [0.36, [0.02, -0.03, -0.46, 0, 0.18, 1.35], 2],
  [0.5, [0.03, -0.04, -0.44, 0, 0.18, 1.3], 1],
  [1, GUARD, 3],
];

/** 爪子（变成丧尸以后）：两只手一直举着，手心朝下、手指张开半弯 */
const CLAW_IDLE: Pose = [0.17, -0.13, -0.36, 0.2, 0.15, 1.1];
const CLAW_BACK: Pose = [0.19, -0.15, -0.33, 0.25, 0.2, 1.0];
/** 一爪：抬到肩膀那么高，斜着往下往里挠 */
const CLAW: readonly Key[] = [
  [0, CLAW_IDLE, 0],
  [0.16, [0.22, -0.02, -0.33, 0.55, -0.1, 0.9], 1],
  [0.36, [0.06, -0.1, -0.5, -0.25, 0.3, 1.4], 2],
  [0.55, [0.0, -0.2, -0.44, -0.5, 0.4, 1.5], 1],
  [1, CLAW_IDLE, 3],
];

const ease = (x: number, mode: number): number => (mode === 1 ? 1 - (1 - x) * (1 - x) : mode === 2 ? x * x : mode === 3 ? x * x * (3 - 2 * x) : x);

function sample(keys: readonly Key[], t: number, out: number[]): void {
  let i = 1;
  while (i < keys.length - 1 && t > (keys[i] as Key)[0]) i++;
  const a = keys[i - 1] as Key;
  const b = keys[i] as Key;
  const u = ease(Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-5, b[0] - a[0]))), b[2]);
  for (let k = 0; k < 6; k++) out[k] = (a[1][k] as number) + ((b[1][k] as number) - (a[1][k] as number)) * u;
}

const SHOULDER_R = new Vector3(0.2, -0.24, 0.125);
const SHOULDER_L = new Vector3(-0.2, -0.24, 0.125);
const POLE_R = new Vector3(0.55, -1, 0.1);
const POLE_L = new Vector3(-0.55, -1, 0.1);
const UPPER = 0.3;
const FORE = 0.25;
const IDENT = new Quaternion();
const ZERO = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');
const _q = new Quaternion();
const _t = new Vector3();
const _fwd = new Vector3();
const _palm = new Vector3();
const _pose: number[] = [0, 0, 0, 0, 0, 0];
const _poseL: number[] = [0, 0, 0, 0, 0, 0];

export interface MeleeFrame {
  /** 手上是什么；null = 什么都不显示 */
  kind: MeleeKind | null;
  /** 举着（true）还是放下（false）：空手平时放下，出拳时才举起来 */
  up: boolean;
  /** 挥击进度 0–1，-1 = 没在挥 */
  swing: number;
  /** 第几下（横扫正手 / 反手、左右拳轮流） */
  combo: number;
  speed: number;
  sprinting: boolean;
  yaw: number;
  pitch: number;
}

export class MeleeView {
  readonly root = new Group();
  /** 模型加载好了（武器模块拿去预热着色器、上传贴图） */
  onModel: ((obj: Object3D, textures: Texture[]) => void) | null = null;
  /** 调姿势用（截图脚本）：不是 null 时握武器的手 / 出拳的手直接摆成这个姿势，不看挥击进度 */
  debugPose: number[] | null = null;

  private readonly armR = new Arm(false);
  private readonly armL = new Arm(true);
  private readonly models = new Map<MeleeId, Group | null>();
  private readonly loading = new Set<MeleeId>();
  private readonly loader = new GLTFLoader();
  private shown: MeleeKind | null = null;
  /** 0 = 举着，1 = 完全放下（画面外） */
  private lower = 1;
  private bobT = 0;
  private bobAmp = 0;
  private sprintK = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private haveLast = false;
  private clawed = false;

  constructor() {
    this.root.name = 'melee-view';
    this.root.add(this.armR.root, this.armL.root);
    this.root.visible = false;
  }

  /** 开始加载一把近战武器的模型（加载过 / 正在加载就什么都不做） */
  ensure(id: MeleeId): void {
    if (this.models.has(id) || this.loading.has(id)) return;
    const model = MELEE_LIST.find((m) => m.id === id)?.model;
    if (!model) return;
    this.loading.add(id);
    this.loader
      .loadAsync(`${import.meta.env.BASE_URL}props/${model}/${model}.gltf`)
      .then((gltf) => {
        const h = HOLD[id];
        const obj = gltf.scene;
        obj.updateMatrixWorld(true);
        const box = new Box3().setFromObject(obj);
        const textures: Texture[] = [];
        const seen = new Set<Material>();
        obj.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          m.castShadow = false;
          m.receiveShadow = false;
          m.frustumCulled = false;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            if (seen.has(mat)) continue;
            seen.add(mat);
            const std = mat as unknown as Record<string, Texture | null> & { color?: { multiplyScalar(k: number): void } };
            if (h.tint !== 1) std.color?.multiplyScalar(h.tint);
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
              const t = std[k];
              if (t && !textures.includes(t)) textures.push(t);
            }
          }
        });
        // 握点挪到原点：水平居中，握把那一段在 y = 0
        obj.position.set(-(box.min.x + box.max.x) / 2, -(box.min.y + h.grip), -(box.min.z + box.max.z) / 2);
        const inner = new Group();
        inner.add(obj);
        inner.scale.setScalar(h.scale);
        // 手套坐标：+X = 拇指那侧，-Y = 掌心，+Z = 手指。武器的长轴（模型 +Y）顺着 +X 从虎口伸出去，握把贴在掌心前面
        const turn = new Group();
        turn.rotation.set(0, h.roll, -Math.PI / 2, 'ZYX');
        turn.add(inner);
        const pivot = new Group();
        pivot.rotation.y = -CANT;
        pivot.position.set(0, -(0.015 + h.r * h.scale), 0.012);
        pivot.add(turn);
        pivot.visible = false;
        this.armR.hand.add(pivot);
        this.models.set(id, pivot);
        this.onModel?.(pivot, textures);
      })
      .catch((e: unknown) => {
        console.warn(`近战武器模型 ${id} 加载失败`, e);
        this.models.set(id, null);
      })
      .finally(() => this.loading.delete(id));
  }

  /** 这把武器的模型有了没有（空手永远是 true；加载失败也算 true：只显示手） */
  ready(kind: MeleeKind): boolean {
    return kind === 'fists' || this.models.has(kind);
  }

  /** 马上放到画面外（换武器、死了、上车：不播放下的过程） */
  snapDown(): void {
    this.lower = 1;
    this.root.visible = false;
  }

  /**
   * 爪子：生化模式里玩家变成丧尸以后的空手。手套和袖子染成发青的烂肉色（手臂的材质是所有手臂共用的那一个：
   * 这时候枪拿不出来、东西用不了，画面里只会有这两只手；变回人的时候染色一起撤掉），握拳换成张开的爪子
   */
  setClaws(on: boolean): void {
    if (on === this.clawed) return;
    this.clawed = on;
    const m = armMaterial();
    if (on) {
      // 发灰的暗绿：主要靠乘色（布纹、明暗都还在），只留一点点自发光让深色的手套不至于还是黑的
      m.color.setRGB(1.5, 2.3, 1.2);
      m.emissive.setRGB(0.014, 0.026, 0.01);
    } else {
      m.color.setRGB(1, 1, 1);
      m.emissive.setRGB(0, 0, 0);
    }
  }

  /** 现在是不是完全放下了（画面里没有东西） */
  get hidden(): boolean {
    return !this.root.visible;
  }

  private place(arm: Arm, left: boolean, p: readonly number[]): void {
    _q.setFromEuler(_e.set(p[3] as number, p[4] as number, p[5] as number, 'YXZ'));
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    // 掌心朝哪边：右手朝左，左手朝右
    _palm.set(left ? 1 : -1, 0, 0).applyQuaternion(_q);
    _t.set(p[0] as number, p[1] as number, p[2] as number);
    arm.solveTacz(left ? SHOULDER_L : SHOULDER_R, _t, _fwd, _palm, IDENT, ZERO, UPPER, FORE, 1.0, left ? POLE_L : POLE_R);
  }

  update(dt: number, f: MeleeFrame): void {
    const kind = f.kind;
    if (kind !== this.shown) {
      // 换了武器：旧的模型藏起来，从下面重新举上来
      if (this.shown && this.shown !== 'fists') {
        const old = this.models.get(this.shown);
        if (old) old.visible = false;
      }
      this.shown = kind;
      this.lower = 1;
    }
    const want = kind && f.up ? 0 : 1;
    // 举起来快、放下去稍慢
    const rate = want < this.lower ? 9 : 6;
    this.lower += Math.max(-rate * dt, Math.min(rate * dt, want - this.lower));
    if (!kind || this.lower >= 0.999) {
      this.root.visible = false;
      this.haveLast = false;
      return;
    }
    this.root.visible = true;
    const sp = MELEE[kind];
    const fists = kind === 'fists';
    if (!fists) {
      const m = this.models.get(kind as MeleeId);
      if (m) m.visible = true;
    }
    // 左手只有空手时出现：近战武器都是右手拿
    this.armL.root.visible = fists;
    if (fists && this.clawed) {
      // 爪子：手指张着、指尖往里勾，拇指撇开
      this.armR.setGrip(0.5, 30, 1.5, 1, 0);
      this.armL.setGrip(0.5, 30, 1.5, 1, 0);
    } else if (fists) {
      // 握拳：第一节弯得不多、后两节弯得多（整只手一起弯到 1.3 以上手指会穿进手掌）
      this.armR.setGrip(1.15, 0, 1.45, 1, 35);
      this.armL.setGrip(1.15, 0, 1.45, 1, 35);
    } else this.armR.setGrip(1.3, 0, 1.1, 1, 25);

    // ---- 走路的起伏、跑步时放低、转视角时滞后
    this.bobAmp += (Math.min(1, f.speed / 4.3) - this.bobAmp) * (1 - Math.exp(-10 * dt));
    this.bobT += dt * f.speed * 1.5;
    this.sprintK += ((f.sprinting && f.swing < 0 ? 1 : 0) - this.sprintK) * (1 - Math.exp(-9 * dt));
    if (this.haveLast && dt > 0) {
      let dy = f.yaw - this.lastYaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      else if (dy < -Math.PI) dy += Math.PI * 2;
      const k = 1 - Math.exp(-10 * dt);
      this.swayX += (Math.max(-0.05, Math.min(0.05, (dy / dt) * 0.011)) - this.swayX) * k;
      this.swayY += (Math.max(-0.04, Math.min(0.04, (-(f.pitch - this.lastPitch) / dt) * 0.011)) - this.swayY) * k;
    }
    this.lastYaw = f.yaw;
    this.lastPitch = f.pitch;
    this.haveLast = true;
    const bob = this.bobAmp * (1 + 0.8 * this.sprintK);
    const low = this.lower * this.lower * (3 - 2 * this.lower);
    const ox = this.swayX + Math.sin(this.bobT) * 0.012 * bob - 0.03 * this.sprintK;
    const oy = this.swayY + Math.sin(this.bobT * 2) * 0.01 * bob - 0.42 * low - 0.07 * this.sprintK;
    const oz = 0.05 * low + 0.05 * this.sprintK;
    const orx = -0.5 * low - 0.3 * this.sprintK;
    const orz = 0.35 * this.sprintK;

    if (fists) {
      // 左右拳轮流：出拳的那只手走 PUNCH，另一只收着
      const leftPunch = (f.combo & 1) === 1;
      const p = _pose;
      const o = _poseL;
      const rest = this.clawed ? CLAW_IDLE : GUARD;
      const back = this.clawed ? CLAW_BACK : GUARD_BACK;
      if (this.debugPose) {
        for (let i = 0; i < 6; i++) {
          p[i] = this.debugPose[i] as number;
          o[i] = rest[i] as number;
        }
      } else if (f.swing >= 0) {
        sample(this.clawed ? CLAW : PUNCH, f.swing, p);
        // 另一只手：出拳的前半段往回收一点
        const k = Math.sin(Math.min(1, f.swing * 1.6) * Math.PI);
        for (let i = 0; i < 6; i++) o[i] = (rest[i] as number) + ((back[i] as number) - (rest[i] as number)) * k;
      } else {
        for (let i = 0; i < 6; i++) p[i] = o[i] = rest[i] as number;
      }
      const r = leftPunch ? o : p;
      const l = leftPunch ? p : o;
      this.offset(r, ox, oy, oz, orx, orz, 1);
      this.place(this.armR, false, r);
      // 左手 = 右手的镜像：x、偏转、翻滚取反
      this.offset(l, 0, 0, 0, 0, 0, -1);
      this.offset(l, ox, oy, oz, orx, -orz, 1);
      this.place(this.armL, true, l);
      return;
    }

    const p = _pose;
    const heavy = sp.style === 'heavy';
    const keys = heavy ? HEAVY : sp.style === 'chop' ? CHOP : (f.combo & 1) === 1 ? SLASH_B : SLASH_A;
    if (this.debugPose) for (let i = 0; i < 6; i++) p[i] = this.debugPose[i] as number;
    else if (f.swing >= 0) sample(keys, f.swing, p);
    else {
      const idle = heavy ? IDLE_HEAVY : IDLE_1H;
      for (let i = 0; i < 6; i++) p[i] = idle[i] as number;
    }
    this.offset(p, ox, oy, oz, orx, orz, 1);
    this.place(this.armR, false, p);
  }

  /** 姿势上叠偏移；mirror = -1 时把 x、偏转、翻滚取反（左手） */
  private offset(p: number[], x: number, y: number, z: number, rx: number, rz: number, mirror: number): void {
    if (mirror < 0) {
      p[0] = -(p[0] as number);
      p[4] = -(p[4] as number);
      p[5] = -(p[5] as number);
      return;
    }
    p[0] = (p[0] as number) + x;
    p[1] = (p[1] as number) + y;
    p[2] = (p[2] as number) + z;
    p[3] = (p[3] as number) + rx;
    p[5] = (p[5] as number) + rz;
  }
}
