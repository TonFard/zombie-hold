import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, PlaneGeometry, type Material, type Texture } from 'three';
import { text } from './atlas';
import type { World } from './ctx';
import { wetMaterial } from './materials';
import { asphaltTex, concreteTex, oldConcreteTex, paverTex, storeTileTex } from './tex';

/**
 * 底座和地面：40 m × 40 m 的正方形底座，两条路在东南方向交成一个街角，
 * 店铺所在的西北街区整体高出路面 0.15 m（路缘石）。
 *
 *   z ↓（朝南、朝"观众"）
 *   路 A（东西向）：z 7..13       路 B（南北向）：x 10..16
 *   店铺：x -8..7, z -12..-2（正门朝南），店前停车场 z -2..5
 *   小巷：x -11..-8（店铺西侧）
 */

export const HALF = 20;
export const CURB = 0.15;
export const ROAD_A = { z0: 7, z1: 13 };
export const ROAD_B = { x0: 10, x1: 16 };
/** 店前三个车位的中心 x（z 中心 1.9，深 5 m，车头朝店）；西边留给自行车，东边是贩卖机 */
export const STALLS = [-3.9, -1.3, 1.3];

/** 每个面按世界尺寸 / tile 设置 UV 的盒子（地砖、墙面可平铺） */
export function uvBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tile: number): BufferGeometry {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const g = new BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    let u: number;
    let v: number;
    if (ny > 0.5) {
      u = x;
      v = -z;
    } else if (nx > 0.5) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

export interface Ground {
  /** 参与"湿地面"反射的网格：渲染反射时把它们藏起来 */
  wet: Mesh[];
  /** 店内地板（反光） */
  floor: Mesh;
}

export function buildGround(W: World): Ground {
  const wet: Mesh[] = [];
  const mat = (t: Texture | null, color: number, kind: [number, number, number]): MeshStandardMaterial => wetMaterial(t, color, kind);
  const asphalt = mat(asphaltTex(), 0x9ca2b4, [1, 1, 0]);
  const paver = mat(paverTex(), 0xb4b4b8, [0.75, 0.85, 0]);
  const concrete = mat(concreteTex(), 0xb0b2b8, [0.85, 0.9, 0]);
  const old = mat(oldConcreteTex(), 0xa8acb0, [1, 0.9, 0]);
  const tiles = mat(storeTileTex(), 0xffffff, [0, 0, 1]);
  const curbM = mat(null, 0xb8bcc4, [0, 0.7, 0]);
  const gutter = mat(null, 0x8a8e98, [1, 1, 0]);

  const slab = (m: Material, x0: number, z0: number, x1: number, z1: number, top: number, tile: number, solid = true, bottom = -0.2): Mesh => {
    const mesh = new Mesh(uvBox(x0, bottom, z0, x1, top, z1, tile), m);
    mesh.receiveShadow = true;
    W.add(mesh);
    wet.push(mesh);
    if (solid) W.solids.add(x0, bottom, z0, x1, top, z1);
    return mesh;
  };

  // ---- 路面
  slab(asphalt, -HALF, ROAD_A.z0, HALF, ROAD_A.z1, 0, 6);
  slab(asphalt, ROAD_B.x0, -HALF, ROAD_B.x1, ROAD_A.z0, 0, 6);
  slab(asphalt, ROAD_B.x0, ROAD_A.z1, ROAD_B.x1, HALF, 0, 6);
  // 路边排水沟（浅色水泥条，比路面低一点点，积水最多）
  const G = 0.45;
  // 排水沟比路面高 1.5 cm（以前 4 mm，远处深度精度不够，和路面互相闪）
  const GY = 0.015;
  slab(gutter, -HALF, ROAD_A.z0, ROAD_B.x0, ROAD_A.z0 + G, GY, 2, false);
  slab(gutter, -HALF, ROAD_A.z1 - G, ROAD_B.x0, ROAD_A.z1, GY, 2, false);
  slab(gutter, ROAD_B.x1, ROAD_A.z0, HALF, ROAD_A.z0 + G, GY, 2, false);
  slab(gutter, ROAD_B.x1, ROAD_A.z1 - G, HALF, ROAD_A.z1, GY, 2, false);
  slab(gutter, ROAD_B.x0, -HALF, ROAD_B.x0 + G, ROAD_A.z0, GY, 2, false);
  slab(gutter, ROAD_B.x1 - G, -HALF, ROAD_B.x1, ROAD_A.z0, GY, 2, false);
  slab(gutter, ROAD_B.x0, ROAD_A.z1, ROAD_B.x0 + G, HALF, GY, 2, false);
  slab(gutter, ROAD_B.x1 - G, ROAD_A.z1, ROAD_B.x1, HALF, GY, 2, false);

  // ---- 人行道 / 停车场 / 小巷（都高出路面 CURB）
  const T = CURB;
  slab(paver, -HALF, 5, ROAD_B.x0, ROAD_A.z0, T, 1.2); // 北侧人行道
  slab(paver, 8, -HALF, ROAD_B.x0, 5, T, 1.2); // 路 B 西侧人行道
  slab(concrete, -8, -2, 8, 5, T, 3); // 店前停车场
  slab(concrete, 7, -HALF, 8, -2, T, 3); // 店铺东侧（贩卖机）
  slab(old, -11, -HALF, -8, 5, T, 4); // 小巷
  slab(old, -8, -HALF, 7, -12, T, 4); // 后院
  slab(paver, -HALF, 3, -11, 5, T, 1.2); // 西边公寓门前
  slab(old, -HALF, -HALF, -11, 3, T, 4); // 公寓楼底
  slab(paver, -HALF, ROAD_A.z1, ROAD_B.x0, 15, T, 1.2); // 南侧人行道
  slab(paver, 8, 15, ROAD_B.x0, HALF, T, 1.2);
  slab(old, -HALF, 15, 8, HALF, T, 4);
  slab(paver, ROAD_B.x1, -HALF, 18, ROAD_A.z0, T, 1.2); // 东侧人行道
  slab(paver, 18, 5, HALF, ROAD_A.z0, T, 1.2);
  slab(old, 18, -HALF, HALF, 5, T, 4);
  slab(paver, ROAD_B.x1, ROAD_A.z1, 18, HALF, T, 1.2);
  slab(paver, 18, ROAD_A.z1, HALF, 15, T, 1.2);
  slab(old, 18, 15, HALF, HALF, T, 4);

  // ---- 路缘石：沿着人行道朝路的边
  const curb = (x0: number, z0: number, x1: number, z1: number): void => {
    slab(curbM, x0, z0, x1, z1, T + 0.012, 1, false, 0);
  };
  const C = 0.18;
  curb(-HALF, ROAD_A.z0 - C, ROAD_B.x0, ROAD_A.z0);
  curb(-HALF, ROAD_A.z1, ROAD_B.x0, ROAD_A.z1 + C);
  curb(ROAD_B.x1, ROAD_A.z0 - C, HALF, ROAD_A.z0);
  curb(ROAD_B.x1, ROAD_A.z1, HALF, ROAD_A.z1 + C);
  curb(ROAD_B.x0 - C, -HALF, ROAD_B.x0, ROAD_A.z0);
  curb(ROAD_B.x1, -HALF, ROAD_B.x1 + C, ROAD_A.z0);
  curb(ROAD_B.x0 - C, ROAD_A.z1, ROAD_B.x0, HALF);
  curb(ROAD_B.x1, ROAD_A.z1, ROAD_B.x1 + C, HALF);
  // 停车场出入口：路缘石往下斜（这里就做成一段低一点的浅色条）
  slab(curbM, -6, 6.6, 6, ROAD_A.z0, T * 0.5, 1, false, 0);

  // ---- 店内地板
  const floor = slab(tiles, -8, -12, 7, -2, 0.3, 1.2);

  buildMarkings(W);
  buildPlinth(W);
  return { wet, floor };
}

/** 路面标线、斑马线、停车格、"止まれ"：都画在一张贴图上，贴成薄薄的反光地贴 */
function buildMarkings(W: World): void {
  const A = W.atlas;
  A.add('tomare', 256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    text(g, '止まれ', w / 2, h / 2, w * 0.95, h * 0.9, '#f4f4f0', 900);
  });
  A.add('paint', 8, 8, (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
  });
  A.add('paintY', 8, 8, (g, w, h) => {
    g.fillStyle = '#f0c030';
    g.fillRect(0, 0, w, h);
  });
  A.add('stall', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#f0f0ea';
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(5, 0);
    g.lineTo(5, h - 5);
    g.lineTo(w - 5, h - 5);
    g.lineTo(w - 5, 0);
    g.stroke();
  });
  A.texture.needsUpdate = true;
  const m = new MeshStandardMaterial({ map: A.texture, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  // 标线也要有湿润反光：用一个半透明的地贴，下面的湿地面反射会透出来
  m.opacity = 0.9;
  const decals: BufferGeometry[] = [];
  const put = (tile: string, cx: number, cz: number, w: number, d: number, y: number, rot = 0): void => {
    const g = new PlaneGeometry(w, d);
    const T = A.get(tile);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, T.u0 + (T.u1 - T.u0) * uv.getX(i), T.v0 + (T.v1 - T.v0) * uv.getY(i));
    g.rotateX(-Math.PI / 2);
    g.rotateY(rot);
    g.translate(cx, y + 0.02, cz);
    decals.push(g);
  };
  // 斑马线 1：横穿路 A（在路口西边，x 5.5..9.5）；条纹沿 x 方向，沿 z 排开
  for (let z = ROAD_A.z0 + 0.5; z < ROAD_A.z1 - 0.4; z += 0.9) put('paint', 7.5, z + 0.22, 3.6, 0.45, 0);
  // 斑马线 2：横穿路 B（在路口北边，z 2..6）
  for (let x = ROAD_B.x0 + 0.5; x < ROAD_B.x1 - 0.4; x += 0.9) put('paint', x + 0.22, 4, 0.45, 3.6, 0);
  // 斑马线 3：横穿路 A（路口东边）
  for (let z = ROAD_A.z0 + 0.5; z < ROAD_A.z1 - 0.4; z += 0.9) put('paint', 18, z + 0.22, 3.0, 0.45, 0);
  // 停止线 + "止まれ"
  put('paint', ROAD_B.x0 + 1.5, 6.6 - 0.2, 3, 0.3, 0);
  put('tomare', ROAD_B.x0 + 1.5, 0.6, 2.6, 1.3, 0, Math.PI);
  put('paint', 5.2, ROAD_A.z0 + 1.5, 0.3, 3, 0);
  // 路 A 中心线（白色虚线）+ 路 B 中心线（黄色实线）
  for (let x = -HALF + 0.5; x < 5; x += 3) put('paint', x + 1, (ROAD_A.z0 + ROAD_A.z1) / 2, 2, 0.14, 0);
  for (let z = -HALF + 0.3; z < 1.8; z += 1) put('paintY', (ROAD_B.x0 + ROAD_B.x1) / 2, z + 0.5, 0.14, 1.02, 0);
  for (let z = ROAD_A.z1 + 0.6; z < HALF; z += 1) put('paintY', (ROAD_B.x0 + ROAD_B.x1) / 2, z + 0.5, 0.14, 1.02, 0);
  for (let x = 20; x < HALF; x += 3) put('paint', x, (ROAD_A.z0 + ROAD_A.z1) / 2, 2, 0.14, 0);
  // 路边白线
  put('paint', -7.5, ROAD_A.z0 + 0.6, 25, 0.12, 0);
  put('paint', -7.5, ROAD_A.z1 - 0.6, 25, 0.12, 0);
  // 停车格：店前 3 个车位，车头朝店
  for (let i = 0; i < 3; i++) put('stall', STALLS[i] as number, 1.9, 2.6, 5, 0.15, Math.PI);
  // 残障车位的蓝色地面标志
  A.add('wheel', 128, 128, (g, w, h) => {
    g.fillStyle = '#2a6ac8';
    g.fillRect(0, 0, w, h);
    text(g, '♿', w / 2, h / 2, w * 0.8, h * 0.7, '#fff', 900);
  });
  A.texture.needsUpdate = true;
  put('wheel', STALLS[2] as number, 2.8, 1.2, 1.2, 0.15, Math.PI);

  const mesh = new Mesh(mergeAll(decals), m);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  W.add(mesh);
}

