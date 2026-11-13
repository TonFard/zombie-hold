import { AnimationMixer, BackSide, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, LoopOnce, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Sphere, Vector3, type AnimationAction, type AnimationClip, type Bone, type Material, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { clamp } from '../../game/core/math';
import type { ZombieKind } from '../../game/data/zombies';
import type { Zombie } from '../../game/entities/zombie';
import { poseMoving } from '../../game/systems/hitvolume';

/**
 * 写实僵尸（npm run zombies:build → public/zombies/<id>.glb + manifest.json）：带贴图的蒙皮模型 + Mixamo 动作。
 * 一个 GLB 里有三档细节（节点 lod0 / lod1 / lod2，共用一副骨架）、装备（props，顶点色）、发光件（glow）。
 * 默认不加载，游戏用程序僵尸；URL 加 ?zombies=glb 才加载。异步加载，没加载好、加载失败时 Actors 继续用程序僵尸。
 *
 * 开了写实模型时，命中体积（ZOMBIES[kind].head）仍然是按程序僵尸量的，头的位置对不上
 *
 * 性能：几何体、贴图、材质在同一外观的僵尸之间共用，每只僵尸只有自己的骨架和动画混合器；
 * 按离玩家的距离换细节档，远处的僵尸隔帧更新动画。
 */
type ClipName = 'idle' | 'punching' | 'reaction_hit' | 'death' | 'dying' | 'run' | 'walk' | 'crawl' | 'scream';
interface ClipInfo {
  dur: number;
  /** 手伸到最前面的时刻（0–1），攻击命中对在这一帧上 */
  impact: number;
  /** 原地播放的走 / 跑 / 爬：对应的前进速度（米/秒，模型不缩放时） */
  speed?: number;
}
interface VariantInfo {
  id: string;
  kind: ZombieKind;
  file: string;
  clips: Partial<Record<ClipName, ClipInfo>>;
}
interface Loaded {
  info: VariantInfo;
  scene: Object3D;
  clips: Map<ClipName, AnimationClip>;
  flash: Material | null;
  /** 去掉头的几何体（按细节档）。这种外观第一次有僵尸被爆头打死时才生成 */
  headless: BufferGeometry[] | null;
}

const BASE = `${import.meta.env.BASE_URL}zombies/`;
const loaded = new Map<ZombieKind, Loaded[]>();
let started: Promise<void> | null = null;

/** 模型身高 1.75 米；各类僵尸的缩放 [宽, 高]（宽 = 左右和前后） */
export const GLB_SCALE: Record<ZombieKind, [number, number]> = {
  walker: [1.04, 1.04],
  runner: [0.98, 1.02],
  bloater: [1.3, 1.06],
  breaker: [1.16, 1.1],
  armored: [1.16, 1.1],
  spitter: [1.02, 1.0],
  screamer: [0.92, 0.97],
  crawler: [1.0, 1.0],
  colossus: [2.45, 2.25],
  leaper: [0.96, 1.0],
  splitter: [1.18, 1.03],
  gasser: [1.06, 1.03],
  reaper: [1.5, 1.85],
  brood: [2.3, 1.7],
  siren: [1.3, 1.65],
};
/** 平常移动用的动作；巨像冲锋时换成跑 */
const MOVE: Record<ZombieKind, ClipName> = { walker: 'run', runner: 'run', bloater: 'walk', breaker: 'run', armored: 'walk', spitter: 'run', screamer: 'run', crawler: 'crawl', colossus: 'walk', leaper: 'run', splitter: 'walk', gasser: 'run', reaper: 'walk', brood: 'walk', siren: 'run' };
/** 移动动作的播放速度上下限：走路动作本身很慢，慢僵尸要加快放；太快会像快进 */
const RATE: Record<ZombieKind, [number, number]> = { walker: [0.45, 1.1], runner: [0.6, 1.6], bloater: [0.8, 2.6], breaker: [0.45, 1.1], armored: [0.8, 2.8], spitter: [0.45, 1.1], screamer: [0.5, 1.3], crawler: [1, 4.5], colossus: [0.8, 2.4], leaper: [0.6, 1.5], splitter: [0.8, 2.6], gasser: [0.45, 1.1], reaper: [0.8, 2.4], brood: [0.8, 2.6], siren: [0.5, 1.2] };
/** 细节档的切换距离（米，按僵尸大小放大） */
const LOD_DIST = [9, 22];

const propsMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.45 });
const glowMat = new MeshBasicMaterial({ vertexColors: true, color: new Color(2.2, 2.2, 2.2), toneMapped: false });
const BOUNDS = new Sphere(new Vector3(0, 0.9, 0), 2.4);
/** 离头骨骼的水平距离在这以内、又高过它的顶点算头上的（头发、拉起来的兜帽都在里面；肩膀比头骨骼低） */
const HEAD_REACH = 0.26;
/** 绑在头骨骼上的权重到这个数的顶点也算头上的：垂到下巴以下的头发、下颌、脖子的上半截 */
const HEAD_WEIGHT = 0.2;
/** 脖子后面、离脖子轴线超过 NECK_R 米的顶点，头骨骼的权重到这个数就算头发 */
const HAIR_WEIGHT = 0.1;
const NECK_R = 0.11;
const _bind = new Matrix4();
/** 脖子的断面：一小截暗红的圆台，半埋在收拢的领口里（所有僵尸共用一份几何体和材质，尺寸按模型的米算） */
const stumpGeo = new CylinderGeometry(0.026, 0.044, 0.04, 8).translate(0, 0.006, 0);
const stumpMat = new MeshStandardMaterial({ color: 0x3a0707, roughness: 0.45 });

