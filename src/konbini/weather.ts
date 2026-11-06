import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { STORE, type World } from './ctx';
import { HALF } from './ground';

/**
 * 天气：雨丝、地面溅起的水花、屋檐滴水、伞上的雨点。
 *
 * 雨的开关（R 键 / 交互）：
 *   下雨 → 雨量 rain 渐变到 1；湿度 wet 跟着慢慢涨到 1（积水变大）。
 *   停雨 → rain 几秒内降到 0；wet 先保持一阵（地面还是湿的），然后慢慢退到 0（积水消失）。
 *   再下雨 → wet 又会慢慢涨回来。
 */

const RAIN_N = 14000;
const SPLASH_N = 900;
const DRIP_N = 60;

/** 不下雨的地方（屋顶、雨棚下面）：雨丝在这些盒子里不画 */
const COVERS: Array<[number, number, number, number, number]> = [
  // x0, x1, z0, z1, 顶面 y
  [STORE.x0 - 0.1, STORE.x1 + 0.1, STORE.z0 - 0.1, STORE.z1 + 1.2, 4.4],
  [-20, -12.2, -19.5, 2.4, 9.5],
  [-9, 7.5, -20, -15.2, 7],
  [-20, 8, 15.2, 20, 6],
  [18.1, 20, -20, 20, 14],
];

export class Weather {
  /** 目标：下雨 / 不下 */
  raining = true;
  /** 当前雨量 0..1 */
  rain = 1;
  /** 地面湿度 0..1 */
  wet = 1;
  /** 停雨后多久开始退水（秒） */
  private dryDelay = 0;
  readonly rainMesh: Mesh;
  readonly splashMesh: Mesh;
  private readonly dripMesh: Mesh;
  private readonly rainMat: ShaderMaterial;
  private readonly splashMat: ShaderMaterial;
  private readonly dripMat: ShaderMaterial;
  private readonly splashData: Float32Array;
  private readonly splashAttr: InstancedBufferAttribute;
  private splashNext = 0;
  private splashAcc = 0;
  private readonly drips: Array<{ p: Vector3; t: number; period: number }> = [];
  private readonly dripAttr: InstancedBufferAttribute;
  private readonly dripData: Float32Array;

