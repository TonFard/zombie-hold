import { Euler, Group, Matrix4, Quaternion, TextureLoader, Vector3, type Box3, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { compileClip, Pose, sampleChannel, type CompiledClip } from '../../render/tacz/anim';
import { placeholderTexture, TaczModel } from '../../render/tacz/model';
import { TACZ_SCALE } from '../../render/tacz/rig';
import type { Bone, Clip } from '../../render/tacz/types';
import { Arm } from '../../render/weapons/arms';

/**
 * 拿在手上用的东西（打针、抽烟、抹药、吃奶酪、手雷）的第一人称模型和动作。
 * 资源来自消耗品包（scripts/tools/stims-import.mjs → public/stims，只在本机有）：和枪一样是基岩版方块模型 + 关键帧动画，
 * 所以模型用主游戏的 TaczModel 建、片段用 anim.ts 采样；双手还是我们自己的程序手臂，跟着模型里的
 * righthand_pos / lefthand_pos 两块占位方块走（和 ViewModel 摆枪上的手是同一套办法）。
 *
 * 没导入过（public/stims 不存在）时 init() 什么都拿不到，has() 一律 false，武器模块就用通用的「把手放下」的动作。
 * 包里的声音不用：片段里只留了「什么时候该出声、哪一类」，由 onCue 交给武器模块自己合成。
 */

const DEG = Math.PI / 180;
const BASE = `${import.meta.env.BASE_URL}stims/`;
/** 和 ViewModel 摆 TACZ 枪上的手用的是同一组数：手臂是枪模比例的三倍、肩膀在镜头下方、上臂 / 前臂的长度、手腕最多弯多少 */
const ARM_K = TACZ_SCALE * 3;
const SHOULDER = { x: 9.5, y: -11.5, z: 6 };
const PX = (1 / 16) * TACZ_SCALE;
const UPPER = 0.3;
const FORE = 0.25;
const WRIST_BEND = 1.0;
/**
 * 画面里的手（手心）离镜头最近多远（视角模型的比例：平时手在 0.1 上下）。包里的动作是给方块手臂做的：抽烟那一口、
 * 咬奶酪那一口把手一直送到嘴边，换成有手指的手套以后四根手指会糊在脸上——凑得太近时把整个模型（连手带东西）顺着视线往前推。
 * 量过：0.3 太远（东西小得看不清），0.1 等于没推；取中间，往嘴边送的那两样再远一点。扔手雷不推
 */
const NEAR_DEFAULT = 0.17;
const NEAR: Record<string, number> = { cigars: 0.2, big_cheese: 0.21 };
/** 拿东西的手用的视野（度）的一半的正切、再放宽一成：判断一只手在不在画面里 */
const TAN_V = Math.tan((35 * Math.PI) / 180) * 1.1;
/** 手雷出手：throw 片段里手雷离开手的时刻（秒） */
const RELEASE_AT = 0.07;

/** 每样东西握着时手指的样子（弯曲、拇指张开、后两节、食指、拇指往里压）：右手、左手。没写的用默认（握住） */
const GRIP: Record<string, { R?: readonly number[]; L?: readonly number[] }> = {
  adrenaline_stim: { R: [1.05, 0, 1, 1, 10], L: [0.7, 10, 1, 1, 0] },
  hopium: { R: [1.05, 0, 1, 1, 10], L: [0.7, 10, 1, 1, 0] },
  big_cheese: { R: [0.55, 20, 0.8, 1, 0], L: [0.55, 20, 0.8, 1, 0] },
  golden_star: { R: [0.8, 10, 0.9, 1, 5], L: [0.8, 10, 0.9, 1, 5] },
  cigars: { R: [1.1, 0, 1.2, 1, 15], L: [0.95, 0, 1, 1, 10] },
  rgd_5: { R: [0.9, 5, 0.9, 1, 10], L: [0.8, 10, 1, 1, 0] },
};
const GRIP_DEFAULT: readonly number[] = [1, 0, 1, 1, 0];
/** 不画的骨骼（连同它下面的）：手雷挥出去时的三片「风」，在这里只是三块白色的长方形 */
const HIDE: Record<string, readonly string[]> = { rgd_5: ['bone2'] };

interface ViewJson {
  id: string;
  texture: { w: number; h: number };
  bones: Bone[];
  anims: Record<string, Clip>;
  /** 片段名 → [时刻（秒）, 哪一类声音] */
  marks?: Record<string, Array<[number, string]>>;
}

interface PackEntry {
  view: string;
  tex: string | null;
  clips: Record<string, number>;
  world?: string;
  size?: [number, number, number];
  /** 游戏里的物品 id */
  item?: string;
}

interface Manifest {
  items: Record<string, PackEntry>;
  hands?: Record<string, PackEntry>;
}

type ModelNode = Parameters<TaczModel['localMatrix']>[0];

const _m = new Matrix4();
const _t = new Matrix4();
const _pre = new Matrix4();
const _e = new Euler(0, 0, 0, 'ZYX');
const _v3 = [0, 0, 0];
const ONE = new Vector3(1, 1, 1);
const ZERO = new Vector3();
const IDENT = new Quaternion();
const _grip = new Vector3();
const _elbow = new Vector3();
const _palm = new Vector3();
const _fwd = new Vector3();
const _sh = new Vector3();
const _pole = new Vector3();

/** 一样东西：模型 + 片段。姿势每帧直接按时间采样（不走主游戏的 Track：那个每帧要分配东西） */
class ItemRig {
  readonly model: TaczModel;
  readonly clips = new Map<string, CompiledClip>();
  readonly marks: Record<string, Array<[number, string]>>;
  readonly cameraAnim = new Quaternion();
  private readonly pose: Pose;
  private readonly base: CompiledClip | null;
  private readonly nodes: ModelNode[] = [];
  private readonly vals: Array<Float32Array | null> = [];
  private readonly camV: Float32Array | null;
  private readonly idleT = new Vector3();
  private readonly idleQ = new Quaternion();
  private readonly hasIdle: boolean;
  private readonly hands: [Mesh | null, Mesh | null];

  constructor(json: ViewJson, tex: Texture) {
    this.model = new TaczModel(json, tex);
    this.model.root.matrixAutoUpdate = false;
    for (const name of HIDE[json.id] ?? []) this.model.setVisible(name, false);
    this.marks = json.marks ?? {};
    for (const [name, c] of Object.entries(json.anims)) this.clips.set(name, compileClip(name, c));
    this.base = this.clips.get('static_idle') ?? null;
    this.pose = new Pose(json.bones.map((b) => b.name));
    for (const [name, n] of this.model.nodes) {
      // camera 的通道给镜头用，不驱动模型
      if (name === 'camera' || name === 'constraint') continue;
      this.nodes.push(n);
      this.vals.push(this.pose.v.get(name) ?? null);
    }
    this.camV = this.pose.v.get('camera') ?? null;
    const inv = this.model.positioningInverse('idle_view', new Matrix4());
    this.hasIdle = !!inv;
    if (inv) inv.decompose(this.idleT, this.idleQ, new Vector3());
    const hand = (name: string): Mesh | null => (this.model.nodes.get(name)?.objs[0]?.children[0] as Mesh | undefined) ?? null;
    this.hands = [hand('righthand_pos'), hand('lefthand_pos')];
  }

  private write(clip: CompiledClip, time: number): void {
    const pose = this.pose;
    const chans = clip.chans;
    for (let i = 0; i < chans.length; i++) {
      const c = chans[i] as CompiledClip['chans'][number];
      sampleChannel(c.ch, time, _v3);
      pose.write(c.bone, c.k, _v3[0] as number, _v3[1] as number, _v3[2] as number, false);
    }
  }

  /** 摆成 clip 在 time 秒时的样子（底下垫着 static_idle），整个模型按 idle_view 放到镜头前；pre = 镜头空间里额外的变换 */
  apply(clip: CompiledClip | null, time: number, pre: Matrix4): void {
    this.pose.reset();
    if (this.base) this.write(this.base, 0);
    if (clip) this.write(clip, Math.min(time, clip.end));
    const model = this.model;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i] as ModelNode;
      model.localMatrix(n, this.vals[i] ?? null, _m);
      const objs = n.objs;
      for (let k = 0; k < objs.length; k++) (objs[k] as Object3D).matrix.copy(_m);
    }
    // 和 TaczRig.place 一样：缩到视角模型的比例、基岩版模型上下颠倒翻回来、idle_view 挪到相机上
    const G = model.root.matrix.copy(pre);
    G.multiply(_t.makeScale(TACZ_SCALE, TACZ_SCALE, TACZ_SCALE));
    G.multiply(_t.makeTranslation(0, 1.5, 0));
    G.multiply(_t.makeRotationZ(Math.PI));
    if (this.hasIdle) {
      G.multiply(_t.makeTranslation(0, 1.5, 0));
      G.multiply(_t.compose(this.idleT, this.idleQ, ONE));
      G.multiply(_t.makeTranslation(0, -1.5, 0));
    }
    model.root.matrixWorldNeedsUpdate = true;
    model.root.updateMatrixWorld(true);
    const v = this.camV;
    if (v) this.cameraAnim.setFromEuler(_e.set((v[3] as number) * DEG, (v[4] as number) * DEG, -(v[5] as number) * DEG, 'ZYX'));
    else this.cameraAnim.identity();
  }

  /** 手臂占位方块两头在镜头空间的位置（手掌那头、肘那头）和贴着东西的那一面的朝向；模型里没有这只手返回 false */
  handEnds(left: boolean, hand: Vector3, elbow: Vector3, palm: Vector3): boolean {
    const mesh = this.hands[left ? 1 : 0];
    if (!mesh) return false;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    hand.set(cx, b.min.y + 2 / 16, cz).applyMatrix4(mesh.matrixWorld);
    elbow.set(cx, b.max.y, cz).applyMatrix4(mesh.matrixWorld);
    palm.set(0, 0, -1).transformDirection(mesh.matrixWorld);
    return true;
  }
}

