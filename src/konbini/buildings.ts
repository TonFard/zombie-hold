import { PointLight, Vector3 } from 'three';
import { text } from './atlas';
import { box3, type World } from './ctx';
import type { At, Kit } from './kit';

/**
 * 街角周围的楼：西边的公寓（外走廊、阳台、晾衣杆）、店后面的老房子、对街的一排小店
 * （卷帘门拉下来的店 + 还亮着灯的居酒屋）、东边的高一点的写字楼。
 * 都是有碰撞的实体；窗户有亮有暗，几扇窗会偶尔开关灯。
 */
const F = 0.15;
const PI = Math.PI;

function tiles(W: World): void {
  const A = W.atlas;
  A.add('shutter', 256, 256, (g, w, h) => {
    g.fillStyle = '#9aa0a8';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) {
      g.fillStyle = '#7a8088';
      g.fillRect(0, y, w, 2);
      g.fillStyle = '#b4b8c0';
      g.fillRect(0, y + 2, w, 2);
    }
    g.fillStyle = 'rgba(40,40,50,0.25)';
    g.fillRect(w * 0.1, h * 0.3, w * 0.5, h * 0.2);
    g.fillStyle = 'rgba(20,20,30,0.5)';
    g.font = `900 34px sans-serif`;
    g.fillText('TAG', w * 0.15, h * 0.45);
  });
  A.add('noren', 256, 160, (g, w, h) => {
    g.fillStyle = '#1a2a4a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0e1a30';
    for (let i = 1; i < 4; i++) g.fillRect((i * w) / 4 - 2, h * 0.3, 4, h);
    text(g, '居酒屋', w / 2, h * 0.5, w * 0.8, h * 0.4, '#f4f0e6', 900);
  });
  A.add('izaSign', 384, 96, (g, w, h) => {
    g.fillStyle = '#2a1a10';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c8a060';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    text(g, '炉端  ほたる', w / 2, h / 2, w * 0.86, h * 0.56, '#f4e0b0', 900);
  });
  A.add('lantern', 96, 160, (g, w, h) => {
    g.fillStyle = '#e8402a';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 12) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, y, w, 2);
    }
    for (const [c, y] of [
      ['や', 0.32],
      ['き', 0.52],
      ['と', 0.72],
    ] as const)
      text(g, c, w / 2, h * y, w * 0.6, h * 0.18, '#1a0a00', 900);
  });
  A.add('barber', 96, 192, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let i = -4; i < 12; i++) {
      g.fillStyle = i % 2 ? '#d8202a' : '#1e52b4';
      g.save();
      g.translate(0, i * 24);
      g.transform(1, 0.5, 0, 1, 0, 0);
      g.fillRect(0, 0, w, 10);
      g.restore();
    }
  });
  A.add('shopSigns', 512, 256, (g, w, h) => {
    const items = [
      ['山田理容', '#1e52b4', '#ffffff'],
      ['クリーニング', '#2a9a5a', '#ffffff'],
      ['たばこ', '#d8202a', '#ffffff'],
      ['ことぶき不動産', '#f0c030', '#1a1a1a'],
    ];
    items.forEach(([s, bg, fg], i) => {
      g.fillStyle = bg as string;
      g.fillRect(0, (i * h) / 4, w, h / 4);
      text(g, s as string, w / 2, ((i + 0.5) * h) / 4, w * 0.9, h / 4 - 16, fg as string, 900);
    });
  });
  A.add('mailbox', 192, 128, (g, w, h) => {
    g.fillStyle = '#c8ccd4';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const x = (i % 4) * (w / 4);
      const y = Math.floor(i / 4) * (h / 3);
      g.fillStyle = '#9aa0a8';
      g.fillRect(x + 4, y + 4, w / 4 - 8, h / 3 - 8);
      g.fillStyle = '#333';
      g.fillRect(x + 10, y + 12, w / 4 - 20, 4);
      text(g, `${100 + Math.floor(i / 4) * 100 + (i % 4) + 1}`, x + w / 8, y + h / 6 + 6, w / 4 - 12, 12, '#222', 800);
    }
  });
  A.add('aptName', 384, 96, (g, w, h) => {
    g.fillStyle = '#e8e4da';
    g.fillRect(0, 0, w, h);
    text(g, 'メゾン夜川', w / 2, h * 0.45, w * 0.8, h * 0.5, '#3a3020', 900);
    text(g, 'MAISON YORUKAWA', w / 2, h * 0.82, w * 0.7, h * 0.16, '#6a6050', 700);
  });
}

