import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, Quaternion, ShaderMaterial, Vector3, type Material, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../game/core/rng';
import { loadModel } from '../../render/world/realProps';
import SIZES from '../world/model-sizes.json';
import { siteLevel, type Site } from '../world/sites';
import type { World } from '../world/world';
import { ITEMS, magOf, rollLoot, type ItemDef, type LootPlace } from './items';

/**
 * 地上能捡的东西。
 *   - 地点里的战利品：每个地点有一批「可能有东西的位置」（SiteContent.loot），按种子决定每个位置有没有、是什么。
 *     捡走的记在 taken 里（存档），所以搜过的房子一直是空的。
 *   - 丢下的东西（玩家丢的、丧尸掉的、换下来的枪）：drops，全部存档。
 * 画法：同一种模型一个 InstancedMesh，只画 38 米以内的；每件东西上面有一个小光点（一次绘制），远了看不见、被墙挡住。
 */

const SIZE = SIZES as unknown as Record<string, [number, number, number]>;
/** 多远以内画出来 */
const R_SHOW = 38;
/** 伸手够得着的距离（从眼睛算） */
const REACH = 2.9;
/** 每种模型最多同时画多少个 */
const CAP = 48;
const GLINTS = 256;
/** 每个位置有东西的概率：不是每个抽屉都有货 */
const FILL: Record<LootPlace, number> = { home: 0.62, shop: 0.7, store: 0.62, office: 0.66, mil: 0.78, car: 0.6, fuel: 0.7 };
const RARE_COLOR: Array<[number, number, number]> = [
  [0.95, 0.95, 0.88],
  [0.45, 0.75, 1.0],
  [1.0, 0.72, 0.28],
];

export interface Pickup {
  item: string;
  n: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  /** 枪：弹匣里还有几发 */
  loaded: number;
  /** 地点里的战利品：`地点 key:第几个位置`；丢下的东西是空串 */
  key: string;
  gone: boolean;
}

interface Batch {
  meshes: InstancedMesh[];
  n: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _qx = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _xAxis = new Vector3(1, 0, 0);
const _col = new Color();

export class Pickups {
  readonly group = new Group();
  /** 捡走了的地点战利品 */
  readonly taken = new Set<string>();
  /** 丢在地上的东西 */
  drops: Pickup[] = [];
  /** 现在准星指着、够得着的那一件 */
  target: Pickup | null = null;
  /** false = 地点里不放战利品（生化模式），只有丢下来的东西 */
  siteLoot = true;
  private readonly bySite = new Map<number, { site: Site; items: Pickup[] }>();
  private readonly near: Site[] = [];
  private readonly shown: Pickup[] = [];
  private readonly batches = new Map<string, Batch>();
  private readonly loading = new Set<string>();
  private readonly loader = new GLTFLoader();
  /** 不在道具清单里的模型（消耗品包）：文件相对 public/props/，尺寸 [长, 高, 宽]（米） */
  private readonly extra = new Map<string, { file: string; size: [number, number, number] }>();
  private readonly glint: Mesh;
  private readonly glintPos: InstancedBufferAttribute;
  private readonly glintCol: InstancedBufferAttribute;
  private readonly glintMat: ShaderMaterial;
  private readonly ring: Mesh;
  private scanT = 0;
  private showT = 0;
  private dirty = true;
  private lastX = Infinity;
  private lastZ = Infinity;
  private time = 0;

