import {
  Color,
  DataTexture,
  DoubleSide,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  type Texture,
} from 'three';
import type { MatKey } from './kit';

/** 三渲二的色阶：四段明暗 */
export function toonRamp(): DataTexture {
  const steps = new Uint8Array([62, 128, 196, 255]);
  const t = new DataTexture(steps, steps.length, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * 写实一点的材质（用户反馈三渲二"太假、像动漫"）：PBR，粗糙度按用途分两档——
 * 结构 / 涂装偏哑光，印刷包装、招牌偏光滑（塑料膜、亮面纸）。alphaTest：贴纸的透明角直接丢掉
 */
export function kitMats(atlas: Texture): Record<MatKey, MeshStandardMaterial | MeshBasicMaterial> {
  const toon = new MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.72, metalness: 0.05, alphaTest: 0.5 });
  const tex = new MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 0.42, metalness: 0, alphaTest: 0.5 });
  const glow = new MeshBasicMaterial({ vertexColors: true, map: atlas, alphaTest: 0.5 });
  return { toon, tex, glow, glowTex: glow };
}

/** 湿地面共享的参数（反射贴图、湿度、雨量、时间） */
export const wetU = {
  uRefl: { value: null as Texture | null },
  uReflMat: { value: new Matrix4() },
  uWet: { value: 1 },
  uRain: { value: 1 },
  uTime: { value: 0 },
  uReflOn: { value: 1 },
  /** 反射平面的高度：只有和它同高的表面（马路）用平面反射，别的高度用了倒影会对不上、走动时滑来滑去 */
  uReflH: { value: 0 },
};

const NOISE = /* glsl */ `
varying vec3 vWPos;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uWet;
uniform float uRain;
uniform float uTime;
uniform float uReflOn;
uniform float uReflH;
uniform vec3 uKind;
float kh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float kvn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(kh12(i), kh12(i+vec2(1,0)), u.x), mix(kh12(i+vec2(0,1)), kh12(i+vec2(1,1)), u.x), u.y); }
float kfbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * kvn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
vec3 kRipple(vec2 p, float t){
  vec2 acc = vec2(0.0); float ring = 0.0;
  for (int l = 0; l < 2; l++){
    vec2 q = p * (2.4 + float(l) * 1.9) + float(l) * 7.31;
    vec2 c = floor(q); vec2 f = fract(q) - 0.5;
    float h = kh12(c);
    float ph = fract(t * (0.8 + h * 0.7) + h * 9.0);
    vec2 off = (vec2(kh12(c + 3.1), kh12(c + 5.7)) - 0.5) * 0.5;
    vec2 d = f - off; float r = length(d);
    float g = exp(-pow((r - ph * 0.45) * 26.0, 2.0)) * (1.0 - ph) * step(h, 0.85);
    acc += d / max(r, 1e-3) * g; ring += g;
  }
  return vec3(acc, ring);
}
vec3 kRefl(vec2 uv, float b){
  vec3 c = texture2D(uRefl, uv).rgb * 0.4;
  c += texture2D(uRefl, uv + vec2(b, 0.0)).rgb * 0.15;
  c += texture2D(uRefl, uv - vec2(b, 0.0)).rgb * 0.15;
  c += texture2D(uRefl, uv + vec2(0.0, b * 1.6)).rgb * 0.15;
  c += texture2D(uRefl, uv - vec2(0.0, b * 1.6)).rgb * 0.15;
  return c;
}
`;