/** 一面墙上开窗：沿局部 X 排开，每层 cols 扇，窗户是发光（亮）或暗色的贴图 */
function windows(W: World, k: Kit, glowK: Kit, at: At, w: number, floors: number, floorH: number, cols: number, y0: number, seed: number, toggles: Array<{ k: Kit; m: ReturnType<Kit['end']>; on: boolean }>): void {
  const A = W.atlas;
  k.push(at);
  glowK.push(at);
  const ww = Math.min(1.4, (w / cols) * 0.55);
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (c + 0.5) * (w / cols);
      const y = y0 + f * floorH + floorH * 0.28;
      const h = floorH * 0.5;
      const v = (seed * 7 + f * 5 + c * 3) % 6;
      const lit = v % 3 !== 2;
      k.box(ww + 0.12, 0.06, 0.12, { x, y: y - 0.06, z: 0.04 }, 0xc8c8c4); // 窗台
      k.box(ww + 0.08, h + 0.08, 0.02, { x, y: y - 0.04, z: 0.005 }, 0x6a6e76); // 窗框
      if (lit) {
        const m = glowK.mark().plane(ww, h, { x, y: y + h / 2, z: 0.02 }, 0xffffff, { tex: A.get(`win${v}`), glow: 0.95 }).end();
        if ((f + c + seed) % 5 === 0) toggles.push({ k: glowK, m, on: true });
      } else k.plane(ww, h, { x, y: y + h / 2, z: 0.02 }, 0xffffff, { tex: A.get(`win${v}`) });
    }
  }
  k.pop();
  glowK.pop();
}

