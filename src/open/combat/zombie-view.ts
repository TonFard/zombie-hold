import {
  AnimationMixer,
  BackSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DetachedBindMode,
  DoubleSide,
  Group,
  LoopOnce,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Skeleton,
  Sphere,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type SkinnedMesh,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Zed } from './zombie-brain';
import { ZKINDS, type ZKind } from './zombie-types';

/**
 * 丧尸的样子：public/zombies 里的蒙皮模型（和据点模式的 ?zombies=glb 是同一批文件）。
 * 据点模式的 src/render/actors/zombie-glb.ts 没法直接用（它只在 ?zombies=glb 时加载、一次加载全部 22 种外观、要据点模式的 Zombie 对象），
 * 这里照它的做法另写一份，多了开放世界要的几样省事的办法：
 *
 *   1. 只加载用到的外观（USE），开局全部建好、贴图传上显卡、着色器跟着 main.ts 的 precompile 一起编译；之后只是从池子里拿 / 放回。
 *   2. 骨架不挂在场景里（网格用 DetachedBindMode）。丧尸走动只改一个 Group 的位置；
 *      骨骼的世界矩阵、骨骼贴图只在「这一帧要动动画」时才算（three 默认每帧每只都算一遍）。
 *   3. 动画按远近分档：画面里最近的十来只每帧都动，再远的每秒只动 30 / 20 / 12 / 6 次（时间攒着一起走），画面外的不动。
 *   4. 三档细节按距离换，最精细的那一档和投影子的都有只数上限；发光的眼睛只在近处画（每只是一次绘制）。
 */

type ClipName = 'idle' | 'punching' | 'reaction_hit' | 'death' | 'dying' | 'run' | 'walk' | 'crawl';
interface ClipInfo {
  dur: number;
  impact: number;
  /** 原地播放的走 / 跑 / 爬对应的前进速度（米/秒，模型不缩放时） */
  speed?: number;
}
interface VariantInfo {
  id: string;
  kind: string;
  file: string;
  clips: Partial<Record<ClipName, ClipInfo>>;
}

/** 模型放在哪（用到的时候才拼：不开浏览器的测试脚本里没有 import.meta.env） */
const base = (): string => `${import.meta.env.BASE_URL}zombies/`;

/** 每类用哪几个外观。行尸最多，多放几个样子；a / b / e 只有一张颜色贴图，最省。母体没有自己的模型：用行尸的，放大到 1.15 倍 */
const USE: Record<ZKind, readonly string[]> = {
  walker: ['walker_a', 'walker_b', 'walker_c', 'walker_e'],
  runner: ['runner_a', 'runner_b'],
  crawler: ['crawler_a'],
  bloater: ['bloater_a'],
  armored: ['armored_a'],
  mother: [],
};
/**
 * 开局每个外观先建几只：一共 60 只（行尸 36、奔袭者 16、爬行者 4、肿胀者 2、重装 2），和 horde.ts 的硬上限一样多。
 * 不够时运行中再建，一帧最多建一只（一只半毫秒到一毫秒）。池子大小不影响绘制次数：画多少只看的是场上有多少只
 */
const PREBUILD: Record<ZKind, number> = { walker: 9, runner: 8, crawler: 4, bloater: 2, armored: 2, mother: 0 };
/** 模型身高 1.75 米；各类的缩放 [宽, 高]（和 zombie-glb.ts 的 GLB_SCALE 一样） */
const SCALE: Record<ZKind, [number, number]> = { walker: [1.04, 1.04], runner: [0.98, 1.02], crawler: [1, 1], bloater: [1.3, 1.06], armored: [1.16, 1.1], mother: [1.15, 1.15] };
const MOVE_CLIP: Record<ZKind, ClipName> = { walker: 'run', runner: 'run', crawler: 'crawl', bloater: 'walk', armored: 'walk', mother: 'run' };
/** 移动动作的播放速度上下限：走路动作本身很慢，慢的要加快放；太快会像快进 */
const RATE: Record<ZKind, [number, number]> = { walker: [0.45, 1.1], runner: [0.6, 1.6], crawler: [1, 4.5], bloater: [0.8, 2.6], armored: [0.8, 2.8], mother: [0.5, 1.75] };
/** 细节档的切换距离（米） */
const LOD_DIST = [9, 22];

// 动作的槽位（每只丧尸一个定长数组，不用 Map：每帧要过一遍）
const IDLE = 0;
const MOVE = 1;
const PUNCH = 2;
const REACT = 3;
const DEATH = 4;
const DYING = 5;
const NCLIP = 6;

const propsMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.45 });
const glowMat = new MeshBasicMaterial({ vertexColors: true, color: new Color(2.2, 2.2, 2.2), toneMapped: false });
/** 倒地动作会把身体带离原点 1 米多：包围球放大，不然尸体在画面边上会被剔除掉 */
const BOUNDS = new Sphere(new Vector3(0, 0.9, 0), 2.4);
const HEAD_REACH = 0.26;
const HEAD_WEIGHT = 0.2;
const HAIR_WEIGHT = 0.1;
const NECK_R = 0.11;
/** 脖子的断面：一小截暗红的圆台，半埋在收拢的领口里 */
const stumpGeo = new CylinderGeometry(0.026, 0.044, 0.04, 8).translate(0, 0.006, 0);
const stumpMat = new MeshStandardMaterial({ color: 0x3a0707, roughness: 0.45 });
const _bind = new Matrix4();
const _target = new Float32Array(NCLIP);
const ONE = new Vector3(1, 1, 1);
const skeletonUpdate = Skeleton.prototype.update;
const NOOP = (): void => {};
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

interface Variant {
  id: string;
  kind: ZKind;
  scene: Object3D;
  /** 按槽位排；这个外观没有的动作是 null */
  clips: (AnimationClip | null)[];
  /** 移动动作原地播放时对应的前进速度（米/秒，已经乘上缩放） */
  moveSpeed: number;
  /** 去掉头的几何体（按细节档） */
  headless: BufferGeometry[];
  free: ZView[];
}

/**
 * 去掉头的几何体：顶点数据和原来的共用，只换一份索引 —— 绑定姿势下高过头骨骼、或者明显绑在头骨骼上的三角形都不要
 * （光把脖子骨骼缩没不够：长头发、兜帽尖有一半绑在肩膀上，会留在原地）。做法和 zombie-glb.ts 的 headlessOf 一样
 */
function headless(m: SkinnedMesh): BufferGeometry {
  const src = m.geometry;
  const bones = m.skeleton.bones;
  const hi = bones.findIndex((b) => /Head$/.test(b.name));
  const index = src.index;
  const pos = src.getAttribute('position');
  if (hi < 0 || !index) return src;
  _bind.copy(m.skeleton.boneInverses[hi] as Matrix4).invert().premultiply(m.bindMatrixInverse);
  const hx = _bind.elements[12];
  const hy = _bind.elements[13];
  const hz = _bind.elements[14];
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const ni = bones.findIndex((b) => /Neck$/.test(b.name));
  if (ni >= 0) _bind.copy(m.skeleton.boneInverses[ni] as Matrix4).invert().premultiply(m.bindMatrixInverse);
  const nx = _bind.elements[12];
  const nz = _bind.elements[14];
  const cut = new Uint8Array(pos.count);
  for (let k = 0; k < pos.count; k++) {
    if (pos.getY(k) > hy && Math.hypot(pos.getX(k) - hx, pos.getZ(k) - hz) < HEAD_REACH) cut[k] = 1;
    else {
      let w = 0;
      for (let c = 0; c < 4; c++) if (si.getComponent(k, c) === hi) w += sw.getComponent(k, c);
      // 披在背后的长头发、毛领：头骨骼的权重不大，但在脖子后面，离脖子的轴线又比脖子粗
      if (w >= HEAD_WEIGHT || (w >= HAIR_WEIGHT && pos.getZ(k) < nz && Math.hypot(pos.getX(k) - nx, pos.getZ(k) - nz) > NECK_R)) cut[k] = 1;
    }
  }
  const keep: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k);
    const b = index.getX(k + 1);
    const c = index.getX(k + 2);
    if (!cut[a] && !cut[b] && !cut[c]) keep.push(a, b, c);
  }
  const g = new BufferGeometry();
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.getAttribute(name));
  g.setIndex(keep);
  g.boundingSphere = BOUNDS;
  return g;
}

function prepare(kind: ZKind, info: VariantInfo, scene: Object3D, anims: AnimationClip[]): Variant {
  scene.updateMatrixWorld(true);
  const lods: SkinnedMesh[] = [];
  scene.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isMesh) return;
    m.geometry.boundingSphere = BOUNDS;
    m.boundingSphere = BOUNDS;
    m.frustumCulled = true;
    m.castShadow = false;
    // 屋里、树下要暗下去（不接阴影的话站在屋里的丧尸像被太阳直射）；发光的眼睛不用
    m.receiveShadow = m.name !== 'glow';
    if (m.name === 'props') m.material = propsMat;
    else if (m.name === 'glow') m.material = glowMat;
    else {
      const mat = m.material as MeshStandardMaterial;
      // 模型是空心的单层壳，身上有开口（腋下、切开的衣摆）：只画正面的话从开口直接看到背景。两面都画；阴影照旧只画背面
      mat.side = DoubleSide;
      mat.shadowSide = BackSide;
      mat.transparent = false;
      mat.depthWrite = true;
      // 有的模型（walker_e）导出时金属度是 1、却没带金属度贴图：纯金属没有漫反射，只反射环境，
      // 雨天、雪天环境光一压暗，整只就成了一团黑影。没有贴图的一律按不是金属算
      if (!mat.metalnessMap) mat.metalness = 0;
      if (!mat.roughnessMap) mat.roughness = Math.min(mat.roughness, 0.9);
      const hit = /^lod(\d)$/.exec(m.name);
      if (hit) lods[Number(hit[1])] = m;
    }
  });
  const byName = new Map<string, AnimationClip>();
  for (const c of anims) byName.set(c.name.replace(/^zombie_/, ''), c);
  const move = MOVE_CLIP[kind];
  const names: ClipName[] = ['idle', move, 'punching', 'reaction_hit', 'death', 'dying'];
  return {
    id: info.id,
    kind,
    scene,
    clips: names.map((n) => byName.get(n) ?? null),
    moveSpeed: (info.clips[move]?.speed ?? 1) * SCALE[kind][1],
    headless: lods.map((m) => headless(m)),
    free: [],
  };
}

