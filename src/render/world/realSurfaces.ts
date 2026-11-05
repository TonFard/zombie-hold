import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  DataArrayTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID_H, GRID_W, Ground, type Grid } from '../../game/world/grid';
import type { MapData, WallStyle } from '../../game/world/types';
import { makeGroundTexture } from './ground';
import { rectOf } from './props/kit';

/**
 * 写实地面和墙面（Poly Haven 平铺 PBR 贴图）。
 * - 地面：一张 80×80 的平面，着色器按"地面类型权重图"混合 6 套贴图（贴图数组，省采样器），
 *   上面再叠一层程序画的细节（标线、油渍、血迹、接触阴影），原来的设计都保留。
 * - 墙：每段墙一个盒子，UV 按世界尺寸展开，同风格合并成一个网格；窗、钢柱、铁丝网这些细节仍由程序模型补上。
 */

export interface SurfaceManifest {
  textures: Record<string, string>;
}

type Kit = { diff: Texture; nor: Texture; arm: Texture };

const BASE = `${import.meta.env.BASE_URL}props/`;

async function loadKit(loader: TextureLoader, dir: string, anisotropy: number): Promise<Kit> {
  const [diff, nor, arm] = (await Promise.all(['diff', 'nor', 'arm'].map((n) => loader.loadAsync(`${BASE}${dir}${n}.jpg`)))) as [Texture, Texture, Texture];
  for (const t of [diff, nor, arm]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = anisotropy;
  }
  diff.colorSpace = SRGBColorSpace;
  nor.colorSpace = NoColorSpace;
  arm.colorSpace = NoColorSpace;
  return { diff, nor, arm };
}

// ---------------------------------------------------------------- 墙

/** 盒子 UV 按世界尺寸展开：每个面 1 次平铺 = tile 米 */
function worldBox(w: number, h: number, d: number, tile: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const n = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const su = nx > 0.5 ? d : w;
    const sv = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
  }
  g.translate(0, h / 2, 0);
  return g;
}

const WALL_TILE: Record<WallStyle, number> = { compound: 2.4, brick: 1.4, plaster: 2.0, metal: 1.6 };
export const WALL_KEY: Record<WallStyle, string> = { compound: 'wall_concrete', brick: 'wall_brick', plaster: 'wall_plaster', metal: 'wall_metal' };