/**
 * 去掉头的几何体：顶点数据和原来的共用，只换一份索引 —— 绑定姿势下有顶点高过头骨骼（下巴的高度）、或者明显绑在头骨骼上的三角形都不要。
 * 光把脖子骨骼缩没不够：长头发、兜帽尖有一半绑在肩膀上，会留在原地，像顶假发盖在断口上
 */
function headlessOf(v: Loaded, lods: SkinnedMesh[]): BufferGeometry[] {
  if (v.headless) return v.headless;
  const out: BufferGeometry[] = [];
  lods.forEach((m, i) => {
    const src = m.geometry;
    out[i] = src;
    const hi = m.skeleton.bones.findIndex((b) => /Head$/.test(b.name));
    const index = src.index;
    const pos = src.getAttribute('position');
    if (hi < 0 || !index) return;
    // 头骨骼在绑定姿势下的位置（网格自己的坐标系里）
    _bind.copy(m.skeleton.boneInverses[hi] as Matrix4).invert().premultiply(m.bindMatrixInverse);
    const hx = _bind.elements[12] as number;
    const hy = _bind.elements[13] as number;
    const hz = _bind.elements[14] as number;
    const si = src.getAttribute('skinIndex');
    const sw = src.getAttribute('skinWeight');
    // 脖子骨骼在绑定姿势下的位置（模型脸朝 +Z，Z 比它小的在脖子后面）
    const ni = m.skeleton.bones.findIndex((b) => /Neck$/.test(b.name));
    if (ni >= 0) _bind.copy(m.skeleton.boneInverses[ni] as Matrix4).invert().premultiply(m.bindMatrixInverse);
    const nx = _bind.elements[12] as number;
    const nz = _bind.elements[14] as number;
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
    out[i] = g;
  });
  v.headless = out;
  return out;
}