/** 一只丧尸的模型（池子里循环用） */
export class ZView {
  /** 在场景里的只有它：位置、朝向、缩放 */
  readonly group = new Group();
  /** 骨架（不在场景里，矩阵自己算） */
  private readonly rig: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly lods: SkinnedMesh[] = [];
  private readonly whole: BufferGeometry[] = [];
  private readonly glow: SkinnedMesh | null;
  private readonly all: SkinnedMesh[];
  private readonly skeletons: Skeleton[] = [];
  private readonly acts: (AnimationAction | null)[] = [];
  private readonly dur = new Float32Array(NCLIP);
  private readonly w = new Float32Array(NCLIP);
  private readonly head: Bone | null;
  private readonly neck: Bone | null;
  private readonly hips: Bone | null;
  private readonly stump: Mesh;
  /** 断面相对脖子上一级骨骼的位置（死的那一刻脖子的姿势） */
  private readonly stumpAt = new Matrix4();
  /** 这几个跟着「现在是哪一种丧尸」走（母体借的是行尸的外观），start() 里定 */
  private rate0 = 1;
  private rate1 = 1;
  private moveSpeed = 1;
  private sw = 1;
  private sh = 1;
  /** 现在显示的是哪一档细节（-1 = 还没定） */
  lod = -1;
  casting = false;
  /** 刚从池子里拿出来：第一帧直接到位，不从上一只的姿势混过来 */
  fresh = true;
  /** 攒着还没走的动画时间 */
  pending = 0;
  /** 0–1：隔一阵才动一次动画的那些用它错开，不会挤在同一帧 */
  phase = 0;
  // ---- 尸体
  private deadAct = -1;
  deadT = 0;
  /** 倒地动作什么时候放完 */
  deadEnd = 0;
  settled = false;
  /** 躺多久以后开始往地里沉 */
  life = 0;
  sunk = 0;

  constructor(readonly variant: Variant) {
    const root = cloneSkinned(variant.scene);
    this.rig = root;
    const meshes: SkinnedMesh[] = [];
    const found: { head?: Bone; neck?: Bone; hips?: Bone } = {};
    root.traverse((o) => {
      // 加载器会把骨骼名里的冒号去掉（mixamorig:Neck → mixamorigNeck）
      if ((o as Bone).isBone) {
        if (/Head$/.test(o.name)) found.head = o as Bone;
        else if (/Neck$/.test(o.name)) found.neck = o as Bone;
        else if (/Hips$/.test(o.name)) found.hips = o as Bone;
      } else if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
    });
    this.head = found.head ?? null;
    this.neck = found.neck ?? null;
    this.hips = found.hips ?? null;
    this.all = meshes;
    let glow: SkinnedMesh | null = null;
    const first = (meshes[0] as SkinnedMesh).skeleton;
    for (const m of meshes) {
      // 克隆出来每个网格各有一副 Skeleton（骨骼是同一批）：合成一副，骨骼矩阵一帧只算一次、只传一张骨骼贴图
      const sk = m.skeleton;
      if (sk !== first && sk.boneInverses === first.boneInverses && sk.bones.length === first.bones.length && sk.bones.every((b, i) => b === first.bones[i])) m.skeleton = first;
      if (!this.skeletons.includes(m.skeleton)) this.skeletons.push(m.skeleton);
      // 骨架不跟着网格走：网格在 group 里（会动），骨骼的矩阵留在模型自己的坐标系里
      m.bindMode = DetachedBindMode;
      m.matrixAutoUpdate = false;
      m.visible = false;
      this.group.add(m);
      const hit = /^lod(\d)$/.exec(m.name);
      if (hit) {
        this.lods[Number(hit[1])] = m;
        this.whole[Number(hit[1])] = m.geometry;
      } else if (m.name === 'glow') glow = m;
      else m.visible = true;
    }
    this.glow = glow;
    // three 每帧会对画出来的蒙皮网格调一次 skeleton.update()：换成空的，什么时候算由 flush() 说了算
    for (const sk of this.skeletons) sk.update = NOOP;
    this.stump = new Mesh(stumpGeo, stumpMat);
    this.stump.matrixAutoUpdate = false;
    this.stump.visible = false;
    this.group.add(this.stump);
    this.group.visible = false;
    this.mixer = new AnimationMixer(root);
    variant.clips.forEach((clip, i) => {
      if (!clip) {
        this.acts[i] = null;
        return;
      }
      const a = this.mixer.clipAction(clip);
      this.dur[i] = clip.duration;
      // 活着时用的四个动作一直开着，靠权重切换；倒地的两个到死的时候才放
      if (i < DEATH) {
        a.enabled = true;
        a.setEffectiveWeight(0);
        a.play();
      }
      this.acts[i] = a;
    });
  }

