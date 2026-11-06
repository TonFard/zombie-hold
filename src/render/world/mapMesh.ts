import { AdditiveBlending, BufferGeometry, CircleGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Sprite, SpriteMaterial } from 'three';
import { FEATURES } from '../../game/data/features';
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
  /** 搜刮点的光柱（M18），visible 由 view 按能不能搜来设 */
  lootMarks: Group[];
  /** 零件箱标记的脉动：t = 时间（秒），玩家位置，night 0–1（夜里光柱收一点，免得太抢眼） */
  updateBeacons(t: number, px: number, pz: number, night: number): void;
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

/** 零件箱的标记：一道竖直光柱（远处就能看到）、地上一圈光环、箱子上一团光晕。全是加法混合，不加真实光源 */
interface Beacon {
  beam: MeshBasicMaterial;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  halo: Sprite;
  haloMat: SpriteMaterial;
  phase: number;
}

const BEACON_COLOR = 0xffb838;
let beaconTex: { beam: CanvasTexture; dot: CanvasTexture; ring: CanvasTexture } | null = null;
const beaconGeo = { beam: null as CylinderGeometry | null, ring: null as PlaneGeometry | null };

function beaconTextures(): { beam: CanvasTexture; dot: CanvasTexture; ring: CanvasTexture } {
  if (beaconTex) return beaconTex;
  // 光柱：下亮上暗，横向两边也收一点
  const bc = document.createElement('canvas');
  bc.width = 4;
  bc.height = 128;
  const bx = bc.getContext('2d') as CanvasRenderingContext2D;
  const bg = bx.createLinearGradient(0, 128, 0, 0);
  bg.addColorStop(0, 'rgba(255,255,255,1)');
  bg.addColorStop(0.15, 'rgba(255,255,255,0.75)');
  bg.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  bg.addColorStop(1, 'rgba(255,255,255,0)');
  bx.fillStyle = bg;
  bx.fillRect(0, 0, 4, 128);
  // 光晕：径向渐变
  const dc = document.createElement('canvas');
  dc.width = dc.height = 64;
  const dx = dc.getContext('2d') as CanvasRenderingContext2D;
  const dg = dx.createRadialGradient(32, 32, 0, 32, 32, 32);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  dg.addColorStop(1, 'rgba(255,255,255,0)');
  dx.fillStyle = dg;
  dx.fillRect(0, 0, 64, 64);
  // 地面光环：细圈 + 里面淡淡一层
  const rc = document.createElement('canvas');
  rc.width = rc.height = 128;
  const rx = rc.getContext('2d') as CanvasRenderingContext2D;
  const rg = rx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,0.12)');
  rg.addColorStop(0.78, 'rgba(255,255,255,0.18)');
  rg.addColorStop(0.88, 'rgba(255,255,255,1)');
  rg.addColorStop(0.95, 'rgba(255,255,255,0.3)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  rx.fillStyle = rg;
  rx.fillRect(0, 0, 128, 128);
  beaconTex = { beam: new CanvasTexture(bc), dot: new CanvasTexture(dc), ring: new CanvasTexture(rc) };
  return beaconTex;
}

