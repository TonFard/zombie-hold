import {
  BufferAttribute,
  BufferGeometry,
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
  Sphere,
  Vector3,
  Box3,
  type PerspectiveCamera,
} from 'three';
import { BASE, MAX_LEVEL, ROW, SEG, chunkHeight, genChunk, type ChunkData } from '../world/chunkgen';
import { WATER } from '../world/terrain';
import type { World } from '../world/world';
import { SNOW_RGB, WX } from './wx';

/**
 * 无限地形的渲染：四叉树。每块都是 32 × 32 格，近处的块 64 米见方（2 米一格），越远的块越大（最远 512 米、16 米一格）。
 * 只生成、只画玩家周围的块，走到哪生成到哪（每帧有时间预算，不卡顿），远处的块回收。
 * 地面材质：8 层写实贴图按顶点权重混合（权重 × 贴图明暗，交界处是碎的而不是一条糊边），
 * 远处换大尺度采样（看不出平铺），陡坡的岩石按侧面投影（不拉伸），水边发湿发暗。
 */

/** 贴图层：顺序和 chunkgen 的权重一致。key 缺了就用 alt */
// hue / k：把贴图按明暗重新上色（保留纹理细节，颜色由这里定）。手头的草地贴图都是褐色 / 土黄的，
// 没有一张是真正的绿；碎石贴图是橘红的。hue 是线性空间里「平均亮度处」的目标颜色，k 是上色的比例
const LAYERS = [
  { key: 'grass', alt: 'grass', tile: 3.4, rough: 1.0, tint: [1, 1, 1], hue: [0.062, 0.104, 0.024], k: 0.86 },
  { key: 'grass_green', alt: 'grass', tile: 3.2, rough: 1.0, tint: [1, 1, 1], hue: [0.25, 0.2, 0.085], k: 0.6 },
  { key: 'forest_floor', alt: 'dirt', tile: 3.6, rough: 1.0, tint: [1, 1, 1], hue: [0.05, 0.05, 0.024], k: 0.45 },
  { key: 'mud', alt: 'dirt', tile: 3.8, rough: 1.0, tint: [1.05, 1, 0.95], hue: [0, 0, 0], k: 0 },
  { key: 'rock_cliff', alt: 'gravel', tile: 4.4, rough: 0.95, tint: [1, 1, 1], hue: [0.16, 0.155, 0.14], k: 0.55 },
  { key: 'sand', alt: 'dirt', tile: 2.8, rough: 1.0, tint: [0.95, 0.95, 0.95], hue: [0, 0, 0], k: 0 },
  { key: 'gravel', alt: 'gravel', tile: 2.6, rough: 0.96, tint: [1, 1, 1], hue: [0.15, 0.14, 0.125], k: 0.8 },
  { key: 'asphalt', alt: 'asphalt', tile: 4.0, rough: 0.9, tint: [1, 1, 1], hue: [0, 0, 0], k: 0 },
];

/** 看多远（米）；每一级在「到块的距离 < 块边长 × SPLIT」时细分 */
export const VIEW = 1250;
const SPLIT = 1.55;

