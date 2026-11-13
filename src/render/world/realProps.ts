import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  EquirectangularReflectionMapping,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  PMREMGenerator,
  Quaternion,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Rng } from '../../game/core/rng';
import { PROP_HEIGHT } from '../../game/world/builder';
import { GRID_W, HALF_H, HALF_W, SANDBAG_HALF } from '../../game/world/grid';
import { FURN_IDS } from '../../game/world/modules';
import type { FurnitureKind, MapData, Prop, PropKind } from '../../game/world/types';
import { rectOf } from './props/kit';

/**
 * 写实道具：读 public/props/manifest.json（npm run props:import 生成），把地图道具换成扫描 / 游戏级模型。
 * 同一个模型的所有摆放合成一个 InstancedMesh。模型按道具的格子范围缩放（"装进格子"），
 * 和碰撞体一致：长边沿格子长边、高度对齐道具高度，所以玩家看到的轮廓就是挡路的范围。
 * manifest.enabled=false 时不启用；URL 加 ?props=1 强制启用、?props=0 强制关闭。
 */

export interface PropsManifest {
  enabled: boolean;
  hdri: string | null;
  /** 夜晚的 HDRI（M19）：偏冷的夜空，夜里换成它做环境反射 */
  hdriNight?: string | null;
  assets: Record<string, { file: string; tris: number }>;
  textures: Record<string, string>;
}

/** 归一化后的模型：长的水平边沿 X，底面在 y=0，水平居中 */
interface Model {
  parts: Array<{ geo: BufferGeometry; mat: Material | Material[]; local: Matrix4 }>;
  size: Vector3;
}

const BASE = `${import.meta.env.BASE_URL}props/`;

export async function loadPropsManifest(): Promise<PropsManifest | null> {
  const q = new URLSearchParams(window.location.search).get('props');
  if (q === '0') return null;
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const m = (await res.json()) as PropsManifest;
    m.textures ??= {};
    return m.enabled || q === '1' ? m : null;
  } catch {
    return null;
  }
}

/**
 * 模型"落地"的高度：一般就是最低点。但有些树模型带着垂到地下的根须，最低点比树干底部低一两米，
 * 按最低点落地树就悬在半空。这类模型（groundPct > 0）改用顶点高度的低百分位，让树干底部贴地、根须埋进地里
 */
function groundY(root: Object3D, pct: number, fallback: number): number {
  if (pct <= 0) return fallback;
  const ys: number[] = [];
  const v = new Vector3();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) ys.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).y);
  });
  if (!ys.length) return fallback;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(pct * (ys.length - 1))] as number;
}

/**
 * 需要按百分位落地的模型：bounding box 最低点不一定是视觉上的"地面"。
 * 树：带根须，最低点比树干底部低一两米，用 3% 百分位。
 * 车：排气管 / 传动轴 / 悬挂零件低于轮底几厘米，0.5% 跳过这些离群点。
 * 集装箱：底部 twist-lock / 角件低于箱体底面，0.3% 就够。
 */
const GROUND_PCT: Record<string, number> = {
  tree_dead: 0.03,
  tree_winter: 0.03,
  car_sedan1: 0.005,
  car_sedan2: 0.005,
  car_crashed: 0.005,
  car_truck: 0.005,
  container_rust: 0.003,
  container_blue: 0.003,
};

const TRUNK_CENTERED = new Set(['tree_dead', 'tree_winter']);