  constructor(private readonly W: World) {
    // ---- 雨丝：每根是一个细长的四边形，在相机周围的盒子里循环下落（着色器里算位置）
    const g = new InstancedBufferGeometry();
    const q = new PlaneGeometry(1, 1);
    g.index = q.index;
    g.setAttribute('position', q.getAttribute('position'));
    g.setAttribute('uv', q.getAttribute('uv'));
    const seeds = new Float32Array(RAIN_N * 4);
    for (let i = 0; i < RAIN_N * 4; i++) seeds[i] = Math.random();
    g.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 4));
    g.instanceCount = RAIN_N;
    const covers = COVERS.map(([a, b, c, d, y]) => new Vector3(0, 0, 0).set(a, b, c).toArray().concat([d, y]));
    this.rainMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new Vector3() },
        uAmount: { value: 1 },
        uColor: { value: new Color(0x9ab4d8) },
        uCovers: { value: covers.flat() },
        uBox: { value: new Vector3(28, 14, 28) },
        uFade: { value: 20 },
        uAlpha: { value: 0.35 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 iSeed;
        uniform float uTime; uniform vec3 uCam; uniform float uAmount;
        uniform float uCovers[${COVERS.length * 5}];
        uniform vec3 uBox; uniform float uFade;
        varying float vA; varying vec2 vUv;
        void main(){
          vUv = uv;
          // 相机周围 28 m × 28 m × 14 m 的盒子，按种子循环
          vec3 box = uBox;
          float speed = 9.0 + iSeed.w * 3.0;
          vec3 p = vec3(iSeed.x, 1.0 - fract(iSeed.y + uTime * speed / box.y), iSeed.z) * box;
          // 世界坐标固定（相机移动时雨丝不跟着跑），在相机周围的盒子里环绕
          vec2 lo = uCam.xz - box.xz * 0.5;
          p.xz = lo + mod(p.xz - lo, box.xz);
          p.y += max(0.0, uCam.y - 4.0) - 0.5;
          // 风：一点点斜
          p.x += (1.0 - p.y / box.y) * 0.4;
          float vis = step(iSeed.w, uAmount);
          // 在底座外、地面以下、屋顶下面都不画
          vis *= step(abs(p.x), ${HALF.toFixed(1)}) * step(abs(p.z), ${HALF.toFixed(1)}) * step(0.0, p.y);
          for (int i = 0; i < ${COVERS.length}; i++){
            float x0 = uCovers[i*5], x1 = uCovers[i*5+1], z0 = uCovers[i*5+2], z1 = uCovers[i*5+3], y = uCovers[i*5+4];
            if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && p.y < y) vis = 0.0;
          }
          vec3 up = vec3(0.04, 1.0, 0.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vec3 vUp = normalize((viewMatrix * vec4(up, 0.0)).xyz);
          vec3 side = normalize(cross(vUp, vec3(0.0, 0.0, 1.0)));
          float d = length(mv.xyz);
          // 远处的雨丝加粗一点，不然细到看不见（模型视角）
          float wide = max(1.0, d / 8.0);
          float len = (0.55 + iSeed.y * 0.35) * mix(1.0, 1.6, clamp(d / 40.0, 0.0, 1.0));
          mv.xyz += vUp * position.y * len + side * position.x * 0.012 * wide;
          vA = vis * smoothstep(0.4, 2.0, d) * (1.0 - smoothstep(uFade * 0.7, uFade, d)) / sqrt(wide);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying float vA; varying vec2 vUv;
        void main(){
          float a = vA * smoothstep(0.0, 0.5, 1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.4, vUv.y) * uAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.rainMesh = new Mesh(g, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 10;
    W.add(this.rainMesh);

    // ---- 水花：落到地上的小圈 + 往上溅的小点（CPU 发射，着色器里展开）
    const sg = new InstancedBufferGeometry();
    sg.index = q.index;
    sg.setAttribute('position', q.getAttribute('position'));
    sg.setAttribute('uv', q.getAttribute('uv'));
    this.splashData = new Float32Array(SPLASH_N * 4).fill(-100);
    this.splashAttr = new InstancedBufferAttribute(this.splashData, 4);
    sg.setAttribute('iData', this.splashAttr);
    sg.instanceCount = SPLASH_N;
    this.splashMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color(0xb8d0f0) } },
      vertexShader: /* glsl */ `
        attribute vec4 iData; uniform float uTime;
        varying vec2 vUv; varying float vT;
        void main(){
          vUv = uv;
          float t = (uTime - iData.w) / 0.35;
          vT = t;
          vec3 c = iData.xyz;
          vec4 mv = viewMatrix * vec4(c + vec3(0.0, 0.05 * t, 0.0), 1.0);
          float s = 0.03 + 0.07 * t;
          mv.xy += position.xy * vec2(s, s * 0.6);
          gl_Position = t < 0.0 || t > 1.0 ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vUv; varying float vT;
        void main(){
          vec2 d = (vUv - 0.5) * 2.0;
          float r = length(d);
          // 小皇冠：一圈 + 上半部分的几根细刺
          float ring = smoothstep(0.25, 0.0, abs(r - 0.7)) * (1.0 - vT);
          float spikes = step(0.0, d.y) * smoothstep(0.3, 0.0, abs(fract(atan(d.y, d.x) * 1.6) - 0.5)) * smoothstep(1.0, 0.3, r) * (1.0 - vT) * 0.6;
          float a = (ring + spikes) * 0.18;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.splashMesh = new Mesh(sg, this.splashMat);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 11;
    W.add(this.splashMesh);

    // ---- 屋檐滴水：雨棚边缘、招牌下沿、公寓走廊边一颗颗往下掉
    const eaves: Array<[number, number, number, number, number]> = [
      // x0, x1, z, y, 地面高
      [STORE.x0, STORE.x1, STORE.z1 + 1.22, 2.94, 0.15],
      [-12.2, -12.2, -18, 3.2, 0.15],
      [-3, 3, 14.75, 2.86, 0.15],
    ];
    for (let i = 0; i < DRIP_N; i++) {
      const e = eaves[i < 40 ? 0 : i < 50 ? 1 : 2] as (typeof eaves)[number];
      const u = Math.random();
      const p = e[0] === e[1] ? new Vector3(e[0] + 1.25, e[3], -18 + u * 19) : new Vector3(e[0] + (e[1] - e[0]) * u, e[3], e[2]);
      this.drips.push({ p, t: Math.random() * 2, period: 0.8 + Math.random() * 1.6 });
      void e[4];
    }
    const dg = new InstancedBufferGeometry();
    dg.index = q.index;
    dg.setAttribute('position', q.getAttribute('position'));
    dg.setAttribute('uv', q.getAttribute('uv'));
    this.dripData = new Float32Array(DRIP_N * 4);
    this.dripAttr = new InstancedBufferAttribute(this.dripData, 4);
    dg.setAttribute('iData', this.dripAttr);
    dg.instanceCount = DRIP_N;
    this.dripMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color(0xd8e8ff) } },
      vertexShader: /* glsl */ `
        attribute vec4 iData; varying vec2 vUv; varying float vA;
        void main(){
          vUv = uv; vA = iData.w;
          vec4 mv = viewMatrix * vec4(iData.xyz, 1.0);
          mv.xy += position.xy * vec2(0.02, 0.07);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vUv; varying float vA;
        void main(){
          float r = length((vUv - 0.5) * vec2(2.0, 2.0));
          float a = smoothstep(1.0, 0.2, r) * vA * 0.9;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.dripMesh = new Mesh(dg, this.dripMat);
    this.dripMesh.frustumCulled = false;
    W.add(this.dripMesh);
  }

  toggle(): void {
    this.raining = !this.raining;
    if (!this.raining) this.dryDelay = 25;
  }

  /** 让地面立刻变干 / 变湿（调试用） */
  setWet(v: number): void {
    this.wet = v;
  }

  /** 雨丝盒子的大小、淡出距离；水花撒的范围（模型视角时整个底座都要下雨） */
  setView(box: number, height: number, fade: number, splash: number, alpha = 0.35): void {
    this.rainMat.uniforms.uAlpha!.value = alpha;
    (this.rainMat.uniforms.uBox!.value as Vector3).set(box, height, box);
    this.rainMat.uniforms.uFade!.value = fade;
    this.splashR = splash;
  }
  private splashR = 22;

  /** cam：镜头位置（雨丝围着它）；focus：水花撒在哪附近 */
  update(dt: number, t: number, cam: Vector3, focus: Vector3 = cam): void {
    const target = this.raining ? 1 : 0;
    // 雨量：开始下雨慢一点（4 秒）、停得快一点（3 秒）
    this.rain += Math.sign(target - this.rain) * Math.min(Math.abs(target - this.rain), dt / (this.raining ? 4 : 3));
    // 湿度：下雨时 40 秒涨满；停雨后等 dryDelay 秒，再用 60 秒退干
    if (this.raining) this.wet = Math.min(1, this.wet + dt / 40);
    else {
      this.dryDelay -= dt;
      if (this.dryDelay < 0) this.wet = Math.max(0, this.wet - dt / 60);
    }
    this.W.rain = this.rain;
    this.W.wet = this.wet;
    this.rainMat.uniforms.uTime!.value = t;
    (this.rainMat.uniforms.uCam!.value as Vector3).copy(cam);
    this.rainMat.uniforms.uAmount!.value = this.rain;
    this.rainMesh.visible = this.rain > 0.01;
    this.splashMat.uniforms.uTime!.value = t;

    // 水花：在相机附近随机落点（屋顶下面的不算）
    this.splashAcc += dt * 700 * this.rain * (this.splashR / 22) ** 2;
    let n = Math.floor(this.splashAcc);
    this.splashAcc -= n;
    while (n-- > 0) {
      const x = focus.x + (Math.random() - 0.5) * this.splashR;
      const z = focus.z + (Math.random() - 0.5) * this.splashR;
      if (Math.abs(x) > HALF || Math.abs(z) > HALF) continue;
      const y = groundY(x, z);
      if (y < -1) continue;
      const i = this.splashNext;
      this.splashNext = (this.splashNext + 1) % SPLASH_N;
      this.splashData[i * 4] = x;
      this.splashData[i * 4 + 1] = y + 0.01;
      this.splashData[i * 4 + 2] = z;
      this.splashData[i * 4 + 3] = t + Math.random() * 0.05;
    }
    // 伞上的雨点：撑伞时在头顶溅开
    if (this.W.holdingUmbrella && this.rain > 0.1 && groundY(cam.x, cam.z) > -1) {
      for (let j = 0; j < 3; j++) {
        if (Math.random() > this.rain) continue;
        const i = this.splashNext;
        this.splashNext = (this.splashNext + 1) % SPLASH_N;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.5;
        this.splashData[i * 4] = cam.x + Math.cos(a) * r;
        this.splashData[i * 4 + 1] = cam.y + 0.45 - r * 0.3;
        this.splashData[i * 4 + 2] = cam.z + Math.sin(a) * r;
        this.splashData[i * 4 + 3] = t;
      }
    }
    this.splashAttr.needsUpdate = true;

    // 屋檐滴水：停雨以后还会再滴一阵（跟着湿度）
    const dripOn = Math.max(this.rain, Math.min(1, this.wet * 1.5) * 0.6);
    this.drips.forEach((d, i) => {
      d.t += dt;
      const period = d.period / Math.max(0.15, dripOn);
      if (d.t > period) d.t -= period;
      // 先在檐口挂一会儿，再加速掉下来
      const hang = 0.5;
      const fall = Math.max(0, d.t - hang);
      const y = d.p.y - 4.9 * fall * fall;
      const ground = 0.16;
      const alive = y > ground && dripOn > 0.05 && Math.random() > 0.001;
      this.dripData[i * 4] = d.p.x;
      this.dripData[i * 4 + 1] = Math.max(ground, y);
      this.dripData[i * 4 + 2] = d.p.z;
      this.dripData[i * 4 + 3] = alive ? 1 : 0;
    });
    this.dripAttr.needsUpdate = true;
  }
}

/** 某个位置的地面高度：屋顶下面（被遮住、不会有水花）返回 -9 */
export function groundY(x: number, z: number): number {
  for (const [x0, x1, z0, z1] of COVERS) if (x > x0 && x < x1 && z > z0 && z < z1) return -9;
  const road = (z > 7 && z < 13) || (x > 10 && x < 16);
  return road ? 0 : 0.15;
}