function placeBox(g: BufferGeometry, horiz: boolean, x: number, y: number, z: number): BufferGeometry {
  if (!horiz) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function buildWalls(map: MapData, kits: Record<string, Kit>): Group {
  const group = new Group();
  const by = new Map<WallStyle, BufferGeometry[]>();
  for (const p of map.props) {
    if (p.kind !== 'wall' && p.kind !== 'doorframe' && p.kind !== 'window') continue;
    const style = p.style ?? 'compound';
    if (!kits[WALL_KEY[style]]) continue;
    const r = rectOf(p);
    const h = p.h ?? 2.4;
    const tile = WALL_TILE[style];
    const list = by.get(style) ?? [];
    // 单格的门 / 窗方向看 side / rot，长段的墙看长宽
    const horiz = p.kind === 'window' ? (p.rot ?? 0) % 2 === 0 : p.side ? p.side === 'N' || p.side === 'S' : r.horiz;
    if (p.kind === 'wall') {
      list.push(placeBox(worldBox(r.L, h, 0.92, tile), r.horiz, r.cx, 0, r.cz));
      // 勒脚：盖住墙和地面的交线
      list.push(placeBox(worldBox(r.L + 0.04, 0.3, 1.0, tile), r.horiz, r.cx, 0, r.cz));
    } else if (p.kind === 'window') {
      // 窗台：挡人的那截矮墙
      list.push(placeBox(worldBox(1, p.h ?? 0.95, 0.92, tile), horiz, r.cx, 0, r.cz));
    } else if (p.variant === 9) {
      // 窗楣：窗洞（到 2.2 米）以上的墙
      list.push(placeBox(worldBox(r.L, h - 2.2, 0.92, tile), horiz, r.cx, 2.2, r.cz));
    } else if (p.house !== undefined) {
      const top = Math.min(2.25, h - 0.3);
      list.push(placeBox(worldBox(r.L, h - top, 0.92, tile), horiz, r.cx, top, r.cz));
    } else {
      // 门洞上方的过梁
      list.push(placeBox(worldBox(r.L, 0.5, 0.92, tile), r.horiz, r.cx, h - 0.5, r.cz));
    }
    by.set(style, list);
  }
  for (const [style, geos] of by) {
    const kit = kits[WALL_KEY[style]] as Kit;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const metal = style === 'metal';
    const mat = new MeshStandardMaterial({
      map: kit.diff,
      normalMap: kit.nor,
      roughnessMap: kit.arm,
      metalnessMap: metal ? kit.arm : null,
      roughness: 1,
      metalness: metal ? 0.9 : 0,
      color: style === 'compound' ? 0xc9c5bc : 0xffffff,
    });
    const m = new Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = `wall:${style}`;
    group.add(m);
  }
  return group;
}

// ---------------------------------------------------------------- 地面

/** 地面类型 → 贴图数组层，以及每层平铺尺寸（米）和粗糙度 */
const LAYERS: Array<{ g: number; key: string; tile: number; rough: number }> = [
  { g: Ground.Grass, key: 'grass', tile: 3.0, rough: 1.0 },
  { g: Ground.Dirt, key: 'dirt', tile: 3.5, rough: 1.0 },
  { g: Ground.Asphalt, key: 'asphalt', tile: 3.0, rough: 0.9 },
  { g: Ground.Concrete, key: 'concrete', tile: 3.0, rough: 0.88 },
  { g: Ground.Floor, key: 'floor', tile: 2.0, rough: 0.8 },
  { g: Ground.Gravel, key: 'gravel', tile: 2.5, rough: 0.95 },
];

/** 两张 RGB 权重图（6 个通道 = 6 种地面），模糊一下让交界过渡约 1 米 */
function weightTextures(grid: Grid): [CanvasTexture, CanvasTexture] {
  const S = 4;
  const W = GRID_W * S;
  const H = GRID_H * S;
  const make = (k: number): CanvasTexture => {
    const raw = document.createElement('canvas');
    raw.width = W;
    raw.height = H;
    const rctx = raw.getContext('2d') as CanvasRenderingContext2D;
    const img = rctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const g = grid.ground[Math.floor(y / S) * GRID_W + Math.floor(x / S)] as number;
        const layer = LAYERS.findIndex((l) => l.g === g);
        const i = (y * W + x) * 4;
        // alpha 一律 255，避免预乘吃掉颜色
        img.data[i] = layer === k * 3 ? 255 : 0;
        img.data[i + 1] = layer === k * 3 + 1 ? 255 : 0;
        img.data[i + 2] = layer === k * 3 + 2 ? 255 : 0;
        img.data[i + 3] = 255;
      }
    }
    rctx.putImageData(img, 0, 0);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.filter = 'blur(2.5px)';
    ctx.drawImage(raw, 0, 0);
    const t = new CanvasTexture(c);
    t.colorSpace = NoColorSpace;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  };
  return [make(0), make(1)];
}