async function loadModel(loader: GLTFLoader, file: string, id = ''): Promise<Model> {
  const gltf = await loader.loadAsync(`${BASE}${file}`);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  box.min.y = groundY(root, GROUND_PCT[id] ?? 0, box.min.y);
  const size = box.getSize(new Vector3());
  // 长边转到 X
  const swap = size.z > size.x;
  const turn = swap ? new Matrix4().makeRotationY(Math.PI / 2) : new Matrix4();
  const center = box.getCenter(new Vector3());
  // 树：水平中心取树干（高度 12%–33% 那一截），不取整棵树的包围盒中心。树冠往一边歪时两者差几十厘米，
  // 而碰撞圆柱在格子正中——差出来的那一截就是"看着没东西却被挡住"
  if (TRUNK_CENTERED.has(id)) {
    const lo = box.min.y + size.y * 0.12;
    const hi = box.min.y + size.y * 0.33;
    const band = new Box3();
    const v = new Vector3();
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y >= lo && v.y <= hi) band.expandByPoint(v);
      }
    });
    if (!band.isEmpty()) {
      center.x = (band.min.x + band.max.x) / 2;
      center.z = (band.min.z + band.max.z) / 2;
    }
  }
  const norm = turn.multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const parts: Model['parts'] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const sm = mat as MeshStandardMaterial;
      // Sketchfab 模型常带 KHR_materials_specular / 双面；保持原样，只把透明裁切的阈值统一
      if (sm.alphaTest > 0) sm.alphaTest = 0.5;
      if (sm.transparent) {
        if (/glass/i.test(sm.name)) {
          // 真正的玻璃（灯罩、炉门）：保留半透明，但不写深度，免得实例之间排序来回闪
          sm.depthWrite = false;
          // 路灯的玻璃罩：点光源就在罩子里面（距离几厘米），镜面高光按 1/d² 爆到上千倍亮，
          // 某几帧正好对上相机就被光晕放大成一大片白光——这就是"路灯在闪"。
          // 灯罩改成不受光的暖色发光体：永远是同一个亮度，不会再随角度、距离一帧一帧跳
          if (/street_lamp/i.test(sm.name)) {
            const glow = new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, depthWrite: false, side: sm.side, toneMapped: false });
            glow.name = sm.name;
            if (Array.isArray(m.material)) m.material = m.material.map((x) => (x === mat ? glow : x));
            else m.material = glow;
          }
        } else {
          // 有的模型（蓝色集装箱）整套材质都标成了 BLEND，渲染出来是半透明的：改回不透明
          sm.transparent = false;
          sm.opacity = 1;
          sm.depthWrite = true;
          sm.alphaTest = 0;
        }
      }
    }
    parts.push({ geo: m.geometry, mat: m.material, local: norm.clone().multiply(m.matrixWorld) });
  });
  if (swap) [size.x, size.z] = [size.z, size.x];
  return { parts, size };
}

/** 一次摆放：世界位置、朝向、三轴缩放（以模型原尺寸为 1） */
interface Place {
  x: number;
  y: number;
  z: number;
  ry: number;
  /** 先绕自身 X 轴转（放倒，比如平放在桌上的手枪），再绕 Y 转 ry */
  rx?: number;
  sx: number;
  sy: number;
  sz: number;
}

type Put = (id: string, p: Place) => void;
type Size = (id: string) => Vector3 | null;

/**
 * 把模型装进道具的矩形：长边对长边，高度对道具高度。
 * keep = 等比缩放的上限（避免模型被拉得太变形）：各轴缩放比不超过最小那个的 keep 倍。
 */
function fit(p: Prop, id: string, size: Size, put: Put, o: { h?: number; keep?: number; inset?: number; flip?: boolean; ry?: number; y?: number } = {}): number {
  const s0 = size(id);
  if (!s0) return 0;
  const r = rectOf(p);
  const inset = o.inset ?? 0.1;
  const h = o.h ?? p.h ?? s0.y;
  let sx = (r.L - inset) / s0.x;
  let sz = (r.T - inset) / s0.z;
  let sy = h / s0.y;
  const keep = o.keep ?? 1.25;
  const lo = Math.min(sx, sy, sz);
  sx = Math.min(sx, lo * keep);
  sy = Math.min(sy, lo * keep);
  sz = Math.min(sz, lo * keep);
  put(id, { x: r.cx, y: o.y ?? 0, z: r.cz, ry: (r.horiz ? 0 : Math.PI / 2) + (o.flip ? Math.PI : 0) + (o.ry ?? 0), sx, sy, sz });
  // 实际摆出来的高度（keep 会把 sy 压小，比要求的 h 矮）：叠放时下一层放在这个高度上
  return s0.y * sy;
}