  constructor(
    private readonly world: World,
    private readonly assets: Record<string, { file: string }>,
  ) {
    this.group.name = 'pickups';
    // 光点：一个朝着相机的小方片，每件东西一个实例
    const quad = new InstancedBufferGeometry();
    quad.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.glintPos = new InstancedBufferAttribute(new Float32Array(GLINTS * 3), 3);
    this.glintCol = new InstancedBufferAttribute(new Float32Array(GLINTS * 3), 3);
    this.glintPos.setUsage(DynamicDrawUsage);
    this.glintCol.setUsage(DynamicDrawUsage);
    quad.setAttribute('aPos', this.glintPos);
    quad.setAttribute('aCol', this.glintCol);
    quad.instanceCount = 0;
    this.glintMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 aPos;
        attribute vec3 aCol;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
          float d = -mv.z;
          // 每件东西闪的节奏错开；近处小、远处稍大一点（不然十几米外就看不见了）
          float ph = aPos.x * 3.1 + aPos.z * 1.7;
          float pulse = 0.75 + 0.25 * sin(uTime * 3.0 + ph);
          float size = (0.035 + d * 0.0045) * pulse;
          mv.xy += position.xy * size;
          vUv = position.xy;
          vCol = aCol;
          vFade = smoothstep(${R_SHOW.toFixed(1)}, ${(R_SHOW * 0.55).toFixed(1)}, d) * smoothstep(0.5, 1.6, d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vFade;
        void main() {
          float r = length(vUv);
          // 中间一个亮点 + 十字星芒
          float core = smoothstep(0.55, 0.0, r);
          float ray = max(smoothstep(0.09, 0.0, abs(vUv.x)), smoothstep(0.09, 0.0, abs(vUv.y))) * smoothstep(1.0, 0.1, r);
          float a = (core * 0.9 + ray * 0.55) * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol * a * 1.6, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.glint = new Mesh(quad, this.glintMat);
    this.glint.frustumCulled = false;
    this.glint.renderOrder = 3;
    this.glint.name = 'pickup-glints';
    this.group.add(this.glint);
    // 准星指着的那一件：脚下一个圈
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3));
    rg.setIndex([0, 2, 1, 0, 3, 2]);
    this.ring = new Mesh(
      rg,
      new ShaderMaterial({
        uniforms: { uTime: this.glintMat.uniforms.uTime as { value: number } },
        vertexShader: `varying vec2 vUv; void main() { vUv = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float a = smoothstep(0.1, 0.0, abs(r - 0.82)) * (0.55 + 0.25 * sin(uTime * 6.0));
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.5) * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.ring.name = 'pickup-ring';
    this.group.add(this.ring);
  }

  // ---------------------------------------------------------------- 模型

  /** 登记一个不在道具清单里的模型（已经是真实大小、长边沿 X、底面在 0） */
  addModel(id: string, file: string, size: [number, number, number]): void {
    this.extra.set(id, { file, size });
    this.dirty = true;
  }

  private sizeOf(model: string): [number, number, number] {
    return SIZE[model] ?? this.extra.get(model)?.size ?? [0.3, 0.3, 0.3];
  }

  /** 用到才加载。加载好以前这种东西先只有光点 */
  private batch(model: string): Batch | null {
    const hit = this.batches.get(model);
    if (hit) return hit;
    if (this.loading.has(model)) return null;
    const f = this.assets[model] ?? this.extra.get(model);
    if (!f) return null;
    this.loading.add(model);
    void loadModel(this.loader, f.file, model)
      .then((md) => {
        const by = new Map<Material, BufferGeometry[]>();
        for (const part of md.parts) {
          const g = part.geo.clone().applyMatrix4(part.local);
          const mat = (Array.isArray(part.mat) ? part.mat[0] : part.mat) as Material;
          // 透射玻璃会让整个场景画两遍（见 sitesView.ts 的 mergeParts）
          const glass = mat as MeshStandardMaterial & { transmission?: number };
          if ((glass.transmission ?? 0) > 0) {
            glass.transmission = 0;
            glass.transparent = true;
            glass.opacity = Math.min(glass.opacity, 0.3);
            glass.depthWrite = false;
          }
          const keep = (mat as MeshStandardMaterial).vertexColors && g.getAttribute('color') ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
          if ((mat as MeshStandardMaterial).vertexColors && !g.getAttribute('color')) (mat as MeshStandardMaterial).vertexColors = false;
          for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
          if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
          const list = by.get(mat) ?? [];
          list.push(g);
          by.set(mat, list);
        }
        const b: Batch = { meshes: [], n: 0 };
        for (const [mat, geos] of by) {
          const geo = geos.length === 1 ? (geos[0] as BufferGeometry) : mergeGeometries(geos, false);
          if (!geo) continue;
          const im = new InstancedMesh(geo, mat, CAP);
          // 实例颜色一开始就建好：着色器从第一帧起就带着它，之后不会因为它重新编译
          im.setColorAt(0, _col.setHex(0xffffff));
          im.count = 0;
          im.visible = false;
          im.frustumCulled = false;
          im.castShadow = false;
          im.receiveShadow = true;
          im.matrixAutoUpdate = false;
          im.name = `pickup:${model}`;
          this.group.add(im);
          b.meshes.push(im);
        }
        this.batches.set(model, b);
        this.dirty = true;
      })
      .catch((e: unknown) => console.warn(`拾取：模型 ${model} 加载失败`, e));
    return null;
  }

  // ---------------------------------------------------------------- 地点里的战利品

  private gen(site: Site): Pickup[] | null {
    const c = this.world.sites.peek(site);
    if (!c) return null;
    const lv = siteLevel(site);
    const out: Pickup[] = [];
    if (!this.siteLoot) return out;
    for (let i = 0; i < c.loot.length; i++) {
      const sp = c.loot[i] as (typeof c.loot)[number];
      const key = `${site.key}:${i}`;
      if (this.taken.has(key)) continue;
      const rng = new Rng((this.world.seed ^ Math.imul(site.key, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0);
      if (rng.next() > FILL[sp.place]) continue;
      const d = rollLoot(sp.place, lv, () => rng.next());
      // 找到的枪里多半只剩小半个弹匣
      const gun = ITEMS[d.item]?.gun;
      const loaded = gun ? Math.floor(rng.next() * (magOf(gun) * 0.6 + 1)) : 0;
      out.push({ item: d.item, n: d.n, x: sp.x, y: sp.y, z: sp.z, ry: rng.range(0, 6.28), loaded, key, gone: false });
    }
    return out;
  }

  /** 捡走 / 用掉一件 */
  remove(p: Pickup): void {
    if (p.gone) return;
    p.gone = true;
    if (p.key) this.taken.add(p.key);
    else {
      const i = this.drops.indexOf(p);
      if (i >= 0) this.drops.splice(i, 1);
    }
    if (this.target === p) this.target = null;
    this.dirty = true;
  }

  /** 在 (x, y, z) 放一件丢下的东西 */
  dropAt(item: string, n: number, loaded: number, x: number, y: number, z: number): Pickup | null {
    if (!ITEMS[item] || n <= 0) return null;
    // 同一个地方已经有一堆同样的东西：并进去
    const def = ITEMS[item] as ItemDef;
    if (def.kind !== 'gun' && def.kind !== 'melee' && def.kind !== 'gear') {
      for (const d of this.drops) {
        if (d.item === item && Math.abs(d.x - x) < 0.5 && Math.abs(d.z - z) < 0.5 && Math.abs(d.y - y) < 0.5) {
          d.n += n;
          return d;
        }
      }
    }
    const p: Pickup = { item, n, x, y, z, ry: Math.random() * 6.28, loaded, key: '', gone: false };
    this.drops.push(p);
    if (this.drops.length > 300) this.drops.shift();
    this.dirty = true;
    return p;
  }

  // ---------------------------------------------------------------- 每帧

  /** eye* = 眼睛的位置，d* = 视线方向（归一化）。canReach = false（开车、死了）时不选目标 */
  update(dt: number, px: number, pz: number, ex: number, ey: number, ez: number, dx: number, dy: number, dz: number, canReach: boolean): void {
    this.time += dt;
    (this.glintMat.uniforms.uTime as { value: number }).value = this.time;
    // 附近地点的战利品：半秒看一次有没有新加载的地点
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.near.length = 0;
      this.world.sites.near(px, pz, 130, this.near);
      for (const s of this.near) {
        if (this.bySite.has(s.key)) continue;
        const items = this.gen(s);
        if (items) {
          this.bySite.set(s.key, { site: s, items });
          this.dirty = true;
        }
      }
      for (const [k, v] of this.bySite) {
        if (Math.hypot(v.site.x - px, v.site.z - pz) - v.site.r > 320) this.bySite.delete(k);
      }
    }
    // 画哪些：走了两米以上、或者东西有变化才重排
    this.showT -= dt;
    if ((this.dirty && this.showT <= 0) || Math.hypot(px - this.lastX, pz - this.lastZ) > 2) {
      this.dirty = false;
      this.showT = 0.1;
      this.lastX = px;
      this.lastZ = pz;
      this.refresh(px, pz);
    }
    // 准星指着哪一件
    let best: Pickup | null = null;
    if (canReach) {
      let bestScore = Infinity;
      for (const p of this.shown) {
        if (p.gone) continue;
        const def = ITEMS[p.item] as ItemDef;
        const h = this.heightOf(def);
        const vx = p.x - ex;
        const vy = p.y + h * 0.5 - ey;
        const vz = p.z - ez;
        const d = Math.hypot(vx, vy, vz);
        if (d > REACH) continue;
        const t = vx * dx + vy * dy + vz * dz;
        if (t < 0.05) continue;
        // 到视线的垂直距离：0.34 米以内算指着；东西越小判定越宽松不了，统一用这个数
        const perp = Math.sqrt(Math.max(0, d * d - t * t));
        if (perp > 0.34) continue;
        const score = perp + d * 0.04;
        if (score >= bestScore) continue;
        // 隔着墙够不着（架子上的东西在架子的碰撞盒里，所以最后 0.6 米不算）
        const hit = this.world.raycast(ex, ey, ez, vx / d, vy / d, vz / d, d, false);
        if (hit < d - 0.6) continue;
        bestScore = score;
        best = p;
      }
    }
    this.target = best;
    if (best) {
      const def = ITEMS[best.item] as ItemDef;
      const r = Math.max(0.16, this.radiusOf(def) * 1.15);
      this.ring.position.set(best.x, best.y + 0.012, best.z);
      this.ring.scale.set(r, 1, r);
      this.ring.visible = true;
    } else this.ring.visible = false;
  }

  private heightOf(def: ItemDef): number {
    const s = this.sizeOf(def.model);
    return (def.flat ? s[2] : s[1]) * def.scale;
  }

  private radiusOf(def: ItemDef): number {
    const s = this.sizeOf(def.model);
    return (Math.max(s[0], def.flat ? s[1] : s[2]) * def.scale) / 2;
  }

  private refresh(px: number, pz: number): void {
    const shown = this.shown;
    shown.length = 0;
    const r2 = R_SHOW * R_SHOW;
    const add = (p: Pickup): void => {
      if (p.gone) return;
      const ddx = p.x - px;
      const ddz = p.z - pz;
      if (ddx * ddx + ddz * ddz < r2) shown.push(p);
    };
    for (const v of this.bySite.values()) for (const p of v.items) add(p);
    for (const p of this.drops) add(p);
    for (const b of this.batches.values()) b.n = 0;
    let g = 0;
    const gp = this.glintPos.array as Float32Array;
    const gc = this.glintCol.array as Float32Array;
    for (const p of shown) {
      const def = ITEMS[p.item] as ItemDef;
      const h = this.heightOf(def);
      if (g < GLINTS) {
        gp[g * 3] = p.x;
        gp[g * 3 + 1] = p.y + h + 0.1;
        gp[g * 3 + 2] = p.z;
        const c = RARE_COLOR[def.rare] ?? (RARE_COLOR[0] as [number, number, number]);
        gc[g * 3] = c[0];
        gc[g * 3 + 1] = c[1];
        gc[g * 3 + 2] = c[2];
        g++;
      }
      const b = this.batch(def.model);
      if (!b || b.n >= CAP) continue;
      const size = this.sizeOf(def.model);
      _q.setFromAxisAngle(_up, p.ry);
      if (def.flat) {
        // 立着建模的东西（枪、球棒）放倒：绕自身 X 轴转 -90°，底面落在 y 上
        _q.multiply(_qx.setFromAxisAngle(_xAxis, -Math.PI / 2));
        const k = (size[1] * def.scale) / 2;
        _p.set(p.x + Math.sin(p.ry) * k, p.y + (size[2] * def.scale) / 2, p.z + Math.cos(p.ry) * k);
      } else _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s.setScalar(def.scale));
      _col.setHex(def.tint ?? 0xffffff);
      for (const im of b.meshes) {
        im.setMatrixAt(b.n, _m);
        im.setColorAt(b.n, _col);
      }
      b.n++;
    }
    for (const b of this.batches.values()) {
      for (const im of b.meshes) {
        im.count = b.n;
        im.visible = b.n > 0;
        if (b.n) {
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
      }
    }
    (this.glint.geometry as InstancedBufferGeometry).instanceCount = g;
    this.glint.visible = g > 0;
    this.glintPos.needsUpdate = true;
    this.glintCol.needsUpdate = true;
  }

  /** 现在画着几件（调试 / 测试用） */
  stats(): { shown: number; sites: number; drops: number; taken: number } {
    return { shown: this.shown.length, sites: this.bySite.size, drops: this.drops.length, taken: this.taken.size };
  }

  /** 附近的东西（调试 / 测试用） */
  list(): Pickup[] {
    return this.shown.filter((p) => !p.gone);
  }

  save(): unknown {
    return { taken: [...this.taken], drops: this.drops.map((d) => [d.item, d.n, Math.round(d.x * 100) / 100, Math.round(d.y * 100) / 100, Math.round(d.z * 100) / 100, d.loaded]) };
  }

  load(data: unknown): void {
    const d = data as { taken?: string[]; drops?: Array<[string, number, number, number, number, number]> } | null;
    this.taken.clear();
    this.drops = [];
    this.bySite.clear();
    if (d && typeof d === 'object') {
      for (const k of d.taken ?? []) this.taken.add(k);
      for (const q of d.drops ?? []) if (ITEMS[q[0]]) this.drops.push({ item: q[0], n: q[1], x: q[2], y: q[3], z: q[4], ry: (q[2] * 7 + q[4] * 3) % 6.28, loaded: q[5] ?? 0, key: '', gone: false });
    }
    this.scanT = 0;
    this.dirty = true;
  }
}