interface Seg {
  clip: CompiledClip | null;
  from: number;
  to: number;
}

export class ItemView {
  /** 挂在视角模型的场景里：两条手臂 + 现在用的那样东西 */
  readonly root = new Group();
  /** 片段里的镜头晃动：武器模块乘到世界相机上 */
  readonly cameraAnim = new Quaternion();
  /** 手雷出手的时刻（0–1，相对整段动作）；begin('…', 'toss') 以后有效 */
  release = 0.65;
  /** 一样东西的模型建好了（武器模块拿去上传贴图、预热） */
  onModel: ((obj: Object3D, tex: Texture | null) => void) | null = null;
  /** 片段播到该出声的地方了 */
  onCue: ((kind: string) => void) | null = null;

  private manifest: Manifest | null = null;
  /** 游戏里的物品 id → 包里的 id */
  private readonly byItem = new Map<string, string>();
  private readonly rigs = new Map<string, ItemRig | null>();
  private readonly armR = new Arm(false);
  private readonly armL = new Arm(true);
  private readonly loader = new TextureLoader();
  private cur: ItemRig | null = null;
  private curPack = '';
  private toss = false;
  private readonly segs: Seg[] = [
    { clip: null, from: 0, to: 1 },
    { clip: null, from: 0, to: 1 },
    { clip: null, from: 0, to: 1 },
  ];
  private segN = 0;
  private lastSeg = -1;
  private lastTime = -1;
  private cueGap = 0;
  /** 现在把模型往前推了多少（米，≤ 0） */
  private push = 0;
  /** 画面的宽高比（武器模块每帧给） */
  aspect = 16 / 9;