/** 按地图道具算出每个模型的摆放 */
function layout(map: MapData, has: (id: string) => boolean, size: Size): { places: Map<string, Place[]>; replaced: Set<PropKind>; fallback: Prop[] } {
  const places = new Map<string, Place[]>();
  const put: Put = (id, p) => {
    if (!has(id)) return;
    let a = places.get(id);
    if (!a) places.set(id, (a = []));
    a.push(p);
  };
  const uni = (x: number, y: number, z: number, ry: number, s = 1): Place => ({ x, y, z, ry, sx: s, sy: s, sz: s });
  const pickHas = (ids: string[], k: number) => {
    const ok = ids.filter(has);
    return ok.length ? (ok[k % ok.length] as string) : null;
  };
  // 每种道具：模型齐了才替换（缺一个就整类保留程序模型）
  const need: Partial<Record<PropKind, string[]>> = {
    barrel: ['Barrel_01'],
    crate: ['wooden_crate_01'],
    barrier: ['concrete_road_barrier'],
    rack: ['worn_metal_rack'],
    lamp: ['street_lamp_01'],
    car: ['car_sedan1'],
    container: ['container_rust'],
    tree: ['tree_dead'],
    sandbag: ['sandbags'],
    pump: ['gas_pump'],
    pallet: ['pallets'],
    dumpster: ['dumpster'],
    generator: ['generator_diesel'],
    workbench: ['metal_office_desk', 'tool_cart'],
    furniture: ['painted_wooden_table'],
  };
  const replaced = new Set<PropKind>();
  /** 写实模型缺的家具：程序模型补上（只建这些，不是整类） */
  const fallback: Prop[] = [];
  for (const [k, ids] of Object.entries(need) as Array<[PropKind, string[]]>) if (ids.every(has)) replaced.add(k);

  for (const p of map.props) {
    if (!replaced.has(p.kind)) continue;
    const rng = new Rng(((p.x0 * 73856093) ^ (p.y0 * 19349663) ^ 0x51ed27) >>> 0);
    const r = rectOf(p);
    switch (p.kind) {
      case 'barrel': {
        const id = pickHas(['Barrel_01', 'Barrel_02', 'barrel_03'], p.variant) as string;
        const s0 = size(id) as Vector3;
        const s = 0.92 / s0.y;
        put(id, uni(r.cx + rng.range(-0.06, 0.06), 0, r.cz + rng.range(-0.06, 0.06), rng.range(0, 6.28), s));
        // 以前桶旁边 ±0.6 米还会摆一个油壶 / 垃圾袋：在旁边的空格里、没有碰撞，人和僵尸直接从里面穿过去，去掉了
        break;
      }
      case 'crate':
        crates(p, rng, put, size, has);
        break;
      case 'barrier': {
        // 一节约 1.55 米，按长度均分
        const id = 'concrete_road_barrier';
        const s0 = size(id) as Vector3;
        const n = Math.max(1, Math.round(r.L / s0.x));
        const seg = r.L / n;
        const h = p.h ?? 0.9;
        for (let i = 0; i < n; i++) {
          const t = -r.L / 2 + seg * (i + 0.5);
          put(id, {
            x: r.cx + (r.horiz ? t : 0),
            y: 0,
            z: r.cz + (r.horiz ? 0 : t),
            ry: (r.horiz ? 0 : Math.PI / 2) + rng.range(-0.04, 0.04),
            sx: (seg * 0.97) / s0.x,
            sy: h / s0.y,
            sz: Math.min(1, (r.T * 0.9) / s0.z),
          });
        }
        // 以前隔离墩旁边 0.75 米还会扔一个旧轮胎：在空格里、没有碰撞，会被穿过去，去掉了
        break;
      }
      case 'rack': {
        const id = 'worn_metal_rack';
        const s0 = size(id) as Vector3;
        const n = Math.max(1, Math.floor(r.L / (s0.x * 1.02)));
        const seg = r.L / n;
        const sy = (p.h ?? 2) / s0.y;
        for (let i = 0; i < n; i++) {
          const t = -r.L / 2 + seg * (i + 0.5);
          put(id, { x: r.cx + (r.horiz ? t : 0), y: 0, z: r.cz + (r.horiz ? 0 : t), ry: (r.horiz ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0), sx: 1, sy, sz: Math.min(1.4, (r.T * 0.9) / s0.z) });
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
        put(id, uni(r.cx, 0, r.cz, (p.variant * Math.PI) / 2, ((p.h ?? 4.2) + 0.15) / (size(id) as Vector3).y));
        break;
      }
      case 'car': {
        const id = pickHas(['car_sedan1', 'car_sedan2', 'car_crashed', 'car_truck'], p.variant) as string;
        // 按车长等比缩放到真实尺寸（轿车 4.6 米、皮卡 5.3 米）。以前按格子的宽（2 格）去装：
        // 这些模型的"宽"包括打开的车门和后视镜（宽 / 长 0.6–0.7，真车只有 0.45），一装进 2 米宽就整辆缩到 3.1–3.4 米长，比人还矮小。
        // 现在车身两头各伸出格子 0.3 米左右、开着的车门伸出去一点，碰撞仍按格子
        const s0 = size(id) as Vector3;
        const s = (id === 'car_truck' ? 5.3 : 4.6) / s0.x;
        put(id, { x: r.cx, y: 0, z: r.cz, ry: (r.horiz ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.05, 0.05), sx: s, sy: s, sz: s });
        break;
      }
      case 'container': {
        const id = pickHas(['container_rust', 'container_blue'], p.variant) as string;
        const h = p.h ?? 2.4;
        // 高于 4 米 = 叠两层：第二层换个颜色、轻微错位
        const layers = h > 4 ? 2 : 1;
        // 每一层放在下面各层的实际高度上：以前用 k × h / layers，可 fit 的等比限制会让模型比 h / layers 矮，
        // 两层之间就空出一条缝（第一章东南角的双层集装箱）
        let y = 0;
        for (let k = 0; k < layers; k++) {
          const lid = k === 0 ? id : (pickHas(['container_blue', 'container_rust'], p.variant) as string);
          // keep 放到 4：集装箱是长方体，拉伸不显变形。以前 keep 1.2 时锈色模型（比例 12.85×5.93×6.70）
          // 被压成 4.4 米长、2.0 米高，叠在上面的蓝色是 5.8 米长，上层两头各悬空 0.7 米。现在两层都填满格子
          y += fit(p, lid, size, put, { h: h / layers, keep: 4, inset: 0.08, y, flip: k % 2 === 1, ry: k ? rng.range(-0.02, 0.02) : 0 });
        }
        break;
      }
      case 'tree': {
        // 只用 tree_dead：tree_winter 的树干是斜的、还分叉，人身高范围内横跨 2 米，圆柱碰撞怎么放都对不上
        const id = 'tree_dead';
        const s0 = size(id) as Vector3;
        const h = (p.h ?? 3) * 1.3;
        put(id, uni(r.cx, 0, r.cz, rng.range(0, 6.28), h / s0.y));
        // 以前 30% 的树旁边 1.6 米内还摆一个树桩：在空格里、没有碰撞，僵尸从树桩中间走过去，去掉了
        break;
      }
      case 'sandbag': {
        // 和碰撞对齐：高度 = 挡子弹的高度，厚度 = 碰撞那一道的厚度，沿长度按段铺满（两头正好到碰撞范围的两端）。
        // 以前整体等比缩进格子：2 格长的只有 0.52 米厚、0.72 米高（碰撞 1 米厚、0.85 米高），
        // 竞技场 20 格长的沙袋墙模型只有 6.4 米，剩下 13 米是空气墙
        const id = 'sandbags';
        const s0 = size(id) as Vector3;
        const sy = (p.h ?? PROP_HEIGHT.sandbag ?? 0.85) / s0.y;
        const n = Math.max(1, Math.round(r.L / (s0.x * sy)));
        const seg = r.L / n;
        const sz = (r.T === 1 ? SANDBAG_HALF * 2 : r.T) / s0.z;
        for (let i = 0; i < n; i++) {
          const t = -r.L / 2 + seg * (i + 0.5);
          put(id, { x: r.cx + (r.horiz ? t : 0), y: 0, z: r.cz + (r.horiz ? 0 : t), ry: (r.horiz ? 0 : Math.PI / 2) + (i % 2 ? Math.PI : 0), sx: seg / s0.x, sy, sz });
        }
        break;
      }
      case 'pump':
        fit(p, 'gas_pump', size, put, { keep: 1.3, inset: 0.3 });
        break;
      case 'pallet':
        fit(p, 'pallets', size, put, { keep: 1.4, inset: 0.1, ry: rng.range(-0.05, 0.05) });
        break;
      case 'dumpster':
        fit(p, 'dumpster', size, put, { keep: 1.25, inset: 0.12, flip: rng.chance(0.5) });
        break;
      case 'furniture': {
        const f = FURN_IDS[p.variant] as FurnitureKind;
        const id = FURN_MODEL[f];
        if (!id || !has(id)) {
          // 没有写实模型的家具（冰箱、厨柜……）：交给程序模型
          fallback.push(p);
          break;
        }
        // 正面朝向：rot 0 北 … 3 西；扫描模型正面默认朝 +z（南）
        const rot = p.rot ?? 2;
        const s0 = size(id) as Vector3;
        const w = p.x1 - p.x0;
        const d = p.y1 - p.y0;
        const along = rot % 2 === 0;
        const L = (along ? w : d) - 0.08;
        const D = (along ? d : w) - 0.08;
        // 模型的长边被归一化到 X；家具摆放时 X = 宽（沿墙），Z = 深
        const sx = L / s0.x;
        const sz = D / s0.z;
        const sy = (p.h ?? s0.y) / s0.y;
        const k = Math.min(sx, sy, sz);
        put(id, { x: r.cx, y: 0, z: r.cz, ry: (-(rot - 2) * Math.PI) / 2 + FURN_TURN[f], sx: Math.min(sx, k * 1.3), sy: Math.min(sy, k * 1.3), sz: Math.min(sz, k * 1.3) });
        break;
      }
      case 'workbench':
        // 竞技场把工坊塞在角落里当占位（高 0.01、不挡路）：不摆
        if ((p.h ?? 1.1) > 0.2) workbenchSet(p, put, size);
        break;
      case 'generator':
        // 能量核心（发光圆柱）仍由程序模型画在 1.3 米以上，机身压到这个高度以下
        fit(p, 'generator_diesel', size, put, { h: 1.3, keep: 1.3, inset: 0.15 });
        break;
      default:
        break;
    }
  }
  return { places, replaced, fallback };
}

/** 家具 → 写实模型。没列的（冰箱、厨柜、椅子之外的小件）用程序模型 */
const FURN_MODEL: Partial<Record<FurnitureKind, string>> = {
  bed: 'old_bed_frame',
  sofa: 'sofa_02',
  table: 'painted_wooden_table',
  chair: 'painted_wooden_chair_01',
  wardrobe: 'painted_wooden_cabinet_02',
  shelf: 'wooden_bookshelf_worn',
  tv: 'television_02',
  stove: 'electric_stove',
  desk: 'metal_office_desk',
  kitchen: 'drawer_cabinet',
};

/**
 * 模型归一化后长边沿 X，但"正面"朝哪边各不相同：这里补一个额外的旋转，让正面朝 +Z。
 * 床的长边是床长（应该沿深度），所以转 90°
 */
const FURN_TURN: Record<FurnitureKind, number> = {
  bed: Math.PI / 2,
  sofa: 0,
  table: 0,
  chair: 0,
  kitchen: 0,
  fridge: 0,
  wardrobe: 0,
  shelf: 0,
  tv: 0,
  stove: 0,
  desk: 0,
};

/**
 * 武器工坊（3×1 格，碰撞高 1.1）：钢制办公桌当工作台 + 右边一辆工具推车，推车上放红色工具箱，
 * 桌上是台钳、拆开的手枪和弹匣、弹药箱、工具箱、摇臂台灯。局部坐标：长边沿 X，正面朝 +Z（和程序模型一样）
 */
function workbenchSet(p: Prop, put: Put, size: Size): void {
  const r = rectOf(p);
  const yaw = r.horiz ? 0 : Math.PI / 2;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const L = r.L - 0.1;
  /** 局部 (x, y, z) 处放一个模型，底面中心落在这一点；s = 缩放（数字 = 等比），ry = 相对工坊的朝向，flat = 平放（绕 X 转 -90°） */
  const at = (id: string, x: number, y: number, z: number, ry: number, s: number | [number, number, number], flat = false) => {
    const s0 = size(id);
    if (!s0) return;
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    // 平放 = 先绕 X 转 -90°：原来的高度方向变成 -Z、厚度方向变成高度。
    // 补一个偏移让平放后仍然是"底面中心"对准 (x, y, z)；这个偏移在模型自己的朝向里，按 ry 转到工坊坐标
    const lift = flat ? (s0.z * sz) / 2 : 0;
    const back = flat ? (s0.y * sy) / 2 : 0;
    const lx = x + back * Math.sin(ry);
    const lz = z + back * Math.cos(ry);
    put(id, { x: r.cx + lx * c + lz * sn, y: y + lift, z: r.cz - lx * sn + lz * c, ry: yaw + ry, rx: flat ? -Math.PI / 2 : 0, sx, sy, sz });
  };

  // 桌子：左边 1.9 米，桌面抬到 0.86（和程序模型、射击时的掩体高度一致）
  const desk = size('metal_office_desk') as Vector3;
  const deskW = Math.min(1.9, L - 1.0);
  const deskX = -L / 2 + deskW / 2;
  const top = 0.86;
  at('metal_office_desk', deskX, 0, 0, 0, [deskW / desk.x, top / desk.y, 0.9 / desk.z]);

  // 推车：右边剩下的宽度，托盘高约 0.73
  const cart = size('tool_cart') as Vector3;
  const cartW = L / 2 - (deskX + deskW / 2) - 0.04;
  const cartX = L / 2 - cartW / 2;
  const cs = cartW / cart.x;
  const cartSy = Math.min(cs * 1.15, 0.85);
  at('tool_cart', cartX, 0, 0.02, 0, [cs, cartSy, Math.min(cs * 1.15, 0.85)]);
  // 推车托盘（原模型 0.86 米处）上放红色工具箱
  at('metal_tool_chest', cartX, 0.862 * cartSy, 0, 0, Math.min(1, (cartW - 0.1) / (size('metal_tool_chest')?.x ?? 1)));

  // 桌上：右前角台钳，中间平放手枪和弹匣，左后弹药箱和工具箱，后沿中间摇臂台灯
  const right = deskX + deskW / 2;
  at('bench_vice_01', right - 0.28, top, 0.2, Math.PI / 2, 1);
  at('service_pistol', deskX + 0.15, top, 0.1, 0.25, 1.1, true);
  at('ammo_box', deskX - deskW / 2 + 0.28, top, -0.22, 0.1, 1);
  at('ammo_box', deskX - deskW / 2 + 0.3, top + (size('ammo_box')?.y ?? 0.18), -0.24, -0.05, 1);
  at('ammo_box', deskX - deskW / 2 + 0.25, top, 0.18, Math.PI / 2 + 0.35, 1);
  at('metal_toolbox', deskX - 0.3, top, -0.2, -0.15, 1);
  at('desk_lamp_arm_01', deskX + 0.75, top, -0.32, 0, 1);
  // 桌下：弹药箱码在容膝空间两边
  at('ammo_box', deskX - 0.15, 0, -0.15, 0, 1);
  at('ammo_box', deskX + 0.15, 0, -0.17, 0.08, 1);
}

/** 木箱：每格堆一摞，摞到设定高度 */
function crates(p: Prop, rng: Rng, put: Put, size: Size, has: (id: string) => boolean): void {
  const h = p.h ?? 0.9;
  const mil = p.variant >= 2 && has('wooden_military_crate');
  for (let ix = p.x0; ix < p.x1; ix++) {
    for (let iy = p.y0; iy < p.y1; iy++) {
      const x = ix + 0.5 - HALF_W;
      const z = iy + 0.5 - HALF_H;
      let y = 0;
      let lv = 0;
      while (y < h * 0.8) {
        const id = mil ? 'wooden_military_crate' : lv === 0 && rng.chance(0.5) && has('plastic_container') ? 'plastic_container' : 'wooden_crate_01';
        const s0 = size(id) as Vector3;
        const s = Math.min(0.95 / s0.x, 1.25);
        put(id, { x: x + rng.range(-0.03, 0.03), y, z: z + rng.range(-0.03, 0.03), ry: rng.range(-0.12, 0.12), sx: s, sy: s, sz: s });
        y += s0.y * s;
        lv++;
      }
      if (rng.chance(0.35)) put('cardboard_box_01', { x, y, z, ry: rng.range(0, 6.28), sx: 0.8, sy: 0.8, sz: 0.8 });
    }
  }
}

/**
 * 地图外圈：用扫描岩壁代替程序的尖锥岩石。
 * 沿四条边每隔几米摆一块，随机朝向、缩放，互相交叠成连续的崖壁。
 */
function cliffs(put: Put, size: Size): void {
  const ids = ['rock_face_02', 'rock_face_01'].filter((id) => size(id));
  if (!ids.length) return;
  const rng = new Rng(9001);
  const uni = (x: number, y: number, z: number, ry: number, s: number): Place => ({ x, y, z, ry, sx: s, sy: s, sz: s });
  // 每条边单独一组（键名带 #边），这样背后的那几条边能被视锥剔除
  // 以前一排、间距 4.6 米、朝向随机 ±0.5：岩壁是单面扫描，转个角度就露出缝，能从缝里看到外面的天。
  // 现在两排错开（里排矮、外排高）、间距 3.2 米、朝向只抖 ±0.2，后面再垫一圈实心岩墙（cliffBackdrop）
  // 里排的岩脚正好压在可走范围的边线上（地图最外 2 格不能走）。以前岩石中心固定在地图边外 1.8 米，
  // 岩脚离边线还有 1.5–2 米：人被一条看不见的线挡在岩壁前面（空气墙）。岩脚在模型的 +Z 一侧（size.z / 2）
  const EDGE = 2;
  const edge = (side: 'n' | 's' | 'w' | 'e', t: number, row: number) => {
    const id = rng.pick(ids);
    const s0 = size(id) as Vector3;
    const s = rng.range(1.0, 1.25) * ((row === 0 ? 4.6 : 7.5) / s0.y);
    const d = (row === 0 ? (s * s0.z) / 2 - EDGE - 0.15 : 4.2);
    const out = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 }[side] + rng.range(-0.2, 0.2);
    const [x, z] = side === 'n' ? [t, -HALF_H - d] : side === 's' ? [t, HALF_H + d] : side === 'w' ? [-HALF_W - d, t] : [HALF_W + d, t];
    put(`${id}#${side}`, uni(x, -0.4, z, out, s));
  };
  for (let row = 0; row < 2; row++) {
    const off = row === 0 ? 0 : 1.6;
    for (let t = -HALF_W - 4 + off; t <= HALF_W + 4; t += 3.2) {
      edge('n', t, row);
      edge('s', t, row);
      edge('w', t, row);
      edge('e', t, row);
    }
  }
}

