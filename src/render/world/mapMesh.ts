import { BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { Rng } from '../../game/core/rng';
import { GRID_H, GRID_W, HALF_H, HALF_W } from '../../game/world/grid';
import type { MapData, Prop, PropKind, WallStyle } from '../../game/world/types';
import { makeGroundTexture } from './ground';
import { Builder, Mats, Pal, toGroup } from '../kit';
import { buildGeneratorCore, buildProp, generatorCage } from './props';

const CHUNK = 16;

export interface MapView {
  group: Group;
  /** 发电机能量核心的材质，渲染层用它做脉动 */
  coreMaterial: MeshBasicMaterial;
  scrapBoxes: Group[];
  /** 重建静态道具：skip 里的种类不建，trimWalls 里风格的墙只建细节，cliffs = false 时不建岩壁 */
  rebuild(o: StaticOpts): void;
  /** 换成写实地面：原来那张平面藏起来 */
  hideGround(): void;
  /** 每栋房子的屋顶（程序版）；换成写实屋顶后由视图替换 */
  roofs: Group[];
  dispose(): void;
}

function chunkOf(cx: number, cy: number): number {
  const x = Math.min(GRID_W / CHUNK - 1, Math.max(0, Math.floor(cx / CHUNK)));
  const y = Math.min(GRID_H / CHUNK - 1, Math.max(0, Math.floor(cy / CHUNK)));
  return y * (GRID_W / CHUNK) + x;
}

/** 地图边界外的岩壁：参差不齐的尖石，挡住视线，也让场地有"被困住"的感觉 */
function cliffs(get: (k: number) => Builder): void {
  const rng = new Rng(9001);
  const rock = (cx: number, cy: number) => {
    const b = get(chunkOf(cx, cy));
    const x = cx - HALF_W;
    const z = cy - HALF_H;
    const h = rng.range(1.6, 4.2);
    const r = rng.range(0.8, 1.6);
    const col = rng.pick([0x3c3b3a, 0x464544, 0x333436, 0x4a4947]);
    b.cone(r, h, rng.int(5, 7), { x, z, ry: rng.range(0, 3), rx: rng.range(-0.1, 0.1), rz: rng.range(-0.1, 0.1) }, { color: col, jitter: 0.3, ao: 0.55, aoH: 3 });
    if (rng.chance(0.6)) {
      b.box(rng.range(1.2, 2.4), rng.range(0.8, 2.0), rng.range(1.0, 2.0), { x: x + rng.range(-0.8, 0.8), z: z + rng.range(-0.8, 0.8), ry: rng.range(0, 3), rx: rng.range(-0.2, 0.2) }, { color: col, jitter: 0.3, ao: 0.5, aoH: 2 });
    }
  };
  // 沿四条边铺一圈：贴近地图内沿 1.6 格，向外延伸 2.5 格
  for (let t = -1; t < GRID_W + 1; t += 1.5) {
    rock(t, rng.range(-2.5, 1.6));
    rock(t, rng.range(GRID_H - 1.6, GRID_H + 2.5));
    rock(rng.range(-2.5, 1.6), t);
    rock(rng.range(GRID_W - 1.6, GRID_W + 2.5), t);
  }
}

function scrapBox(): Group {
  const b = new Builder();
  b.rbox(0.8, 0.5, 0.56, 0.05, {}, { color: 0x4f565c, mat: 'metal', jitter: 0.15, ao: 0.4 });
  b.rbox(0.84, 0.1, 0.6, 0.03, { y: 0.5 }, { color: 0x6a7278, mat: 'metal', jitter: 0.1, ao: 0 });
  b.box(0.5, 0.04, 0.04, { y: 0.62, z: 0.0 }, { color: 0x9aa0a4, mat: 'metal', ao: 0 });
  b.box(0.7, 0.06, 0.02, { y: 0.3, z: 0.29 }, { color: 0xffc040, mat: 'glow', glow: 1.8 });
  b.box(0.7, 0.06, 0.02, { y: 0.3, z: -0.29 }, { color: 0xffc040, mat: 'glow', glow: 1.8 });
  b.rod([-0.2, 0.55, 0.1], [-0.35, 0.85, 0.2], 0.03, { color: Pal.rust, mat: 'metal', ao: 0 }, 4);
  b.rod([0.2, 0.55, -0.1], [0.3, 0.8, -0.2], 0.03, { color: 0x7c8890, mat: 'metal', ao: 0 }, 4);
  b.box(0.18, 0.04, 0.12, { x: 0.15, y: 0.6, z: 0.1, ry: 0.5 }, { color: 0x9a6a3a, mat: 'metal', ao: 0 });
  return toGroup(b.build());
}

export interface StaticOpts {
  skip: ReadonlySet<PropKind>;
  /** 虽然种类在 skip 里，这几个道具仍然用程序模型建（写实模型缺的家具） */
  keep?: ReadonlySet<Prop>;
  trimWalls: ReadonlySet<WallStyle>;
  cliffs: boolean;
}

/** 地图道具按 16×16 格分块合并成几个大网格；被写实模型替换的部分不建 */
function buildStatics(map: MapData, o: StaticOpts): { group: Group; geos: BufferGeometry[] } {
  const builders = new Map<number, Builder>();
  const get = (k: number): Builder => {
    let b = builders.get(k);
    if (!b) {
      b = new Builder();
      builders.set(k, b);
    }
    return b;
  };
  for (const p of map.props) {
    const b = get(chunkOf((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2));
    if (!o.skip.has(p.kind) || o.keep?.has(p)) buildProp(b, p, o.trimWalls);
    // 发电机换成写实机组时，顶上的电芯护笼仍然要
    else if (p.kind === 'generator') generatorCage(b, p);
  }
  if (o.cliffs) cliffs(get);

  const group = new Group();
  const geos: BufferGeometry[] = [];
  for (const b of builders.values()) {
    const built = b.build();
    for (const k of ['matte', 'metal', 'glow'] as const) {
      const geo = built[k];
      if (geo) geos.push(geo);
    }
    group.add(toGroup(built));
  }
  return { group, geos };
}

export function buildMapView(map: MapData, anisotropy: number): MapView {
  const group = new Group();

  // ---- 地面 ----
  const groundTex = makeGroundTexture(map.grid, anisotropy);
  const ground = new Mesh(new PlaneGeometry(GRID_W, GRID_H), new MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const outer = new Mesh(new PlaneGeometry(500, 500), new MeshStandardMaterial({ color: 0x1b1d19, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  outer.receiveShadow = true;
  group.add(outer);

  // ---- 静态道具 ----
  let statics = buildStatics(map, { skip: new Set(), trimWalls: new Set(), cliffs: true });
  group.add(statics.group);
  const geos: BufferGeometry[] = [];

  // ---- 发电机能量核心 ----
  const coreMaterial = (Mats.glow as MeshBasicMaterial).clone();
  const coreBuilt = buildGeneratorCore(map.corePos.x, map.corePos.z).build();
  if (coreBuilt.glow) {
    const m = new Mesh(coreBuilt.glow, coreMaterial);
    group.add(m);
    geos.push(coreBuilt.glow);
  }

  // ---- 屋顶（程序版）：每栋一个 Group，玩家进屋时藏起来 ----
  const roofs: Group[] = map.houses.map((h) => {
    const g = new Group();
    g.name = 'roof';
    if (h.roof !== 'flat') return g;
    const w = h.x1 - h.x0;
    const d = h.y1 - h.y0;
    const at = { x: (h.x0 + h.x1) / 2 - HALF_W, z: (h.y0 + h.y1) / 2 - HALF_H };
    const part = (name: string, f: (b: Builder) => void) => {
      const b = new Builder();
      f(b);
      const built = b.build();
      if (built.matte) geos.push(built.matte);
      const m = toGroup(built);
      m.name = name;
      g.add(m);
    };
    part('roof:top', (b) => b.box(w + 0.3, 0.18, d + 0.3, { ...at, y: h.h }, { color: 0x3a3836, jitter: 0.1, ao: 0 }));
    part('roof:ceiling', (b) => b.box(w - 1.6, 0.04, d - 1.6, { ...at, y: h.h - 0.05 }, { color: 0xc8c2b6, jitter: 0.05, ao: 0 }));
    group.add(g);
    return g;
  });

  // ---- 零件箱 ----
  const scrapBoxes: Group[] = [];
  const rng = new Rng(55);
  for (const c of map.scrapBoxes) {
    const g = scrapBox();
    g.position.set(c.cx - HALF_W + 0.5, 0, c.cy - HALF_H + 0.5);
    g.rotation.y = rng.range(0, 6.28);
    group.add(g);
    scrapBoxes.push(g);
  }

  return {
    group,
    coreMaterial,
    scrapBoxes,
    roofs,
    rebuild(o) {
      group.remove(statics.group);
      for (const g of statics.geos) g.dispose();
      statics = buildStatics(map, o);
      group.add(statics.group);
    },
    hideGround() {
      ground.visible = false;
    },
    dispose() {
      groundTex.dispose();
      for (const g of statics.geos) g.dispose();
      for (const g of geos) g.dispose();
      ground.geometry.dispose();
      outer.geometry.dispose();
    },
  };
}
