import {
  Color,
  DepthTexture,
  HalfFloatType,
  Matrix4,
  MeshNormalMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { wetU } from './materials';

/**
 * 渲染管线：
 *   1. 地面反射：把场景按 y = h 的水平面镜像渲染到一张半分辨率的贴图（所有湿地面共用）
 *   2. 法线 + 深度：只画第 0 层（不含玻璃、雨、粒子），给描边用
 *   3. 主画面 → 描边（法线 / 深度跳变处画深色轮廓线，三渲二的关键）→ Bloom（霓虹、灯箱）→ 调色 → 输出
 */

/** 图层：0 = 实体，2 = 玻璃 / 雨 / 粒子（不参与描边，不进反射） */
export const LAYER_FX = 2;

export class Mirror {
  readonly rt: WebGLRenderTarget;
  private readonly cam = new PerspectiveCamera();
  private readonly plane = new Plane();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly v = new Vector3();
  private readonly t = new Vector3();
  private readonly look = new Vector3();
  private readonly n = new Vector3(0, 1, 0);
  private readonly rot = new Matrix4();
  /** 马路的高度：积水主要在路上；人行道 / 店里不用平面反射（shader 按高度判断） */
  height = 0;
  /** 渲染反射时隐藏的东西（地面本身、雨） */
  readonly hide: Object3D[] = [];

  constructor(w: number, h: number) {
    // 4 倍 MSAA：没有抗锯齿时，倒影里的台阶边、车底边缘一走动就闪
    this.rt = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 });
    wetU.uRefl.value = this.rt.texture;
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
  }

  render(r: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    const c = this.cam;
    const P = this.v.set(0, this.height, 0);
    const camPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    // 相机在水面下面（例如蹲在路缘下）就不画了
    if (camPos.y < this.height + 0.02) return;
    // 镜像相机位置
    const view = new Vector3().subVectors(P, camPos).setX(0).setZ(0);
    c.position.set(camPos.x, 2 * this.height - camPos.y, camPos.z);
    void view;
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(camPos);
    this.t.set(this.look.x, 2 * this.height - this.look.y, this.look.z);
    c.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.n);
    c.lookAt(this.t);
    c.far = camera.far;
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    // 采样矩阵（不含偏移，偏移在着色器里做）
    (wetU.uReflMat.value as Matrix4).multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    // 斜裁剪面：水面以下的东西不画进反射
    this.plane.setFromNormalAndCoplanarPoint(this.n, P).applyMatrix4(c.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = c.projectionMatrix;
    const q = this.q;
    q.x = (Math.sign(this.clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(this.clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1;
    q.w = (1 + pm.elements[10]) / pm.elements[14];
    this.clip.multiplyScalar(2 / this.clip.dot(q));
    pm.elements[2] = this.clip.x;
    pm.elements[6] = this.clip.y;
    pm.elements[10] = this.clip.z + 1 - 0.003;
    pm.elements[14] = this.clip.w;
    c.layers.mask = camera.layers.mask;
    for (const o of this.hide) o.visible = false;
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    wetU.uReflOn.value = 0;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, c);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = prevShadow;
    wetU.uReflOn.value = 1;
    for (const o of this.hide) o.visible = true;
  }
}

const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: null },
    tDepth: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uNear: { value: 0.05 },
    uFar: { value: 200 },
    uColor: { value: new Color(0x1a1830) },
    uStrength: { value: 0.85 },
    uWidth: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
    uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform vec3 uColor; uniform float uStrength; uniform float uWidth;
    varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 px = uWidth / uRes;
      float dc = lin(texture2D(tDepth, vUv).r);
      vec3 nc = texture2D(tNormal, vUv).rgb * 2.0 - 1.0;
      float de = 0.0; float ne = 0.0;
      vec2 offs[4];
      offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
      for (int i = 0; i < 4; i++){
        float d = lin(texture2D(tDepth, vUv + offs[i]).r);
        vec3 n = texture2D(tNormal, vUv + offs[i]).rgb * 2.0 - 1.0;
        // 深度跳变（相对深度，远处的线不会糊成一片）
        de = max(de, (d - dc) / max(dc, 0.1));
        ne = max(ne, 1.0 - dot(n, nc));
      }
      float e = max(smoothstep(0.035, 0.09, de), smoothstep(0.25, 0.55, ne) * 0.85);
      // 天空（深度 = 远平面）不描边；太远的线淡一点
      e *= step(dc, uFar * 0.95) * (1.0 - smoothstep(30.0, 70.0, dc) * 0.6);
      // 越亮的地方（灯箱、发光招牌）线越淡，保住霓虹的干净
      float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      e *= 1.0 - smoothstep(0.9, 2.0, lum) * 0.8;
      col.rgb = mix(col.rgb, uColor * (0.4 + col.rgb * 0.3), e * uStrength);
      gl_FragColor = col;
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uTilt: { value: 0 },
    uRain: { value: 1 },
  },
  vertexShader: OutlineShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uTilt; uniform float uRain;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // 移轴：微缩模型的感觉（模型视角下打开）——上下边缘模糊
      if (uTilt > 0.0){
        float b = smoothstep(0.18, 0.5, abs(vUv.y - 0.5)) * uTilt * 3.0;
        vec3 s = vec3(0.0);
        for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) s += texture2D(tDiffuse, vUv + vec2(float(i), float(j)) * b / uRes).rgb;
        c.rgb = mix(c.rgb, s / 49.0, smoothstep(0.0, 0.3, b));
      }
      // 调色：暗部偏蓝紫，亮部偏暖，稍微提一点饱和度（动画感）
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = mix(vec3(0.82, 0.88, 1.12), vec3(0.95, 0.97, 1.03), 1.0 - uRain);
      c.rgb *= mix(shadowTint, vec3(1.06, 1.0, 0.92), smoothstep(0.2, 0.9, l));
      c.rgb = mix(vec3(l), c.rgb, 1.04);
      // 暗角
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * 0.55;
      // 极淡的胶片颗粒
      // 颗粒固定不动（以前每帧换一次，画面整体在"沙沙"地闪）
      c.rgb += (h(floor(vUv * uRes)) - 0.5) * 0.008;
      gl_FragColor = c;
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  readonly mirror: Mirror;
  private readonly nd: WebGLRenderTarget;
  private readonly normalMat = new MeshNormalMaterial();
  private readonly outline: ShaderPass;
  private readonly grade: ShaderPass;
  readonly bloom: UnrealBloomPass;
  private w = 1;
  private h = 1;

  constructor(
    private readonly r: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    const size = r.getDrawingBufferSize(new Vector2());
    this.w = size.x;
    this.h = size.y;
    this.mirror = new Mirror(Math.floor(size.x / 2), Math.floor(size.y / 2));
    void OutlineShader;
    this.nd = new WebGLRenderTarget(size.x, size.y, { depthTexture: new DepthTexture(size.x, size.y) });
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    // 描边（三渲二）去掉了：法线 / 深度那一遍没有抗锯齿，人一走动轮廓线就一闪一闪，而且要把场景多画一遍
    this.outline = new ShaderPass(OutlineShader);
    this.outline.uniforms.tNormal!.value = this.nd.texture;
    this.outline.uniforms.tDepth!.value = this.nd.depthTexture;
    this.outline.enabled = false;
    this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.32, 0.45, 1.6);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setSize(size.x, size.y);
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.composer.setSize(w / this.r.getPixelRatio(), h / this.r.getPixelRatio());
    this.nd.setSize(w, h);
    this.mirror.setSize(Math.floor(w / 2), Math.floor(h / 2));
    (this.outline.uniforms.uRes!.value as Vector2).set(w, h);
    (this.grade.uniforms.uRes!.value as Vector2).set(w, h);
    this.outline.uniforms.uWidth!.value = Math.max(1, h / 1080);
  }

  set tilt(v: number) {
    this.grade.uniforms.uTilt!.value = v;
  }

  render(t: number, rain: number, reflect: boolean): void {
    const r = this.r;
    const cam = this.camera;
    if (reflect) this.mirror.render(r, this.scene, cam);
    if (!this.outline.enabled) {
      this.grade.uniforms.uTime!.value = t;
      this.grade.uniforms.uRain!.value = rain;
      this.composer.render();
      return;
    }
    // 法线 + 深度（只画实体层）
    const mask = cam.layers.mask;
    cam.layers.set(0);
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.nd);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(this.scene, cam);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    this.scene.fog = fog;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    cam.layers.mask = mask;
    this.outline.uniforms.uNear!.value = cam.near;
    this.outline.uniforms.uFar!.value = cam.far;
    this.grade.uniforms.uTime!.value = t;
    this.grade.uniforms.uRain!.value = rain;
    this.composer.render();
    void this.w;
    void this.h;
  }
}