  constructor() {
    this.root.name = 'item-view';
    this.root.add(this.armR.root, this.armL.root);
    this.root.visible = false;
  }

  /**
   * 读 public/stims/manifest.json。没有这个目录时开发服务器会回一页 HTML，解析失败 = 没导入过，照常运行。
   * skip = 调试用（?stims=0）：故意去读一个不存在的清单，走的就是「没导入过」那条路
   */
  async init(skip = false): Promise<void> {
    try {
      const res = await fetch(`${BASE}manifest${skip ? '.none' : ''}.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const m = (await res.json()) as Manifest;
      if (!m || typeof m !== 'object' || !m.items) return;
      this.manifest = m;
      for (const [pack, e] of Object.entries(m.items)) if (e.item) this.byItem.set(e.item, pack);
    } catch {
      // 没导入过
      return;
    }
    // 六样东西的模型现在就全建好（还在加载画面后面）：第一次用就有，建模型的那几十毫秒也不落在玩的时候
    await Promise.all(Object.keys(this.manifest.items).map((pack) => this.load(pack)));
  }

  /** 这样东西有没有专门的手部模型 */
  has(item: string): boolean {
    return this.byItem.has(item);
  }

  /** 这样东西掉在地上的模型（没有返回 null） */
  worldUrl(item: string): string | null {
    const pack = this.byItem.get(item);
    const w = pack ? this.manifest?.items[pack]?.world : undefined;
    return w ? `${BASE}${w}` : null;
  }

  /**
   * 调试 / 截图：把清单里所有「掉在地上的模型」排成一排放进 parent（原点在这一排的中间，沿 +X 排开，间隔 gap 米）。
   * 返回每样的名字和清单里写的大小（米）。只在调试时调：每个模型多一次绘制
   */
  async debugRow(parent: Object3D, gap = 0.05): Promise<string[]> {
    const out: string[] = [];
    const m = this.manifest;
    if (!m) return out;
    const loader = new GLTFLoader();
    const list = Object.entries(m.items).filter((q) => q[1].world && q[1].size);
    let total = -gap;
    for (const q of list) total += (q[1].size as number[])[0] + gap;
    let x = -total / 2;
    for (const [pack, e] of list) {
      const size = e.size as [number, number, number];
      const gltf = await loader.loadAsync(`${BASE}${e.world}`);
      gltf.scene.position.set(x + size[0] / 2, 0, 0);
      gltf.scene.traverse((o) => {
        (o as Mesh).frustumCulled = false;
      });
      parent.add(gltf.scene);
      x += size[0] + gap;
      out.push(`${e.item ?? pack} ← ${pack}：${size.map((v) => (v * 100).toFixed(1)).join(' × ')} 厘米`);
    }
    return out;
  }

  /** 已经建好的模型（调试用） */
  loaded(): string[] {
    const out: string[] = [];
    for (const [k, v] of this.rigs) if (v) out.push(k);
    return out;
  }

  /** 建一样东西的模型。失败了只报一声：这样东西以后用通用的动作 */
  private async load(pack: string): Promise<void> {
    const e = this.manifest?.items[pack];
    if (!e || this.rigs.has(pack)) return;
    try {
      const res = await fetch(`${BASE}${e.view}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ViewJson;
      const tex = e.tex ? await this.loader.loadAsync(`${BASE}${e.tex}`) : placeholderTexture();
      const rig = new ItemRig(json, tex);
      this.rigs.set(pack, rig);
      this.onModel?.(rig.model.root, tex);
    } catch (err) {
      console.warn(`消耗品模型 ${pack} 加载失败`, err);
      this.rigs.set(pack, null);
    }
  }

  /**
   * 开始一段动作。kind = 'use'：掏出来 → 用 → 收起来；'toss'：拔保险销 → 扔。
   * 三段片段按比例压进整段动作里（掏和收最多各占一小段，中间的「用」拿剩下的）。
   * 没有这样东西 / 模型没建成返回 false
   */
  begin(item: string, kind: 'use' | 'toss', seconds: number): boolean {
    const pack = this.byItem.get(item);
    if (!pack) return false;
    const rig = this.rigs.get(pack);
    if (!rig) return false;
    const s = this.segs;
    const T = Math.max(0.1, seconds);
    if (kind === 'toss') {
      const pin = rig.clips.get('unlock_safe') ?? null;
      const thr = rig.clips.get('throw') ?? null;
      if (!pin || !thr) return false;
      const a = 0.58;
      (s[0] as Seg).clip = pin;
      (s[0] as Seg).from = 0;
      (s[0] as Seg).to = a;
      (s[1] as Seg).clip = thr;
      (s[1] as Seg).from = a;
      (s[1] as Seg).to = 1;
      this.segN = 2;
      this.release = a + (1 - a) * Math.min(1, RELEASE_AT / Math.max(0.05, thr.end));
    } else {
      const draw = rig.clips.get('draw') ?? null;
      const use = rig.clips.get('use') ?? null;
      const put = rig.clips.get('put_away') ?? null;
      if (!use) return false;
      const td = draw ? Math.min(draw.end, 0.22 * T) : 0;
      const tp = put ? Math.min(put.end, 0.15 * T) : 0;
      let n = 0;
      if (draw) {
        const q = s[n++] as Seg;
        q.clip = draw;
        q.from = 0;
        q.to = td / T;
      }
      const q = s[n++] as Seg;
      q.clip = use;
      q.from = td / T;
      q.to = 1 - tp / T;
      if (put) {
        const r = s[n++] as Seg;
        r.clip = put;
        r.from = 1 - tp / T;
        r.to = 1;
      }
      this.segN = n;
    }
    if (this.cur && this.cur !== rig) this.root.remove(this.cur.model.root);
    this.cur = rig;
    this.curPack = pack;
    this.toss = kind === 'toss';
    this.root.add(rig.model.root);
    this.lastSeg = -1;
    this.lastTime = -1;
    this.cueGap = 0;
    this.push = 0;
    this.cameraAnim.identity();
    return true;
  }

  /** 动作做完 / 被打断：藏起来 */
  end(): void {
    this.root.visible = false;
    this.cameraAnim.identity();
  }

  /** 每帧：k = 这段动作的进度 0–1 */
  update(dt: number, k: number): void {
    const rig = this.cur;
    if (!rig) return;
    this.root.visible = true;
    let si = 0;
    while (si < this.segN - 1 && k >= (this.segs[si] as Seg).to) si++;
    const seg = this.segs[si] as Seg;
    const clip = seg.clip;
    const u = Math.min(1, Math.max(0, (k - seg.from) / Math.max(1e-5, seg.to - seg.from)));
    const time = clip ? u * clip.end : 0;
    // 该出声的地方（片段被压得很快时别挤成一串）
    this.cueGap -= dt;
    if (si !== this.lastSeg) {
      this.lastSeg = si;
      this.lastTime = -1;
    }
    const marks = clip ? rig.marks[clip.name] : undefined;
    if (marks && this.onCue) {
      for (let i = 0; i < marks.length; i++) {
        const mk = marks[i] as [number, string];
        if (mk[0] > this.lastTime && mk[0] <= time && this.cueGap <= 0) {
          this.onCue(mk[1]);
          this.cueGap = 0.09;
        }
      }
    }
    this.lastTime = time;

    // 镜头空间里额外的变换：上一帧的镜头晃动；手雷没有「掏出来」那一段，开头自己从下面举上来
    _pre.makeRotationFromQuaternion(this.cameraAnim);
    if (this.toss && k < 0.16) {
      const r = 1 - k / 0.16;
      _pre.multiply(_t.makeTranslation(0, -0.3 * r * r, 0));
    }
    rig.apply(clip, time, _pre);
    this.cameraAnim.copy(rig.cameraAnim);

    // 画面里的手凑得太近：整个模型往前推（慢慢推过去、慢慢回来，不跳）
    const near = this.toss ? 0 : (NEAR[this.curPack] ?? NEAR_DEFAULT);
    let want = 0;
    if (near > 0) {
      for (let side = 0; side < 2; side++) {
        if (!rig.handEnds(side === 1, _grip, _elbow, _palm)) continue;
        const d = -_grip.z;
        // 贴着镜头 / 在镜头后面、或者在画面外（从下面伸上来的那一段）：不算
        if (d < 0.01 || Math.abs(_grip.y) > d * TAN_V || Math.abs(_grip.x) > d * TAN_V * this.aspect) continue;
        want = Math.min(want, d - near);
      }
    }
    this.push += (want - this.push) * (1 - Math.exp(-10 * dt));
    if (this.push < -1e-4) {
      const root = rig.model.root;
      (root.matrix.elements as number[])[14] = ((root.matrix.elements as number[])[14] as number) + this.push;
      root.matrixWorldNeedsUpdate = true;
      root.updateMatrixWorld(true);
    }

    const grip = GRIP[this.curPack];
    const inv = 1 / ARM_K;
    for (let side = 0; side < 2; side++) {
      const left = side === 1;
      const arm = left ? this.armL : this.armR;
      if (!rig.handEnds(left, _grip, _elbow, _palm)) {
        arm.root.visible = false;
        continue;
      }
      const h = (left ? grip?.L : grip?.R) ?? GRIP_DEFAULT;
      arm.root.visible = true;
      arm.root.scale.setScalar(ARM_K);
      arm.setGrip(h[0] as number, h[1] as number, h[2] as number, h[3] as number, h[4] as number);
      _fwd.subVectors(_grip, _elbow).normalize();
      const out = left ? -1 : 1;
      _sh.set(out * SHOULDER.x, SHOULDER.y, SHOULDER.z).multiplyScalar(PX * inv);
      _grip.multiplyScalar(inv);
      // 肘往下、往身体外侧弯
      _pole.set(out * 0.55, -1, 0.1);
      arm.solveTacz(_sh, _grip, _fwd, _palm, IDENT, ZERO, UPPER, FORE, WRIST_BEND, _pole);
    }
  }
}