  /** 从池子里拿出来给一只新丧尸用。kind = 这只丧尸是哪一种（和外观的种类不一样时按它定个头、步子） */
  start(seed: number, kind: ZKind = this.variant.kind): void {
    const [w, h] = SCALE[kind];
    [this.rate0, this.rate1] = RATE[kind];
    // 个头不一样，迈一步走的距离跟着变
    this.moveSpeed = (this.variant.moveSpeed * h) / SCALE[this.variant.kind][1];
    // 个头差一点：一群里不会一样高
    const k = 0.96 + 0.08 * (((seed >>> 8) % 1000) / 1000);
    this.sw = w * k;
    this.sh = h * k;
    this.group.scale.set(this.sw, this.sh, this.sw);
    // 每只从动作的不同位置开始：不会齐步走
    const t = (seed % 997) / 997;
    for (const i of [IDLE, MOVE]) {
      const a = this.acts[i];
      if (a) {
        a.time = t * (this.dur[i] as number);
        a.timeScale = 1;
      }
    }
    this.phase = ((seed >>> 3) % 64) / 64;
    this.fresh = true;
    this.pending = 0;
    this.w.fill(0);
    this.group.visible = true;
  }

  /** 放回池子：把死的时候改的东西都改回来 */
  reset(): void {
    this.group.visible = false;
    if (this.deadAct >= 0) (this.acts[this.deadAct] as AnimationAction).stop();
    this.deadAct = -1;
    this.deadT = 0;
    this.settled = false;
    this.sunk = 0;
    if (this.stump.visible) {
      this.stump.visible = false;
      if (this.neck) this.neck.scale.setScalar(1);
      this.lods.forEach((m, i) => {
        m.geometry = this.whole[i] as BufferGeometry;
      });
    }
    this.setShadow(false);
    this.lod = -1;
    for (const m of this.lods) m.visible = false;
    if (this.glow) this.glow.visible = false;
  }

