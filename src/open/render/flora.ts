import {
  AmbientLight,
  type BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  OrthographicCamera,
  BufferGeometry as Geo,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadModel } from '../../render/world/realProps';
import { hash2 } from '../world/noise';
import { BASE, plantsInCell, type Plant } from '../world/chunkgen';
import type { World } from '../world/world';
import { SNOW_RGB, WX } from './wx';

/**
 * 植被：树、灌木、石头、倒木。
 * - 近处（树 68 米内）是真模型：每种模型一个实例池，玩家走出几米才重填一次。
 * - 远处的树是两片交叉的面片（开局时把每种树拍成一张图），按 256 米一块合批，一块一次绘制，能看到 1 公里外的林子。
 * - 两者之间用抖动溶解过渡，不会"啪"地跳一下。叶子有轻微的风。
 */

/** 树的槽位：0–3 = 活树（chunkgen 的品种），4 = 枯树 */
const TREES = [
  { id: 'tree_pine_a', k: 1.15, wind: 0.012 },
  { id: 'tree_pine_b', k: 1.2, wind: 0.01 },
  { id: 'tree_leaf_a', k: 0.72, wind: 0.02 },
  { id: 'tree_leaf_b', k: 0.85, wind: 0.016 },
  { id: 'tree_winter', k: 0.85, wind: 0 },
];
const BUSH = 'bush_a';
const ROCK_BIG = 'namaqualand_boulder_04';
const ROCK_FLAT = 'namaqualand_boulder_05';
const LOG = 'dead_tree_trunk';

/** 真模型画到多远（米） */
const R_TREE = 68;
const R_BUSH = 105;
const R_ROCK = 150;
/** 面片树画到多远 */
export const R_FAR = 1050;
const TILE = 256;
const ATLAS_W = 256;
const ATLAS_H = 512;

const treeSlot = (kind: number) => (kind === 7 ? 4 : kind);
export const treeHeight = (p: Plant) => p.s * (TREES[treeSlot(p.kind)] as { k: number }).k;