/** 岩壁背后一圈实心岩墙：借岩壁的材质，盖住两排岩石之间可能还剩的缝 */
function cliffBackdrop(group: Group, mat: Material, disposables: Array<{ dispose(): void }>): void {
  const H = 10;
  const D = 7.2;
  const L = GRID_W + 2 * D + 4;
  for (const [x, z, ry] of [
    [0, -HALF_H - D, 0],
    [0, HALF_H + D, 0],
    [-HALF_W - D, 0, Math.PI / 2],
    [HALF_W + D, 0, Math.PI / 2],
  ] as const) {
    const geo = new BoxGeometry(L, H, 2);
    // 贴图按世界尺寸平铺（盒子默认 UV 是 0–1，拉满 90 米会糊成一团）
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L / 6), uv.getY(i) * (H / 6));
    const m = new Mesh(geo, mat);
    m.position.set(x, H / 2 - 0.5, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.name = 'cliffBackdrop';
    group.add(m);
    disposables.push(geo);
  }
}

export interface RealProps {
  group: Group;
  envMap: Texture | null;
  /** 夜晚的环境反射（没有就是 null，夜里继续用白天那张） */
  envNight: Texture | null;
  /** 换成写实模型的道具种类：程序模型不再建 */
  replaced: Set<PropKind>;
  /** 岩壁也换了：程序的尖锥岩石不再建 */
  cliffs: boolean;
  /** replaced 里的种类中，没有写实模型、仍要程序模型补上的个别道具 */
  fallback: Prop[];
  dispose(): void;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _qx = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);