/** 把 6 张同尺寸贴图打包成一个贴图数组 */
async function arrayTexture(urls: string[], srgb: boolean, anisotropy: number): Promise<DataArrayTexture> {
  const imgs = await Promise.all(
    urls.map(
      (u) =>
        new Promise<HTMLImageElement>((ok, bad) => {
          const im = new Image();
          im.onload = () => ok(im);
          im.onerror = () => bad(new Error(u));
          im.src = u;
        }),
    ),
  );
  const S = 1024;
  const data = new Uint8Array(S * S * 4 * imgs.length);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  // 数据贴图不做 flipY：画布上下翻转后再读，v 方向和普通贴图一致（法线的 G 通道才对）
  ctx.setTransform(1, 0, 0, -1, 0, S);
  imgs.forEach((im, i) => {
    ctx.drawImage(im, 0, 0, S, S);
    data.set(ctx.getImageData(0, 0, S, S).data, i * S * S * 4);
  });
  const t = new DataArrayTexture(data, S, S, imgs.length);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

async function buildGround(map: MapData, m: SurfaceManifest, anisotropy: number): Promise<{ mesh: Mesh; dispose(): void } | null> {
  if (!LAYERS.every((l) => m.textures[l.key])) return null;
  const dirs = LAYERS.map((l) => `${BASE}${m.textures[l.key]}`);
  const [diffArr, norArr] = await Promise.all([arrayTexture(dirs.map((d) => `${d}diff.jpg`), true, anisotropy), arrayTexture(dirs.map((d) => `${d}nor.jpg`), false, anisotropy)]);
  const [w0, w1] = weightTextures(map.grid);
  // 细节层：标线、裂缝、油渍、血迹、草丛、接触阴影、边缘压暗——透明底，盖在写实贴图上
  const overlay = makeGroundTexture(map.grid, anisotropy, true);
  const mat = new MeshStandardMaterial({ map: overlay, normalMap: overlay, roughness: 1, metalness: 0 });
  const tiles = LAYERS.map((l) => (GRID_W / l.tile).toFixed(3));
  const roughs = LAYERS.map((l) => l.rough.toFixed(3));
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDiff = { value: diffArr };
    sh.uniforms.uNor = { value: norArr };
    sh.uniforms.uW0 = { value: w0 };
    sh.uniforms.uW1 = { value: w1 };
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray uDiff;
uniform highp sampler2DArray uNor;
uniform sampler2D uW0;
uniform sampler2D uW1;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 w0 = texture2D(uW0, vMapUv).rgb;
vec3 w1 = texture2D(uW1, vMapUv).rgb;
float ws[6] = float[6](w0.r, w0.g, w0.b, w1.r, w1.g, w1.b);
float tl[6] = float[6](${tiles.join(', ')});
float rg[6] = float[6](${roughs.join(', ')});
vec3 gAlb = vec3(0.0);
vec3 gNor = vec3(0.0);
float gRough = 0.0;
float gSum = 0.0;
for (int i = 0; i < 6; i++) {
  float w = ws[i];
  if (w < 0.004) continue;
  vec2 tuv = vMapUv * tl[i];
  gAlb += texture(uDiff, vec3(tuv, float(i))).rgb * w;
  gNor += texture(uNor, vec3(tuv, float(i))).xyz * w;
  gRough += rg[i] * w;
  gSum += w;
}
gSum = max(gSum, 1e-3);
gAlb /= gSum;
gNor /= gSum;
gRough /= gSum;
vec4 ov = texture2D(map, vMapUv);
diffuseColor.rgb *= mix(gAlb, ov.rgb, ov.a);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gRough;')
      .replaceAll('texture2D( normalMap, vNormalMapUv ).xyz', 'gNor');
  };
  // 每次编译都是同一份代码，按 key 缓存
  mat.customProgramCacheKey = () => 'realGround';
  const mesh = new Mesh(new PlaneGeometry(GRID_W, GRID_H), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'realGround';
  return {
    mesh,
    dispose() {
      for (const t of [diffArr, norArr, w0, w1, overlay]) t.dispose();
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- 加油棚、立柱、门框

/** 这些种类改由写实材质的简单几何体负责（程序模型不再建） */
export const STRUCT_KINDS = ['canopy', 'pillar', 'doorframe'] as const;

function pbr(kit: Kit, o: { color?: number; metal?: boolean; tint?: number } = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: kit.diff,
    normalMap: kit.nor,
    roughnessMap: kit.arm,
    metalnessMap: o.metal ? kit.arm : null,
    roughness: 1,
    metalness: o.metal ? 0.85 : 0,
    color: o.color ?? 0xffffff,
  });
}

/**
 * 加油棚：厚檐口（红白涂装）+ 顶板 + 吊顶灯；立柱：方形混凝土柱 + 防撞黄黑漆；门框：金属包边。
 * 都是简单盒子，靠贴图出质感。灯管用自发光材质，接 Bloom。
 */
function buildStructs(map: MapData, kits: Record<string, Kit>): Group {
  const group = new Group();
  const metalKit = kits.trim_metal;
  // 涂装部分用白色抹灰贴图再染色（绿色的 painted_concrete 一染红就发脏）
  const paintKit = kits.wall_plaster;
  const concKit = kits.wall_concrete;
  if (!metalKit || !paintKit || !concKit) return group;
  const red: BufferGeometry[] = [];
  const white: BufferGeometry[] = [];
  const steel: BufferGeometry[] = [];
  const conc: BufferGeometry[] = [];
  const hazard: BufferGeometry[] = [];
  const lights: BufferGeometry[] = [];
  for (const p of map.props) {
    const r = rectOf(p);
    if (p.kind === 'canopy') {
      const h = p.h ?? 3.6;
      const w = p.x1 - p.x0;
      const d = p.y1 - p.y0;
      // 檐口：外圈 0.7 米高的盒子，上半红、下半白
      const fascia = (len: number, x: number, z: number, along: boolean) => {
        const a = worldBox(len, 0.38, 0.22, 2);
        const b2 = worldBox(len, 0.3, 0.22, 2);
        if (!along) a.rotateY(Math.PI / 2), b2.rotateY(Math.PI / 2);
        a.translate(x, h + 0.3, z);
        b2.translate(x, h, z);
        red.push(a);
        white.push(b2);
      };
      fascia(w + 0.22, r.cx, r.cz - d / 2, true);
      fascia(w + 0.22, r.cx, r.cz + d / 2, true);
      fascia(d, r.cx - w / 2, r.cz, false);
      fascia(d, r.cx + w / 2, r.cz, false);
      // 顶板（下表面看得见：白色涂装）+ 屋面
      white.push(worldBox(w, 0.06, d, 3).translate(r.cx, h + 0.1, r.cz));
      steel.push(worldBox(w + 0.1, 0.05, d + 0.1, 2).translate(r.cx, h + 0.66, r.cz));
      // 吊顶灯带
      for (const z of [-d / 4, d / 4]) {
        for (let x = -w / 2 + 2; x < w / 2 - 0.5; x += 3.5) lights.push(new BoxGeometry(0.9, 0.05, 0.22).translate(r.cx + x, h + 0.07, r.cz + z));
      }
    } else if (p.kind === 'pillar') {
      const h = p.h ?? 3.6;
      conc.push(worldBox(0.44, h, 0.44, 1.5).translate(r.cx, 0, r.cz));
      conc.push(worldBox(0.7, 0.18, 0.7, 1.5).translate(r.cx, 0, r.cz));
      // 防撞漆：黄黑相间的三段
      for (let i = 0; i < 4; i++) (i % 2 ? steel : hazard).push(worldBox(0.46, 0.18, 0.46, 1).translate(r.cx, 0.25 + i * 0.18, r.cz));
    } else if (p.kind === 'doorframe' && p.house === undefined) {
      const h = p.h ?? 2.4;
      for (const s of [-1, 1]) {
        const g = worldBox(0.16, h, 1.02, 1.2);
        g.translate(s * (r.L / 2 - 0.08), 0, 0);
        if (!r.horiz) g.rotateY(Math.PI / 2);
        steel.push(g.translate(r.cx, 0, r.cz));
      }
      const top = worldBox(r.L, 0.14, 1.02, 1.2);
      if (!r.horiz) top.rotateY(Math.PI / 2);
      steel.push(top.translate(r.cx, h - 0.64, r.cz));
    }
  }
  const add = (geos: BufferGeometry[], mat: MeshStandardMaterial | MeshBasicMaterial, name: string, shadow = true) => {
    const g = geos.length ? mergeGeometries(geos, false) : null;
    for (const x of geos) x.dispose();
    if (!g) return;
    const m = new Mesh(g, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    m.name = name;
    group.add(m);
  };
  add(red, pbr(paintKit, { color: 0xc23a2c }), 'canopy:red');
  add(white, pbr(paintKit, { color: 0xe8e4dc }), 'canopy:white');
  add(steel, pbr(metalKit, { metal: true, color: 0x9aa0a4 }), 'trim:steel');
  add(conc, pbr(concKit, { color: 0xd8d4cc }), 'pillar');
  add(hazard, pbr(paintKit, { color: 0xe0b020 }), 'pillar:hazard');
  add(lights, new MeshBasicMaterial({ color: 0xeaf2ff, toneMapped: false }), 'canopy:lights', false);
  return group;
}

// ---------------------------------------------------------------- 屋顶

/**
 * 平顶房：一块屋面（外面看到的沥青油毡）+ 一块天花板（屋里抬头看到的抹灰），每栋房子一个 Group，
 * 玩家走进屋里时由视图把这栋的屋面藏起来，不挡视线（天花板仍在，屋里看起来是封闭的）。
 */
function buildRoofs(map: MapData, kits: Record<string, Kit>): Group[] {
  const roofKit = kits.roof;
  const ceilKit = kits.wall_plaster;
  const out: Group[] = [];
  if (!roofKit || !ceilKit) return out;
  const roofMat = pbr(roofKit, { color: 0x9a948a });
  const ceilMat = pbr(ceilKit, { color: 0xd8d2c6 });
  for (const h of map.houses) {
    const g = new Group();
    g.name = 'roof';
    if (h.roof === 'flat') {
      const w = h.x1 - h.x0;
      const d = h.y1 - h.y0;
      const cx = (h.x0 + h.x1) / 2 - GRID_W / 2;
      const cz = (h.y0 + h.y1) / 2 - GRID_H / 2;
      // 屋面略出檐，压在墙顶上
      const top = new Mesh(worldBox(w + 0.3, 0.18, d + 0.3, 3).translate(cx, h.h, cz), roofMat);
      top.castShadow = true;
      top.receiveShadow = true;
      top.name = 'roof:top';
      // 天花板：墙内侧，从下面看
      const ceil = new Mesh(worldBox(w - 1.6, 0.04, d - 1.6, 2.5).translate(cx, h.h - 0.05, cz), ceilMat);
      ceil.receiveShadow = true;
      ceil.name = 'roof:ceiling';
      g.add(top, ceil);
    }
    out.push(g);
  }
  return out;
}

export interface RealSurfaces {
  walls: Group;
  ground: Mesh | null;
  /** 每栋房子的屋顶（和 MapData.houses 一一对应；没有屋顶的是空 Group） */
  roofs: Group[];
  dispose(): void;
}

export async function buildRealSurfaces(map: MapData, m: SurfaceManifest, anisotropy: number): Promise<RealSurfaces> {
  const loader = new TextureLoader();
  const kits: Record<string, Kit> = {};
  await Promise.all(
    [...Object.values(WALL_KEY), 'trim_metal', 'roof'].map(async (key) => {
      const dir = m.textures[key];
      if (!dir) return;
      try {
        kits[key] = await loadKit(loader, dir, anisotropy);
      } catch (e) {
        console.warn(`墙面贴图 ${key} 加载失败`, e);
      }
    }),
  );
  const walls = buildWalls(map, kits);
  const structs = buildStructs(map, kits);
  for (const c of [...structs.children]) walls.add(c);
  const roofs = buildRoofs(map, kits);
  let ground: Awaited<ReturnType<typeof buildGround>> = null;
  try {
    ground = await buildGround(map, m, anisotropy);
  } catch (e) {
    console.warn('写实地面加载失败', e);
  }
  return {
    walls,
    ground: ground?.mesh ?? null,
    roofs,
    dispose() {
      for (const r of roofs) for (const c of r.children) (c as Mesh).geometry.dispose();
      ground?.dispose();
      for (const c of walls.children) {
        const mesh = c as Mesh;
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial | MeshBasicMaterial).dispose();
      }
      for (const k of Object.values(kits)) for (const t of [k.diff, k.nor, k.arm]) t.dispose();
    },
  };
}

/** 加油棚、立柱、门框是否已经换成写实版 */
export function hasStructs(m: SurfaceManifest): boolean {
  return !!(m.textures.trim_metal && m.textures.wall_plaster && m.textures.wall_concrete);
}

/** 有写实墙面贴图的风格：这些墙的程序模型只建细节 */
export function realWallStyles(m: SurfaceManifest): Set<WallStyle> {
  return new Set((Object.keys(WALL_KEY) as WallStyle[]).filter((s) => m.textures[WALL_KEY[s]]));
}