async function loadOne(loader: GLTFLoader, info: VariantInfo): Promise<void> {
  const gltf = await loader.loadAsync(`${BASE}${info.file}`);
  let flash: Material | null = null;
  gltf.scene.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isMesh) return;
    // 倒地动作会把身体带离原点 1 米多：包围球放大，不然尸体在画面边上会被剔除掉。
    // 蒙皮网格的视锥剔除看的是网格自己的 boundingSphere（不设的话按第一次渲染时的姿势算一次，之后不再更新），
    // 不看几何体的；克隆时会跟着复制过去
    m.geometry.boundingSphere = BOUNDS;
    m.boundingSphere = BOUNDS;
    m.frustumCulled = true;
    if (m.name === 'props') m.material = propsMat;
    else if (m.name === 'glow') m.material = glowMat;
    else {
      const mat = m.material as MeshStandardMaterial;
      // 模型是空心的单层壳，身上有开口（腋下、切开的衣摆）：只画正面的话从开口直接看到背景，像透明了一块。
      // 两面都画，开口里看到的是衣服内侧。阴影照旧只画背面（和只画正面时一样，不起条纹）
      mat.side = DoubleSide;
      mat.shadowSide = BackSide;
      mat.transparent = false;
      mat.depthWrite = true;
      if (!flash) {
        const f = mat.clone();
        f.emissive = new Color(0xff9070);
        f.emissiveIntensity = 0.9;
        flash = f;
      }
    }
    m.castShadow = m.name !== 'glow';
    m.receiveShadow = false;
  });
  const clips = new Map<ClipName, AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name.replace(/^zombie_/, '') as ClipName, c);
  const list = loaded.get(info.kind) ?? [];
  list.push({ info, scene: gltf.scene, clips, flash, headless: null });
  loaded.set(info.kind, list);
}

/** 后台一个一个加载（先常见的），不卡开局 */
export function loadZombieModels(): Promise<void> {
  if (started) return started;
  if (new URLSearchParams(window.location.search).get('zombies') !== 'glb') return (started = Promise.resolve());
  started = (async () => {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const m = (await res.json()) as { variants: VariantInfo[] };
    const loader = new GLTFLoader();
    const order: ZombieKind[] = ['walker', 'runner', 'crawler', 'spitter', 'bloater', 'breaker', 'screamer', 'armored', 'colossus'];
    const list = [...m.variants].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const v of list) {
      try {
        await loadOne(loader, v);
      } catch (e) {
        console.warn(`僵尸模型 ${v.id} 加载失败，继续用程序模型：`, e);
      }
    }
  })().catch((e: unknown) => console.warn('僵尸模型清单加载失败，继续用程序模型：', e));
  return started;
}

export const hasZombieModel = (kind: ZombieKind): boolean => (loaded.get(kind)?.length ?? 0) > 0;

export interface GlbPose {
  /** 攻击进度 0–1（0.47 是命中的时刻），<0 = 没在攻击 */
  attack: number;
  /** 受击 1→0 */
  flinch: number;
  /** 嘶吼进度 0–1，<0 = 没在叫 */
  scream: number;
  /** 离玩家的距离（米） */
  dist: number;
}

export class GlbZombie {
  readonly group = new Group();
  private readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly lods: SkinnedMesh[] = [];
  private readonly shadowed: SkinnedMesh[] = [];
  private body: Material | null = null;
  private readonly flash: Material | null;
  private readonly acts = new Map<ClipName, AnimationAction>();
  private readonly info: VariantInfo;
  private readonly variant: Loaded;
  private readonly weights = new Map<ClipName, number>();
  private readonly kind: ZombieKind;
  private readonly scaleY: number;
  private flashing = false;
  private casting = true;
  private lod = -1;
  private frame: number;
  private pending = 0;
  private fresh = true;
  private deadClip: AnimationAction | null = null;
  private deadT = 0;
  /** 脖子骨骼（头是它的子骨骼）。动作里没有缩放通道，缩放改了之后混合器不会改回去 */
  private neckBone: Object3D | null = null;

