import { Group, MeshBasicMaterial, PointLight, SpotLight, type Material } from 'three';
import { box3, STORE, type World } from './ctx';
import type { Kit, MatKey } from './kit';
import { glassMaterial } from './materials';

/**
 * 便利店的外壳：墙、正面的大玻璃窗、自动门、天花板灯、招牌、雨棚、屋顶。
 * 店内的陈设在 fixtures.ts。
 *
 * 店铺 x -8..7、z -12..-2，地板 y 0.3，天花板 3.2，屋顶 3.6。正门在 x 0..2（朝南）。
 */

export const DOOR = { x0: 0, x1: 2, z: -2 };
/** 后墙上的员工门（通往后院） */
export const BACK_DOOR = { x0: 5.2, x1: 6.2 };
const F = STORE.floor;
const CEIL = STORE.ceil;
const ROOF = 3.6;
const FRAME = 0x3c4048;

/** 店铺外壳用到的东西（门、闪烁的灯箱）交给 main 每帧更新 */
export interface StoreShell {
  /** 招牌灯箱的发光强度（闪烁用） */
  signLight: PointLight;
  interiorLights: PointLight[];
  spill: SpotLight;
  frontMat: MeshBasicMaterial;
  sideMat: MeshBasicMaterial;
}

export function glassKit(W: World, tint?: number, opacity?: number, drops = true): Kit {
  const m = glassMaterial(tint, opacity, drops);
  const mats = { toon: m, tex: m, glow: m, glowTex: m } as Record<MatKey, Material>;
  const k = W.kit(mats);
  k.shadows = false;
  return k;
}

/** 玻璃网格放到第 2 层：描边用的法线 / 深度那一遍不画它，否则店里的东西就没有轮廓线了 */
export function glassGroup(g: Group): Group {
  g.traverse((o) => {
    o.layers.set(2);
    o.castShadow = false;
    o.receiveShadow = false;
    o.renderOrder = 3;
  });
  return g;
}

