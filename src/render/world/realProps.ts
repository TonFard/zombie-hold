import {
  Box3,
  EquirectangularReflectionMapping,
  Group,
  InstancedMesh,
  Matrix4,
  type Mesh,
  type Material,
  type BufferGeometry,
  PMREMGenerator,
  Quaternion,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Rng } from '../../game/core/rng';
import { HALF_H, HALF_W } from '../../game/world/grid';
import type { MapData, Prop, PropKind } from '../../game/world/types';
import { rectOf } from './props/kit';

/**
 * 写实道具（Poly Haven，CC0）：读 public/props/manifest.json（npm run props:import 生成），
 * 把地图里部分种类的程序道具换成扫描模型。同一个模型的所有摆放合成一个 InstancedMesh。
 * manifest.enabled=false 时不启用；URL 加 ?props=1 强制启用、?props=0 强制关闭。
 */

interface Manifest {
  enabled: boolean;
  hdri: string | null;
  assets: Record<string, { file: string; tris: number }>;
}

/** 归一化后的模型：长的水平边沿 X，底面在 y=0，水平居中 */
interface Model {
  parts: Array<{ geo: BufferGeometry; mat: Material | Material[]; local: Matrix4 }>;
  size: Vector3;
}

/** 这些种类整体换成写实模型，程序版不再建 */
export const REAL_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['barrel', 'crate', 'barrier', 'rack', 'lamp']);

const BASE = `${import.meta.env.BASE_URL}props/`;

export async function loadPropsManifest(): Promise<Manifest | null> {
  const q = new URLSearchParams(window.location.search).get('props');
  if (q === '0') return null;
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const m = (await res.json()) as Manifest;
    return m.enabled || q === '1' ? m : null;
  } catch {
    return null;
  }
}

async function loadModel(loader: GLTFLoader, file: string): Promise<Model> {
  const gltf = await loader.loadAsync(`${BASE}${file}`);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  // 长边转到 X
  const turn = size.z > size.x ? new Matrix4().makeRotationY(Math.PI / 2) : new Matrix4();
  const center = box.getCenter(new Vector3());
  const norm = turn.multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const parts: Model['parts'] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    parts.push({ geo: m.geometry, mat: m.material, local: norm.clone().multiply(m.matrixWorld) });
  });
  if (size.z > size.x) [size.x, size.z] = [size.z, size.x];
  return { parts, size };
}

/** 一次摆放：世界位置、朝向、三轴缩放（以模型原尺寸为 1） */
interface Place {
  x: number;
  y: number;
  z: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
}