export async function buildRealProps(map: MapData, manifest: PropsManifest, renderer: WebGLRenderer): Promise<RealProps> {
  const loader = new GLTFLoader();
  const models = new Map<string, Model>();
  // 同时最多加载 4 个：一次性解码一百多张贴图，内存吃紧时浏览器会让部分图片解码失败
  const queue = Object.entries(manifest.assets);
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [id, a] = job;
      try {
        models.set(id, await loadModel(loader, a.file, id));
      } catch (e) {
        console.warn(`写实道具 ${id} 加载失败`, e);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const has = (id: string) => models.has(id);
  const size: Size = (id) => models.get(id)?.size ?? null;
  const { places, replaced, fallback } = layout(map, has, size);
  const put: Put = (key, p) => {
    if (!has(key.split('#')[0] as string)) return;
    let a = places.get(key);
    if (!a) places.set(key, (a = []));
    a.push(p);
  };
  cliffs(put, size);
  const hasCliffs = has('rock_face_02') || has('rock_face_01');

  const group = new Group();
  group.name = 'realProps';
  const disposables: Array<{ dispose(): void }> = [];
  for (const [key, list] of places) {
    const id = key.split('#')[0] as string;
    const model = models.get(id) as Model;
    // 外圈岩壁：离玩家远、数量多，不投影（阴影相机只覆盖玩家周围 26 米）
    const far = key.includes('#');
    for (const part of model.parts) {
      const im = new InstancedMesh(part.geo, part.mat, list.length);
      list.forEach((pl, i) => {
        _q.setFromAxisAngle(_up, pl.ry);
        if (pl.rx) _q.multiply(_qx.setFromAxisAngle(_xAxis, pl.rx));
        _m.compose(_p.set(pl.x, pl.y, pl.z), _q, _s.set(pl.sx, pl.sy, pl.sz)).multiply(part.local);
        im.setMatrixAt(i, _m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = !far;
      im.receiveShadow = true;
      im.name = key;
      group.add(im);
    }
  }
  const rockPart = (models.get('rock_face_02') ?? models.get('rock_face_01'))?.parts[0];
  if (hasCliffs && rockPart) cliffBackdrop(group, Array.isArray(rockPart.mat) ? (rockPart.mat[0] as Material) : rockPart.mat, disposables);
  for (const model of models.values()) {
    for (const part of model.parts) {
      disposables.push(part.geo);
      for (const m of Array.isArray(part.mat) ? part.mat : [part.mat]) disposables.push(m);
    }
  }

  // 户外 HDRI 做环境反射：写实材质在 RoomEnvironment 下发灰。夜里换一张偏冷的夜空（M19）
  const loadEnv = async (file: string | null | undefined): Promise<Texture | null> => {
    if (!file) return null;
    try {
      const hdr = await new HDRLoader().loadAsync(`${BASE}${file}`);
      hdr.mapping = EquirectangularReflectionMapping;
      const pmrem = new PMREMGenerator(renderer);
      const t = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      disposables.push(t);
      return t;
    } catch (e) {
      console.warn('HDRI 加载失败', file, e);
      return null;
    }
  };
  const [envMap, envNight] = await Promise.all([loadEnv(manifest.hdri), loadEnv(manifest.hdriNight)]);
  return {
    group,
    envMap,
    envNight,
    replaced,
    cliffs: hasCliffs,
    fallback,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