  constructor(kind: ZombieKind, seed: number) {
    const list = loaded.get(kind) as Loaded[];
    const v = list[seed % list.length] as Loaded;
    this.kind = kind;
    this.info = v.info;
    this.variant = v;
    this.flash = v.flash;
    this.root = cloneSkinned(v.scene);
    this.root.traverse((o) => {
      // 加载器会把骨骼名里的冒号去掉（mixamorig:Neck → mixamorigNeck）
      if ((o as Bone).isBone && /Neck$/.test(o.name)) this.neckBone = o;
      const m = o as SkinnedMesh;
      if (!m.isMesh) return;
      const hit = /^lod(\d)$/.exec(m.name);
      if (hit) {
        this.lods[Number(hit[1])] = m;
        this.body = m.material as Material;
      }
      if (m.castShadow) this.shadowed.push(m);
    });
    const [w, h] = GLB_SCALE[kind];
    this.scaleY = h;
    this.group.scale.set(w, h, w);
    this.group.add(this.root);
    this.mixer = new AnimationMixer(this.root);
    for (const [name, clip] of v.clips) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.acts.set(name, a);
      this.weights.set(name, 0);
    }
    // 每只僵尸从动作的不同位置开始：一群僵尸不会齐步走
    const k = (seed % 997) / 997;
    for (const name of ['idle', 'run', 'walk', 'crawl'] as const) {
      const a = this.acts.get(name);
      if (a) a.time = k * a.getClip().duration;
    }
    this.frame = seed % 3;
    this.setLod(2);
  }

  private setLod(i: number): void {
    if (i === this.lod) return;
    this.lod = i;
    this.lods.forEach((m, k) => {
      if (m) m.visible = k === i;
    });
  }

  setFlash(on: boolean): void {
    if (on === this.flashing || !this.flash || !this.body) return;
    this.flashing = on;
    for (const m of this.lods) if (m) m.material = on ? this.flash : this.body;
  }

  setCastShadow(on: boolean): void {
    if (on === this.casting) return;
    this.casting = on;
    for (const m of this.shadowed) m.castShadow = on;
  }

  /** 把权重往目标值靠拢；没列出的动作目标是 0 */
  private blend(target: Partial<Record<ClipName, number>>, dt: number, rate = 10): void {
    const k = Math.min(1, dt * rate);
    for (const [name, a] of this.acts) {
      const cur = this.weights.get(name) as number;
      const next = cur + ((target[name] ?? 0) - cur) * k;
      this.weights.set(name, next);
      a.setEffectiveWeight(next < 0.002 ? 0 : next);
    }
  }

  private pickLod(dist: number): number {
    const d = dist / Math.max(1, this.scaleY);
    return d < LOD_DIST[0]! ? 0 : d < LOD_DIST[1]! ? 1 : 2;
  }

  update(dt: number, z: Zombie, p: GlbPose): void {
    const lod = this.pickLod(p.dist);
    this.setLod(lod);
    // 远处隔帧更新（中档每 2 帧、远档每 3 帧），时间攒起来一起走
    this.pending += dt;
    this.frame++;
    if (!this.fresh && lod > 0 && this.frame % (lod + 1) !== 0) return;
    // 刚出现的那一帧直接到位，不从绑定姿势（T 字）混过来
    const step = this.fresh ? 100 : this.pending;
    this.fresh = false;
    this.pending = 0;

    const charging = z.chargeState === 2;
    const moveName: ClipName = charging && this.acts.has('run') ? 'run' : MOVE[this.kind];
    const move = this.acts.get(moveName);
    const speed = Math.hypot(z.vx, z.vz);
    // 和头部命中球用同一个数（hitvolume.ts）：动作混到哪，头球就跟到哪
    const moving = poseMoving(z);
    const target: Partial<Record<ClipName, number>> = {};
    if (move) {
      const clipSpeed = (this.info.clips[moveName]?.speed ?? 1) * this.scaleY;
      const [lo, hi] = RATE[this.kind];
      move.timeScale = charging ? 1.5 : clamp(speed / clipSpeed, lo, hi);
    }
    const hasIdle = this.acts.has('idle');
    let rest = 1;
    const take = (name: ClipName, w: number, time: number): void => {
      const a = this.acts.get(name);
      if (!a || w <= 0) return;
      a.timeScale = 0;
      a.time = clamp(time, 0, 0.999) * a.getClip().duration;
      target[name] = w * rest;
      rest *= 1 - w;
    };
    // 硬直 / 巨像冲完的僵直：停在受击动作里身体后仰的那一下
    if (z.stunT > 0 || z.chargeState === 3) take('reaction_hit', 0.85, 0.22 + 0.04 * Math.sin(this.mixer.time * 5));
    else if (p.flinch > 0) take('reaction_hit', 0.6 * p.flinch, 0.1 + 0.14 * (1 - p.flinch));
    if (p.scream >= 0) take('scream', 1, 0.12 + 0.8 * p.scream);
    if (p.attack >= 0) {
      const hit = this.info.clips.punching?.impact ?? 0.5;
      take('punching', 1, p.attack < 0.47 ? (p.attack / 0.47) * hit : hit + ((p.attack - 0.47) / 0.53) * (1 - hit));
    }
    if (hasIdle) {
      target[moveName] = rest * moving;
      target.idle = rest * (1 - moving);
    } else {
      // 爬行者只有爬的动作：停下来时放慢，扑咬时加快
      target[moveName] = 1;
      if (move) move.timeScale = p.attack >= 0 ? 4 : Math.max(0.5, move.timeScale * (0.3 + 0.7 * moving));
    }
    this.blend(target, step, p.attack >= 0 || p.scream >= 0 ? 18 : 10);
    this.mixer.update(Math.min(step, 0.1));
  }

  /**
   * 倒地：有倒地动作的放动作（按种子选向后 / 向前倒），爬行者直接趴住不动。
   * 爆头击杀的换成去掉头的几何体，再把脖子骨骼缩没：剩下的脖子、领口收到脖子根，把切口合上
   */
  die(seed: number, head = false): void {
    this.setFlash(false);
    if (head && this.neckBone) {
      this.neckBone.scale.setScalar(0.001);
      this.addStump(this.neckBone);
      const g = headlessOf(this.variant, this.lods);
      this.lods.forEach((m, i) => {
        m.geometry = g[i] as BufferGeometry;
      });
    }
    const a = this.acts.get(seed % 2 ? 'death' : 'dying') ?? null;
    if (!a) return;
    a.setLoop(LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1.35;
    a.time = 0.12 * a.getClip().duration;
    this.deadClip = a;
  }

  /** 断面挂在脖子的上一级骨骼上（脖子自己已经缩没了），位置和朝向照脖子骨骼的来 */
  private addStump(neck: Object3D): void {
    const parent = neck.parent;
    if (!parent) return;
    // 骨架里的单位不一定是米（有的导出带 0.01 的缩放）：把上面各级的缩放乘起来，换回模型的米
    let unit = 1;
    for (let o: Object3D | null = parent; o && o !== this.group; o = o.parent) unit *= o.scale.x;
    const cap = new Mesh(stumpGeo, stumpMat);
    cap.position.copy(neck.position);
    cap.quaternion.copy(neck.quaternion);
    cap.scale.setScalar(1 / unit);
    parent.add(cap);
  }

  /** 尸体每帧：倒地动作放完就不再更新动画 */
  updateDead(dt: number, dist: number): void {
    this.setLod(Math.max(this.lod, this.pickLod(dist)));
    const a = this.deadClip;
    if (!a) return;
    this.deadT += dt;
    if (this.deadT > a.getClip().duration / a.timeScale + 0.3) return;
    const t: Partial<Record<ClipName, number>> = {};
    for (const [name, act] of this.acts) if (act === a) t[name] = 1;
    this.blend(t, dt, 14);
    this.mixer.update(dt);
  }

  /** 脖子断口现在的世界坐标；模型里没有脖子骨骼时返回 false */
  neck(out: Vector3): boolean {
    if (!this.neckBone) return false;
    this.neckBone.getWorldPosition(out);
    return true;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    // 克隆出来的每个网格都有自己的骨架，骨骼矩阵贴图要手动释放（几何体、材质、贴图是共用的，不动）
    this.root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) m.skeleton.dispose();
    });
  }
}

if (typeof window !== 'undefined') void loadZombieModels();