function addBeacon(g: Group, rng: Rng, color = BEACON_COLOR): Beacon {
  const tex = beaconTextures();
  const glow = { color, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false } as const;
  beaconGeo.beam ??= new CylinderGeometry(0.16, 0.26, 9, 14, 1, true).translate(0, 4.5, 0);
  beaconGeo.ring ??= new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const beam = new MeshBasicMaterial({ ...glow, map: tex.beam, side: DoubleSide, opacity: 0.5 });
  const beamMesh = new Mesh(beaconGeo.beam, beam);
  beamMesh.renderOrder = 5;
  const ringMat = new MeshBasicMaterial({ ...glow, map: tex.ring, opacity: 0.6, fog: true });
  const ring = new Mesh(beaconGeo.ring, ringMat);
  ring.position.y = 0.03;
  ring.renderOrder = 5;
  const haloMat = new SpriteMaterial({ ...glow, map: tex.dot, opacity: 0.55 });
  const halo = new Sprite(haloMat);
  halo.position.y = 0.55;
  halo.scale.setScalar(1.5);
  halo.renderOrder = 5;
  for (const m of [beamMesh, ring, halo]) {
    m.castShadow = false;
    m.receiveShadow = false;
    m.name = 'scrapBeacon';
    g.add(m);
  }
  return { beam, ring, ringMat, halo, haloMat, phase: rng.range(0, 6.28) };
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
  const groundTex = makeGroundTexture(map.grid, anisotropy, false, map.coreCells.length ? { cx: ((map.coreCells[0] as number) % 80) + 1, cy: Math.floor((map.coreCells[0] as number) / 80) + 1 } : null, !!map.outpostMarks);
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
  const beacons: Beacon[] = [];
  const rng = new Rng(55);
  for (const c of map.scrapBoxes) {
    const g = scrapBox();
    g.position.set(c.cx - HALF_W + 0.5, 0, c.cy - HALF_H + 0.5);
    g.rotation.y = rng.range(0, 6.28);
    beacons.push(addBeacon(g, rng));
    group.add(g);
    scrapBoxes.push(g);
  }

  // ---- 搜刮点（M18）：和零件箱一样的光柱 + 光环，危险区是红色；能搜的时候才显示（由 view 每帧设置 visible） ----
  const lootMarks: Group[] = [];
  // 搜刮点下线时（FEATURES.lootSpots）不画光柱和污水；周围的沙袋、油桶这些布景是普通道具，照常留着当掩体
  for (const l of FEATURES.lootSpots ? (map.loot ?? []) : []) {
    const g = new Group();
    g.position.set(l.x, 0, l.z);
    const danger = l.kind === 'checkpoint' || l.kind === 'bunker' || l.kind === 'toxic';
    beacons.push(addBeacon(g, rng, danger ? 0xff5a46 : 0xffd060));
    // 污染区：地上一摊发绿的污水（不发光，正常混合）
    if (l.kind === 'toxic' && l.r) {
      // 受光、很光滑（像一层油乎乎的污水，能反射天空），颜色压暗：不受光的话在夜里也亮得像荧光
      const m = new Mesh(new CircleGeometry(l.r, 32).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2e4a12, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82, depthWrite: false }));
      m.position.y = 0.025;
      m.renderOrder = 2;
      geos.push(m.geometry);
      g.add(m);
    }
    group.add(g);
    lootMarks.push(g);
  }
  const lootOffset = scrapBoxes.length;

  return {
    group,
    coreMaterial,
    scrapBoxes,
    lootMarks,
    updateBeacons(t, px, pz, night) {
      for (let i = 0; i < beacons.length; i++) {
        const b = beacons[i] as Beacon;
        const g = (i < lootOffset ? scrapBoxes[i] : lootMarks[i - lootOffset]) as Group;
        if (!g.visible) continue;
        const d = Math.hypot(g.position.x - px, g.position.z - pz);
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + b.phase);
        // 近了（< 6 米）光环放大变亮、光晕更亮，提示"走过去就能捡"；贴脸时光柱淡掉，不糊住视线
        const near = Math.max(0, Math.min(1, (6 - d) / 4));
        const close = Math.max(0, Math.min(1, (d - 1.5) / 8));
        b.beam.opacity = (0.32 + 0.18 * pulse) * (1 - 0.35 * night) * (0.08 + 0.92 * close * close);
        b.ringMat.opacity = 0.35 + 0.3 * pulse + 0.35 * near;
        const rs = 1.5 + 0.25 * pulse + 0.7 * near;
        b.ring.scale.set(rs, 1, rs);
        b.haloMat.opacity = (0.35 + 0.25 * pulse + 0.3 * near) * (1 - 0.3 * night);
        b.halo.scale.setScalar(1.2 + 0.3 * pulse + 0.5 * near);
      }
    },
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
      for (const b of beacons) {
        b.beam.dispose();
        b.ringMat.dispose();
        b.haloMat.dispose();
      }
      ground.geometry.dispose();
      outer.geometry.dispose();
    },
  };
}
