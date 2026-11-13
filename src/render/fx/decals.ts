import { CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { Rng } from '../../game/core/rng';

export type DecalKind = 'blood' | 'acid' | 'scorch';

const COLORS: Record<DecalKind, number> = { blood: 0x5a100c, acid: 0x6ea82a, scorch: 0x0c0b0a };

function splatTexture(seed: number): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const rng = new Rng(seed);
  ctx.fillStyle = '#fff';
  // 中心大块 + 周围飞溅的小点 + 拖尾
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, 6.28);
    const d = rng.range(0, 26);
    const r = rng.range(8, 22) * (1 - d / 60);
    const g = ctx.createRadialGradient(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, 6.28);
    ctx.fill();
  }
  for (let i = 0; i < 22; i++) {
    const a = rng.range(0, 6.28);
    const d = rng.range(28, 58);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.5, 0.95)})`;
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, rng.range(1.2, 4.5), 0, 6.28);
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Decal {
  mesh: Mesh;
  mat: MeshStandardMaterial;
  age: number;
  life: number;
  base: number;
}

/** 地面贴花：血迹、酸液、焦痕。固定数量的循环池，最旧的被覆盖 */
export class Decals {
  readonly group = new Group();
  private readonly pool: Decal[] = [];
  private readonly textures = [splatTexture(1), splatTexture(2), splatTexture(3), splatTexture(4)];
  private idx = 0;
  private readonly rng = new Rng(777);

  constructor(max = 90) {
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < max; i++) {
      const mat = new MeshStandardMaterial({
        map: this.textures[i % this.textures.length] as CanvasTexture,
        transparent: true,
        depthWrite: false,
        roughness: 0.35,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.012;
      mesh.visible = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.pool.push({ mesh, mat, age: 0, life: 0, base: 0 });
    }
  }

  add(kind: DecalKind, x: number, z: number, size: number, life = 26): void {
    const d = this.pool[this.idx] as Decal;
    this.idx = (this.idx + 1) % this.pool.length;
    d.mesh.visible = true;
    d.mesh.position.set(x, 0.012 + (this.idx % 7) * 0.0006, z);
    d.mesh.rotation.z = this.rng.range(0, 6.28);
    d.mesh.scale.set(size, size, 1);
    d.mat.color.set(new Color(COLORS[kind]).offsetHSL(0, 0, this.rng.range(-0.02, 0.03)));
    d.age = 0;
    d.life = life;
    d.base = kind === 'scorch' ? 0.85 : 0.9;
    // 血和酸是湿的，反光；焦痕是干的：不压掉反光的话，低角度看过去映着天空，是一块浅灰色的「水渍」
    d.mat.roughness = kind === 'scorch' ? 1 : 0.35;
    d.mat.envMapIntensity = kind === 'scorch' ? 0 : 1;
    d.mat.opacity = d.base;
  }

  update(dt: number): void {
    for (const d of this.pool) {
      if (!d.mesh.visible) continue;
      d.age += dt;
      const left = d.life - d.age;
      if (left <= 0) d.mesh.visible = false;
      else if (left < 6) d.mat.opacity = d.base * (left / 6);
    }
  }
}
