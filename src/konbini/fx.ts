import { CanvasTexture, MeshBasicMaterial, AdditiveBlending, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/**
 * 小粒子：热气（关东煮、咖啡、空调外机）。每个粒子是一个朝向镜头的软圆片，往上飘、变大、变淡。
 */
interface Emitter {
  p: Vector3;
  rate: number;
  on: () => boolean;
  acc: number;
  spread: number;
}

export class Steam {
  readonly mesh: Mesh;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly life: Float32Array;
  private readonly vel: Float32Array;
  private readonly aPos: InstancedBufferAttribute;
  private readonly aLife: InstancedBufferAttribute;
  private readonly emitters: Emitter[] = [];
  private next = 0;

  constructor(n = 160, color = 0xffffff, additive = false) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(1);
    this.vel = new Float32Array(n * 3);
    const g = new InstancedBufferGeometry();
    const q = new PlaneGeometry(1, 1);
    g.index = q.index;
    g.setAttribute('position', q.getAttribute('position'));
    g.setAttribute('uv', q.getAttribute('uv'));
    this.aPos = new InstancedBufferAttribute(this.pos, 3);
    this.aLife = new InstancedBufferAttribute(this.life, 1);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iLife', this.aLife);
    g.instanceCount = n;
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: { uColor: { value: new Color(color) } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute float iLife;
        varying vec2 vUv; varying float vLife;
        void main(){
          vUv = uv; vLife = iLife;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float s = mix(0.06, 0.32, iLife) * step(iLife, 0.999);
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vUv; varying float vLife;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.2, d) * (1.0 - vLife) * smoothstep(0.0, 0.15, vLife) * 0.28;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  emit(p: Vector3, rate: number, on: () => boolean = () => true, spread = 0.12): void {
    this.emitters.push({ p, rate, on, acc: 0, spread });
  }

  update(dt: number): void {
    for (const e of this.emitters) {
      if (!e.on()) continue;
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const i = this.next;
        this.next = (this.next + 1) % this.n;
        this.pos[i * 3] = e.p.x + (Math.random() - 0.5) * e.spread;
        this.pos[i * 3 + 1] = e.p.y;
        this.pos[i * 3 + 2] = e.p.z + (Math.random() - 0.5) * e.spread;
        this.vel[i * 3] = (Math.random() - 0.5) * 0.08;
        this.vel[i * 3 + 1] = 0.25 + Math.random() * 0.2;
        this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
        this.life[i] = 0;
      }
    }
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] >= 1) continue;
      this.life[i] = Math.min(1, (this.life[i] as number) + dt / 2.2);
      this.pos[i * 3] = (this.pos[i * 3] as number) + (this.vel[i * 3] as number) * dt;
      this.pos[i * 3 + 1] = (this.pos[i * 3 + 1] as number) + (this.vel[i * 3 + 1] as number) * dt;
      this.pos[i * 3 + 2] = (this.pos[i * 3 + 2] as number) + (this.vel[i * 3 + 2] as number) * dt;
    }
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
  }
}

/** 软的接触阴影（贴在地上的径向渐变）：给会动的东西用，它们不进阴影贴图 */
let blobTex: CanvasTexture | null = null;
export function blobShadow(r: number): Mesh {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    blobTex = new CanvasTexture(c);
  }
  const geo = new PlaneGeometry(r * 2, r * 2);
  geo.rotateX(-Math.PI / 2);
  const m = new Mesh(geo, new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.renderOrder = 2;
  return m;
}