  place(x: number, y: number, z: number, yaw: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  /** 按距离换细节档（换的时候留一点余量，免得在分界上来回跳）。r0 = 多远以内用最精细的那一档 */
  setLod(dist: number, glow: boolean, r0: number): void {
    const d = dist / Math.max(1, this.sh);
    const r1 = LOD_DIST[1] as number;
    let i = this.lod;
    if (i < 0) i = d < r0 ? 0 : d < r1 ? 1 : 2;
    else {
      while (i < 2 && d > (i ? r1 : r0) * 1.06) i++;
      while (i > 0 && d < (i > 1 ? r1 : r0) * 0.94) i--;
    }
    if (i !== this.lod) {
      this.lod = i;
      this.lods.forEach((m, k) => {
        m.visible = k === i;
      });
    }
    if (this.glow) this.glow.visible = glow && this.deadAct < 0 && !this.settled;
  }

  setShadow(on: boolean): void {
    if (on === this.casting) return;
    this.casting = on;
    for (const m of this.all) if (m !== this.glow) m.castShadow = on;
  }

  /** 这个动作停在 frac（0–1）的位置上，占 w 的权重；返回剩下的权重 */
  private take(i: number, w: number, frac: number, rest: number): number {
    const a = this.acts[i] as AnimationAction;
    a.timeScale = 0;
    a.time = clamp(frac, 0, 0.999) * (this.dur[i] as number);
    _target[i] = w * rest;
    return rest * (1 - w);
  }

  /** 权重往 _target 靠拢 */
  private blend(step: number, rate: number): void {
    const k = Math.min(1, step * rate);
    const w = this.w;
    for (let i = 0; i < NCLIP; i++) {
      const a = this.acts[i];
      if (!a) continue;
      const next = (w[i] as number) + ((_target[i] as number) - (w[i] as number)) * k;
      w[i] = next;
      a.setEffectiveWeight(next < 0.002 ? 0 : next);
    }
  }

  /** 走一步动画（step 秒）并把骨骼矩阵算出来 */
  animate(z: Zed, step: number): void {
    if (this.fresh) step = 100;
    this.fresh = false;
    const a = this.acts;
    _target.fill(0);
    const move = a[MOVE];
    // 走到闲逛速度的一半就算「在走」：站着晃和迈步之间按速度混
    const moving = Math.min(1, z.sp / (z.spec.roam * 0.5));
    if (move) move.timeScale = clamp(z.sp / this.moveSpeed, this.rate0, this.rate1);
    let rest = 1;
    const stagger = z.state === 'stagger';
    if (a[REACT]) {
      // 硬直：停在受击动作里身体后仰的那一下；普通受击只是抖一下
      if (stagger) rest = this.take(REACT, 0.85, 0.22 + 0.04 * Math.sin(this.mixer.time * 5), rest);
      else if (z.flinch > 0) rest = this.take(REACT, 0.6 * z.flinch, 0.1 + 0.14 * (1 - z.flinch), rest);
    }
    // 出手：z.atk 和动作的进度是一比一的（PUNCH_HIT = 手伸到最前面的那一帧）
    if (z.atk >= 0 && a[PUNCH]) rest = this.take(PUNCH, 1, z.atk, rest);
    if (a[IDLE]) {
      _target[MOVE] = rest * moving;
      _target[IDLE] = rest * (1 - moving);
    } else {
      // 爬行者只有爬的动作：停下来时放慢，扑咬时加快，硬直时几乎停住
      _target[MOVE] = 1;
      if (move) move.timeScale = stagger ? 0.15 : z.atk >= 0 ? 4 : Math.max(0.5, move.timeScale * (0.3 + 0.7 * moving));
    }
    this.blend(step, z.atk >= 0 ? 18 : 10);
    this.mixer.update(Math.min(step, 0.25));
    this.flush();
  }

  /** 骨骼贴图现在就建好、传上显卡（不然要等这只第一次被画到的那一帧） */
  upload(renderer: WebGLRenderer): void {
    for (const sk of this.skeletons) {
      if (!sk.boneTexture) sk.computeBoneTexture();
      if (sk.boneTexture) renderer.initTexture(sk.boneTexture);
    }
  }

  /** 骨骼的矩阵 → 骨骼贴图 */
  flush(): void {
    this.rig.updateMatrixWorld(true);
    for (const sk of this.skeletons) skeletonUpdate.call(sk);
    if (this.stump.visible && this.neck?.parent) this.stump.matrix.multiplyMatrices(this.neck.parent.matrixWorld, this.stumpAt);
  }

  /**
   * 倒地：有倒地动作的放动作（从背后打死的往前扑，别的往后倒），爬行者直接趴住不动。
   * 爆头打死的换成去掉头的几何体，再把脖子骨骼缩没：剩下的脖子、领口收到脖子根，把切口合上
   */
  die(z: Zed): void {
    if (z.head && this.neck) {
      this.stumpAt.compose(this.neck.position, this.neck.quaternion, ONE);
      this.neck.scale.setScalar(0.001);
      this.stump.visible = true;
      this.lods.forEach((m, i) => {
        m.geometry = this.variant.headless[i] ?? (this.whole[i] as BufferGeometry);
      });
    }
    if (this.glow) this.glow.visible = false;
    this.deadT = 0;
    this.settled = false;
    this.sunk = 0;
    this.pending = 0;
    const i = this.acts[z.fallFwd ? DYING : DEATH] ? (z.fallFwd ? DYING : DEATH) : this.acts[DEATH] ? DEATH : this.acts[DYING] ? DYING : -1;
    this.deadAct = i;
    if (i < 0) {
      this.deadEnd = 0;
      return;
    }
    const a = this.acts[i] as AnimationAction;
    a.reset();
    a.setLoop(LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1.35;
    // 动作开头有一小段还站着：跳过去，中枪就倒
    a.time = 0.12 * (this.dur[i] as number);
    if (this.fresh) {
      this.fresh = false;
      this.w.fill(0);
      this.w[i] = 1;
    }
    a.setEffectiveWeight(this.w[i] as number);
    a.play();
    this.deadEnd = ((this.dur[i] as number) * 0.88) / 1.35 + 0.3;
  }

  /** 尸体走一步动画 */
  animateDead(step: number): void {
    _target.fill(0);
    if (this.deadAct >= 0) _target[this.deadAct] = 1;
    else {
      const m = this.acts[MOVE];
      _target[MOVE] = 1;
      if (m) m.timeScale = 0;
    }
    this.blend(step, 14);
    this.mixer.update(Math.min(step, 0.25));
    this.flush();
  }

  /**
   * 命中体积用的两个点（世界坐标）：out = [头的球心 x, y, z, 髋 x, y, z]。跟着现在的动作走（弯腰、前扑、挨打后仰时头都在该在的地方）。
   * 头骨骼的原点在下巴后面的关节上，球心沿骨骼方向再往上 0.1 米（清单里量头的位置也是这么算的）
   */
  volumes(z: Zed, out: Float32Array): boolean {
    if (!this.head || !this.hips || this.fresh) return false;
    const c = Math.cos(z.yaw);
    const s = Math.sin(z.yaw);
    const h = this.head.matrixWorld.elements;
    const k = 0.1 / (Math.hypot(h[4], h[5], h[6]) || 1);
    let mx = h[12] + h[4] * k;
    let mz = h[14] + h[6] * k;
    out[0] = z.x + (mx * c + mz * s) * this.sw;
    out[1] = z.y + (h[13] + h[5] * k) * this.sh;
    out[2] = z.z + (mz * c - mx * s) * this.sw;
    const p = this.hips.matrixWorld.elements;
    mx = p[12];
    mz = p[14];
    out[3] = z.x + (mx * c + mz * s) * this.sw;
    out[4] = z.y + p[13] * this.sh;
    out[5] = z.z + (mz * c - mx * s) * this.sw;
    return true;
  }

  /** 开局预热：所有网格都画出来（把几何体传上显卡），不做视锥剔除 */
  showcase(on: boolean): void {
    this.group.visible = on;
    for (const m of this.all) {
      m.visible = on;
      m.frustumCulled = !on;
      m.castShadow = on && m !== this.glow;
    }
    this.stump.visible = on;
    this.stump.frustumCulled = !on;
    this.casting = on;
    this.lod = -1;
    if (on) {
      this.group.position.y = -500;
      this.flush();
    } else {
      // 装备（props）平时一直跟着身体显示；各档身体和眼睛等 setLod 来开
      for (const m of this.all) m.visible = m !== this.glow && !this.lods.includes(m);
    }
  }
}

/** 所有丧尸的模型：池子、每帧的细节档 / 动画节拍、尸体 */
export class ZombieViews {
  private readonly byKind: Record<ZKind, Variant[]> = { walker: [], runner: [], crawler: [], bloater: [], armored: [], mother: [] };
  private readonly corpses: ZView[] = [];
  private readonly warming: ZView[] = [];
  private warm = 3;
  /** 这一帧还能新建几只模型 */
  private builds = 1;
  // ---- 画质
  /** 每帧都动动画的最多几只（画面里最近的那几只） */
  private fullN = 12;
  /** 最精细的那一档（一万一千个三角形）最多几只；一群围上来时不会几十只全是最精细的 */
  private lod0N = 8;
  /** 投影子的最多几只、最远多远 */
  private shadowN = 10;
  private shadowMax = 26;
  /** 草稿：每只离相机多远、在不在画面里；所有的距离、画面里的距离（排序用） */
  private dOf = new Float32Array(64);
  private seenOf = new Uint8Array(64);
  private dAll = new Float32Array(64);
  private dSeen = new Float32Array(64);
  private maxCorpses = 12;
  private k = 1;
  private glowK = -1;
  // ---- 相机
  private readonly vm = new Float64Array(16);
  private tanX = 1;
  private tanY = 1;
  private secX = 1;
  private secY = 1;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  /** 调试 / 量性能：这一帧动了几只的骨架、画面里几只、尸体几具、池子里一共建了几只 */
  readonly info = { anim: 0, shown: 0, corpses: 0, built: 0, loadMs: 0, buildMs: 0 };

  private constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
    variants: Variant[],
  ) {
    const t0 = performance.now();
    for (const v of variants) this.byKind[v.kind].push(v);
    // 没加载出来的种类用行尸的样子顶上
    for (const k of ZKINDS) if (!this.byKind[k].length) this.byKind[k] = this.byKind.walker;
    for (const v of variants) {
      for (let i = 0; i < PREBUILD[v.kind]; i++) v.free.push(this.build(v));
      // 每个外观留一只做开局预热
      const w = v.free.pop() as ZView;
      w.showcase(true);
      this.warming.push(w);
    }
    this.info.buildMs = Math.round(performance.now() - t0);
  }

  /** 加载用到的外观，建好池子。贴图在这里就传上显卡；着色器由 main.ts 随后的 precompile 编译（它会遍历场景里所有网格，包括没显示的） */
  static async load(scene: Scene, renderer: WebGLRenderer): Promise<ZombieViews> {
    const t0 = performance.now();
    const BASE = base();
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`丧尸模型清单加载失败（${res.status}）`);
    const man = (await res.json()) as { variants: VariantInfo[] };
    const loader = new GLTFLoader();
    const jobs: Promise<Variant | null>[] = [];
    for (const kind of ZKINDS) {
      for (const id of USE[kind]) {
        const info = man.variants.find((v) => v.id === id);
        if (!info) continue;
        jobs.push(
          loader.loadAsync(`${BASE}${info.file}`).then(
            (g) => prepare(kind, info, g.scene, g.animations),
            (e: unknown) => {
              console.warn(`[horde] 丧尸模型 ${id} 加载失败`, e);
              return null;
            },
          ),
        );
      }
    }
    const list = (await Promise.all(jobs)).filter((v): v is Variant => v !== null);
    if (!list.some((v) => v.kind === 'walker')) throw new Error('丧尸模型没加载出来');
    for (const v of list) {
      v.scene.traverse((o) => {
        const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
        if (!mat || Array.isArray(mat)) return;
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap]) if (t) renderer.initTexture(t);
      });
    }
    const ms = Math.round(performance.now() - t0);
    const views = new ZombieViews(scene, renderer, list);
    views.info.loadMs = ms;
    return views;
  }

  private build(v: Variant): ZView {
    const z = new ZView(v);
    this.scene.add(z.group);
    // 骨骼贴图现在就传上显卡（开局建的、运行中补建的都一样），不留到它第一次被画到的那一帧
    z.upload(this.renderer);
    this.info.built++;
    return z;
  }

  /**
   * 拿一只这个种类的模型：先要按种子定的那个外观，没有现成的就拿同一类里别的外观（一波放几十只的时候不用现建），
   * 都没有才新建。这一帧已经新建过一只了就返回 null（调用方下一帧再来）；force = 一定要（调试用）
   */
  acquire(kind: ZKind, seed: number, force = false): ZView | null {
    const list = this.byKind[kind];
    const n = list.length;
    const want = list[seed % n] as Variant;
    let v = want.free.pop();
    for (let k = 1; !v && k < n; k++) v = (list[(seed + k) % n] as Variant).free.pop();
    if (!v && (this.builds > 0 || force)) {
      this.builds--;
      v = this.build(want);
    }
    if (!v) return null;
    v.start(seed, kind);
    return v;
  }

  release(v: ZView): void {
    v.reset();
    v.variant.free.push(v);
  }

  setQuality(k: number): void {
    this.k = k;
    this.fullN = Math.max(5, Math.round(12 * k));
    this.lod0N = Math.max(3, Math.round(8 * k));
    this.shadowN = k >= 0.7 ? Math.round(10 * k) : 0;
    this.shadowMax = k >= 0.85 ? 26 : k >= 0.7 ? 16 : 0;
    this.maxCorpses = Math.max(5, Math.round(12 * k));
  }

  /** 每帧开头：记下相机（后面判断「在不在画面里」用） */
  look(camera: PerspectiveCamera): void {
    const e = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) this.vm[i] = e[i] as number;
    this.tanY = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
    this.tanX = this.tanY * camera.aspect;
    this.secX = Math.hypot(1, this.tanX);
    this.secY = Math.hypot(1, this.tanY);
    this.cx = camera.position.x;
    this.cy = camera.position.y;
    this.cz = camera.position.z;
    this.builds = 1;
  }

  /** 以 (x, y, z) 为球心、半径 r 的球在不在画面里（只看视锥，不管被没被挡住） */
  sees(x: number, y: number, z: number, r: number): boolean {
    const m = this.vm;
    const vx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    const vy = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    const d = -((m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number));
    if (d < -r) return false;
    return Math.abs(vx) - r * this.secX < d * this.tanX && Math.abs(vy) - r * this.secY < d * this.tanY;
  }

  /** 一只丧尸死了：模型转成尸体，躺 life 秒以后沉进地里 */
  kill(z: Zed, life: number): void {
    const v = z.view as ZView | null;
    if (!v) return;
    z.view = null;
    v.place(z.x, z.y, z.z, z.yaw);
    v.die(z);
    v.life = life;
    this.corpses.push(v);
    // 尸体太多：最早的那具现在就开始沉
    if (this.corpses.length > this.maxCorpses) {
      const old = this.corpses[0] as ZView;
      old.life = Math.min(old.life, old.deadT);
    }
  }

  update(dt: number, zeds: readonly Zed[], night: number): void {
    const info = this.info;
    info.anim = 0;
    info.shown = 0;
    if (this.warm > 0) {
      // 开局头几帧：每种外观各一只放在脚下的地底（看不见），所有细节档、装备、断面都画一遍，把几何体传上显卡，
      // 蒙皮的阴影着色器也在这时候编译（不然第一只丧尸走进画面的那一帧会卡一下）
      for (const w of this.warming) w.place(this.cx, this.cy - 12, this.cz, 0);
      if (--this.warm === 0) {
        for (const w of this.warming) {
          w.showcase(false);
          w.variant.free.push(w);
        }
        this.warming.length = 0;
      }
    }
    // 眼睛的亮度：白天不发光（大太阳底下两个亮点很假），天擦黑开始慢慢亮起来，夜里全亮
    const gk = Math.round(Math.min(1, Math.max(0, (night - 0.05) / 0.55)) * 2.4 * 20) / 20;
    if (gk !== this.glowK) {
      this.glowK = gk;
      glowMat.color.setScalar(gk);
    }
    // 眼睛：白天十几米外就看不出来了，夜里远远的两点亮光要留着
    const glowR = gk <= 0 ? 0 : night > 0.5 ? 45 : 14;
    // 先量一遍：每只离相机多远、在不在画面里。每帧都动的 / 最精细的 / 投影子的各取最近的 N 只，圈的大小按名次定
    // （原来是一点点调圈的大小，一群贴身围上来时圈缩不到那么小，几十只全算了进去）
    const n = zeds.length;
    if (this.dOf.length < n) {
      this.dOf = new Float32Array(n + 32);
      this.seenOf = new Uint8Array(n + 32);
      this.dAll = new Float32Array(n + 32);
      this.dSeen = new Float32Array(n + 32);
    }
    const { dOf, seenOf, dAll, dSeen } = this;
    let na = 0;
    let ns = 0;
    for (let i = 0; i < n; i++) {
      const z = zeds[i] as Zed;
      if (!z.view) continue;
      // 存的是单精度：后面拿它和排好序的同一批数比大小，要一模一样
      const d = Math.fround(Math.hypot(z.x - this.cx, z.y + 1 - this.cy, z.z - this.cz));
      const seen = this.sees(z.x, z.y + 0.9, z.z, 1.9);
      dOf[i] = d;
      seenOf[i] = seen ? 1 : 0;
      dAll[na++] = d;
      if (seen) dSeen[ns++] = d;
    }
    dAll.fill(Infinity, na);
    dSeen.fill(Infinity, ns);
    dAll.sort();
    dSeen.sort();
    const fullR = Math.min(34 * this.k, dSeen[this.fullN - 1] as number);
    const lod0R = Math.min(LOD_DIST[0] as number, dAll[this.lod0N - 1] as number);
    const shadowR = this.shadowN > 0 ? Math.min(this.shadowMax, dAll[this.shadowN - 1] as number) : -1;
    for (let i = 0; i < n; i++) {
      const z = zeds[i] as Zed;
      const v = z.view as ZView | null;
      if (!v) continue;
      v.place(z.x, z.y, z.z, z.yaw);
      const d = dOf[i] as number;
      const seen = seenOf[i] === 1;
      v.setLod(d, d < glowR, lod0R);
      v.setShadow(d <= shadowR);
      // 隔多久动一次动画（秒）：画面里最近的一批每帧（最多每秒 100 次），再远每秒 30 / 20 / 12 / 6 次；
      // 画面外的不动（贴身的除外：它的影子可能在画面里）
      let every = -1;
      if (seen) {
        info.shown++;
        every = d <= fullR ? 0.01 : d < 30 ? 1 / 30 : d < 50 ? 1 / 20 : d < 90 ? 1 / 12 : 1 / 6;
      } else if (d < 12) every = 1 / 20;
      v.pending += dt;
      if (v.fresh) {
        v.animate(z, v.pending);
        // 同一帧刷出来的一群：下一次各自错开
        v.pending = -v.phase * 0.05;
        info.anim++;
      } else if (every >= 0 && v.pending >= every) {
        v.animate(z, v.pending);
        v.pending = 0;
        info.anim++;
      } else if (every < 0 && v.pending > 0.3) v.pending = 0.3;
    }
    // ---- 尸体
    const cs = this.corpses;
    for (let i = cs.length - 1; i >= 0; i--) {
      const v = cs[i] as ZView;
      v.deadT += dt;
      const p = v.group.position;
      const d = Math.hypot(p.x - this.cx, p.y + 0.5 - this.cy, p.z - this.cz);
      if (v.deadT > v.life) {
        v.sunk += dt * 0.25;
        p.y -= dt * 0.25;
      }
      if (v.sunk > 0.7 || d > 160) {
        cs[i] = cs[cs.length - 1] as ZView;
        cs.pop();
        this.release(v);
        continue;
      }
      v.setLod(d, false, LOD_DIST[0] as number);
      if (v.settled) {
        // 躺平以后影子很小：不投了
        v.setShadow(false);
        continue;
      }
      v.setShadow(d <= shadowR);
      v.pending += dt;
      if (v.deadT >= v.deadEnd) {
        // 倒地动作放完：最后算一次，之后这具尸体不再花时间
        v.animateDead(v.pending + 0.1);
        v.settled = true;
        info.anim++;
        continue;
      }
      const seen = this.sees(p.x, p.y + 0.9, p.z, 2.4);
      if (v.pending >= (seen ? (d < 30 ? 0.01 : d < 60 ? 1 / 30 : 1 / 15) : 1 / 15)) {
        v.animateDead(v.pending);
        v.pending = 0;
        info.anim++;
      }
    }
    info.corpses = cs.length;
  }
}
