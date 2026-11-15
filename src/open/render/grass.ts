import { BufferAttribute, DataTexture, DoubleSide, FloatType, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshLambertMaterial, NearestFilter, RGBAFormat, Vector3, Vector4, type PerspectiveCamera } from 'three';
import type { GroundSample, GroundView } from './ground';
import { SNOW_RGB, WX } from './wx';

/**
 * 草：玩家周围一圈程序生成的草丛，无限地图上不占任何 CPU。
 * 做法：每一层草是固定的一块「草皮」（比如 28 米见方、2.6 万丛），顶点着色器里按相机位置取模，
 * 草皮永远包着相机——走到哪草就在哪，不用生成也不用回收。三层由密到疏：身边 14 米最密，
 * 往外 36 米、75 米逐层变疏变粗，最外圈淡出。
 * 地面高度、哪里长草、青还是黄：从一张跟着玩家走的小数据图里读（192 米见方，2 米一格，和地形网格完全对齐）。
 */

const TEX = 96;
const CELL = 2;

interface Layer {
  size: number;
  count: number;
  blades: number;
  segs: number;
  h: number;
  w: number;
  spread: number;
}

const LAYERS: Layer[] = [
  { size: 28, count: 30000, blades: 6, segs: 2, h: 0.42, w: 0.03, spread: 0.2 },
  { size: 72, count: 34000, blades: 5, segs: 1, h: 0.46, w: 0.07, spread: 0.4 },
  { size: 150, count: 30000, blades: 4, segs: 1, h: 0.5, w: 0.17, spread: 0.8 },
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一丛草：几片叶子，底宽顶尖，往外倒一点。y 是 0–1（乘上草高），x / z 是米 */
function tuft(l: Layer, rnd: () => number): { pos: Float32Array; t: Float32Array; index: number[] } {
  const pos: number[] = [];
  const tt: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < l.blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * l.spread;
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    const yaw = rnd() * Math.PI * 2;
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    const lean = (0.1 + rnd() * 0.28) * l.h;
    const h = 0.6 + rnd() * 0.4;
    const base = pos.length / 3;
    for (let s = 0; s <= l.segs; s++) {
      const t = s / l.segs;
      const off = lean * t * t;
      const cx = rx - dz * off;
      const cz = rz + dx * off;
      if (s < l.segs) {
        const ww = (l.w * (1 - t * 0.5)) / 2;
        pos.push(cx - dx * ww, t * h, cz - dz * ww, cx + dx * ww, t * h, cz + dz * ww);
        tt.push(t, t);
      } else {
        pos.push(cx, t * h, cz);
        tt.push(t);
      }
    }
    for (let s = 0; s < l.segs; s++) {
      const p = base + s * 2;
      if (s < l.segs - 1) idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
      else idx.push(p, p + 1, p + 2);
    }
  }
  return { pos: new Float32Array(pos), t: new Float32Array(tt), index: idx };
}

export interface GrassView {
  group: Group;
  update(camera: PerspectiveCamera, dt: number): void;
  /** 画质档位：只画前面这么多比例的草丛（位置是随机的，画一部分 = 均匀变稀） */
  setDensity(k: number): void;
  stats(): { tufts: number; tris: number };
  dispose(): void;
}