export function buildStore(W: World): StoreShell {
  const A = W.atlas;
  const k = W.kit();
  const glass = glassKit(W);
  const { x0, x1, z0, z1 } = STORE;
  // 招牌单独用一份发光材质：可以单独闪烁
  const frontMat = (W.mats.glow as MeshBasicMaterial).clone();
  const sideMat = (W.mats.glow as MeshBasicMaterial).clone();
  const signFront = W.kit({ ...W.mats, glow: frontMat, glowTex: frontMat });
  const signSide = W.kit({ ...W.mats, glow: sideMat, glowTex: sideMat });

  // ---------------------------------------------------------------- 墙
  const wallC = 0xf0ece4;
  const outC = 0xdcd8d0;
  // 后墙 / 西墙 / 东墙（室内侧白、外侧浅灰）
  // 后墙在 x 5.2..6.2 留一个员工门洞（通往后院）
  k.box(BACK_DOOR.x0 - x0, ROOF - F, 0.2, { x: (x0 + BACK_DOOR.x0) / 2, y: F, z: z0 + 0.1 }, wallC);
  k.box(x1 - BACK_DOOR.x1, ROOF - F, 0.2, { x: (x1 + BACK_DOOR.x1) / 2, y: F, z: z0 + 0.1 }, wallC);
  k.box(BACK_DOOR.x1 - BACK_DOOR.x0, ROOF - 2.3, 0.2, { x: (BACK_DOOR.x0 + BACK_DOOR.x1) / 2, y: 2.3, z: z0 + 0.1 }, wallC);
  k.box(BACK_DOOR.x1 - BACK_DOOR.x0 + 0.12, 0.06, 0.24, { x: (BACK_DOOR.x0 + BACK_DOOR.x1) / 2, y: 2.27, z: z0 + 0.1 }, 0x6a6e76);
  k.box(0.2, ROOF - F, z1 - z0, { x: x0 + 0.1, y: F, z: (z0 + z1) / 2 }, wallC);
  k.box(0.2, ROOF - F, z1 - z0, { x: x1 - 0.1, y: F, z: (z0 + z1) / 2 }, wallC);
  W.wall(x0, F, z0, BACK_DOOR.x0, ROOF, z0 + 0.2);
  W.wall(BACK_DOOR.x1, F, z0, x1, ROOF, z0 + 0.2);
  W.wall(BACK_DOOR.x0, 2.3, z0, BACK_DOOR.x1, ROOF, z0 + 0.2);
  W.wall(x0, F, z0, x0 + 0.2, ROOF, z1);
  W.wall(x1 - 0.2, F, z0, x1, ROOF, z1);
  // 外墙面一圈：下面的深色踢脚 + 上面的三色腰线
  for (const [cx, cz, w, d] of [
    [(x0 + BACK_DOOR.x0) / 2, z0 - 0.01, BACK_DOOR.x0 - x0 + 0.02, 0.02],
    [(x1 + BACK_DOOR.x1) / 2, z0 - 0.01, x1 - BACK_DOOR.x1 + 0.02, 0.02],
    [x0 - 0.01, (z0 + z1) / 2, 0.02, z1 - z0],
    [x1 + 0.01, (z0 + z1) / 2, 0.02, z1 - z0],
  ] as const) {
    k.box(w, ROOF - F - 0.5, d, { x: cx, y: F + 0.5, z: cz }, outC);
    k.box(w + 0.01, 0.5, d + 0.01, { x: cx, y: F, z: cz }, 0x5a5e66);
    k.box(w + 0.02, 0.08, d + 0.02, { x: cx, y: 2.9, z: cz }, 0x1d3d8f);
    k.box(w + 0.02, 0.06, d + 0.02, { x: cx, y: 2.82, z: cz }, 0x24b0a0);
    k.box(w + 0.02, 0.06, d + 0.02, { x: cx, y: 2.74, z: cz }, 0xf28a24);
  }
  // 室内墙面的踢脚线和墙上的三色线
  k.box(x1 - x0 - 0.4, 0.12, 0.02, { x: (x0 + x1) / 2, y: F, z: z0 + 0.21 }, 0x9a9a9a);
  k.box(0.02, 0.12, z1 - z0, { x: x0 + 0.21, y: F, z: (z0 + z1) / 2 }, 0x9a9a9a);

  // ---------------------------------------------------------------- 正面
  const fz = z1;
  // 门两边的玻璃窗（x -8..0 和 2..4.4），竖框每 1.6 m 一根
  const panes: Array<[number, number]> = [
    [-8, -6.4],
    [-6.4, -4.8],
    [-4.8, -3.2],
    [-3.2, -1.6],
    [-1.6, 0],
    [2, 3.2],
    [3.2, 4.4],
  ];
  for (const [a, b] of panes) {
    glass.box(b - a - 0.06, 2.55 - F - 0.25, 0.02, { x: (a + b) / 2, y: F + 0.25, z: fz - 0.04 }, 0xffffff);
    k.box(0.07, CEIL - F, 0.12, { x: a, y: F, z: fz - 0.05 }, FRAME);
    W.wall(a, F, fz - 0.1, b, CEIL, fz);
  }
  k.box(0.07, CEIL - F, 0.12, { x: 4.4, y: F, z: fz - 0.05 }, FRAME);
  // 窗下的踢脚板、窗上的横框和气窗
  for (const [a, b] of [
    [-8, 0],
    [2, 4.4],
  ] as const) {
    k.box(b - a, 0.25, 0.14, { x: (a + b) / 2, y: F, z: fz - 0.05 }, 0x2a2e36);
    k.box(b - a, 0.06, 0.13, { x: (a + b) / 2, y: 2.55, z: fz - 0.05 }, FRAME);
    glass.box(b - a, CEIL - 2.61, 0.02, { x: (a + b) / 2, y: 2.61, z: fz - 0.04 }, 0xffffff);
  }
  // 门上的横梁 + 感应器 + "自動ドア"贴纸用的门框
  k.box(2.2, CEIL - 2.4, 0.16, { x: 1, y: 2.4, z: fz - 0.05 }, FRAME);
  k.box(0.3, 0.08, 0.1, { x: 1, y: 2.32, z: fz + 0.05 }, 0x222222);
  k.box(0.04, 0.02, 0.01, { x: 1.1, y: 2.35, z: fz + 0.1 }, 0xff3030, { glow: 2 });
  // 门右边的实墙（x 4.4..7）：外面靠着贩卖机，里面是柜台后面
  k.box(7 - 4.4, CEIL - F, 0.2, { x: 5.7, y: F, z: fz - 0.1 }, outC);
  k.box(7 - 4.4 + 0.01, 0.5, 0.21, { x: 5.7, y: F, z: fz - 0.1 }, 0x5a5e66);
  W.wall(4.4, F, fz - 0.2, 7, CEIL, fz);
  // 天花板到屋顶之间的正面墙（招牌后面）
  k.box(x1 - x0, ROOF - CEIL, 0.2, { x: (x0 + x1) / 2, y: CEIL, z: fz - 0.1 }, outC);

  // 窗上贴的海报（贴在玻璃内侧，从外面看得到）
  const posters: Array<[number, number, number]> = [
    [-7.6, 0, 1.1],
    [-6.0, 1, 1.0],
    [-1.2, 2, 0.9],
    [2.4, 3, 0.9],
    [3.8, 4, 0.9],
  ];
  for (const [x, p, s] of posters) k.box(0.5 * s, 0.75 * s, 0.01, { x, y: 1.4, z: fz - 0.08, ry: Math.PI }, 0xffffff, { tex: A.get(`poster${p}`), faces: ['pz', 'nz'] });
  // 营业时间贴纸、"OPEN 24 HOURS"
  k.box(0.36, 0.18, 0.01, { x: 2.6, y: 2.2, z: fz - 0.07, ry: Math.PI }, 0xffffff, { tex: A.get('h24'), faces: ['pz', 'nz'], glow: 1.1 });

  // ---------------------------------------------------------------- 天花板 + 灯
  k.box(x1 - x0, ROOF - CEIL, z1 - z0, { x: (x0 + x1) / 2, y: CEIL, z: (z0 + z1) / 2 }, 0xf4f2ee);
  // 吊顶的分格线
  for (let x = x0 + 1.2; x < x1; x += 1.2) k.box(0.02, 0.01, z1 - z0, { x, y: CEIL - 0.01, z: (z0 + z1) / 2 }, 0xc8c8c8);
  for (let z = z0 + 1.2; z < z1; z += 1.2) k.box(x1 - x0, 0.01, 0.02, { x: (x0 + x1) / 2, y: CEIL - 0.01, z }, 0xc8c8c8);
  // 日光灯（发光条）
  for (const x of [-6.2, -3.6, -1, 1.6, 4.6]) {
    for (const z of [-10.6, -8.4, -6.2, -4.0]) {
      k.box(1.3, 0.05, 0.34, { x, y: CEIL - 0.05, z }, 0xd0d0d0);
      k.box(1.24, 0.02, 0.28, { x, y: CEIL - 0.07, z }, 0xfff8ec, { glow: 1.5 });
    }
  }
  // 监控摄像头（球形）、烟雾报警器、空调出风口
  for (const [x, z] of [
    [-7.2, -2.6],
    [6.2, -11.2],
  ] as const) {
    k.cyl(0.08, 0.08, 0.04, 10, { x, y: CEIL - 0.04, z }, 0xeeeeee);
    k.sphere(0.07, { x, y: CEIL - 0.06, z }, 0x222226, { sy: 0.8 });
  }
  for (const [x, z] of [
    [-4.8, -7.3],
    [1.2, -7.3],
  ] as const) {
    k.box(0.7, 0.03, 0.7, { x, y: CEIL - 0.03, z }, 0xe0e0e0);
    for (let i = 0; i < 4; i++) k.box(0.62 - i * 0.14, 0.012, 0.62 - i * 0.14, { x, y: CEIL - 0.045 - i * 0.006, z }, 0xb8b8b8);
  }

  // ---------------------------------------------------------------- 招牌 + 雨棚
  // 正面招牌：整条发光灯箱
  k.box(x1 - x0 + 0.3, 1.1, 0.32, { x: (x0 + x1) / 2, y: 3.25, z: fz + 0.1 }, 0xf4f4f0);
  signFront.box(x1 - x0 + 0.2, 0.92, 0.01, { x: (x0 + x1) / 2, y: 3.34, z: fz + 0.265 }, 0xffffff, { tex: A.get('sign'), glow: 0.95 });
  k.box(x1 - x0 + 0.34, 0.05, 0.36, { x: (x0 + x1) / 2, y: 4.35, z: fz + 0.1 }, 0x8a8e96);
  // 东侧面的招牌
  k.box(0.32, 1.1, 8, { x: x1 + 0.1, y: 3.25, z: -6 }, 0xf4f4f0);
  signSide.box(7.8, 0.92, 0.01, { x: x1 + 0.27, y: 3.34, z: -6, ry: Math.PI / 2 }, 0xffffff, { tex: A.get('sign'), glow: 0.95 });
  // 雨棚：门窗上方往外伸 1.2 m，底下有一排筒灯
  const aw = { z0: fz, z1: fz + 1.2, y: 2.98 };
  k.box(x1 - x0 + 0.2, 0.14, aw.z1 - aw.z0, { x: (x0 + x1) / 2, y: aw.y, z: (aw.z0 + aw.z1) / 2 }, 0xe8e8e4);
  k.box(x1 - x0 + 0.24, 0.2, 0.06, { x: (x0 + x1) / 2, y: aw.y - 0.04, z: aw.z1 }, 0x1d3d8f);
  k.box(x1 - x0 + 0.24, 0.04, 0.07, { x: (x0 + x1) / 2, y: aw.y - 0.07, z: aw.z1 }, 0x9aa0a8);
  for (let x = x0 + 0.8; x < x1; x += 1.6) {
    k.cyl(0.07, 0.07, 0.01, 10, { x, y: aw.y - 0.01, z: fz + 0.6 }, 0xfff4d8, { glow: 2.6 });
  }
  // 雨棚的排水管（东边落下来）
  k.cyl(0.04, 0.04, aw.y - F, 8, { x: x1 + 0.02, y: F, z: aw.z1 - 0.06 }, 0x9aa0a8);
  k.box(0.2, 0.04, 0.12, { x: x1 + 0.02, y: F, z: aw.z1 + 0.02 }, 0x9aa0a8);

  // ---------------------------------------------------------------- 屋顶
  k.box(x1 - x0 + 0.1, 0.1, z1 - z0 + 0.1, { x: (x0 + x1) / 2, y: ROOF, z: (z0 + z1) / 2 }, 0x8a8c90);
  // 女儿墙
  k.box(x1 - x0 + 0.1, 0.5, 0.15, { x: (x0 + x1) / 2, y: ROOF, z: z0 + 0.02 }, outC);
  k.box(0.15, 0.5, z1 - z0, { x: x0 + 0.02, y: ROOF, z: (z0 + z1) / 2 }, outC);
  // 屋顶的空调主机、通风管、检修口
  for (const [x, z] of [
    [-5.5, -8],
    [-3.5, -8],
    [2.5, -9.5],
  ] as const) {
    k.box(1.1, 0.9, 0.6, { x, y: ROOF + 0.1, z }, 0xd8d8d4);
    k.cyl(0.32, 0.32, 0.02, 14, { x, y: ROOF + 1.0, z }, 0x2a2a2a);
    k.box(1.0, 0.02, 0.04, { x, y: ROOF + 1.02, z }, 0x666666);
    k.box(0.04, 0.02, 0.6, { x, y: ROOF + 1.02, z }, 0x666666);
  }
  k.box(0.2, 0.2, 5, { x: -4.5, y: ROOF + 0.1, z: -5 }, 0x9a9a9a);
  k.box(1, 0.15, 1, { x: 4.5, y: ROOF + 0.1, z: -5 }, 0x6a6e74);
  k.cyl(0.18, 0.18, 0.7, 10, { x: 0, y: ROOF + 0.1, z: -11 }, 0xa8a8a8);
  k.cyl(0.24, 0.24, 0.08, 10, { x: 0, y: ROOF + 0.8, z: -11 }, 0x8a8a8a);

  W.add(k.build('store'));
  W.add(signFront.build('signFront'));
  W.add(signSide.build('signSide'));
  W.add(glassGroup(glass.build('storeGlass')));

  // ---------------------------------------------------------------- 灯光
  const interiorLights: PointLight[] = [];
  // 3 盏就够（以前 5 盏，每个像素都要把每盏灯算一遍，是卡的主要原因之一）；日光灯本身是发光体
  for (const [x, z] of [
    [-4.8, -7],
    [0.2, -7],
    [4.8, -6],
  ] as const) {
    const l = new PointLight(0xfff0dc, 2.4, 11, 1.4);
    l.position.set(x, CEIL - 0.4, z);
    W.add(l);
    interiorLights.push(l);
  }
  // 从店里照到外面的暖光：投影，窗框、货架的影子会印在店门口的地上
  const spill = new SpotLight(0xffe2b8, 30, 22, 1.05, 0.6, 1.4);
  spill.position.set(-1.5, 2.9, -7.5);
  spill.target.position.set(-1.5, 0, 2);
  spill.castShadow = true;
  spill.shadow.mapSize.set(1024, 1024);
  spill.shadow.bias = -0.0012;
  spill.shadow.normalBias = 0.06;
  spill.shadow.camera.near = 0.5;
  spill.shadow.camera.far = 22;
  W.add(spill);
  W.add(spill.target);
  // 招牌灯箱照亮门口和雨棚
  const signLight = new PointLight(0xe8f0ff, 6, 10, 1.6);
  signLight.position.set(-0.5, 3.6, fz + 1.6);
  W.add(signLight);

  buildDoor(W);
  return { signLight, interiorLights, spill, frontMat, sideMat };
}

