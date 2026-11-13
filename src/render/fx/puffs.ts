import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';

export interface PuffOpts {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 刚出来时的直径（米） */
  size: number;
  /** 散开到最后是开始的几倍 */
  grow: number;
  life: number;
  r: number;
  g: number;
  b: number;
  /** 最浓的时候有多不透明（0–1） */
  alpha: number;
  /** 往上飘的加速度 */
  rise?: number;
  drag?: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute float iSize;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  mvPosition.xy += position.xy * iSize;
  // 面片往镜头这边拉半个直径：灰是贴着墙面 / 地面冒出来的，不拉的话面片有一半插在墙里，边上是一条硬切线
  mvPosition.z += min(iSize * 0.5, max(0.0, -mvPosition.z - 0.2));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** 离镜头太近的灰：直径不超过「距离 × 这个数」，不然贴着墙开枪时整屏都是一团 */
const NEAR_CAP = 0.3;

/** 一团团半透明的灰 / 烟：永远朝着镜头的软边圆片，边散开边变淡。一个 InstancedMesh 画完 */
export class Puffs {
  readonly mesh: Mesh;
  /** 镜头的位置（Effects 每帧写进来） */
  readonly eye = new Vector3();
  private n = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly grow: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly alpha: Float32Array;
  private readonly rise: Float32Array;
  private readonly drag: Float32Array;
  private readonly aPos: InstancedBufferAttribute;
  private readonly aColor: InstancedBufferAttribute;
  private readonly aSize: InstancedBufferAttribute;
  private readonly geo: InstancedBufferGeometry;
  private readonly mat: ShaderMaterial;

  constructor(readonly max = 256) {
    const quad = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aColor = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aSize = new InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aPos, this.aColor, this.aSize]) a.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iSize', this.aSize);
    this.geo.instanceCount = 0;
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: UniformsUtils.clone(UniformsLib.fog),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    // 排在贴花、路灯光斑这些贴地的透明面片后面画
    this.mesh.renderOrder = 2;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    const f = () => new Float32Array(max);
    this.size = f();
    this.grow = f();
    this.life = f();
    this.maxLife = f();
    this.alpha = f();
    this.rise = f();
    this.drag = f();
  }

  get count(): number {
    return this.n;
  }

  spawn(o: PuffOpts): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx;
    this.vel[i * 3 + 1] = o.vy;
    this.vel[i * 3 + 2] = o.vz;
    this.col[i * 3] = o.r;
    this.col[i * 3 + 1] = o.g;
    this.col[i * 3 + 2] = o.b;
    this.size[i] = o.size;
    this.grow[i] = o.grow;
    this.life[i] = this.maxLife[i] = o.life;
    this.alpha[i] = o.alpha;
    this.rise[i] = o.rise ?? 0.4;
    this.drag[i] = o.drag ?? 2.5;
  }

  update(dt: number): void {
    const { pos, vel, col } = this;
    const outPos = this.aPos.array as Float32Array;
    const outCol = this.aColor.array as Float32Array;
    const outSize = this.aSize.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      this.life[i] = (this.life[i] as number) - dt;
      if ((this.life[i] as number) <= 0) {
        this.removeAt(i);
        continue;
      }
      const a = i * 3;
      const d = Math.exp(-(this.drag[i] as number) * dt);
      vel[a] = (vel[a] as number) * d;
      vel[a + 1] = ((vel[a + 1] as number) + (this.rise[i] as number) * dt) * d;
      vel[a + 2] = (vel[a + 2] as number) * d;
      pos[a] = (pos[a] as number) + (vel[a] as number) * dt;
      pos[a + 1] = (pos[a + 1] as number) + (vel[a + 1] as number) * dt;
      pos[a + 2] = (pos[a + 2] as number) + (vel[a + 2] as number) * dt;
      // k：0 刚出来 → 1 散尽。先快后慢地散开；一开始很快变浓，然后匀速淡掉
      const k = 1 - (this.life[i] as number) / (this.maxLife[i] as number);
      const spread = 1 - (1 - k) * (1 - k);
      let s = (this.size[i] as number) * (1 + ((this.grow[i] as number) - 1) * spread);
      const dist = Math.hypot((pos[a] as number) - this.eye.x, (pos[a + 1] as number) - this.eye.y, (pos[a + 2] as number) - this.eye.z);
      s = Math.min(s, dist * NEAR_CAP);
      const fade = Math.min(1, k * 8) * (1 - k);
      outPos[a] = pos[a] as number;
      outPos[a + 1] = pos[a + 1] as number;
      outPos[a + 2] = pos[a + 2] as number;
      const c = i * 4;
      outCol[c] = col[a] as number;
      outCol[c + 1] = col[a + 1] as number;
      outCol[c + 2] = col[a + 2] as number;
      outCol[c + 3] = (this.alpha[i] as number) * fade;
      outSize[i] = s;
      i++;
    }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  private removeAt(i: number): void {
    const l = --this.n;
    if (i === l) return;
    for (const arr of [this.pos, this.vel, this.col]) {
      arr[i * 3] = arr[l * 3] as number;
      arr[i * 3 + 1] = arr[l * 3 + 1] as number;
      arr[i * 3 + 2] = arr[l * 3 + 2] as number;
    }
    for (const arr of [this.size, this.grow, this.life, this.maxLife, this.alpha, this.rise, this.drag]) arr[i] = arr[l] as number;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