function mergeAll(list: BufferGeometry[]): BufferGeometry {
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx: number[] = [];
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const nn = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3);
      nor.set([nn.getX(i), nn.getY(i), nn.getZ(i)], (o + i) * 3);
      uv.set([u.getX(i), u.getY(i)], (o + i) * 2);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + o);
    o += p.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** 收藏模型的底座：地层剖面 + 黑色木框 + 铜铭牌 */
function buildPlinth(W: World): void {
  const A = W.atlas;
  A.add('nameplate', 512, 96, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#e8c878');
    gr.addColorStop(0.5, '#b8903a');
    gr.addColorStop(1, '#8a6a2a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#5a4018';
    g.lineWidth = 4;
    g.strokeRect(8, 8, w - 16, h - 16);
    text(g, '夜川町 二丁目 · 雨夜', w / 2, h * 0.4, w * 0.86, h * 0.34, '#3a2808', 900);
    text(g, 'YORUKAWA-CHO  RAINY NIGHT  1/50', w / 2, h * 0.74, w * 0.8, h * 0.16, '#3a2808', 700);
  });
  A.texture.needsUpdate = true;
  const k = W.kit();
  const H = HALF;
  // 地层剖面：沥青 / 碎石 / 土
  k.box(H * 2 + 0.02, 0.2, H * 2 + 0.02, { y: -0.4 }, 0x4a4a52);
  k.box(H * 2 + 0.02, 0.5, H * 2 + 0.02, { y: -0.9 }, 0x5a4a3c);
  k.box(H * 2 + 0.02, 0.3, H * 2 + 0.02, { y: -1.2 }, 0x3a2e26);
  // 木框（深色漆面）
  k.box(H * 2 + 1.2, 0.9, H * 2 + 1.2, { y: -2.1 }, 0x1c1614);
  k.box(H * 2 + 1.0, 0.06, H * 2 + 1.0, { y: -1.24 }, 0x2a2220);
  // 铭牌：前面（+Z）
  k.box(5, 0.6, 0.04, { y: -1.95, z: H + 0.6 }, 0xb8903a, { tex: A.get('nameplate') });
  const g = k.build('plinth');
  W.add(g);
  // 底座四边的隐形墙：人不会从边上掉下去
  const t = 0.5;
  W.solids.add(-H - t, -2, -H - t, H + t, 6, -H);
  W.solids.add(-H - t, -2, H, H + t, 6, H + t);
  W.solids.add(-H - t, -2, -H, -H, 6, H);
  W.solids.add(H, -2, -H, H + t, 6, H);
}
