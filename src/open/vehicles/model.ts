import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import type { GeomEntry, LampKind, VehicleDef } from './types';

/**
 * 读 public/vehicles/<id>/（vehicle.json + mesh.bin + webp 贴图），拼成一台车的场景节点：
 *
 *   root（世界姿态：模型原点 = 两轴中间的地面）
 *   └ lean（摩托压弯：绕车身纵轴、地面高度转）
 *     ├ near    会动的车（在开、刚停下、走到跟前）：车身 + 每个会动的骨骼一个子节点（驾驶员的门、尾门、油箱盖、方向盘……）
 *     ├ inner   车内、底盘、发动机：很近或者坐在车里才显示
 *     ├ parked  停着的车（门关着、灯灭着）稍远一点：整个车身按材质并成 4 个网格
 *     ├ far     45 米以外：低模，连轮子一起并成 4 个网格
 *     ├ shadow  只投影子的替身（低模并成一个网格）：近处的车身不用再往阴影贴图里画一遍
 *     └ wheel[i]（悬挂高度）→ steer（转向）→ side（左轮转 180°）→ spin（滚动）→ 轮子网格
 *
 * 原来每个骨骼、每种材质一个网格，一台车 50 多次绘制（加上阴影 78 次）。车包里的骨骼大多数从来不动
 * （引擎盖、雨刷、仪表上的旋钮……），加载时把不动的按材质并进车身：在开的车 28 次，停着的 10 次（走到跟前 16 次），远处 4 次。
 *
 * 材质按（贴图, 车漆 / 第二车漆 / 普通, 玻璃, 灯）分：车漆是灰底乘颜色；每类灯一个材质，亮度单独调。
 */

/** 无头测试（npx tsx）里没有 import.meta.env */
export const BASE = `${import.meta.env?.BASE_URL ?? '/'}vehicles/`;
/** 外观近模的显示距离 / 车内件的显示距离（米） */
export const NEAR_DIST = 45;
export const INNER_DIST = 14;

export interface VehicleAsset {
  def: VehicleDef;
  geos: BufferGeometry[];
  tex: Record<string, { base: Texture; normal?: Texture; orm?: Texture }>;
  /** 合并好的网格（建第一台车时才算，见 kitOf） */
  kit?: Kit;
}

const loader = new TextureLoader();

