import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type PerspectiveCamera } from 'three';
import type { Lighting } from './lighting';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
  // 地平线以下：压暗，万一从围墙缺口看到天空以下的部分也不会穿帮
  col = mix(col, uHorizon * 0.55, clamp(-d.y * 5.0, 0.0, 1.0));

  // 太阳 / 月亮：大范围的柔光 + 小而亮的圆盘（圆盘会触发后期的光晕）
  float s = max(dot(d, uSunDir), 0.0);
  // 圆盘小一点、边缘柔和、亮度压低：以前 5 倍亮度的硬边圆盘被光晕放大成一大团橙色的球
  col += uSunColor * (pow(s, 5.0) * 0.12 + pow(s, 120.0) * 0.35 + smoothstep(0.99955, 0.99975, s) * 1.4);

  // 星星：夜里才出现，靠近地平线的淡掉
  vec3 g = d * 170.0;
  vec3 cell = floor(g);
  float r = hash(cell);
  // 每个格子里只有少数是星星，并且是中心亮、边缘淡的小圆点
  float dotMask = smoothstep(0.5, 0.12, length(fract(g) - 0.5));
  float star = step(0.9972, r) * dotMask * smoothstep(0.08, 0.4, d.y) * (0.5 + 0.5 * hash(cell + 7.0));
  col += vec3(0.85, 0.9, 1.0) * star * uNight * uNight * 1.8;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ZENITH_DUSK = new Color(0x2c3764);
const ZENITH_NIGHT = new Color(0x02050c);
const _c = new Color();

/** 天空穹顶：渐变 + 太阳 / 月亮 + 夜里的星星。跟着相机走，所以永远在无穷远处 */
export class Sky {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uHorizon: { value: new Color() },
        uZenith: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uNight: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 32, 16), this.mat);
    this.mesh.scale.setScalar(250);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }

  update(camera: PerspectiveCamera, lighting: Lighting): void {
    this.mesh.position.copy(camera.position);
    const u = this.mat.uniforms;
    const t = lighting.night;
    // 地平线的颜色就是雾的颜色，远处的建筑淡进雾里时和天空自然衔接
    (u.uHorizon!.value as Color).copy(lighting.fog.color);
    (u.uZenith!.value as Color).copy(ZENITH_DUSK).lerp(ZENITH_NIGHT, t);
    (u.uSunDir!.value as Vector3).copy(lighting.dir);
    (u.uSunColor!.value as Color).copy(_c.copy(lighting.sun.color)).multiplyScalar(0.55 + 0.45 * t);
    u.uNight!.value = t;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