/** 按地图道具算出每个模型的摆放 */
function layout(map: MapData, models: Map<string, Model>): Map<string, Place[]> {
  const out = new Map<string, Place[]>();
  const put = (id: string, p: Place) => {
    if (!models.has(id)) return;
    let a = out.get(id);
    if (!a) out.set(id, (a = []));
    a.push(p);
  };
  const size = (id: string) => models.get(id)?.size ?? new Vector3(1, 1, 1);
  const uni = (x: number, y: number, z: number, ry: number, s = 1): Place => ({ x, y, z, ry, sx: s, sy: s, sz: s });

  for (const p of map.props) {
    const rng = new Rng(((p.x0 * 73856093) ^ (p.y0 * 19349663) ^ 0x51ed27) >>> 0);
    const r = rectOf(p);
    switch (p.kind) {
      case 'barrel': {
        const id = ['Barrel_01', 'Barrel_02', 'barrel_03', 'Barrel_01'][p.variant % 4] as string;
        // 统一到 0.9 高，和碰撞体一致
        const s = 0.9 / size(id).y;
        put(id, uni(r.cx + rng.range(-0.08, 0.08), 0, r.cz + rng.range(-0.08, 0.08), rng.range(0, 6.28), s));
        // 旁边偶尔丢一个油壶 / 垃圾袋（装饰，不挡路）
        if (rng.chance(0.5)) put(rng.chance(0.5) ? 'metal_jerrycan' : 'trashbag', uni(r.cx + rng.range(-0.55, 0.55), 0, r.cz + rng.pick([-0.55, 0.55]), rng.range(0, 6.28)));
        break;
      }
      case 'crate':
        crates(p, rng, put, size);
        break;
      case 'barrier': {
        // 一节 1.55 米，按长度均分，缝隙留一点
        const id = 'concrete_road_barrier';
        const s0 = size(id);
        const n = Math.max(1, Math.round(r.L / s0.x));
        const seg = r.L / n;
        const h = p.h ?? 0.9;
        for (let i = 0; i < n; i++) {
          const t = -r.L / 2 + seg * (i + 0.5);
          const ry = (r.horiz ? 0 : Math.PI / 2) + rng.range(-0.04, 0.04);
          put(id, {
            x: r.cx + (r.horiz ? t : 0),
            y: 0,
            z: r.cz + (r.horiz ? 0 : t),
            ry,
            sx: (seg * 0.97) / s0.x,
            sy: h / s0.y,
            sz: Math.min(1, (r.T * 0.9) / s0.z),
          });
        }
        if (rng.chance(0.4)) put('old_tyre', uni(r.cx + (r.horiz ? rng.range(-1, 1) : 0.7), 0, r.cz + (r.horiz ? 0.7 : rng.range(-1, 1)), rng.range(0, 6.28)));
        break;
      }
      case 'rack': {
        const id = 'worn_metal_rack';
        const s0 = size(id);
        const n = Math.max(1, Math.floor(r.L / (s0.x * 1.02)));
        const seg = r.L / n;
        const sy = (p.h ?? 2) / s0.y;
        for (let i = 0; i < n; i++) {
          const t = -r.L / 2 + seg * (i + 0.5);
          put(id, { x: r.cx + (r.horiz ? t : 0), y: 0, z: r.cz + (r.horiz ? 0 : t), ry: (r.horiz ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0), sx: 1, sy, sz: Math.min(1.4, (r.T * 0.9) / s0.z) });
          // 搁板上随手堆几个纸箱
          for (const y of [0.05, 0.72 * sy, 1.38 * sy]) {
            if (!rng.chance(0.6)) continue;
            const off = rng.range(-0.25, 0.25);
            put('cardboard_box_01', uni(r.cx + (r.horiz ? t + off : 0), y, r.cz + (r.horiz ? 0 : t + off), rng.range(-0.3, 0.3) + (r.horiz ? 0 : Math.PI / 2), 0.9));
          }
        }
        break;
      }
      case 'lamp': {
        const id = 'street_lamp_01';
        const s = ((p.h ?? 4.2) + 0.15) / size(id).y;
        put(id, uni(r.cx, 0, r.cz, (p.variant * Math.PI) / 2, s));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 木箱：每格堆一摞，摞到设定高度 */
function crates(p: Prop, rng: Rng, put: (id: string, pl: Place) => void, size: (id: string) => Vector3): void {
  const h = p.h ?? 0.9;
  const mil = p.variant >= 2;
  for (let ix = p.x0; ix < p.x1; ix++) {
    for (let iy = p.y0; iy < p.y1; iy++) {
      const x = ix + 0.5 - HALF_W;
      const z = iy + 0.5 - HALF_H;
      let y = 0;
      let lv = 0;
      while (y < h * 0.8) {
        // 底层用大箱子，上面压小一点的
        const id = mil ? 'wooden_military_crate' : lv === 0 && rng.chance(0.5) ? 'plastic_container' : 'wooden_crate_01';
        const s0 = size(id);
        const s = Math.min(0.95 / s0.x, 1.25);
        const ry = rng.range(-0.12, 0.12) + (lv % 2 ? Math.PI / 2 : 0) * (s0.x * s < 0.6 ? 1 : 0);
        put(id, { x: x + rng.range(-0.03, 0.03), y, z: z + rng.range(-0.03, 0.03), ry, sx: s, sy: s, sz: s });
        y += s0.y * s;
        lv++;
      }
      if (rng.chance(0.35)) put('cardboard_box_01', { x, y, z, ry: rng.range(0, 6.28), sx: 0.8, sy: 0.8, sz: 0.8 });
    }
  }
}

export interface RealProps {
  group: Group;
  envMap: Texture | null;
  dispose(): void;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

export async function buildRealProps(map: MapData, manifest: Manifest, renderer: WebGLRenderer): Promise<RealProps> {
  const loader = new GLTFLoader();
  const models = new Map<string, Model>();
  await Promise.all(
    Object.entries(manifest.assets).map(async ([id, a]) => {
      try {
        models.set(id, await loadModel(loader, a.file));
      } catch (e) {
        console.warn(`写实道具 ${id} 加载失败`, e);
      }
    }),
  );

  const group = new Group();
  group.name = 'realProps';
  const disposables: Array<{ dispose(): void }> = [];
  for (const [id, places] of layout(map, models)) {
    const model = models.get(id) as Model;
    for (const part of model.parts) {
      const im = new InstancedMesh(part.geo, part.mat, places.length);
      places.forEach((pl, i) => {
        _q.setFromAxisAngle(_up, pl.ry);
        _m.compose(_p.set(pl.x, pl.y, pl.z), _q, _s.set(pl.sx, pl.sy, pl.sz)).multiply(part.local);
        im.setMatrixAt(i, _m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      im.receiveShadow = true;
      im.name = id;
      group.add(im);
    }
    for (const part of model.parts) {
      disposables.push(part.geo);
      for (const m of Array.isArray(part.mat) ? part.mat : [part.mat]) disposables.push(m);
    }
  }

  // 户外 HDRI 做环境反射：写实材质在 RoomEnvironment 下发灰
  let envMap: Texture | null = null;
  if (manifest.hdri) {
    try {
      const hdr = await new HDRLoader().loadAsync(`${BASE}${manifest.hdri}`);
      hdr.mapping = EquirectangularReflectionMapping;
      const pmrem = new PMREMGenerator(renderer);
      envMap = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      disposables.push(envMap);
    } catch (e) {
      console.warn('HDRI 加载失败', e);
    }
  }
  return {
    group,
    envMap,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