async function loadTex(url: string, srgb: boolean, aniso: number): Promise<Texture> {
  const t = await loader.loadAsync(url);
  t.flipY = false;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function loadVehicle(id: string, aniso: number): Promise<VehicleAsset> {
  const dir = `${BASE}${id}/`;
  const [def, bin] = await Promise.all([
    fetch(`${dir}vehicle.json`).then((r) => {
      if (!r.ok) throw new Error(`${id}/vehicle.json ${r.status}`);
      return r.json() as Promise<VehicleDef>;
    }),
    fetch(`${dir}mesh.bin`).then((r) => {
      if (!r.ok) throw new Error(`${id}/mesh.bin ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const geos = buildGeometries(def, bin);
  const tex: VehicleAsset['tex'] = {};
  await Promise.all(
    Object.entries(def.atlases).map(async ([name, a]) => {
      const [base, normal, orm] = await Promise.all([
        loadTex(dir + a.base, true, aniso),
        a.normal ? loadTex(dir + a.normal, false, aniso) : Promise.resolve(undefined),
        a.orm ? loadTex(dir + a.orm, false, aniso) : Promise.resolve(undefined),
      ]);
      tex[name] = { base, normal, orm };
    }),
  );
  return { def, geos, tex };
}

/** mesh.bin → 每个 geoms 条目一个几何体（无头测试也用它：直接从文件读，不走 fetch） */
export function buildGeometries(def: VehicleDef, bin: ArrayBuffer): BufferGeometry[] {
  return def.geoms.map((g) => buildGeometry(bin, g));
}

function buildGeometry(bin: ArrayBuffer, g: GeomEntry): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(bin, g.pos, g.count * 3), 3));
  geo.setAttribute('normal', new BufferAttribute(new Int16Array(bin, g.nrm, g.count * 3), 3, true));
  geo.setAttribute('uv', new BufferAttribute(new Uint16Array(bin, g.uv, g.count * 2), 2, true));
  geo.setIndex(new BufferAttribute(g.big ? new Uint32Array(bin, g.idx, g.index) : new Uint16Array(bin, g.idx, g.index), 1));
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------- 合并

/** 要并进去的一块：网格 + 平移（骨骼的支点 / 轮子的位置）；flip = 绕 Y 转 180°（左边的轮子） */
interface Src {
  geo: BufferGeometry;
  x: number;
  y: number;
  z: number;
  flip?: boolean;
}

/** 车包网格的格式：位置 float32、法线 int16（归一化）、uv uint16（归一化）。并出来还是这个格式 */
function merge(list: Src[]): BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const s of list) {
    const p = s.geo.getAttribute('position');
    if (!p) continue;
    nv += p.count;
    ni += s.geo.index ? s.geo.index.count : p.count;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Int16Array(nv * 3);
  const uv = new Uint16Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0;
  let i0 = 0;
  for (const s of list) {
    const p = s.geo.getAttribute('position');
    if (!p) continue;
    const pa = p.array as Float32Array;
    const na = s.geo.getAttribute('normal')?.array as Int16Array | undefined;
    const ta = s.geo.getAttribute('uv')?.array as Uint16Array | undefined;
    const k = s.flip ? -1 : 1;
    for (let i = 0; i < p.count; i++) {
      const o = (v0 + i) * 3;
      pos[o] = (pa[i * 3] as number) * k + s.x;
      pos[o + 1] = (pa[i * 3 + 1] as number) + s.y;
      pos[o + 2] = (pa[i * 3 + 2] as number) * k + s.z;
      if (na) {
        // −(−32768) 放不进 int16
        nrm[o] = Math.max(-32767, na[i * 3] as number) * k;
        nrm[o + 1] = na[i * 3 + 1] as number;
        nrm[o + 2] = Math.max(-32767, na[i * 3 + 2] as number) * k;
      }
    }
    if (ta) uv.set(ta.subarray(0, p.count * 2), v0 * 2);
    const ia = s.geo.index?.array;
    const n = ia ? ia.length : p.count;
    for (let i = 0; i < n; i++) idx[i0 + i] = (ia ? (ia[i] as number) : i) + v0;
    v0 += p.count;
    i0 += n;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3, true));
  geo.setAttribute('uv', new BufferAttribute(uv, 2, true));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/** 越野胎：原来的轮子外面加两圈交错的胎块（uv 取胎面上的一个点：和轮胎同一种橡胶色，不用多一个材质） */
function lugged(wheel: BufferGeometry): BufferGeometry {
  const p = wheel.getAttribute('position');
  const t = wheel.getAttribute('uv');
  if (!p || !t) return wheel;
  const pa = p.array as Float32Array;
  let best = 0;
  let bestR = -1;
  let halfW = 0;
  for (let i = 0; i < p.count; i++) {
    const x = pa[i * 3] as number;
    const r = Math.hypot(pa[i * 3 + 1] as number, pa[i * 3 + 2] as number) - Math.abs(x) * 0.5;
    halfW = Math.max(halfW, Math.abs(x));
    if (r > bestR) {
      bestR = r;
      best = i;
    }
  }
  const R = Math.hypot(pa[best * 3 + 1] as number, pa[best * 3 + 2] as number);
  const tu = (t.array as Uint16Array)[best * 2] as number;
  const tv = (t.array as Uint16Array)[best * 2 + 1] as number;
  const N = 18;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  // 一块：沿圆周 len、沿半径从 R−0.02 到 R+0.026、沿轴向 x0..x1
  const lug = (a: number, x0: number, x1: number): void => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const half = 0.034;
    const r0 = R - 0.02;
    const r1 = R + 0.026;
    // 局部：u = 轴向 (1,0,0)，v = 径向 (0,c,s)，w = 切向 (0,−s,c)
    const corner = (u: number, v: number, w: number): [number, number, number] => [u, v * c - w * s, v * s + w * c];
    const faces: Array<[[number, number, number], Array<[number, number, number]>]> = [
      [[0, 1, 0], [[x0, r1, -half], [x0, r1, half], [x1, r1, half], [x1, r1, -half]]],
      [[0, 0, 1], [[x0, r0, half], [x1, r0, half], [x1, r1, half], [x0, r1, half]]],
      [[0, 0, -1], [[x1, r0, -half], [x0, r0, -half], [x0, r1, -half], [x1, r1, -half]]],
      [[1, 0, 0], [[x1, r0, half], [x1, r0, -half], [x1, r1, -half], [x1, r1, half]]],
      [[-1, 0, 0], [[x0, r0, -half], [x0, r0, half], [x0, r1, half], [x0, r1, -half]]],
    ];
    for (const [n, q] of faces) {
      const b = pos.length / 3;
      const nn = corner(n[0], n[1], n[2]);
      for (const v of q) {
        pos.push(...corner(v[0], v[1], v[2]));
        nor.push(nn[0], nn[1], nn[2]);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  const w1 = halfW + 0.014;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    lug(a, -w1, -0.012);
    lug(a + Math.PI / N, 0.012, w1);
  }
  const nv = pos.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(Int16Array.from(nor, (v) => Math.round(v * 32767)), 3, true));
  const uv = new Uint16Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    uv[i * 2] = tu;
    uv[i * 2 + 1] = tv;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2, true));
  g.setIndex(idx);
  return merge([
    { geo: wheel, x: 0, y: 0, z: 0 },
    { geo: g, x: 0, y: 0, z: 0 },
  ]);
}

/** 一个要画的网格：几何体 + 它的材质是哪一种 */
interface Piece {
  geo: BufferGeometry;
  g: GeomEntry;
  /** 灯并进普通材质（停着的车、远模：灯是灭的） */
  lampOff: boolean;
}

export interface Kit {
  /** 会动的骨骼；别的骨骼都并进车身 */
  moving: Set<string>;
  /** 骨骼名（'' = 车身）→ 网格 */
  near: Map<string, Piece[]>;
  inner: Map<string, Piece[]>;
  parked: Piece[];
  far: Piece[];
  shadow: BufferGeometry | null;
  /** 轮子（近模）：geoms 的下标 → 越野胎的网格 */
  lugged: Map<number, BufferGeometry>;
}

const matKey = (g: GeomEntry, lampOff: boolean): string => `${g.atlas || 'main'}|${g.mat.cls}|${g.mat.glass ? 1 : 0}|${lampOff ? '' : (g.mat.lamp ?? '')}`;

/** 把一组网格按（骨骼, 材质）并起来；不在 moving 里的骨骼都算车身（平移到各自的支点上） */
function bake(asset: VehicleAsset, ids: number[], moving: Set<string>, lampOff: boolean, extra: Array<Src & { g: GeomEntry }> = []): Map<string, Piece[]> {
  const def = asset.def;
  const buckets = new Map<string, Map<string, { g: GeomEntry; src: Src[] }>>();
  const add = (bone: string, g: GeomEntry, src: Src): void => {
    let m = buckets.get(bone);
    if (!m) buckets.set(bone, (m = new Map()));
    const key = matKey(g, lampOff);
    let b = m.get(key);
    if (!b) m.set(key, (b = { g, src: [] }));
    b.src.push(src);
  };
  for (const i of ids) {
    const g = def.geoms[i] as GeomEntry;
    const geo = asset.geos[i] as BufferGeometry;
    if (moving.has(g.bone)) add(g.bone, g, { geo, x: 0, y: 0, z: 0 });
    else {
      const p = def.bones[g.bone] ?? [0, 0, 0];
      add('', g, { geo, x: p[0], y: p[1], z: p[2] });
    }
  }
  for (const e of extra) add('', e.g, e);
  const out = new Map<string, Piece[]>();
  for (const [bone, m] of buckets) {
    const list: Piece[] = [];
    for (const b of m.values()) {
      const one = b.src.length === 1 ? (b.src[0] as Src) : null;
      // 只有一块而且不用挪：直接用原来的网格
      const geo = one && !one.x && !one.y && !one.z && !one.flip ? one.geo : merge(b.src);
      list.push({ geo, g: b.g, lampOff });
    }
    out.set(bone, list);
  }
  return out;
}

export function kitOf(asset: VehicleAsset): Kit {
  if (asset.kit) return asset.kit;
  const def = asset.def;
  const side = Math.sign(def.layout.seats[0]?.right ?? 0);
  const names = new Set(def.geoms.map((g) => g.bone));
  const moving = new Set<string>();
  for (const b of [side < 0 ? 'door_l' : side > 0 ? 'door_r' : '', 'tailgate', 'fuel_door', 'steering', 'fork', 'swingarm']) if (b && names.has(b)) moving.add(b);
  const none = new Set<string>();
  // 远模的轮子并进车身（45 米外看不出轮子转没转）
  const farWheels: Array<Src & { g: GeomEntry }> = [];
  for (const w of def.wheels) {
    for (const i of def.wheelFar) {
      const g = def.geoms[i] as GeomEntry;
      if (g.bone === w.geo) farWheels.push({ geo: asset.geos[i] as BufferGeometry, g, x: w.x, y: def.phys.radius, z: w.z, flip: w.side < 0 });
    }
  }
  const far = bake(asset, def.far, none, true, farWheels).get('') ?? [];
  const solid: Src[] = [];
  for (const i of def.far) {
    const g = def.geoms[i] as GeomEntry;
    if (g.mat.glass) continue;
    const p = def.bones[g.bone] ?? [0, 0, 0];
    solid.push({ geo: asset.geos[i] as BufferGeometry, x: p[0], y: p[1], z: p[2] });
  }
  for (const w of farWheels) solid.push(w);
  const lug = new Map<number, BufferGeometry>();
  if (def.kind === 'car') for (const i of def.wheel) lug.set(i, lugged(asset.geos[i] as BufferGeometry));
  asset.kit = {
    moving,
    near: bake(asset, def.near, moving, false),
    inner: bake(asset, def.inner, moving, false),
    parked: bake(asset, def.near, none, true).get('') ?? [],
    far,
    shadow: solid.length ? merge(solid) : null,
    lugged: lug,
  };
  return asset.kit;
}

/** 影子替身的材质：正常那一遍什么都不写（颜色、深度都不写），阴影那一遍照常画 */
const SHADOW_MAT = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export interface WheelNode {
  /** 悬挂：position.y = 轮心高度（车身坐标） */
  holder: Object3D;
  steer: Object3D;
  spin: Object3D;
  near: Object3D;
}

export class VehicleRig {
  readonly root = new Group();
  readonly lean = new Group();
  readonly near = new Group();
  readonly inner = new Group();
  readonly parked = new Group();
  readonly far = new Group();
  readonly wheels: WheelNode[] = [];
  /** 骨骼名 → 各处的节点（门、方向盘……一起转） */
  readonly bones = new Map<string, Object3D[]>();
  readonly lamps: Record<LampKind, MeshStandardMaterial[]> = { head: [], park: [], tail: [], reverse: [] };
  /** 摩托：前轮挂在前叉上，前叉绕转向轴转 */
  readonly fork: Object3D | null = null;
  readonly kit: Kit;
  /** 现在显示的是哪一档：0 会动的近模 · 1 停着的（并好的） · 2 远模 */
  lod = -1;
  private readonly mats = new Map<string, MeshStandardMaterial>();
  private readonly paint: Color;
  private readonly paint2: Color;
  private readonly shadow: Mesh | null = null;
  private readonly wheelMeshes: Array<{ mesh: Mesh; id: number }> = [];
  private innerOn = false;
  private tires = false;

  constructor(
    readonly asset: VehicleAsset,
    paint?: { main: string; second: string },
  ) {
    const def = asset.def;
    const kit = kitOf(asset);
    this.kit = kit;
    this.paint = new Color(paint?.main ?? def.paint.main);
    this.paint2 = new Color(paint?.second ?? def.paint.second);
    this.root.add(this.lean);
    this.lean.add(this.near, this.inner, this.parked, this.far);
    this.root.name = `vehicle:${def.id}`;
    this.fill(this.near, kit.near);
    this.fill(this.inner, kit.inner);
    for (const p of kit.parked) this.parked.add(this.mesh(p));
    for (const p of kit.far) this.far.add(this.mesh(p));
    if (kit.shadow) {
      const m = new Mesh(kit.shadow, SHADOW_MAT);
      m.castShadow = true;
      m.name = 'shadow';
      this.lean.add(m);
      this.shadow = m;
    }
    // 摩托的前叉：转向轴上的一个节点，前轮挂在它下面
    let forkNode: Object3D | null = null;
    if (def.kind === 'bike') {
      const s = def.layout.steer;
      forkNode = new Object3D();
      forkNode.position.set(s.x, s.y, s.z);
      this.lean.add(forkNode);
      (this as { fork: Object3D | null }).fork = forkNode;
    }
    for (const w of def.wheels) {
      const holder = new Object3D();
      const steer = new Object3D();
      const side = new Object3D();
      const spin = new Object3D();
      holder.position.set(w.x, def.phys.radius, w.z);
      if (w.side < 0) side.rotation.y = Math.PI;
      holder.add(steer);
      steer.add(side);
      side.add(spin);
      const near = new Group();
      for (const i of def.wheel) {
        const g = def.geoms[i] as GeomEntry;
        if (g.bone !== w.geo) continue;
        const m = this.mesh({ geo: asset.geos[i] as BufferGeometry, g, lampOff: false });
        near.add(m);
        this.wheelMeshes.push({ mesh: m, id: i });
      }
      spin.add(near);
      if (forkNode && w.steer) {
        forkNode.add(holder);
        holder.position.sub(forkNode.position);
      } else this.lean.add(holder);
      this.wheels.push({ holder, steer, spin, near });
    }
    this.setDistance(0, false, true);
  }

  get def(): VehicleDef {
    return this.asset.def;
  }

  private fill(parent: Group, set: Map<string, Piece[]>): void {
    for (const [bone, list] of set) {
      const node = new Object3D();
      node.name = bone || 'body';
      if (bone) {
        const p = this.asset.def.bones[bone] ?? [0, 0, 0];
        node.position.set(p[0], p[1], p[2]);
        const reg = this.bones.get(bone) ?? [];
        reg.push(node);
        this.bones.set(bone, reg);
      }
      for (const p of list) node.add(this.mesh(p));
      parent.add(node);
    }
  }

  /** 在骨骼的支点上再挂一个节点（跟着这个骨骼一起转）：改装件里跟着门走的那部分用 */
  attach(bone: string): Object3D {
    const node = new Object3D();
    const p = this.asset.def.bones[bone] ?? [0, 0, 0];
    node.position.set(p[0], p[1], p[2]);
    node.name = `${bone}+`;
    this.lean.add(node);
    const reg = this.bones.get(bone) ?? [];
    reg.push(node);
    this.bones.set(bone, reg);
    return node;
  }

  /** 影子都由替身投（见文件头）；车身自己只接影子 */
  private mesh(p: Piece): Mesh {
    const m = new Mesh(p.geo, this.material(p.g, p.lampOff));
    m.castShadow = false;
    m.receiveShadow = true;
    if (p.g.mat.glass) m.renderOrder = 2;
    return m;
  }

  private material(g: GeomEntry, lampOff: boolean): Material {
    const key = matKey(g, lampOff);
    let m = this.mats.get(key);
    if (m) return m;
    const t = this.asset.tex[g.atlas || 'main'] ?? (this.asset.tex.main as VehicleAsset['tex'][string]);
    m = new MeshStandardMaterial({
      map: t.base,
      normalMap: t.normal ?? null,
      roughnessMap: t.orm ?? null,
      metalnessMap: t.orm ?? null,
      aoMap: t.orm ?? null,
      roughness: 1,
      metalness: 1,
    });
    if (!t.orm) {
      m.roughness = 0.6;
      m.metalness = 0;
    }
    // 车漆压暗一点（线性 ×0.78）：近白的车顶朝着正午的太阳会比场景里别的东西亮一截，bloom 下整片发光
    if (g.mat.cls === 'paint') m.color.copy(this.paint).multiplyScalar(0.78);
    else if (g.mat.cls === 'paint2') m.color.copy(this.paint2).multiplyScalar(0.78);
    if (g.mat.glass) {
      m.transparent = true;
      m.opacity = Math.max(0.18, Math.min(0.85, g.mat.opacity ?? 0.35));
      m.depthWrite = false;
      m.side = DoubleSide;
    }
    if (g.mat.lamp && !lampOff) {
      m.emissive.set(g.mat.lamp === 'tail' ? 0xff2a1a : g.mat.lamp === 'park' ? 0xffc890 : 0xffffff);
      m.emissiveMap = t.base;
      m.emissiveIntensity = 0;
      this.lamps[g.mat.lamp].push(m);
    }
    m.name = `${this.asset.def.id}:${key}`;
    this.mats.set(key, m);
    return m;
  }

  /**
   * 按相机距离挑一档。inside = 相机在车里（车内件一定要显示）；
   * live = 这台车现在会动（在开、还没停稳、门 / 尾门开着、灯亮着）：45 米以内都用会动的近模
   */
  setDistance(d: number, inside: boolean, live: boolean): void {
    const lod = inside || (live && d < NEAR_DIST) ? 0 : d < NEAR_DIST ? 1 : 2;
    const innerOn = inside || d < INNER_DIST;
    if (lod === this.lod && innerOn === this.innerOn) return;
    this.lod = lod;
    this.innerOn = innerOn;
    this.near.visible = lod === 0;
    this.inner.visible = innerOn;
    this.parked.visible = lod === 1;
    this.far.visible = lod === 2;
    // 阴影只覆盖身边 ±45 米：远模不用投
    if (this.shadow) this.shadow.visible = lod < 2;
    for (const w of this.wheels) w.near.visible = lod < 2;
  }

  /** 骨骼的转动（所有挂在这个骨骼上的节点一起） */
  rotateBone(name: string, axis: Vector3, angle: number): void {
    const list = this.bones.get(name);
    if (!list) return;
    for (const n of list) n.quaternion.setFromAxisAngle(axis, angle);
  }

  setLamp(kind: LampKind, intensity: number): void {
    for (const m of this.lamps[kind]) m.emissiveIntensity = intensity;
  }

  /** 越野胎：轮子换成带胎块的网格（同一个材质，不多画） */
  setTires(on: boolean): void {
    if (on === this.tires) return;
    this.tires = on;
    for (const w of this.wheelMeshes) w.mesh.geometry = (on ? this.kit.lugged.get(w.id) : null) ?? (this.asset.geos[w.id] as BufferGeometry);
  }

  /** 一个不转的备胎（越野胎的样子），调用方自己摆位置；车包里没有轮子就返回 null */
  spareWheel(): Mesh | null {
    const w = this.wheelMeshes[0];
    if (!w) return null;
    const m = new Mesh(this.kit.lugged.get(w.id) ?? w.mesh.geometry, w.mesh.material);
    m.receiveShadow = true;
    return m;
  }

  /** 所有贴图（开局预先传进显卡用：第一次走到车跟前不会卡一下） */
  textures(): Texture[] {
    const out: Texture[] = [];
    for (const t of Object.values(this.asset.tex)) {
      out.push(t.base);
      if (t.normal) out.push(t.normal);
      if (t.orm) out.push(t.orm);
    }
    return out;
  }

  /** 这台车自己建的材质（车拿掉的时候释放） */
  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
  }
}
