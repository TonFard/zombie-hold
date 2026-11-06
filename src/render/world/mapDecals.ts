import { CanvasTexture, Group, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { Rng } from '../../game/core/rng';
import { Ground, HALF_H, HALF_W } from '../../game/world/grid';
import type { MapData } from '../../game/world/types';

/**
 * 地面贴花（M19）：地图上固定的油污、积水、轮胎印、裂缝。和战斗中的血迹 / 焦痕（fx/decals.ts，循环池）分开：
 * 这些是地图的一部分，按固定种子撒一次、永远在。每种一个 InstancedMesh（一次绘制），只是平面贴片，不进网格。
 *
 *   油污：加油站、停车场、路上的车旁边——深色、很光滑（反光）
 *   积水：沥青和混凝土上的低洼——几乎黑色、极光滑，反射天空（夜里能映出路灯）
 *   轮胎印：沿着四条路的方向，两道平行的深色条纹
 *   裂缝：沥青上的细线
 * 画质：高 全部；中 一半；低 只有积水和油污（数量少、最能体现"地面不是一张图"）
 */
export type MapDecalKind = 'oil' | 'puddle' | 'tire' | 'crack';

interface KindDef {
  color: number;
  rough: number;
  metal: number;
  opacity: number;
  /** 画质低时也保留 */
  low: boolean;
}

const KINDS: Record<MapDecalKind, KindDef> = {
  oil: { color: 0x0a0a0c, rough: 0.18, metal: 0.25, opacity: 0.75, low: true },
  puddle: { color: 0x0c1014, rough: 0.04, metal: 0.4, opacity: 0.82, low: true },
  tire: { color: 0x101010, rough: 0.85, metal: 0, opacity: 0.55, low: false },
  crack: { color: 0x0a0908, rough: 0.9, metal: 0, opacity: 0.7, low: false },
};

/** 贴图：白色形状 + alpha（颜色由材质给） */
function texture(kind: MapDecalKind, seed: number): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const rng = new Rng(seed);
  if (kind === 'oil' || kind === 'puddle') {
    // 不规则的一摊：几个重叠的椭圆，边缘柔
    for (let i = 0; i < (kind === 'oil' ? 6 : 9); i++) {
      const x = S / 2 + rng.range(-24, 24);
      const y = S / 2 + rng.range(-18, 18);
      const r = rng.range(16, 34);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rng.range(0.5, 0.9), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'tire') {
    // 两道平行的轮胎印，带一点花纹
    for (const x0 of [S * 0.3, S * 0.7]) {
      for (let y = 0; y < S; y += 3) {
        const w = 10 + Math.sin(y * 0.3) * 1.5;
        ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.min(1, Math.min(y, S - y) / 20)})`;
        ctx.fillRect(x0 - w / 2 + rng.range(-0.8, 0.8), y, w, 2);
      }
    }
  } else {
    // 裂缝：从中间往外分叉的折线
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineCap = 'round';
    const crack = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      for (let i = 0; i < len; i++) {
        const nx = x + Math.cos(a) * 6;
        const ny = y + Math.sin(a) * 6;
        ctx.lineWidth = w * (1 - i / len) + 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        x = nx;
        y = ny;
        a += rng.range(-0.5, 0.5);
        if (depth > 0 && rng.chance(0.18)) crack(x, y, a + rng.range(-1.2, 1.2), Math.floor(len * 0.5), w * 0.6, depth - 1);
      }
    };
    for (let k = 0; k < 3; k++) crack(S / 2, S / 2, rng.range(0, Math.PI * 2), 9, 2.6, 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Place {
  x: number;
  z: number;
  /** 长、宽（米），朝向 */
  sx: number;
  sz: number;
  ry: number;
}

/** 按地面类型和道具撒贴花（固定种子） */
function layout(map: MapData, seed: number): Record<MapDecalKind, Place[]> {
  const rng = new Rng(seed);
  const g = map.grid;
  const out: Record<MapDecalKind, Place[]> = { oil: [], puddle: [], tire: [], crack: [] };
  const free = (cx: number, cy: number) => g.inBounds(cx, cy) && !g.solid[g.idx(cx, cy)];
  const wx = (cx: number) => cx - HALF_W + 0.5;
  const wz = (cy: number) => cy - HALF_H + 0.5;
  // 车旁边：油污
  for (const p of map.props) {
    if (p.kind !== 'car' && p.kind !== 'pump') continue;
    if (!rng.chance(p.kind === 'pump' ? 1 : 0.7)) continue;
    const cx = rng.int(p.x0 - 1, p.x1);
    const cy = rng.int(p.y0 - 1, p.y1);
    if (!free(cx, cy)) continue;
    const s = rng.range(1.2, 2.4);
    out.oil.push({ x: wx(cx) + rng.range(-0.3, 0.3), z: wz(cy) + rng.range(-0.3, 0.3), sx: s, sz: s * rng.range(0.6, 1), ry: rng.range(0, 6.28) });
  }
  // 沥青 / 混凝土上随机撒：积水、裂缝；沿着路：轮胎印
  for (let i = 0; i < 4000; i++) {
    const cx = rng.int(3, g.w - 4);
    const cy = rng.int(3, g.h - 4);
    if (!free(cx, cy)) continue;
    const gnd = g.ground[g.idx(cx, cy)];
    const hard = gnd === Ground.Asphalt || gnd === Ground.Concrete;
    if (!hard) continue;
    const r = rng.next();
    if (r < 0.012 && out.puddle.length < 26) {
      const s = rng.range(1.6, 3.6);
      out.puddle.push({ x: wx(cx), z: wz(cy), sx: s, sz: s * rng.range(0.5, 0.85), ry: rng.range(0, 6.28) });
    } else if (r < 0.04 && out.crack.length < 60 && gnd === Ground.Asphalt) {
      const s = rng.range(1.2, 2.6);
      out.crack.push({ x: wx(cx), z: wz(cy), sx: s, sz: s, ry: rng.range(0, 6.28) });
    } else if (r < 0.055 && out.tire.length < 40 && gnd === Ground.Asphalt) {
      // 轮胎印顺着路：看左右 / 上下哪个方向是更长的沥青
      let h = 0;
      let v = 0;
      for (let k = -3; k <= 3; k++) {
        if (g.inBounds(cx + k, cy) && g.ground[g.idx(cx + k, cy)] === Ground.Asphalt) h++;
        if (g.inBounds(cx, cy + k) && g.ground[g.idx(cx, cy + k)] === Ground.Asphalt) v++;
      }
      const len = rng.range(3, 6);
      out.tire.push({ x: wx(cx), z: wz(cy), sx: 1.2, sz: len, ry: (h > v ? Math.PI / 2 : 0) + rng.range(-0.15, 0.15) });
    }
  }
  return out;
}

export interface MapDecals {
  group: Group;
  setQuality(q: 'low' | 'mid' | 'high'): void;
  dispose(): void;
}

export function buildMapDecals(map: MapData, seed = 31337): MapDecals {
  const places = layout(map, seed);
  const group = new Group();
  group.name = 'mapDecals';
  const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const disposables: Array<{ dispose(): void }> = [geo];
  const meshes: Array<{ kind: MapDecalKind; mesh: InstancedMesh }> = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  (Object.keys(KINDS) as MapDecalKind[]).forEach((kind, k) => {
    const list = places[kind];
    if (!list.length) return;
    const d = KINDS[kind];
    const tex = texture(kind, 100 + k);
    const mat = new MeshStandardMaterial({ color: d.color, map: tex, roughness: d.rough, metalness: d.metal, transparent: true, opacity: d.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 - k, polygonOffsetUnits: -1 - k });
    const mesh = new InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.ry);
      // 每种贴花高度错开一点点，互相叠的时候不闪
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, 0.008 + k * 0.002, p.z), q, scl.set(p.sx, 1, p.sz)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    mesh.name = `decal:${kind}`;
    group.add(mesh);
    meshes.push({ kind, mesh });
    disposables.push(tex, mat);
  });
  return {
    group,
    setQuality(qa) {
      for (const { kind, mesh } of meshes) {
        const n = places[kind].length;
        // 低画质：只留积水和油污；中画质：一半
        mesh.count = qa === 'low' ? (KINDS[kind].low ? n : 0) : qa === 'mid' ? Math.ceil(n / 2) : n;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