/** 自动门：两扇玻璃门往两边滑开。人靠近就开，没人的时候偶尔也会自己开一下（感应到雨伞、小猫……） */
function buildDoor(W: World): void {
  const A = W.atlas;
  const fz = DOOR.z;
  const panels: Array<{ g: Group; closedX: number; dir: number; solid: ReturnType<World['solids']['add']> }> = [];
  for (const side of [0, 1]) {
    const k = W.kit();
    k.shadows = false;
    const gk = glassKit(W);
    const cx = side === 0 ? 0.5 : 1.5;
    const zz = fz - (side === 0 ? 0.03 : 0.08);
    // 门框（四边的铝框）
    k.box(1.0, 0.08, 0.05, { x: 0, y: F, z: 0 }, FRAME);
    k.box(1.0, 0.06, 0.05, { x: 0, y: 2.34, z: 0 }, FRAME);
    k.box(0.05, 2.4 - F, 0.05, { x: -0.475, y: F, z: 0 }, FRAME);
    k.box(0.05, 2.4 - F, 0.05, { x: 0.475, y: F, z: 0 }, FRAME);
    // "自動ドア"贴纸（两面都贴）
    k.box(0.34, 0.12, 0.004, { x: side === 0 ? 0.25 : -0.25, y: 1.15, z: 0.028 }, 0xffffff, { tex: A.get('door'), faces: ['pz', 'nz'] });
    gk.box(0.9, 2.34 - F - 0.08, 0.016, { y: F + 0.08 }, 0xffffff);
    const g = k.build(`door${side}`);
    g.add(glassGroup(gk.build()));
    g.position.set(cx, 0, zz);
    W.add(g);
    const solid = W.solids.add(cx - 0.5, F, zz - 0.04, cx + 0.5, 2.4, zz + 0.04);
    panels.push({ g, closedX: cx, dir: side === 0 ? -1 : 1, solid });
  }
  let open = 0;
  let ghost = 12;
  let wasOpen = false;
  W.tick.push((dt) => {
    const p = W.player;
    const near = Math.abs(p.x - 1) < 1.3 && p.z > fz - 1.6 && p.z < fz + 1.6 && p.y < 2;
    ghost -= dt;
    if (ghost < -2.5) ghost = 25 + Math.random() * 30;
    const want = near || ghost < 0 ? 1 : 0;
    // 开门比关门快
    open += Math.sign(want - open) * Math.min(Math.abs(want - open), dt * (want ? 1.6 : 0.8));
    const isOpen = open > 0.05;
    if (isOpen && !wasOpen) {
      W.sfx.doorSlide();
      if (p.z > fz && near) W.sfx.chime();
    }
    wasOpen = isOpen;
    const e = open * open * (3 - 2 * open);
    for (const pn of panels) {
      pn.g.position.x = pn.closedX + pn.dir * 0.96 * e;
      const cx = pn.g.position.x;
      pn.solid.minx = cx - 0.5;
      pn.solid.maxx = cx + 0.5;
    }
  });
  // 门口上方的感应器范围：不能交互，只是给出提示
  W.interact({
    box: box3(0.7, 2.25, fz - 0.05, 1.3, 2.42, fz + 0.15),
    label: () => '自动门感应器：走近就会打开',
    use: () => W.say('叮咚～ いらっしゃいませ'),
  });
}