interface Pool {
  meshes: InstancedMesh[];
  /** 模型尺寸（归一化后） */
  sx: number;
  sy: number;
  cap: number;
  n: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _c = new Color();

const DITHER = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';

export interface FloraView {
  group: Group;
  update(camera: PerspectiveCamera, dt: number, budgetMs: number): void;
  settle(camera: PerspectiveCamera): void;
  /** 画质档位：树 / 灌木 / 石头的真模型画到多远，面片树画到多远（米） */
  setQuality(q: { tree: number; bush: number; rock: number; far: number }): void;
  stats(): { near: number; tiles: number; far: number; pending: number };
  dispose(): void;
}

export async function buildFloraView(world: World, files: Record<string, { file: string }>, renderer: WebGLRenderer): Promise<FloraView> {
  const loader = new GLTFLoader();
  const uCam = { value: new Vector3() };
  const uTime = { value: 0 };
  const group = new Group();
  group.name = 'flora';
  /** 真模型 / 面片树画到多远：按画质档位改（setQuality）。前三个同时是着色器里溶解距离的 uniform */
  const uTreeR = { value: R_TREE };
  const uBushR = { value: R_BUSH };
  const uRockR = { value: R_ROCK };
  let rFar = R_FAR;

  /** 近处模型的材质：加上按距离溶解和风 */
  const patch = (mat: Material, fadeR: { value: number }, wind: number, tint: number | null): Material => {
    const m = mat.clone();
    if (tint !== null) (m as MeshStandardMaterial).color.setHex(tint);
    const uR = fadeR;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCam = uCam;
      sh.uniforms.uTime = uTime;
      sh.uniforms.uFadeR = uR;
      sh.uniforms.uWxSnow = WX.snow;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCam;\nuniform float uTime;\nuniform float uFadeR;\nvarying float vFade;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 iO = instanceMatrix[3].xyz;
vFade = smoothstep(uFadeR - 10.0, uFadeR, distance(iO.xz, uCam.xz));
${wind > 0 ? `float wv = uTime * 1.3 + iO.x * 0.7 + iO.z * 0.5;
transformed.x += (sin(wv + transformed.y * 0.7) + 0.5 * sin(wv * 2.3 + transformed.z * 2.0)) * ${wind.toFixed(4)} * transformed.y;
transformed.z += cos(wv * 0.8 + transformed.y * 0.5) * ${(wind * 0.7).toFixed(4)} * transformed.y;` : ''}
#else
vFade = 0.0;
#endif`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;\nuniform float uWxSnow;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (vFade > 0.001 && ${DITHER} < vFade) discard;`)
        // 积雪（render/wx.ts）：朝上的面变白（viewMatrix[1].xyz = 世界的「上」在视图空间里的方向）
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\ndiffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_RGB}, uWxSnow * 0.9 * smoothstep(0.1, 0.65, dot(normal, viewMatrix[1].xyz)));`);
    };
    m.customProgramCacheKey = () => `flora:${wind > 0 ? wind : 0}`;
    return m;
  };

  /** 加载一个模型：同材质的零件合并；树把树干挪到正中 */
  const load = async (id: string, centerTrunk: boolean): Promise<{ parts: Array<{ geo: BufferGeometry; mat: Material }>; sx: number; sy: number } | null> => {
    const f = files[id];
    if (!f) return null;
    try {
      const model = await loadModel(loader, f.file, id);
      const by = new Map<Material, BufferGeometry[]>();
      for (const p of model.parts) {
        const g = p.geo.clone().applyMatrix4(p.local);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
        const mat = (Array.isArray(p.mat) ? p.mat[0] : p.mat) as Material;
        const map = (mat as MeshStandardMaterial).map;
        if (map && map.magFilter !== LinearFilter) {
          map.magFilter = LinearFilter;
          map.needsUpdate = true;
        }
        const list = by.get(mat) ?? [];
        list.push(g);
        by.set(mat, list);
      }
      const parts: Array<{ geo: BufferGeometry; mat: Material }> = [];
      for (const [mat, geos] of by) {
        const merged = geos.length === 1 ? (geos[0] as BufferGeometry) : mergeGeometries(geos, false);
        if (merged) parts.push({ geo: merged, mat });
      }
      if (centerTrunk) {
        // 树干 = 高度最低 6% 那一截的顶点的中心（树冠歪的树，包围盒中心不在树干上）
        let sx = 0;
        let sz = 0;
        let n = 0;
        for (const p of parts) {
          const pos = p.geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            if (pos.getY(i) > model.size.y * 0.06) continue;
            sx += pos.getX(i);
            sz += pos.getZ(i);
            n++;
          }
        }
        if (n) for (const p of parts) p.geo.translate(-sx / n, 0, -sz / n);
      }
      return { parts, sx: Math.max(model.size.x, model.size.z), sy: model.size.y };
    } catch (e) {
      console.warn(`植被模型 ${id} 加载失败`, e);
      return null;
    }
  };

  const [trees, bush, rockBig, rockFlat, log] = await Promise.all([Promise.all(TREES.map((t) => load(t.id, true))), load(BUSH, false), load(ROCK_BIG, false), load(ROCK_FLAT, false), load(LOG, false)]);

  const makePool = (model: { parts: Array<{ geo: BufferGeometry; mat: Material }>; sx: number; sy: number } | null, cap: number, fadeR: { value: number }, wind: number, shadow: boolean, tint: number | null = null): Pool | null => {
    if (!model) return null;
    const meshes = model.parts.map((p) => {
      // 叶子（透明裁切的材质）才随风动，树干不动
      const leaf = (p.mat as MeshStandardMaterial).alphaTest > 0;
      const im = new InstancedMesh(p.geo, patch(p.mat, fadeR, leaf ? wind : 0, tint), cap);
      im.count = 0;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.matrixAutoUpdate = false;
      group.add(im);
      return im;
    });
    return { meshes, sx: model.sx, sy: model.sy, cap, n: 0 };
  };
  const treePools = trees.map((t, i) => makePool(t, 260, uTreeR, (TREES[i] as { wind: number }).wind, true));
  const bushPool = makePool(bush, 520, uBushR, 0.02, false, 0x8f9c78);
  const rockPool = makePool(rockBig, 260, uRockR, 0, true, 0x8fa3b3);
  const flatPool = makePool(rockFlat, 320, uRockR, 0, false);
  const logPool = makePool(log, 80, uBushR, 0, true);

  // ---------------------------------------------------------------- 把每种树拍成一张图（面片用）
  const atlas = new WebGLRenderTarget(ATLAS_W * TREES.length, ATLAS_H, { depthBuffer: true });
  atlas.texture.colorSpace = SRGBColorSpace;
  atlas.texture.generateMipmaps = true;
  atlas.texture.minFilter = LinearMipmapLinearFilter;
  atlas.texture.magFilter = LinearFilter;
  {
    const bake = new Scene();
    // 只有环境光 + 一点顶光：拍出来的是"带一点体积感的固有色"，真正的明暗由场景里的光算
    bake.add(new AmbientLight(0xffffff, Math.PI * 0.62));
    bake.add(new HemisphereLight(0xffffff, 0x666666, Math.PI * 0.45));
    const key = new DirectionalLight(0xffffff, 0.9);
    key.position.set(-0.6, 1, 0.8);
    bake.add(key);
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevTarget = renderer.getRenderTarget();
    const prevColor = new Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(atlas);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    atlas.scissorTest = true;
    trees.forEach((t, i) => {
      atlas.viewport.set(i * ATLAS_W, 0, ATLAS_W, ATLAS_H);
      atlas.scissor.set(i * ATLAS_W, 0, ATLAS_W, ATLAS_H);
      renderer.setRenderTarget(atlas);
      renderer.clear();
      if (!t) return;
      const meshes = t.parts.map((p) => new Mesh(p.geo, p.mat));
      for (const m of meshes) bake.add(m);
      cam.left = -t.sx / 2;
      cam.right = t.sx / 2;
      cam.bottom = 0;
      cam.top = t.sy;
      cam.position.set(0, 0, 60);
      cam.lookAt(0, 0, 0);
      cam.position.y = 0;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      renderer.render(bake, cam);
      for (const m of meshes) bake.remove(m);
    });
    atlas.scissorTest = false;
    atlas.viewport.set(0, 0, ATLAS_W * TREES.length, ATLAS_H);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
  }

  // 面片：两片交叉的竖直方片，宽 1、高 1，底边在 y = 0；法线一律朝上（受光和地面一致）
  const card = new Geo();
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (const [ax, az] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const b = pos.length / 3;
      pos.push(-0.5 * ax, 0, -0.5 * az, 0.5 * ax, 0, 0.5 * az, 0.5 * ax, 1, 0.5 * az, -0.5 * ax, 1, -0.5 * az);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    card.setAttribute('position', new Float32BufferAttribute(pos, 3));
    card.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    card.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    card.setIndex(idx);
  }
  const farMat = new MeshLambertMaterial({ map: atlas.texture, alphaTest: 0.38, side: DoubleSide });
  farMat.onBeforeCompile = (sh) => {
    sh.uniforms.uCam = uCam;
    sh.uniforms.uTreeR = uTreeR;
    sh.uniforms.uWxSnow = WX.snow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;\nuniform vec3 uCam;\nuniform float uTreeR;\nvarying float vFade;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2((uv.x + aKind) / ${TREES.length.toFixed(1)}, uv.y);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFade = smoothstep(uTreeR - 10.0, uTreeR, distance(instanceMatrix[3].xz, uCam.xz));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;\nuniform float uWxSnow;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (vFade < 0.999 && ${DITHER} >= vFade) discard;`)
      // 积雪（render/wx.ts）：面片没有真的法线，按高度来——树冠白得多，树干不白
      .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_RGB}, uWxSnow * 0.6 * smoothstep(0.15, 0.8, vMapUv.y));`)
      // 面片是双面的：背面不能把法线翻过去，否则一半的面片是黑的
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
  };
  farMat.customProgramCacheKey = () => 'floraFar2';

  interface Tile {
    tx: number;
    tz: number;
    mesh: InstancedMesh | null;
    /** 还没算完的基础格下标（0–15） */
    next: number;
    plants: Plant[];
    count: number;
  }
  const tiles = new Map<number, Tile>();
  const tileKey = (tx: number, tz: number) => (tx + 8192) * 16384 + (tz + 8192);
  const CELLS = TILE / BASE;
  let farCount = 0;

  /** 往下算一块面片树；返回是否算完了 */
  const stepTile = (t: Tile, deadline: number): boolean => {
    while (t.next < CELLS * CELLS) {
      const bx = t.tx * CELLS + (t.next % CELLS);
      const bz = t.tz * CELLS + Math.floor(t.next / CELLS);
      for (const p of plantsInCell(world.terrain, bx, bz)) if (p.kind < 4 || p.kind === 7) t.plants.push(p);
      t.next++;
      if (performance.now() > deadline) return false;
    }
    const n = t.plants.length;
    t.count = n;
    if (n) {
      const im = new InstancedMesh(card, farMat, n);
      const kinds = new Float32Array(n);
      t.plants.forEach((p, i) => {
        const slot = treeSlot(p.kind);
        const model = trees[slot];
        const h = treeHeight(p);
        const w = model ? (h * model.sx) / model.sy : h * 0.5;
        _q.setFromAxisAngle(_up, p.ry);
        im.setMatrixAt(i, _m.compose(_p.set(p.x, p.y - 0.15, p.z), _q, _s.set(w, h, w)));
        // 每棵树的明暗、冷暖略有不同
        const v = hash2(Math.round(p.x * 3), Math.round(p.z * 3), 77);
        im.setColorAt(i, _c.setRGB(0.78 + v * 0.3, 0.8 + v * 0.26, 0.74 + v * 0.22));
        kinds[i] = slot;
      });
      im.geometry = card.clone();
      im.geometry.setAttribute('aKind', new InstancedBufferAttribute(kinds, 1));
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      im.name = `trees:${t.tx},${t.tz}`;
      group.add(im);
      t.mesh = im;
      farCount += n;
    }
    t.plants = [];
    return true;
  };
  const dropTile = (k: number, t: Tile) => {
    if (t.mesh) {
      group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.dispose();
      farCount -= t.count;
    }
    tiles.delete(k);
  };

  // ---------------------------------------------------------------- 近处实例池
  let lastX = Infinity;
  let lastZ = Infinity;
  let nearCount = 0;
  const near: Plant[] = [];
  const put = (pool: Pool | null, p: Plant, sx: number, sy: number, sink: number) => {
    if (!pool || pool.n >= pool.cap) return;
    _q.setFromAxisAngle(_up, p.ry);
    _m.compose(_p.set(p.x, world.groundAt(p.x, p.z) - sink, p.z), _q, _s.set(sx, sy, sx));
    for (const im of pool.meshes) im.setMatrixAt(pool.n, _m);
    pool.n++;
  };
  const refill = (x: number, z: number) => {
    lastX = x;
    lastZ = z;
    const pools = [...treePools, bushPool, rockPool, flatPool, logPool];
    for (const p of pools) if (p) p.n = 0;
    near.length = 0;
    world.plantsNear(x, z, uRockR.value + 8, near);
    nearCount = 0;
    for (const p of near) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (p.kind < 4 || p.kind === 7) {
        if (d > uTreeR.value + 8) continue;
        const pool = treePools[treeSlot(p.kind)] ?? null;
        if (pool) {
          const s = treeHeight(p) / pool.sy;
          put(pool, p, s, s, 0.15);
        }
      } else if (p.kind === 4) {
        if (d > uBushR.value + 8) continue;
        if (bushPool) {
          const s = p.s / bushPool.sy;
          put(bushPool, p, s, s, 0.08);
        }
      } else if (p.kind === 5) {
        const pool = p.s >= 1.4 ? rockPool : flatPool;
        if (pool) {
          const s = p.s / pool.sx;
          put(pool, p, s, s, p.s * 0.15);
        }
      } else if (p.kind === 6) {
        if (d > uBushR.value + 8) continue;
        if (logPool) {
          const s = p.s / logPool.sx;
          put(logPool, p, s, s, 0.06);
        }
      }
    }
    for (const p of pools) {
      if (!p) continue;
      nearCount += p.n;
      for (const im of p.meshes) {
        im.count = p.n;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  };

  let frame = 0;
  const pending: Tile[] = [];
  const update = (camera: PerspectiveCamera, dt: number, budgetMs: number): void => {
    frame++;
    uTime.value += dt;
    uCam.value.copy(camera.position);
    const x = camera.position.x;
    const z = camera.position.z;
    if (Math.hypot(x - lastX, z - lastZ) > 6) refill(x, z);
    // 面片树：范围内的块都要有；没算完的按距离排队，每帧在预算内算
    const t0 = Math.floor((x - rFar) / TILE);
    const t1 = Math.floor((x + rFar) / TILE);
    const u0 = Math.floor((z - rFar) / TILE);
    const u1 = Math.floor((z + rFar) / TILE);
    pending.length = 0;
    for (let tz = u0; tz <= u1; tz++) {
      for (let tx = t0; tx <= t1; tx++) {
        const dx = Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE);
        const dz = Math.max(tz * TILE - z, 0, z - (tz + 1) * TILE);
        if (Math.hypot(dx, dz) > rFar) continue;
        const k = tileKey(tx, tz);
        let t = tiles.get(k);
        if (!t) tiles.set(k, (t = { tx, tz, mesh: null, next: 0, plants: [], count: 0 }));
        if (t.next < CELLS * CELLS) pending.push(t);
      }
    }
    if (pending.length) {
      const d = (t: Tile) => Math.hypot((t.tx + 0.5) * TILE - x, (t.tz + 0.5) * TILE - z);
      pending.sort((a, b) => d(a) - d(b));
      const deadline = performance.now() + budgetMs;
      for (const t of pending) {
        if (!stepTile(t, deadline)) break;
        if (performance.now() > deadline) break;
      }
    }
    if (frame % 120 === 0) {
      for (const [k, t] of tiles) {
        const dx = Math.max(t.tx * TILE - x, 0, x - (t.tx + 1) * TILE);
        const dz = Math.max(t.tz * TILE - z, 0, z - (t.tz + 1) * TILE);
        if (Math.hypot(dx, dz) > rFar + TILE) dropTile(k, t);
      }
    }
  };

  return {
    group,
    update,
    settle(camera) {
      for (let k = 0; k < 400; k++) {
        update(camera, 0, 1e9);
        if (!pending.some((t) => t.next < CELLS * CELLS)) break;
      }
    },
    setQuality(q) {
      uTreeR.value = q.tree;
      uBushR.value = q.bush;
      uRockR.value = q.rock;
      rFar = q.far;
      // 下一帧重填近处的实例；远处多出来的面片块两秒内回收
      lastX = Infinity;
    },
    stats: () => ({ near: nearCount, tiles: tiles.size, far: farCount, pending: pending.length }),
    dispose() {
      for (const [k, t] of tiles) dropTile(k, t);
      atlas.dispose();
      farMat.dispose();
      card.dispose();
    },
  };
}