const WET_FRAG = /* glsl */ `
{
  vec2 p = vWPos.xz;
  float n = kfbm(p * 0.33);
  float n2 = kfbm(p * 1.9 + 13.1);
  float th = mix(1.02, 0.5, uWet);
  float pud = smoothstep(th, th + 0.05, n * 0.86 + n2 * 0.14) * uKind.x;
  float damp = smoothstep(0.0, 1.0, uWet) * uKind.y;
  vec3 rp = kRipple(p, uTime) * uRain;
  vec3 V = normalize(cameraPosition - vWPos);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  float k = max(pud * mix(0.6, 0.96, fres), damp * mix(0.1, 0.5, fres));
  k = max(k, uKind.z * mix(0.05, 0.18, fres));
  vec4 rc = uReflMat * vec4(vWPos, 1.0);
  vec2 ruv = rc.xy / rc.w * 0.5 + 0.5;
  // 扰动压小、模糊放大：反射图只有半分辨率，扰动大了人一动就满地闪
  ruv += rp.xy * 0.008 * (pud + 0.25) + (n2 - 0.5) * 0.003 * (1.0 - pud);
  vec3 refl = kRefl(ruv, mix(0.008, 0.003, max(pud, uKind.z)));
  outgoingLight *= mix(1.0, 0.5, max(damp * 0.8, pud));
  float onPlane = 1.0 - smoothstep(0.01, 0.03, abs(vWPos.y - uReflH));
  outgoingLight = mix(outgoingLight, outgoingLight * 0.35 + refl, k * uReflOn * onPlane);
  outgoingLight += vec3(0.55, 0.65, 0.8) * rp.z * (pud * 0.35 + damp * 0.08) * 0.35;
}
`;

/**
 * 湿地面材质：在三渲二光照之后叠加积水（噪声阈值，越干水洼越小）、全局湿润反光、雨滴涟漪。
 * kind = (积水强度, 湿润反光强度, 常驻抛光反光——店内地砖)
 */
export function wetMaterial(map: Texture | null, color: number, kind: [number, number, number]): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(color), map, roughness: kind[2] ? 0.35 : 0.88, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wetU, { uKind: { value: kind } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE}`).replace('#include <opaque_fragment>', `${WET_FRAG}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `wet:${kind.join(',')}`;
  return m;
}

/** 玻璃：淡淡的冷色、边缘反光，雨天有水滴沿玻璃往下滑 */
export const glassU = {
  uTime: wetU.uTime,
  uWet: { value: 1 },
};

/** drops = false：室内的玻璃（冷柜门）没有雨滴 */
export function glassMaterial(tint = 0xbfd8f0, opacity = 0.14, drops = true): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uTime: glassU.uTime, uWet: drops ? glassU.uWet : { value: 0 }, uTint: { value: new Color(tint) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec3 vWPos; varying vec3 vN;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWPos = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos; varying vec3 vN;
      uniform float uTime; uniform float uWet; uniform vec3 uTint; uniform float uOpacity;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec3 V = normalize(cameraPosition - vWPos);
        float f = pow(1.0 - abs(dot(V, normalize(vN))), 2.0);
        // 水平方向的坐标：玻璃不是朝 X 就是朝 Z
        float u = abs(vN.x) > 0.5 ? vWPos.z : vWPos.x;
        float y = vWPos.y;
        float a = 0.0;
        // 两层水滴：每列一颗往下滑，后面拖一条细水痕
        for (int l = 0; l < 2; l++){
          float cw = l == 0 ? 0.045 : 0.028;
          float col = floor(u / cw);
          float hs = h1(col * 12.9 + float(l) * 71.0);
          float sp = 0.25 + hs * 0.7;
          float head = 3.0 - mod(uTime * sp + hs * 9.0, 3.4);
          float cx = (fract(u / cw) - 0.5) * cw;
          float dx = abs(cx - (h1(col + 3.0) - 0.5) * cw * 0.4);
          float drop = smoothstep(cw * 0.32, 0.0, dx) * smoothstep(0.03, 0.0, abs(y - head));
          float trail = smoothstep(cw * 0.12, 0.0, dx) * step(head, y) * smoothstep(head + 0.9 * hs + 0.2, head, y) * 0.45;
          a += (drop + trail) * step(0.35, hs);
        }
        // 静止的小水珠
        vec2 g = vec2(u, y) * 28.0;
        vec2 cell = floor(g);
        float r = h1(dot(cell, vec2(17.1, 91.7)));
        vec2 c = fract(g) - 0.5 - (vec2(h1(r * 13.0), h1(r * 29.0)) - 0.5) * 0.5;
        a += smoothstep(0.16, 0.05, length(c)) * step(0.72, r) * 0.6;
        a *= uWet;
        vec3 col = uTint * (0.4 + f * 1.6) + vec3(0.8, 0.9, 1.0) * a * 0.9;
        gl_FragColor = vec4(col, clamp(uOpacity + f * 0.25 + a * 0.35, 0.0, 0.85));
      }`,
  });
}