export function buildGrassView(ground: GroundView, density = 1, blockers: (x: number, z: number, r: number) => Array<{ x0: number; z0: number; x1: number; z1: number }> = () => []): GrassView {
  const group = new Group();
  group.name = 'grass';
  const data = new Float32Array(TEX * TEX * 4);
  const tex = new DataTexture(data, TEX, TEX, RGBAFormat, FloatType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const uCam = { value: new Vector3() };
  const uTime = { value: 0 };
  const uTex = { value: new Vector4(0, 0, CELL, TEX) };
  const uGround = { value: tex };

  const mats: MeshLambertMaterial[] = [];
  const geos: InstancedBufferGeometry[] = [];
  let tufts = 0;
  let tris = 0;
  /** 每层一共多少丛、一丛几个三角形 */
  const full: number[] = [];
  const per: number[] = [];
  LAYERS.forEach((l, li) => {
    const rnd = rng(1234 + li * 77);
    const t = tuft(l, rnd);
    const n = Math.max(1000, Math.round(l.count * density));
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(t.pos, 3));
    g.setAttribute('aT', new BufferAttribute(t.t, 1));
    // 没有法线的话 three 会自动切成平面着色（那样就没有 vNormal 了）：给一份全朝上的
    const up = new Float32Array(t.pos.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    g.setAttribute('normal', new BufferAttribute(up, 3));
    g.setIndex(t.index);
    const inst = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) inst[i] = rnd();
    g.setAttribute('aI', new InstancedBufferAttribute(inst, 4));
    g.instanceCount = n;
    full.push(n);
    per.push(t.index.length / 3);
    tufts += n;
    tris += (n * t.index.length) / 3;
    const m = new MeshLambertMaterial({ side: DoubleSide });
    const uSize = { value: l.size };
    // 里圈：上一层开始变淡的地方，这一层开始长出来
    const prev = LAYERS[li - 1];
    const uInner = { value: prev ? prev.size * 0.34 : -1 };
    const uH = { value: l.h };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCam = uCam;
      sh.uniforms.uTime = uTime;
      sh.uniforms.uTex = uTex;
      sh.uniforms.uGround = uGround;
      sh.uniforms.uSize = uSize;
      sh.uniforms.uInner = uInner;
      sh.uniforms.uH = uH;
      sh.uniforms.uWxSnow = WX.snow;
      sh.uniforms.uWxWet = WX.wet;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aI;
attribute float aT;
uniform vec3 uCam;
uniform float uTime;
uniform vec4 uTex;
uniform highp sampler2D uGround;
uniform float uSize;
uniform float uInner;
uniform float uH;
uniform float uWxSnow;
uniform float uWxWet;
varying vec3 vCol;
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
}
// 和地形网格同一种三角形插值（对角线 b–c）：草根正好贴在看到的地面上
vec4 gSample(vec2 p) {
  vec2 g = (p - uTex.xy) / uTex.z;
  vec2 fi = clamp(floor(g), 0.0, uTex.w - 2.0);
  ivec2 i = ivec2(fi);
  vec2 f = clamp(g - fi, 0.0, 1.0);
  vec4 a = texelFetch(uGround, i, 0);
  vec4 b = texelFetch(uGround, i + ivec2(1, 0), 0);
  vec4 c = texelFetch(uGround, i + ivec2(0, 1), 0);
  vec4 d = texelFetch(uGround, i + ivec2(1, 1), 0);
  return f.x + f.y <= 1.0 ? a + (b - a) * f.x + (c - a) * f.y : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
}`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          `vec2 gRoot = aI.xy * uSize;
gRoot = mod(gRoot - uCam.xz + uSize * 0.5, uSize) - uSize * 0.5 + uCam.xz;
vec4 gG = gSample(gRoot);
float gDist = distance(gRoot, uCam.xz);
float gFade = (1.0 - smoothstep(uSize * 0.34, uSize * 0.485, gDist)) * (uInner > 0.0 ? smoothstep(uInner * 0.72, uInner * 1.3, gDist) : 1.0);
// 长不长草：草地的覆盖度（带一点随机，交界处是稀稀拉拉的），离路面边缘 1 米内不长
float gCover = smoothstep(0.22, 0.62, gG.g + (aI.z - 0.5) * 0.45) * smoothstep(0.25, 1.3, gG.a);
float gHgt = uH * (0.55 + aI.w * 0.9) * gFade * gCover * (1.0 - 0.3 * gG.b) * (1.0 - 0.5 * uWxSnow);
float gOn = step(0.02, gHgt);
float gAng = aI.w * 6.2832;
float gCs = cos(gAng);
float gSn = sin(gAng);
vec2 gXZ = vec2(position.x * gCs - position.z * gSn, position.x * gSn + position.z * gCs) * (0.75 + aI.z * 0.5);
// 风：一阵一阵地吹过去，越靠草尖摆得越多
float gW = uTime * 1.5 + gRoot.x * 0.31 + gRoot.y * 0.23;
float gBend = (sin(gW) * 0.55 + sin(gW * 2.6 + 1.3) * 0.25 + 0.35) * 0.3 * aT * aT * gHgt;
vec3 transformed = vec3(gRoot.x + (gXZ.x + gBend) * gOn, gG.r + position.y * gHgt - 0.03, gRoot.y + (gXZ.y + gBend * 0.45) * gOn);
// 颜色：草根暗（挨着地、互相挡光），草尖亮；青 → 黄按干枯程度；每丛深浅不一
vec3 gTip = mix(vec3(0.1, 0.158, 0.04), vec3(0.3, 0.25, 0.11), gG.b);
vec3 gBase = mix(vec3(0.028, 0.05, 0.012), vec3(0.09, 0.07, 0.03), gG.b);
// 和地面同一套大尺度明暗（一片深一片浅），草和地面一起变
float gM1 = gNoise(gRoot * 0.019);
float gM2 = gNoise(gRoot * 0.0041 + 7.3);
float gMacro = (0.8 + 0.4 * (gM1 * 0.55 + gM2 * 0.45));
// 一小片一小片的色差：有的地方草老一点、黄一点
float gPatch = gNoise(gRoot * 0.21);
gTip = mix(gTip, gTip * vec3(1.35, 1.12, 0.8), smoothstep(0.55, 0.9, gPatch) * 0.7);
vCol = mix(gBase, gTip, aT * 0.85 + 0.15 * aT * aT) * (0.74 + 0.5 * fract(aI.z * 7.13 + aI.w * 3.7)) * gMacro;
// 天气（render/wx.ts）：淋湿了颜色深一点；积雪从草根往上盖，雪厚了草被压矮（上面的 gHgt）、只剩草尖露着
vCol *= 1.0 - 0.25 * uWxWet;
vCol = mix(vCol, ${SNOW_RGB} * (0.86 + 0.2 * gMacro), clamp(uWxSnow * 1.5 - aT * 1.0 - aI.z * 0.3, 0.0, 1.0));`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCol;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vCol;')
        // 叶片是双面的：法线一律朝上，受光和地面一致，背面不会发黑
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
    };
    m.customProgramCacheKey = () => 'openGrass2';
    const mesh = new Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `grass:${li}`;
    group.add(mesh);
    mats.push(m);
    geos.push(g);
  });

  const s: GroundSample = { y: 0, grass: 0, dry: 0, forest: 0, edge: 40, paved: false };
  let cx = Infinity;
  let cz = Infinity;
  let complete = false;
  let retry = 0;
  const refill = (x: number, z: number): void => {
    cx = x;
    cz = z;
    const ox = (Math.round(x / CELL) - TEX / 2) * CELL;
    const oz = (Math.round(z / CELL) - TEX / 2) * CELL;
    complete = true;
    let k = 0;
    for (let j = 0; j < TEX; j++) {
      for (let i = 0; i < TEX; i++, k += 4) {
        if (ground.sample(ox + i * CELL, oz + j * CELL, s)) {
          data[k] = s.y;
          // 林下也长一点稀疏的草
          data[k + 1] = s.grass + s.forest * 0.42;
          data[k + 2] = s.dry;
          data[k + 3] = s.edge;
        } else {
          // 这一块最细的地形还没生成：先不长草，稍后重填
          complete = false;
          data[k] = 0;
          data[k + 1] = 0;
          data[k + 2] = 0;
          data[k + 3] = 0;
        }
      }
    }
    // 房子里面（有地板）不长草：外轮廓往外再留 2 米多（数据图 2 米一格，插值会往外洇一格）
    for (const b of blockers(x, z, (TEX * CELL) / 2)) {
      const i0 = Math.max(0, Math.ceil((b.x0 - 2.2 - ox) / CELL));
      const i1 = Math.min(TEX - 1, Math.floor((b.x1 + 2.2 - ox) / CELL));
      const j0 = Math.max(0, Math.ceil((b.z0 - 2.2 - oz) / CELL));
      const j1 = Math.min(TEX - 1, Math.floor((b.z1 + 2.2 - oz) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[(j * TEX + i) * 4 + 1] = 0;
    }
    uTex.value.set(ox, oz, CELL, TEX);
    tex.needsUpdate = true;
  };

  return {
    group,
    update(camera, dt) {
      uTime.value += dt;
      uCam.value.copy(camera.position);
      const x = camera.position.x;
      const z = camera.position.z;
      retry -= dt;
      // 数据图 192 米见方，草最远 75 米：离中心超过 18 米就重新对中
      if (Math.hypot(x - cx, z - cz) > 18 || (!complete && retry <= 0)) {
        refill(x, z);
        retry = 0.25;
      }
    },
    setDensity(k) {
      tufts = 0;
      tris = 0;
      geos.forEach((g, i) => {
        const n = full[i] as number;
        g.instanceCount = Math.min(n, Math.max(Math.min(n, 1000), Math.round(n * k)));
        tufts += g.instanceCount;
        tris += g.instanceCount * (per[i] as number);
      });
    },
    stats: () => ({ tufts, tris }),
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      tex.dispose();
    },
  };
}