export function buildBuildings(W: World): void {
  tiles(W);
  const A = W.atlas;
  const k = W.kit();
  const gk = W.kit(); // 亮着的窗（发光，可以开关）
  gk.shadows = false;
  const toggles: Array<{ k: Kit; m: ReturnType<Kit['end']>; on: boolean }> = [];
  const solid = (x0: number, z0: number, x1: number, z1: number, h: number): void => {
    W.wall(x0, F, z0, x1, F + h, z1);
  };

  // ================================================================ 西边：3 层公寓「メゾン夜川」（朝东，外走廊对着小巷）
  {
    const x0 = -20;
    const x1 = -12.2;
    const z0 = -19.5;
    const z1 = 2.4;
    const fh = 2.9;
    const H = fh * 3 + 0.6;
    k.box(x1 - x0, H, z1 - z0, { x: (x0 + x1) / 2, y: F, z: (z0 + z1) / 2 }, 0xd8c8b0);
    solid(x0, z0, x1, z1, H);
    // 外走廊：每层一条，栏板 + 扶手 + 门
    for (let f = 0; f < 3; f++) {
      const y = F + 0.4 + f * fh;
      if (f > 0) k.box(1.2, 0.18, z1 - z0 - 1, { x: x1 + 0.6, y: y - 0.18, z: (z0 + z1) / 2 - 0.5 }, 0xc8c0b0);
      if (f > 0) k.box(0.08, 1.0, z1 - z0 - 1, { x: x1 + 1.16, y, z: (z0 + z1) / 2 - 0.5 }, 0xe8e0d0);
      k.box(0.1, 0.04, z1 - z0 - 1, { x: x1 + 1.16, y: y + 1.0, z: (z0 + z1) / 2 - 0.5 }, 0x8a6a4a);
      for (let d = 0; d < 5; d++) {
        const z = z0 + 2.4 + d * 3.8;
        k.box(0.06, 2.05, 0.9, { x: x1 + 0.02, y, z }, [0x6a5040, 0x5a6a7a, 0x6a5040, 0x7a6a5a, 0x5a6a7a][(d + f) % 5] as number);
        k.box(0.04, 0.05, 0.12, { x: x1 + 0.06, y: y + 1.0, z: z + 0.3 }, 0xc8ccd4);
        k.box(0.04, 0.12, 0.3, { x: x1 + 0.05, y: y + 2.2, z }, 0xf4f0e0, { glow: f === 1 && d === 2 ? 0 : 1.6 });
        // 门旁边的小窗（亮/暗）
        const lit = (d * 3 + f) % 4 !== 0;
        k.plane(0.7, 0.5, { x: x1 + 0.03, y: y + 1.4, z: z + 1.3, ry: PI / 2 }, 0xffffff, { tex: A.get(`win${lit ? (d + f) % 2 : 2}`), glow: lit ? 0.9 : undefined });
        // 门口的燃气表 + 洗衣机
        if ((d + f) % 2) k.box(0.6, 0.85, 0.6, { x: x1 + 0.45, y, z: z - 1.0 }, 0xf0f0ec);
      }
      if (f > 0) W.solids.add(x1, y - 0.18, z0 + 0.5, x1 + 1.2, y, z1 - 1);
    }
    // 楼梯（南端，室外钢楼梯，只做外形）
    for (let s = 0; s < 10; s++) k.box(1.0, 0.06, 0.32, { x: x1 + 0.6, y: F + 0.4 + s * 0.29, z: z1 - 0.6 - s * 0.3 }, 0x6a7078);
    k.box(0.05, 3, 0.05, { x: x1 + 1.1, y: F, z: z1 - 0.6 }, 0x6a7078);
    // 南面：入口、信箱、楼名
    k.box(0.06, 0.06, 0.06, { x: x1 - 1.6, y: F + 2.6, z: z1 + 0.04 }, 0xffffff);
    k.box(2.2, 0.12, 1.2, { x: x1 - 2, y: F + 2.5, z: z1 + 0.6 }, 0xc8c0b0);
    k.box(1.5, 0.01, 0.6, { x: x1 - 2, y: F + 2.49, z: z1 + 0.6 }, 0xfff0d0, { glow: 2 });
    k.box(1.2, 0.8, 0.3, { x: x1 - 4.2, y: F + 0.8, z: z1 + 0.15 }, 0xffffff, { tex: A.get('mailbox') });
    k.box(1.6, 0.4, 0.04, { x: x1 - 2, y: F + 2.7, z: z1 + 0.02 }, 0xffffff, { tex: A.get('aptName') });
    k.box(1.4, 2.2, 0.05, { x: x1 - 2, y: F, z: z1 + 0.02 }, 0x2a2a30);
    k.plane(1.2, 2.0, { x: x1 - 2, y: F + 1.1, z: z1 + 0.05 }, 0xffffff, { tex: A.get('win1'), glow: 0.8 });
    windows(W, k, gk, { x: (x0 + x1) / 2 - 1.5, y: 0, z: z1 + 0.01 }, 5, 3, fh, 3, F + 0.4, 3, toggles);
    // 屋顶：水箱 + 女儿墙
    k.box(x1 - x0, 0.4, 0.2, { x: (x0 + x1) / 2, y: F + H, z: z1 - 0.1 }, 0xc8b8a0);
    k.box(0.2, 0.4, z1 - z0, { x: x1 - 0.1, y: F + H, z: (z0 + z1) / 2 }, 0xc8b8a0);
    k.cyl(0.8, 0.8, 1.4, 14, { x: -17, y: F + H + 0.8, z: -8 }, 0xd8d8d4);
    for (const [dx, dz] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ] as const)
      k.cyl(0.05, 0.05, 0.8, 6, { x: -17 + dx, y: F + H, z: -8 + dz }, 0x8a8e96);
    // 公寓窗口上的雨水管
    k.cyl(0.05, 0.05, H, 8, { x: x1 + 0.05, y: F, z: z1 - 0.1 }, 0x9aa0a8);
  }

  // ================================================================ 店后面：两层的老房子（瓦顶）
  {
    const x0 = -9;
    const x1 = 7.5;
    const z0 = -20;
    const z1 = -15.2;
    const h = 5.4;
    k.box(x1 - x0, h, z1 - z0, { x: (x0 + x1) / 2, y: F, z: (z0 + z1) / 2 }, 0xb8a890);
    solid(x0, z0, x1, z1, h);
    // 斜瓦屋顶（深灰蓝）
    k.push({ x: (x0 + x1) / 2, y: F + h, z: (z0 + z1) / 2 });
    k.box(x1 - x0 + 0.6, 0.12, 3.0, { z: 1.25, rx: -0.45 }, 0x3a4458);
    k.box(x1 - x0 + 0.6, 0.12, 3.0, { z: -1.25, rx: 0.45 }, 0x3a4458);
    for (let i = 0; i < 10; i++) k.box(x1 - x0 + 0.6, 0.03, 0.04, { y: 0.1 + i * 0.12, z: 2.5 - i * 0.26, rx: -0.45 }, 0x2a3446);
    k.box(x1 - x0 + 0.7, 0.18, 0.22, { y: 1.2 }, 0x2a3040);
    k.pop();
    windows(W, k, gk, { x: (x0 + x1) / 2, y: 0, z: z1 + 0.01 }, x1 - x0 - 2, 2, 2.5, 6, F + 0.2, 1, toggles);
    // 一楼的后门、换气扇、雨檐
    k.box(1.0, 2.1, 0.05, { x: -6, y: F, z: z1 + 0.02 }, 0x5a5048);
    k.box(1.6, 0.06, 0.6, { x: -6, y: F + 2.3, z: z1 + 0.3 }, 0x8a8e96);
    k.cyl(0.18, 0.18, 0.04, 12, { x: -4, y: F + 1.8, z: z1 + 0.02, rx: PI / 2 }, 0x6a6e76);
  }

  // ================================================================ 后院：货笼、纸箱、店铺的垃圾站
  {
    k.box(2.0, 1.2, 1.0, { x: 2.5, y: F, z: -14.4 }, 0x8a9098);
    for (let i = 0; i < 6; i++) k.box(0.02, 1.2, 1.0, { x: 1.55 + i * 0.38, y: F, z: -14.4 }, 0x5a6068);
    k.box(1.8, 1.0, 0.8, { x: 2.5, y: F + 0.05, z: -14.4 }, 0x2a6a4a);
    W.solids.add(1.5, F, -14.9, 3.5, F + 1.2, -13.9);
    // 折好的纸箱 + 牛奶周转箱
    for (let i = 0; i < 4; i++) k.box(0.9, 0.04, 0.6, { x: -1.5, y: F + i * 0.04, z: -13.2, ry: i * 0.08 }, 0xc8a070);
    for (let i = 0; i < 3; i++) k.box(0.5, 0.3, 0.36, { x: -3, y: F + i * 0.3, z: -13.3 }, [0x2a6ac8, 0xd8402a, 0x2a6ac8][i] as number);
    W.solids.add(-3.25, F, -13.5, -1.05, F + 0.9, -12.9);
    k.box(0.3, 0.12, 0.2, { x: 5.7, y: 2.5, z: -12.08 }, 0xf0f4ff, { glow: 2.4 });
  }

  // ================================================================ 对街（路 A 南侧）：一排小店
  {
    const z0 = 15.2;
    const z1 = 20;
    const shops: Array<[number, number, number, number, string]> = [
      // x0, x1, 高, 颜色, 类型
      [-20, -14, 5.6, 0xa89880, 'shutter'],
      [-14, -9, 3.6, 0xc8b8a0, 'barber'],
      [-9, -3, 5.5, 0x9aa0a8, 'shutter'],
      [-3, 3, 3.8, 0x8a7a6a, 'izakaya'],
      [3, 8, 5.6, 0xb8b0a0, 'cleaning'],
    ];
    shops.forEach(([x0, x1, h, c, type], i) => {
      const cx = (x0 + x1) / 2;
      const w = x1 - x0 - 0.1;
      k.box(w, h, z1 - z0, { x: cx, y: F, z: (z0 + z1) / 2 }, c as number);
      solid(x0, z0, x1, z1, h);
      // 二楼以上的窗
      windows(W, k, gk, { x: cx, y: 0, z: z0 - 0.01, ry: PI }, w - 1, Math.floor((h - 3) / 2.4), 2.4, 2, F + 3, i + 4, toggles);
      // 一楼店面上方的雨檐 + 招牌
      k.box(w, 0.1, 0.9, { x: cx, y: F + 2.8, z: z0 - 0.45 }, 0x5a5e66);
      const signRow = { barber: 0, cleaning: 1, shutter: i === 0 ? 2 : 3 }[type as 'barber' | 'cleaning' | 'shutter'];
      if (type !== 'izakaya') k.box(w - 0.6, 0.5, 0.06, { x: cx, y: F + 2.95, z: z0 - 0.03, ry: PI }, 0xffffff, { tex: A.sub('shopSigns', 0, 1 - ((signRow as number) + 1) / 4, 1, 1 - (signRow as number) / 4), glow: 0.7 });
      if (type === 'shutter' || type === 'barber' || type === 'cleaning') {
        // 拉下来的卷帘门
        k.box(w - 0.8, 2.6, 0.05, { x: cx, y: F, z: z0 - 0.03, ry: PI }, 0xffffff, { tex: A.get('shutter') });
        k.box(w - 0.6, 0.3, 0.3, { x: cx, y: F + 2.5, z: z0 - 0.15 }, 0x8a8e96);
      }
      if (type === 'barber') {
        k.cyl(0.13, 0.13, 0.9, 14, { x: x1 - 0.5, y: F + 1.2, z: z0 - 0.25 }, 0xffffff, { tex: A.get('barber'), glow: 1.2 });
        k.sphere(0.14, { x: x1 - 0.5, y: F + 2.15, z: z0 - 0.25 }, 0xe8e8e8);
      }
      if (type === 'izakaya') {
        // 还开着的居酒屋：暖光的格子拉门、暖帘、红灯笼、门口的啤酒箱和招牌
        k.box(w - 0.4, 2.5, 0.06, { x: cx, y: F, z: z0 - 0.03 }, 0x6a4a2a);
        for (let j = 0; j < 4; j++) k.plane(1.1, 2.0, { x: x0 + 0.9 + j * 1.4, y: F + 1.15, z: z0 - 0.07, ry: PI }, 0xffe0a8, { glow: 1.4 });
        for (let j = 0; j < 5; j++) k.box(0.04, 2.0, 0.03, { x: x0 + 0.2 + j * 1.4, y: F + 0.15, z: z0 - 0.09 }, 0x3a2a1a);
        for (let j = 0; j < 6; j++) k.box(w - 0.6, 0.03, 0.03, { x: cx, y: F + 0.4 + j * 0.34, z: z0 - 0.09 }, 0x3a2a1a);
        k.box(2.4, 0.8, 0.01, { x: cx, y: F + 1.9, z: z0 - 0.12, ry: PI }, 0xffffff, { tex: A.get('noren') });
        k.box(2.6, 0.6, 0.08, { x: cx, y: F + 3.05, z: z0 - 0.05, ry: PI }, 0xffffff, { tex: A.get('izaSign'), glow: 1.1 });
        for (const lx of [x0 + 0.5, x1 - 0.5]) {
          k.cyl(0.2, 0.2, 0.55, 14, { x: lx, y: F + 1.9, z: z0 - 0.35, ry: PI }, 0xffffff, { tex: A.get('lantern'), glow: 1.5 });
          k.cyl(0.21, 0.21, 0.04, 14, { x: lx, y: F + 1.88, z: z0 - 0.35 }, 0x1a1a1a);
          k.cyl(0.21, 0.21, 0.04, 14, { x: lx, y: F + 2.45, z: z0 - 0.35 }, 0x1a1a1a);
        }
        for (let j = 0; j < 2; j++) k.box(0.45, 0.3, 0.35, { x: x1 - 1.0, y: F + j * 0.3, z: z0 - 0.5 }, 0xd8a020);
        k.box(0.5, 0.8, 0.3, { x: x0 + 1.2, y: F, z: z0 - 0.5 }, 0x1a1a1a);
        k.plane(0.42, 0.68, { x: x0 + 1.2, y: F + 0.42, z: z0 - 0.66, ry: PI }, 0xffffff, { tex: A.get('menu') });
        const iza = new PointLight(0xffb060, 8, 9, 1.8);
        iza.position.set(cx, F + 1.6, z0 - 1.4);
        W.add(iza);
        W.interact({
          box: box3(x0, F, z0 - 0.4, x1, F + 2.6, z0),
          label: () => '居酒屋「ほたる」  门口飘出烤串的香味',
          use: () => {
            W.sfx.chime();
            W.say('「いらっしゃい！」…今天满座了，下次再来吧');
          },
        });
      }
      // 楼顶的小招牌架 / 天线
      if (i % 2 === 0) {
        k.cyl(0.02, 0.02, 1.5, 4, { x: cx + 1, y: F + h, z: (z0 + z1) / 2 }, 0x8a8e96);
        k.box(1.2, 0.04, 0.04, { x: cx + 1, y: F + h + 1.3, z: (z0 + z1) / 2 }, 0x8a8e96);
      }
    });
    // 南侧人行道和楼之间的店前路面（自动贩卖机 ×1，在理发店旁）
    k.box(0.95, 1.83, 0.7, { x: -14.6, y: F, z: z0 - 0.4 }, 0x1e64c8);
    k.box(0.9, 1.7, 0.01, { x: -14.6, y: F + 0.07, z: z0 - 0.751, ry: PI }, 0xffffff, { tex: A.get('vend1'), glow: 1.0 });
    W.solids.add(-15.1, F, z0 - 0.75, -14.1, F + 1.9, z0 - 0.05);
  }

  // ================================================================ 东边：写字楼（路 B 东侧，比较高，窗户多数暗）
  {
    const x0 = 18.1;
    const x1 = 20;
    const parts: Array<[number, number, number]> = [
      [-20, -6, 13],
      [-6, 5, 10],
      [15.2, 20, 9],
    ];
    parts.forEach(([z0, z1, h], i) => {
      k.box(x1 - x0, h, z1 - z0, { x: (x0 + x1) / 2, y: F, z: (z0 + z1) / 2 }, i === 1 ? 0x8a929e : 0x9a9a98);
      solid(x0, z0, x1, z1, h);
      windows(W, k, gk, { x: x0 - 0.01, y: 0, z: (z0 + z1) / 2, ry: -PI / 2 }, z1 - z0 - 1, Math.floor((h - 1) / 2.6), 2.6, Math.round((z1 - z0) / 2.2), F + 0.6, i * 3 + 2, toggles);
    });
    // 一楼的玻璃门厅（亮着）+ 楼顶的红色航空障碍灯
    k.plane(4, 2.4, { x: x0 - 0.02, y: F + 1.3, z: -1, ry: -PI / 2 }, 0xd8ecff, { glow: 0.9 });
    k.sphere(0.12, { x: 19, y: F + 13.1, z: -13 }, 0xff2020, { glow: 3 });
  }
  // 路 A 南侧往东（路 B 东南角）的小楼
  k.box(1.9, 6, 4, { x: 19.05, y: F, z: 17.8 }, 0xb8a890);

  W.add(k.build('buildings'));
  W.add(gk.build('windows'));
  // 窗户偶尔开关灯：每隔一会儿随机一扇
  let t = 5;
  W.tick.push((dt) => {
    t -= dt;
    if (t > 0 || toggles.length === 0) return;
    t = 6 + Math.random() * 10;
    const w = toggles[Math.floor(Math.random() * toggles.length)] as (typeof toggles)[number];
    w.on = !w.on;
    w.k.setHidden(w.m, !w.on);
  });
}

export const _p = new Vector3();
