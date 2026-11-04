import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  DataArrayTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
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
    if (p.kind !== 'wall' && p.kind !== 'doorframe') continue;
    const style = p.style ?? 'compound';
    if (!kits[WALL_KEY[style]]) continue;
    const r = rectOf(p);
    const h = p.h ?? 2.4;
    const tile = WALL_TILE[style];
    const list = by.get(style) ?? [];
    if (p.kind === 'wall') {
      list.push(placeBox(worldBox(r.L, h, 0.92, tile), r.horiz, r.cx, 0, r.cz));
      // 勒脚：盖住墙和地面的交线
      list.push(placeBox(worldBox(r.L + 0.04, 0.3, 1.0, tile), r.horiz, r.cx, 0, r.cz));
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

export interface RealSurfaces {
  walls: Group;
  ground: Mesh | null;
  dispose(): void;
}

export async function buildRealSurfaces(map: MapData, m: SurfaceManifest, anisotropy: number): Promise<RealSurfaces> {
  const loader = new TextureLoader();
  const kits: Record<string, Kit> = {};
  await Promise.all(
    Object.values(WALL_KEY).map(async (key) => {
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
  let ground: Awaited<ReturnType<typeof buildGround>> = null;
  try {
    ground = await buildGround(map, m, anisotropy);
  } catch (e) {
    console.warn('写实地面加载失败', e);
  }
  return {
    walls,
    ground: ground?.mesh ?? null,
    dispose() {
      ground?.dispose();
      for (const c of walls.children) {
        const mesh = c as Mesh;
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      for (const k of Object.values(kits)) for (const t of [k.diff, k.nor, k.arm]) t.dispose();
    },
  };
}

/** 有写实墙面贴图的风格：这些墙的程序模型只建细节 */
export function realWallStyles(m: SurfaceManifest): Set<WallStyle> {
  return new Set((Object.keys(WALL_KEY) as WallStyle[]).filter((s) => m.textures[WALL_KEY[s]]));
}