export async function loadArray(urls: string[], size: number, srgb: boolean, anisotropy: number, lum?: number[]): Promise<DataArrayTexture> {
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
  const data = new Uint8Array(size * size * 4 * imgs.length);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  // 数据贴图不做 flipY：画布上下翻转后再读，v 方向和普通贴图一致
  ctx.setTransform(1, 0, 0, -1, 0, size);
  imgs.forEach((im, i) => {
    ctx.drawImage(im, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    data.set(px, i * size * size * 4);
    if (lum) {
      // 这一层的平均亮度（线性空间），重新上色时用它归一化
      let sum = 0;
      let n = 0;
      const lin = (v: number) => Math.pow(v / 255, 2.2);
      for (let k = 0; k < px.length; k += 4 * 37) {
        sum += 0.2126 * lin(px[k] as number) + 0.7152 * lin(px[k + 1] as number) + 0.0722 * lin(px[k + 2] as number);
        n++;
      }
      lum[i] = Math.max(0.005, sum / n);
    }
  });
  const t = new DataArrayTexture(data, size, size, imgs.length);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const NV = SEG + 1;
const SKIRT_N = SEG * 4;
const VERTS = NV * NV + SKIRT_N;

/** 所有块共用一份索引（拓扑完全一样） */
function sharedIndex(): { index: BufferAttribute; border: number[] } {
  const idx: number[] = [];
  for (let b = 0; b < SEG; b++) {
    for (let a = 0; a < SEG; a++) {
      const p = b * NV + a;
      idx.push(p, p + NV, p + 1, p + 1, p + NV, p + NV + 1);
    }
  }
  const border: number[] = [];
  for (let a = 0; a < SEG; a++) border.push(a);
  for (let b = 0; b < SEG; b++) border.push(b * NV + SEG);
  for (let a = SEG; a > 0; a--) border.push(SEG * NV + a);
  for (let b = SEG; b > 0; b--) border.push(b * NV);
  for (let k = 0; k < SKIRT_N; k++) {
    const t0 = border[k] as number;
    const t1 = border[(k + 1) % SKIRT_N] as number;
    const s0 = NV * NV + k;
    const s1 = NV * NV + ((k + 1) % SKIRT_N);
    idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
  }
  return { index: new BufferAttribute(new Uint16Array(idx), 1), border };
}

function chunkGeometry(c: ChunkData, index: BufferAttribute, border: number[]): BufferGeometry {
  const pos = new Float32Array(VERTS * 3);
  const nor = new Float32Array(VERTS * 3);
  const wA = new Uint8Array(VERTS * 4);
  const wB = new Uint8Array(VERTS * 4);
  const rd = new Float32Array(VERTS * 4);
  rd.set(c.rd);
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NV; i++) {
      const k = j * NV + i;
      const hk = (j + 1) * ROW + (i + 1);
      pos[k * 3] = c.x0 + i * c.step;
      pos[k * 3 + 1] = c.h[hk] as number;
      pos[k * 3 + 2] = c.z0 + j * c.step;
      const dx = (c.h[hk + 1] as number) - (c.h[hk - 1] as number);
      const dz = (c.h[hk + ROW] as number) - (c.h[hk - ROW] as number);
      const L = Math.hypot(dx, 2 * c.step, dz);
      nor[k * 3] = -dx / L;
      nor[k * 3 + 1] = (2 * c.step) / L;
      nor[k * 3 + 2] = -dz / L;
    }
  }
  wA.set(c.wA);
  wB.set(c.wB);
  // 裙边：沿边一圈往下垂，盖住粗细两档之间的缝
  const drop = c.step * 1.6 + 1;
  for (let s = 0; s < SKIRT_N; s++) {
    const t = border[s] as number;
    const k = NV * NV + s;
    pos[k * 3] = pos[t * 3] as number;
    pos[k * 3 + 1] = (pos[t * 3 + 1] as number) - drop;
    pos[k * 3 + 2] = pos[t * 3 + 2] as number;
    nor[k * 3] = nor[t * 3] as number;
    nor[k * 3 + 1] = nor[t * 3 + 1] as number;
    nor[k * 3 + 2] = nor[t * 3 + 2] as number;
    for (let q = 0; q < 4; q++) {
      wA[k * 4 + q] = wA[t * 4 + q] as number;
      wB[k * 4 + q] = wB[t * 4 + q] as number;
      rd[k * 4 + q] = rd[t * 4 + q] as number;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('wA', new BufferAttribute(wA, 4, true));
  g.setAttribute('wB', new BufferAttribute(wB, 4, true));
  g.setAttribute('rd', new BufferAttribute(rd, 4));
  g.setIndex(index);
  g.boundingBox = new Box3(new Vector3(c.x0, c.minY - drop, c.z0), new Vector3(c.x0 + c.size, c.maxY, c.z0 + c.size));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

interface Node {
  level: number;
  ix: number;
  iz: number;
  data: ChunkData | null;
  mesh: Mesh | null;
  used: number;
  shown: number;
}

export interface GroundSample {
  y: number;
  /** 草地的覆盖度 0–1（青草 + 枯草） */
  grass: number;
  dry: number;
  /** 林地的覆盖度 0–1 */
  forest: number;
  /** 到铺装路面边缘的距离（米；在路面上是负的，附近没有路是几十） */
  edge: number;
  paved: boolean;
}

export interface GroundView {
  group: Group;
  /** 每帧调用：挑细节、显隐、在预算内生成新块 */
  update(camera: PerspectiveCamera, budgetMs: number): void;
  /** 开局：把周围的块全部生成完 */
  settle(camera: PerspectiveCamera): void;
  stats(): { chunks: number; shown: number; queue: number; built: number };
  /** 最细那档地形在 (x, z) 的地面：高度、草的覆盖度、干枯程度、是不是铺装路面。没加载到返回 false */
  sample(x: number, z: number, out: GroundSample): boolean;
  /** 调试：0 正常，1 只看法线检查（白 = 法线朝上的地方对了） */
  debug: { value: number };
  dispose(): void;
}

export async function buildGroundView(world: World, textures: Record<string, string>, anisotropy: number): Promise<GroundView> {
  const base = `${import.meta.env.BASE_URL}props/`;
  const dirs = LAYERS.map((l) => `${base}${textures[l.key] ?? textures[l.alt] ?? ''}`);
  const lums: number[] = [];
  const [diffArr, norArr] = await Promise.all([loadArray(dirs.map((d) => `${d}diff.jpg`), 1024, true, anisotropy, lums), loadArray(dirs.map((d) => `${d}nor.jpg`), 512, false, Math.min(4, anisotropy))]);
  const debug = { value: 0 };
  const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const inv = LAYERS.map((l) => (1 / l.tile).toFixed(4));
  const roughs = LAYERS.map((l) => l.rough.toFixed(3));
  const tints = LAYERS.map((l) => `vec3(${l.tint.map((v) => v.toFixed(3)).join(', ')})`);
  const hues = LAYERS.map((l, i) => `vec4(${l.hue.map((v) => (v / (lums[i] ?? 0.1)).toFixed(4)).join(', ')}, ${l.k.toFixed(3)})`);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDiff = { value: diffArr };
    sh.uniforms.uNor = { value: norArr };
    sh.uniforms.uDbg = debug;
    sh.uniforms.uWxSnow = WX.snow;
    sh.uniforms.uWxWet = WX.wet;
    sh.uniforms.uWxRain = WX.rain;
    sh.uniforms.uWxTime = WX.time;
    sh.uniforms.uWxSky = WX.sky;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 wA;
attribute vec4 wB;
attribute vec4 rd;
varying vec4 vRd;
varying vec4 vWA;
varying vec4 vWB;
varying vec3 vWP;
varying vec3 vWN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWA = wA;
vWB = wB;
vRd = rd;
vWP = position;
vWN = normal;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray uDiff;
uniform highp sampler2DArray uNor;
uniform int uDbg;
uniform float uWxSnow;
uniform float uWxWet;
uniform float uWxRain;
uniform float uWxTime;
uniform vec3 uWxSky;
varying vec4 vWA;
varying vec4 vWB;
varying vec4 vRd;
varying vec3 vWP;
varying vec3 vWN;
float gHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 gWN = normalize(vWN);
float gDist = length(vViewPosition);
float gFar = smoothstep(22.0, 130.0, gDist);
float gNrmK = 1.0 - smoothstep(50.0, 240.0, gDist);
// 铺装路面：按横向距离画，边缘清晰（带一点破损的锯齿），不受地形网格粗细影响
float gRs = max(abs(vRd.x), vRd.w);
float gHw = vRd.z;
float gEdgeN = (gNoise(vWP.xz * 0.9) - 0.5) * 0.5 + (gNoise(vWP.xz * 4.0) - 0.5) * 0.12;
float gRoad = gHw > 0.5 ? 1.0 - smoothstep(gHw - 0.06, gHw + 0.06, gRs + gEdgeN) : 0.0;
float gKeep = 1.0 - gRoad;
float gW[8] = float[8](vWA.x * gKeep, vWA.y * gKeep, vWA.z * gKeep, vWA.w * gKeep, vWB.x * gKeep, vWB.y * gKeep, vWB.z * gKeep, max(vWB.w * gKeep, gRoad));
float gT[8] = float[8](${inv.join(', ')});
float gR[8] = float[8](${roughs.join(', ')});
vec3 gTint[8] = vec3[8](${tints.join(', ')});
vec4 gHue[8] = vec4[8](${hues.join(', ')});
vec3 gAlb = vec3(0.0);
vec2 gNor = vec2(0.0);
float gRough = 0.0;
float gSum = 0.0;
// 很陡的岩壁按侧面投影，贴图不会被拉成竖条
vec2 gSide = abs(gWN.x) > abs(gWN.z) ? vWP.zy : vWP.xy;
float gSteep = step(gWN.y, 0.5);
for (int i = 0; i < 8; i++) {
  float w = gW[i];
  if (w < 0.02) continue;
  vec2 uv = (i == 4 ? mix(vWP.xz, gSide, gSteep) : vWP.xz) * gT[i];
  vec3 a = texture(uDiff, vec3(uv, float(i))).rgb;
  // 远处换成大尺度的采样：看不出一格一格的平铺
  if (gFar > 0.01) a = mix(a, texture(uDiff, vec3(uv * 0.173 + 0.37, float(i))).rgb, gFar * 0.8);
  // 权重 × 贴图明暗：亮的（高的）地方先露出来，两种地面的交界是碎的
  float ww = w * w * (0.22 + dot(a, vec3(0.6)));
  gAlb += mix(a * gTint[i], gHue[i].rgb * dot(a, vec3(0.2126, 0.7152, 0.0722)), gHue[i].a) * ww;
  if (gNrmK > 0.01) gNor += (texture(uNor, vec3(uv, float(i))).xy * 2.0 - 1.0) * ww;
  gRough += gR[i] * ww;
  gSum += ww;
}
gSum = max(gSum, 1e-4);
gAlb /= gSum;
gNor /= gSum;
gRough /= gSum;
// 大尺度的明暗和冷暖变化：远看不是一整片同一个颜色
float gM1 = gNoise(vWP.xz * 0.019);
float gM2 = gNoise(vWP.xz * 0.0041 + 7.3);
gAlb *= (0.8 + 0.4 * (gM1 * 0.55 + gM2 * 0.45)) * mix(vec3(0.97, 1.0, 0.95), vec3(1.05, 1.0, 0.93), gM2);
// 路面标线（磨损的旧漆）：公路两条白边线 + 中间黄虚线，支路只有中线
if (gRoad > 0.01 && gDist < 420.0) {
  float mk = gHw > 4.6 ? 1.0 : 0.5;
  float aa = 0.02 + gDist * 0.0012;
  float center = (1.0 - smoothstep(0.07, 0.07 + aa, gRs)) * step(fract(vRd.y / 9.0), 0.36);
  float edge = (1.0 - smoothstep(0.065, 0.065 + aa, abs(gRs - (gHw - 0.45)))) * step(0.75, mk);
  float wear = smoothstep(0.25, 0.7, gNoise(vWP.xz * 1.7) * 0.6 + gNoise(vWP.xz * 7.0) * 0.4);
  float fade = (1.0 - smoothstep(260.0, 420.0, gDist)) * step(0.25, mk);
  gAlb = mix(gAlb, vec3(0.62, 0.5, 0.2), center * wear * fade * 0.85);
  gAlb = mix(gAlb, vec3(0.7, 0.7, 0.68), edge * wear * fade * 0.8);
  // 车轮压出来的两道浅色
  float rut = 1.0 - smoothstep(0.0, 0.7, abs(abs(gRs - gHw * 0.5) - 0.9));
  gAlb *= 1.0 + 0.07 * rut * gRoad;
}
// 水边：湿的地面更暗、更光
float gWet = 1.0 - smoothstep(${(WATER + 0.1).toFixed(2)}, ${(WATER + 1.5).toFixed(2)}, vWP.y);
gAlb *= 1.0 - 0.5 * gWet;
gRough = mix(gRough, 0.3, gWet * 0.8);
// 天气（render/wx.ts，weather.ts 每帧改）。淋湿：颜色变深、变光滑，路面最明显；湿透以后平地的低洼处积水，映出天色
if (uWxWet > 0.004) {
  float wHard = max(gRoad, gW[6] * 0.6);
  float wK = uWxWet * (0.55 + 0.45 * wHard);
  float wThr = mix(-0.36, -0.08, smoothstep(0.55, 1.0, uWxWet) * (0.35 + 0.65 * wHard));
  float wPud = (1.0 - smoothstep(wThr - 0.04, wThr + 0.04, gEdgeN)) * smoothstep(0.93, 0.99, gWN.y);
  gAlb *= (1.0 - 0.42 * wK) * (1.0 - 0.4 * wPud);
  gRough = mix(mix(gRough, mix(0.6, 0.3, wHard), wK), 0.12, wPud);
  gNor *= 1.0 - 0.92 * wPud;
  // 正在下雨：雨点砸出来的涟漪（每格一个，落点和时刻随机，一圈水波扩出去、越扩越淡），只画近处
  vec2 wRip = vec2(0.0);
  if (uWxRain > 0.02 && gDist < 30.0) {
    vec2 rp = vWP.xz * 2.7;
    vec2 ri = floor(rp);
    float rh = gHash(ri);
    float rt = fract(uWxTime * (1.0 + 0.25 * floor(rh * 3.99)) + rh * 13.0);
    vec2 rv = fract(rp) - 0.5 - (vec2(gHash(ri + 17.3), gHash(ri + 41.7)) - 0.5) * 0.3;
    float rl = length(rv);
    float rw = (rl - rt * 0.34) * 34.0;
    wRip = rv / max(rl, 0.02) * (sin(rw) * exp(-rw * rw * 0.2) * (1.0 - rt) * (1.0 - rt) * step(rh, uWxRain * 0.8) * (1.0 - smoothstep(14.0, 30.0, gDist)));
    gNor += wRip * (0.08 + 0.3 * wPud) * wK;
  }
  // 水面映出天色（菲涅耳：脚边的水是透的，越远、看得越平越亮）
  vec3 wN = normalize(gWN + vec3(wRip.x, 0.0, wRip.y) * 0.3);
  float wF = pow(1.0 - max(dot(wN, normalize(cameraPosition - vWP)), 0.0), 5.0);
  totalEmissiveRadiance += uWxSky * ((0.02 + 0.98 * wF) * (wPud + 0.2 * wK * wHard * (1.0 - wPud)));
}
// 积雪：朝上的面变白。先从零零星星的小块开始，越积越满；陡坡上挂不住，水里没有；
// 路上薄一点，车轮压过的两道更薄（大雪天也认得出路）
if (uWxSnow > 0.004) {
  float sN = 0.5 + gEdgeN * (1.3 - gFar) + (gM1 - 0.5) * 0.5;
  float sRut = gRoad * (1.0 - smoothstep(0.0, 0.55, abs(abs(gRs - gHw * 0.5) - 0.9)));
  float sK = uWxSnow * (1.3 - 0.22 * gRoad - 0.2 * sRut);
  float gSn = smoothstep(sN * 0.72, sN * 0.72 + 0.3, sK) * smoothstep(0.42, 0.78, gWN.y) * (1.0 - gWet);
  // 雪面不是一张白纸：大尺度上有深有浅，近处留一点底下地面的起伏
  gAlb = mix(gAlb, ${SNOW_RGB} * (0.9 + 0.16 * gM2 + gEdgeN * 0.2 * (1.0 - gFar)), gSn * 0.96);
  gRough = mix(gRough, 0.9, gSn);
  gNor *= 1.0 - 0.55 * gSn;
}
diffuseColor.rgb *= gAlb;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `// 细节法线：地面的切线就是世界的 x / z，直接在世界空间里叠到网格法线上
vec3 gN2 = normalize(gWN + vec3(gNor.x, 0.0, gNor.y) * (0.85 * gNrmK));
normal = normalize((viewMatrix * vec4(gN2, 0.0)).xyz);`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if (uDbg == 1) gl_FragColor = vec4(vec3(step(0.8, dot(normal, normalize(vNormal)))), 1.0);`,
      );
  };
  mat.customProgramCacheKey = () => 'openGround3';

  const group = new Group();
  group.name = 'ground';
  const { index, border } = sharedIndex();
  const nodes = new Map<number, Node>();
  const keyOf = (level: number, ix: number, iz: number) => level * 16777216 + (ix + 2048) * 4096 + (iz + 2048);
  const node = (level: number, ix: number, iz: number): Node => {
    const k = keyOf(level, ix, iz);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { level, ix, iz, data: null, mesh: null, used: 0, shown: 0 }));
    return n;
  };
  let frame = 0;
  let builtTotal = 0;
  const build = (n: Node) => {
    const data = genChunk(world.terrain, n.level, n.ix, n.iz);
    const mesh = new Mesh(chunkGeometry(data, index, border), mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `ground:${n.level}:${n.ix},${n.iz}`;
    mesh.visible = false;
    group.add(mesh);
    n.data = data;
    n.mesh = mesh;
    builtTotal++;
  };
  const drop = (k: number, n: Node) => {
    if (n.mesh) {
      group.remove(n.mesh);
      // 索引是共用的：只释放顶点
      n.mesh.geometry.dispose();
    }
    nodes.delete(k);
  };

  // 水面：一大块跟着相机走的平面（网格位置按 64 米取整，水波是按世界坐标算的，不会跟着滑）
  const water = new MeshStandardMaterial({ color: 0x16302f, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.88 });
  const time = { value: 0 };
  water.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWP;')
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec2 p = vWP.xz;
  float t = uTime;
  float k = 1.0 - smoothstep(40.0, 260.0, length(vViewPosition));
  vec2 g = vec2(cos(p.x * 0.9 + t * 1.1) + 0.6 * cos(p.x * 2.3 - p.y * 1.7 + t * 1.7), cos(p.y * 1.1 - t * 0.9) + 0.6 * cos(p.y * 2.9 + p.x * 1.3 + t * 1.3)) * 0.03 * k;
  normal = normalize((viewMatrix * vec4(normalize(vec3(g.x, 1.0, g.y)), 0.0)).xyz);
}`,
      );
  };
  water.customProgramCacheKey = () => 'openWater2';
  const wg = new PlaneGeometry(VIEW * 2.4, VIEW * 2.4);
  wg.rotateX(-Math.PI / 2);
  const waterMesh = new Mesh(wg, water);
  waterMesh.position.y = WATER;
  waterMesh.renderOrder = 2;
  waterMesh.name = 'water';
  group.add(waterMesh);

  world.exactHeight = (x, z) => {
    const n = nodes.get(keyOf(0, Math.floor(x / BASE), Math.floor(z / BASE)));
    return n?.data ? chunkHeight(n.data, x, z) : null;
  };

  const queue: Array<{ n: Node; d: number }> = [];
  let cx = 0;
  let cz = 0;
  let shownCount = 0;
  const visit = (level: number, ix: number, iz: number): void => {
    const size = BASE << level;
    const x0 = ix * size;
    const z0 = iz * size;
    const dx = Math.max(x0 - cx, 0, cx - (x0 + size));
    const dz = Math.max(z0 - cz, 0, cz - (z0 + size));
    const d = Math.hypot(dx, dz);
    if (d > VIEW) return;
    const n = node(level, ix, iz);
    n.used = frame;
    if (level > 0 && d < size * SPLIT) {
      let ready = true;
      for (let q = 0; q < 4; q++) {
        const c = node(level - 1, ix * 2 + (q & 1), iz * 2 + (q >> 1));
        c.used = frame;
        if (!c.mesh) {
          ready = false;
          queue.push({ n: c, d });
        }
      }
      // 四个子块都生成好了才换过去：没好之前继续画自己，画面上不会出现洞
      if (ready && n.mesh) {
        for (let q = 0; q < 4; q++) visit(level - 1, ix * 2 + (q & 1), iz * 2 + (q >> 1));
        return;
      }
    }
    if (!n.mesh) {
      queue.push({ n, d: d - 1e5 });
      return;
    }
    n.shown = frame;
    shownCount++;
  };

  const update = (camera: PerspectiveCamera, budgetMs: number): void => {
    frame++;
    time.value += 1 / 60;
    cx = camera.position.x;
    cz = camera.position.z;
    queue.length = 0;
    shownCount = 0;
    const R = BASE << MAX_LEVEL;
    const i0 = Math.floor((cx - VIEW) / R);
    const i1 = Math.floor((cx + VIEW) / R);
    const j0 = Math.floor((cz - VIEW) / R);
    const j1 = Math.floor((cz + VIEW) / R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(MAX_LEVEL, i, j);
    for (const n of nodes.values()) if (n.mesh) n.mesh.visible = n.shown === frame;
    if (queue.length) {
      queue.sort((a, b) => a.d - b.d);
      const t0 = performance.now();
      for (const q of queue) {
        if (!q.n.mesh) build(q.n);
        if (performance.now() - t0 > budgetMs) break;
      }
    }
    // 回收：5 秒没用到的块
    if (frame % 90 === 0) for (const [k, n] of nodes) if (frame - n.used > 300) drop(k, n);
    waterMesh.position.x = Math.round(cx / BASE) * BASE;
    waterMesh.position.z = Math.round(cz / BASE) * BASE;
  };

  return {
    group,
    debug,
    update,
    settle(camera) {
      for (let k = 0; k < 12; k++) {
        update(camera, 1e9);
        if (!queue.length) break;
      }
    },
    stats: () => ({ chunks: nodes.size, shown: shownCount, queue: queue.length, built: builtTotal }),
    sample(x, z, out) {
      const c = nodes.get(keyOf(0, Math.floor(x / BASE), Math.floor(z / BASE)))?.data;
      if (!c) return false;
      const i = Math.max(0, Math.min(SEG, Math.round((x - c.x0) / c.step)));
      const j = Math.max(0, Math.min(SEG, Math.round((z - c.z0) / c.step)));
      const o = (j * NV + i) * 4;
      const g = c.wA[o] as number;
      const d = c.wA[o + 1] as number;
      out.y = chunkHeight(c, x, z);
      out.grass = (g + d) / 255;
      out.dry = d / (g + d + 1);
      out.forest = (c.wA[o + 2] as number) / 255;
      out.edge = Math.abs(c.rd[o] as number) - (c.rd[o + 2] as number);
      out.paved = (c.rd[o + 2] as number) > 0.5 && Math.abs(c.rd[o] as number) < (c.rd[o + 2] as number) + 0.7;
      return true;
    },
    dispose() {
      for (const [k, n] of nodes) drop(k, n);
      for (const t of [diffArr, norArr]) t.dispose();
      mat.dispose();
      water.dispose();
      wg.dispose();
    },
  };
}
