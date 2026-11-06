import { Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { box3, STORE, type World } from './ctx';
import { Cart, good, goodInfo, shelfItem, SIZE, type Good, type GoodKind } from './goods';
import type { Steam } from './fx';
import type { Kit } from './kit';
import { BACK_DOOR, glassGroup, glassKit } from './store';

/**
 * 店内陈设：货架岛、饮料冷柜（玻璃门可开）、便当冷藏柜、杂志架、收银台、热食柜、关东煮、
 * 咖啡机、烟柜、ATM、复印机、快递柜、冰柜、员工门、地面导视。
 * 每件商品都是能拿的实体；门、盖子、柜门都能开关。
 */

const F = STORE.floor;
const PI = Math.PI;
type Fill = (sec: number, level: number) => [GoodKind, number] | null;

/** 一段连续摆放的商品（局部坐标：从 x0 到 x1，放在高 y 的层板上，正面贴着 zFront） */
function row(W: World, gk: Kit, cart: Cart, kind: GoodKind, v: number | ((i: number) => number), x0: number, x1: number, y: number, zFront: number, gap = 0.012, tilt = 0, back = 0): void {
  const [w, , d] = SIZE[kind];
  const n = Math.floor((x1 - x0 + gap) / (w + gap));
  const used = n * (w + gap) - gap;
  let x = x0 + (x1 - x0 - used) / 2 + w / 2;
  for (let i = 0; i < n; i++) {
    const vv = typeof v === 'function' ? v(i) : v;
    const m = good(W, gk, kind, vv, x, y, zFront - d / 2, tilt);
    shelfItem(W, gk, m, goodInfo(kind, vv), cart);
    // 后面再码几排同样的货（只是陈列，拿不到）：拿走前排以后看到的是后面那一件，货架不会一下就空
    for (let b = 1; b <= back; b++) good(W, gk, kind, vv, x, y, zFront - d / 2 - b * (d + 0.01), tilt);
    x += w + gap;
  }
}

/** 双面货架岛：长 L、沿局部 X；两面朝 ±Z，各 4 层 */
function gondola(W: World, k: Kit, gk: Kit, cart: Cart, L: number, fills: [Fill, Fill], prices: Kit): void {
  const A = W.atlas;
  const H = 1.45;
  k.box(L, H, 0.05, {}, 0xe6e6e2); // 中间的背板
  k.box(L + 0.04, 0.03, 0.9, { y: H }, 0xf4f4f0); // 顶板
  for (const s of [0, 1] as const) {
    // 三个拼模型工具都要转到同一面：以前只有货架本体转了，商品和价签留在正面，
    // 背面那一面的商品和正面的叠在同一个位置（互相穿插、闪烁）
    const side = { ry: s ? PI : 0 };
    k.push(side);
    gk.push(side);
    prices.push(side);
    k.box(L, 0.12, 0.42, { z: 0.23 }, 0x2a2e36); // 底座
    k.box(L, 0.02, 0.02, { y: 0.11, z: 0.44 }, 0x24b0a0);
    const levels = [0.12, 0.45, 0.78, 1.11];
    levels.forEach((y, li) => {
      if (li > 0) k.box(L, 0.025, 0.4, { y: y - 0.025, z: 0.22 }, 0xf8f8f6);
      // 价签条（每 1.4 m 一段）
      for (let x = -L / 2; x < L / 2 - 0.01; x += 1.4) prices.box(Math.min(1.4, L / 2 - x), 0.035, 0.008, { x: x + Math.min(1.4, L / 2 - x) / 2, y: y - 0.04, z: 0.425 }, 0xffffff, { tex: A.get('price') });
      for (let sec = 0; sec * 1.4 < L - 0.01; sec++) {
        const f = fills[s](sec, li);
        if (!f) continue;
        const x0 = -L / 2 + sec * 1.4 + 0.03;
        const x1 = Math.min(L / 2, x0 + 1.4) - 0.03;
        row(W, gk, cart, f[0], f[1], x0, x1, y, 0.415, 0.012, 0, Math.min(3, Math.floor(0.36 / (SIZE[f[0]][2] + 0.01)) - 1));
      }
    });
    // 端头的立柱
    for (const x of [-L / 2, L / 2]) k.box(0.04, H, 0.44, { x, z: 0.22 }, 0xd8d8d4);
    k.pop();
    gk.pop();
    prices.pop();
  }
}

/** 一扇绕竖轴转的门（冷柜门、员工门、快递柜门）。hinge 是转轴的世界坐标，门板沿 +X 方向长 w */
interface Swing {
  g: Group;
  open: number;
  want: number;
  max: number;
  /** 自动关门的倒计时（< 0 不自动关） */
  auto: number;
  autoT: number;
  onToggle?: (open: boolean) => void;
}

function swingTick(W: World, list: Swing[]): void {
  W.tick.push((dt) => {
    for (const s of list) {
      if (s.want && s.auto > 0) {
        s.autoT -= dt;
        if (s.autoT <= 0) s.want = 0;
      }
      const d = s.want - s.open;
      if (Math.abs(d) > 1e-4) {
        s.open += Math.sign(d) * Math.min(Math.abs(d), dt * 2.2);
        const e = s.open * s.open * (3 - 2 * s.open);
        s.g.rotation.y = -s.max * e;
      }
    }
  });
}

export interface Fixtures {
  cart: Cart;
}

/** Blender-made interior fixtures use a static baked atlas; interactive products,
 * doors, screens, prices and machine controls stay in the live Three.js scene. */
function loadBlenderFixtures(W: World, fallback: Group): void {
  const url = `${import.meta.env.BASE_URL}konbini/interior-fixtures.glb`;
  new GLTFLoader().load(
    url,
    ({ scene }) => {
      scene.name = 'Konbini | Blender-baked interior fixtures';
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // Static furnishings already contain the Cycles lighting/shadow bake.
        // Unlit avoids double lighting from the store's legacy point lights.
        const convert = (source: unknown): MeshBasicMaterial => {
          const material = source as MeshBasicMaterial;
          const unlit = new MeshBasicMaterial({
            map: material.map,
            color: 0xffffff,
            side: material.side,
            alphaMap: material.alphaMap,
            alphaTest: material.alphaTest,
            transparent: material.transparent,
            opacity: material.opacity,
            toneMapped: material.toneMapped,
          });
          unlit.name = `${material.name} (static bake)`;
          return unlit;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
      });
      W.add(scene);
      fallback.visible = false;
    },
    undefined,
    (error) => {
      console.warn('Konbini Blender fixture pack failed to load; using procedural fixtures.', error);
      fallback.visible = true;
    },
  );
}

export function buildFixtures(W: World, steam: Steam): Fixtures {
  const A = W.atlas;
  const cart = new Cart();
  const k = W.kit();
  const prices = W.kit();
  prices.shadows = false;
  const swings: Swing[] = [];

  // ================================================================ 货架岛
  const snacks: Fill = (sec, li) => ['snack', (sec * 2 + li) % 6];
  const sweets: Fill = (sec, li) => (sec < 2 ? ['sweet', (sec * 4 + li) % 6] : sec < 4 ? ['bread', (sec * 3 + li) % 5] : ['daily', li % 4]);
  const breads: Fill = (sec, li) => (li === 0 ? ['snack', sec % 6] : ['bread', (sec + li * 2) % 5]);
  const noodles: Fill = (sec, li) => (li < 3 ? ['noodle', (sec + li) % 4] : ['sweet', (sec + 2) % 6]);
  const daily: Fill = (sec, li) => (sec < 2 ? ['daily', (sec + li) % 4] : ['snack', (sec + li * 3) % 6]);
  const drinks: Fill = (sec, li) => (li % 2 ? ['can', (sec * 2 + li) % 8] : ['bottle', (sec + li) % 8]);
  const islands: Array<[number, Fill, Fill]> = [
    [-4.75, snacks, sweets],
    [-7.0, breads, noodles],
    [-9.3, daily, drinks],
  ];
  const L = 7;
  for (const [z, south, north] of islands) {
    const gk = W.kit();
    gk.shadows = false;
    k.push({ x: -2.5, y: F, z });
    gk.push({ x: -2.5, y: F, z });
    prices.push({ x: -2.5, y: F, z });
    gondola(W, k, gk, cart, L, [south, north], prices);
    gk.pop();
    prices.pop();
    // 端头促销架（东端，朝 +X）+ "2個で10%OFF"
    k.push({ x: L / 2 + 0.25, ry: PI / 2 });
    k.box(0.9, 0.12, 0.45, { z: 0 }, 0x2a2e36);
    for (const y of [0.45, 0.8]) k.box(0.9, 0.025, 0.42, { y, z: 0 }, 0xf8f8f6);
    k.box(0.9, 1.0, 0.03, { z: -0.22 }, 0xe6e6e2);
    k.box(0.5, 0.32, 0.02, { y: 1.12, z: -0.2 }, 0xffffff, { tex: A.get('sale') });
    k.box(0.03, 0.3, 0.03, { y: 1.0, z: -0.21 }, 0x999999);
    k.pop();
    gk.push({ x: L / 2 + 0.25, ry: PI / 2 });
    row(W, gk, cart, 'snack', (i) => (i + 60 + Math.round(z)) % 6, -0.42, 0.42, 0.12, 0.2);
    row(W, gk, cart, 'sweet', (i) => i % 6, -0.42, 0.42, 0.475, 0.2);
    row(W, gk, cart, 'can', (i) => (i * 3) % 8, -0.42, 0.42, 0.825, 0.2);
    gk.pop();
    k.pop();
    W.add(gk.build('goods'));
    W.solids.add(-6.05, F, z - 0.46, 1.5, F + 1.5, z + 0.46);
  }
  // 货架上方吊着的分类牌
  const hang = (x: number, z: number, cat: number, ry = 0): void => {
    k.push({ x, y: 2.45, z, ry });
    k.box(1.1, 0.21, 0.03, {}, 0xffffff, { tex: A.get(`cat${cat}`), faces: ['pz', 'nz'] });
    for (const s of [-0.45, 0.45]) k.box(0.01, STORE.ceil - 2.66, 0.01, { x: s, y: 0.21 }, 0x777777);
    k.pop();
  };
  hang(-2.5, -4.75, 3);
  hang(-2.5, -7.0, 2);
  hang(-2.5, -9.3, 5);
  hang(-7.2, -6.9, 1, PI / 2);

  // ================================================================ 饮料冷柜（后墙，9 个门）
  {
    const gk = W.kit();
    gk.shadows = false;
    const glass = glassKit(W, 0xd8ecff, 0.08, false);
    const bayW = 1.08;
    const x0 = -7.7;
    const zb = -11.8;
    const zf = -10.9;
    const n = 9;
    const xEnd = x0 + n * bayW;
    // 柜体
    k.box(xEnd - x0, 0.15, zf - zb, { x: (x0 + xEnd) / 2, y: F, z: (zb + zf) / 2 }, 0x1e2026);
    k.box(xEnd - x0, 2.6 - 2.15, zf - zb + 0.05, { x: (x0 + xEnd) / 2, y: F + 2.15, z: (zb + zf) / 2 + 0.025 }, 0x1e2026);
    k.box(xEnd - x0, F + 2.25, 0.04, { x: (x0 + xEnd) / 2, y: 0, z: zb + 0.02 }, 0xe8eef4);
    // 顶上的灯箱招牌：ドリンク（发光）+ 三色条
    k.box(xEnd - x0 - 0.1, 0.26, 0.01, { x: (x0 + xEnd) / 2, y: F + 2.24, z: zf + 0.03 }, 0xffffff, { tex: A.sub('cat0', 0.2, 0, 1, 1), glow: 1.15 });
    for (let i = 0; i < n; i++) {
      const bx = x0 + i * bayW;
      const cx = bx + bayW / 2;
      // 隔板、层板、灯条
      k.box(0.04, 2.0, zf - zb, { x: bx, y: F + 0.15, z: (zb + zf) / 2 }, 0x2a2c32);
      k.box(0.02, 2.0, 0.02, { x: bx + 0.04, y: F + 0.15, z: zf - 0.05 }, 0xffffff, { glow: 1.8 });
      const levels = [0.16, 0.56, 0.96, 1.36, 1.76];
      levels.forEach((y, li) => {
        k.box(bayW - 0.06, 0.02, zf - zb - 0.12, { x: cx, y: F + y - 0.02, z: (zb + zf) / 2 }, 0xcfd4dc);
        prices.box(bayW - 0.06, 0.03, 0.006, { x: cx, y: F + y - 0.035, z: zf - 0.06 }, 0xffffff, { tex: A.sub('price', 0, 0, 0.5, 1) });
        const kinds: Array<[GoodKind, number]> =
          i < 6 ? [['bottle', (i * 3 + li) % 8]] : i < 8 ? [['can', (i * 2 + li) % 8]] : [['bottle', li % 2 ? 5 : 7]];
        const [kind, v] = kinds[0] as [GoodKind, number];
        // 两排：前排能拿，后排只是让柜子看起来满
        gk.push({ x: 0, y: F, z: 0 });
        row(W, gk, cart, kind, v, bx + 0.06, bx + bayW - 0.04, y, zf - 0.08);
        gk.pop();
        const [w, , d] = SIZE[kind];
        for (let x = bx + 0.06 + w / 2; x < bx + bayW - 0.04 - w / 2; x += w + 0.012) good(W, gk, kind, v, x, F + y, zf - 0.1 - d * 1.6);
      });
      // 玻璃门：转轴在左边，往外（+Z）开
      const door = new Group();
      const dk = W.kit();
      dk.shadows = false;
      dk.box(0.04, 2.0, 0.04, { x: 0.02, y: 0 }, 0x24262c);
      dk.box(0.04, 2.0, 0.04, { x: bayW - 0.06, y: 0 }, 0x24262c);
      dk.box(bayW - 0.04, 0.05, 0.04, { x: bayW / 2 - 0.02, y: 0 }, 0x24262c);
      dk.box(bayW - 0.04, 0.05, 0.04, { x: bayW / 2 - 0.02, y: 1.95 }, 0x24262c);
      dk.box(0.025, 0.8, 0.025, { x: bayW - 0.12, y: 0.7, z: 0.05 }, 0xb8bcc4); // 把手
      door.add(dk.build('coolerDoor'));
      glass.box(bayW - 0.1, 1.9, 0.01, { x: bayW / 2 - 0.02, y: 0.05 }, 0xffffff);
      const gd = glassGroup(glass.build());
      door.add(gd);
      door.position.set(bx + 0.02, F + 0.15, zf + 0.02);
      W.add(door);
      const sw: Swing = { g: door, open: 0, want: 0, max: 1.75, auto: 8, autoT: 0 };
      swings.push(sw);
      const closedBox = box3(bx, F + 0.15, zf - 0.02, bx + bayW, F + 2.15, zf + 0.08);
      W.interact({
        box: closedBox,
        label: () => (sw.want ? '' : '打开冷柜门'),
        on: () => !sw.want,
        use: () => {
          sw.want = 1;
          sw.autoT = sw.auto;
          W.sfx.click();
        },
      });
      // 门开着的时候：门板本身也能点，点了就关上
      const openBox = box3(bx - 0.04, F + 0.15, zf, bx + 0.08, F + 2.15, zf + bayW);
      W.interact({
        box: openBox,
        label: () => '关上冷柜门',
        on: () => sw.want === 1 && sw.open > 0.9,
        use: () => {
          sw.want = 0;
          W.sfx.click();
        },
      });
      // 门没开的时候里面的商品拿不到：用一个随门开关的"墙"挡住拾取射线
      const shield = W.walls.add(bx, F + 0.15, zf + 0.0, bx + bayW, F + 2.15, zf + 0.01);
      W.tick.push(() => {
        shield.on = sw.open < 0.5;
      });
    }
    W.add(glass.build());
    W.add(gk.build('coolerGoods'));
    W.solids.add(x0, F, zb, xEnd, F + 2.6, zf + 0.05);
  }

  // ================================================================ 便当 / 饭团冷藏柜（西墙，开放式）
  {
    const gk = W.kit();
    gk.shadows = false;
    const len = 6.4;
    k.push({ x: -7.8, y: F, z: -6.9, ry: PI / 2 });
    gk.push({ x: -7.8, y: F, z: -6.9, ry: PI / 2 });
    k.box(len, 0.15, 0.75, { z: 0.375 }, 0x2a2e36);
    k.box(len, 0.6, 0.75, { y: 0.15, z: 0.375 }, 0xf0f0ec);
    k.box(len, 0.05, 0.02, { y: 0.4, z: 0.75 }, 0x24b0a0);
    k.box(len, 0.03, 0.02, { y: 0.47, z: 0.75 }, 0xf28a24);
    k.box(len, 0.1, 0.03, { y: 0.75, z: 0.74 }, 0xe0e0e0); // 前挡
    k.box(len, 2.15, 0.06, { z: 0.03 }, 0xe8e8e4); // 背板
    const shelves: Array<[number, number]> = [
      [1.05, 0.55],
      [1.35, 0.46],
      [1.65, 0.38],
    ];
    for (const [y, d] of shelves) {
      k.box(len, 0.025, d, { y: y - 0.025, z: 0.06 + d / 2 }, 0xd8dce2);
      prices.box(len, 0.03, 0.006, { y: y - 0.04, z: 0.06 + d + 0.003 }, 0xffffff, { tex: A.get('price') });
    }
    // 顶棚：灯条 + 分类灯箱
    k.box(len, 0.08, 0.7, { y: 2.0, z: 0.35 }, 0xf0f0ec);
    k.box(len - 0.1, 0.02, 0.06, { y: 1.98, z: 0.55 }, 0xffffff, { glow: 2.2 });
    for (let i = 0; i < 4; i++) k.box(1.5, 0.24, 0.01, { x: -2.4 + i * 1.6, y: 2.08, z: 0.71 }, 0xffffff, { tex: A.get(`cat${[1, 2, 9, 1][i]}`), glow: 1.1 });
    for (const x of [-len / 2, len / 2]) k.box(0.04, 2.15, 0.75, { x, z: 0.375 }, 0xe0e0e0);
    // 便当：平放在下层，两排
    for (const zz of [0.48, 0.66]) row(W, gk, cart, 'bento', (i) => (i + (zz > 0.5 ? 2 : 0)) % 4, -len / 2 + 0.05, len / 2 - 0.05, 0.75, zz + 0.075, 0.03);
    // 饭团（三层板最下面）、三明治 = 面包、甜点
    row(W, gk, cart, 'onigiri', (i) => Math.floor(i / 3) % 6, -len / 2 + 0.05, len / 2 - 0.05, 1.05, 0.06 + 0.5);
    row(W, gk, cart, 'bread', (i) => (Math.floor(i / 4) + 1) % 5, -len / 2 + 0.05, len / 2 - 0.05, 1.35, 0.06 + 0.42);
    row(W, gk, cart, 'sweet', (i) => Math.floor(i / 5) % 2, -len / 2 + 0.05, len / 2 - 0.05, 1.65, 0.06 + 0.34);
    k.pop();
    gk.pop();
    W.add(gk.build('deliGoods'));
    W.solids.add(-7.8, F, -10.1, -7.05, F + 2.1, -3.7);
  }

  // ================================================================ 杂志架（沿正面窗户，朝店里）
  {
    const gk = W.kit();
    gk.shadows = false;
    const len = 5.6;
    k.push({ x: -4.6, y: F, z: -2.12, ry: PI });
    gk.push({ x: -4.6, y: F, z: -2.12, ry: PI });
    k.box(len, 0.35, 0.5, { z: 0.25 }, 0x2a2e36);
    k.box(len, 0.02, 0.02, { y: 0.33, z: 0.5 }, 0x24b0a0);
    for (let t = 0; t < 3; t++) {
      const y = 0.35 + t * 0.24;
      const z = 0.45 - t * 0.14;
      k.box(len, 0.025, 0.14, { y, z: z - 0.07 }, 0xf0f0ec);
      k.box(len, 0.06, 0.012, { y, z }, 0xf0f0ec);
      // 杂志：往后靠着，一本挨一本
      let i = 0;
      for (let x = -len / 2 + 0.14; x < len / 2 - 0.1; x += 0.22) {
        const v = (i * 3 + t * 5) % 8;
        const m = good(W, gk, 'mag', v, x, y + 0.02, z - 0.03, -0.3);
        shelfItem(W, gk, m, goodInfo('mag', v), cart);
        i++;
      }
    }
    k.box(len, 1.08, 0.03, { z: 0.015 }, 0xe8e8e4);
    k.pop();
    gk.pop();
    W.add(gk.build('mags'));
    W.solids.add(-7.4, F, -2.65, -1.8, F + 1.1, -2.1);
  }

  buildCounter(W, k, cart, steam, swings);
  buildBackCorner(W, k, cart, swings);

  // 地面导视："こちらにお並びください"脚印
  k.plane(1.0, 0.5, { x: 3.5, y: F + 0.012, z: -6.4, rx: -PI / 2, rz: -PI / 2 }, 0xffffff, { tex: A.get('queue') });
  k.plane(0.6, 0.3, { x: 3.5, y: F + 0.012, z: -5.2, rx: -PI / 2, rz: -PI / 2 }, 0xffffff, { tex: A.get('queue') });

  const fixtureFallback = k.build('fixtures');
  W.add(fixtureFallback);
  loadBlenderFixtures(W, fixtureFallback);
  W.add(prices.build('prices'));
  swingTick(W, swings);
  W.tick.push((dt) => cart.update(dt));
  return { cart };
}

// ================================================================ 收银台一带
function buildCounter(W: World, k: Kit, cart: Cart, steam: Steam, swings: Swing[]): void {
  const A = W.atlas;
  const cx0 = 4.2;
  const cx1 = 4.9;
  const cz0 = -8.6;
  const cz1 = -3.2;
  const top = F + 1.0;
  const midZ = (cz0 + cz1) / 2;
  // 柜台本体（正面朝西）
  k.box(cx1 - cx0, 0.95, cz1 - cz0, { x: (cx0 + cx1) / 2, y: F, z: midZ }, 0xeeeeea);
  k.box(0.02, 0.1, cz1 - cz0, { x: cx0 - 0.005, y: F, z: midZ }, 0x2a2e36);
  k.box(0.02, 0.06, cz1 - cz0, { x: cx0 - 0.005, y: F + 0.62, z: midZ }, 0x1d3d8f);
  k.box(0.02, 0.04, cz1 - cz0, { x: cx0 - 0.005, y: F + 0.55, z: midZ }, 0x24b0a0);
  k.box(0.02, 0.04, cz1 - cz0, { x: cx0 - 0.005, y: F + 0.5, z: midZ }, 0xf28a24);
  k.box(cx1 - cx0 + 0.1, 0.05, cz1 - cz0 + 0.06, { x: (cx0 + cx1) / 2 - 0.04, y: F + 0.95, z: midZ }, 0xc8a070);
  W.solids.add(cx0 - 0.05, F, cz0, cx1, top, cz1);

  // 收银机 ×2（屏幕朝店员，客显朝顾客）
  for (const z of [-5.8, -7.0]) {
    k.push({ x: 4.6, y: top, z, ry: PI / 2 });
    k.box(0.4, 0.1, 0.32, {}, 0x2a2c30);
    k.box(0.36, 0.05, 0.22, { y: 0.1, z: 0.02 }, 0x3a3c42);
    k.push({ y: 0.15, z: 0.08, rx: -0.4 });
    k.box(0.34, 0.24, 0.03, {}, 0x1a1a1e);
    k.pop();
    k.push({ y: 0.15, z: -0.1, rx: 0.35, ry: PI });
    k.box(0.22, 0.16, 0.025, {}, 0x1a1a1e);
    k.plane(0.18, 0.13, { y: 0.08, z: 0.014 }, 0xffffff, { tex: A.get('regScr'), glow: 1.2 });
    k.pop();
    // 扫码器：红色的扫描光
    k.box(0.12, 0.06, 0.1, { x: 0.28, y: 0 }, 0x1a1a1e);
    k.box(0.08, 0.004, 0.06, { x: 0.28, y: 0.061 }, 0xff2020, { glow: 2 });
    // 钱盘、零钱托盘
    k.box(0.16, 0.012, 0.12, { x: -0.3, y: 0, z: -0.05 }, 0x2a6ac8);
    k.pop();
    W.interact({
      box: box3(4.25, top - 0.02, z - 0.25, 4.9, top + 0.45, z + 0.25),
      label: () => (cart.unpaid ? `结账  ${cart.unpaid} 件  ¥${cart.total}` : '收银台（先去拿点东西吧）'),
      use: () => {
        if (!cart.unpaid) {
          W.say('「いらっしゃいませ〜」');
          W.sfx.beep();
          return;
        }
        const total = cart.total;
        const n = cart.pay();
        W.sfx.register(Math.min(n, 8));
        W.say(`¥${total} お預かりします…  ありがとうございました！（已结账 ${n} 件）`);
      },
    });
  }
  // "レジ"吊牌
  k.push({ x: 3.9, y: 2.5, z: -6.4, ry: PI / 2 });
  k.box(0.9, 0.34, 0.03, {}, 0xffffff, { tex: A.get('regi'), faces: ['pz', 'nz'], glow: 1.05 });
  for (const s of [-0.38, 0.38]) k.box(0.01, STORE.ceil - 2.84, 0.01, { x: s, y: 0.34 }, 0x777777);
  k.pop();

  // 热食柜：暖光玻璃箱，里面一排排炸鸡块
  {
    const z = -4.6;
    const gl = glassKit(W, 0xfff0d8, 0.1, false);
    k.box(0.5, 0.04, 0.6, { x: 4.55, y: top, z }, 0x2a2a2a);
    k.box(0.5, 0.03, 0.6, { x: 4.55, y: top + 0.42, z }, 0x2a2a2a);
    k.box(0.48, 0.02, 0.58, { x: 4.55, y: top + 0.04, z }, 0xffe0a0, { glow: 1.4 });
    k.box(0.46, 0.008, 0.56, { x: 4.55, y: top + 0.41, z }, 0xfff0c0, { glow: 2.2 });
    k.box(0.02, 0.12, 0.62, { x: 4.29, y: top - 0.12, z }, 0xffffff, { tex: A.sub('hot', 0, 0, 1, 1) });
    k.box(0.4, 0.015, 0.5, { x: 4.55, y: top + 0.22, z }, 0xc8ccd4);
    for (let i = 0; i < 18; i++) {
      const y = i < 9 ? top + 0.06 : top + 0.235;
      k.sphere(0.035, { x: 4.42 + (i % 3) * 0.1, y: y + 0.03, z: z - 0.2 + (Math.floor(i / 3) % 3) * 0.15 }, i % 4 ? 0xc87a30 : 0xe8a040, { seg: 7, sy: 0.75 });
    }
    gl.box(0.5, 0.38, 0.6, { x: 4.55, y: top + 0.04, z }, 0xffffff);
    W.add(glassGroup(gl.build()));
    // 店里的菜单板
    k.box(0.02, 0.3, 0.8, { x: 4.92, y: top + 0.7, z }, 0xffffff, { tex: A.get('menu'), faces: ['nx'] });
    const kara: Good = { kind: 'bento', v: 0, name: 'からあげ（5個入）', price: 238 };
    W.interact({
      box: box3(4.28, top, z - 0.3, 4.82, top + 0.45, z + 0.3),
      label: () => '买一份热乎乎的炸鸡块  ¥238',
      use: () => {
        cart.add(kara);
        W.sfx.pick();
        W.say('「からあげ、お一つですね」');
      },
    });
  }

  // 关东煮：不锈钢锅 + 汤面（贴图）+ 热气 + 可以掀开的盖子
  {
    const z = -8.05;
    k.box(0.5, 0.18, 0.44, { x: 4.55, y: top, z }, 0xc8ccd4);
    k.box(0.44, 0.01, 0.38, { x: 4.55, y: top + 0.17, z }, 0xffffff, { tex: A.get('oden'), faces: ['py'] });
    for (const zz of [-0.07, 0.07]) k.box(0.44, 0.02, 0.01, { x: 4.55, y: top + 0.17, z: z + zz }, 0xa8acb4);
    k.box(0.02, 0.06, 0.46, { x: 4.29, y: top + 0.08, z }, 0xd8202a);
    const lid = new Group();
    const lk = W.kit();
    lk.box(0.24, 0.015, 0.44, { x: 0.12 }, 0xd8dce4);
    lk.box(0.03, 0.03, 0.12, { x: 0.12, y: 0.015 }, 0x333333);
    lid.add(lk.build('lid'));
    lid.position.set(4.55, top + 0.185, z);
    W.add(lid);
    let lidOpen = false;
    steam.emit(new Vector3(4.5, top + 0.2, z), 4, () => true, 0.3);
    const oden: Good = { kind: 'bento', v: 0, name: 'おでん（大根・たまご）', price: 210 };
    W.interact({
      box: box3(4.28, top, z - 0.24, 4.82, top + 0.3, z + 0.24),
      label: () => (lidOpen ? '盛一碗关东煮  ¥210' : '掀开关东煮的盖子'),
      use: () => {
        if (!lidOpen) {
          lidOpen = true;
          W.sfx.click();
        } else {
          cart.add(oden);
          W.sfx.plop();
          W.say('「おでん、からしはお付けしますか？」');
        }
      },
    });
    W.tick.push((dt) => {
      const tx = lidOpen ? -0.22 : 0;
      lid.position.x += (4.55 + tx - lid.position.x) * Math.min(1, dt * 6);
    });
  }

  // 咖啡机：自助。按一下 → 放杯子、出咖啡（3 秒）、冒热气，咖啡进购物袋
  {
    const z = -3.6;
    k.push({ x: 4.6, y: top, z, ry: -PI / 2 });
    k.box(0.42, 0.62, 0.4, {}, 0x1e1e22);
    k.box(0.4, 0.3, 0.01, { y: 0.3, z: 0.2 }, 0xffffff, { tex: A.get('coffee') });
    k.box(0.3, 0.06, 0.2, { y: 0.18, z: 0.12 }, 0x2a2a2e);
    k.cyl(0.015, 0.015, 0.04, 6, { y: 0.14, z: 0.14 }, 0x888888);
    k.box(0.3, 0.02, 0.2, { y: 0.0, z: 0.12 }, 0x5a5a60);
    k.box(0.05, 0.02, 0.01, { x: 0.15, y: 0.55, z: 0.205 }, 0x30ff80, { glow: 2 });
    // 旁边的杯子塔、吸管、糖包
    for (let i = 0; i < 6; i++) k.cyl(0.042, 0.032, 0.1, 10, { x: -0.38, y: i * 0.025, z: 0.05 }, 0xfafafa, { open: true });
    k.box(0.12, 0.08, 0.1, { x: 0.36, y: 0, z: 0.05 }, 0xc8a070);
    k.pop();
    const cup = new Group();
    const ck = W.kit();
    ck.cyl(0.04, 0.03, 0.1, 10, {}, 0xfafafa);
    ck.box(0.08, 0.03, 0.002, { y: 0.04, z: 0.0405 }, 0xc83a2a);
    cup.add(ck.build('cup'));
    cup.position.set(4.48, top + 0.02, z);
    cup.visible = false;
    W.add(cup);
    let brew = -1;
    steam.emit(new Vector3(4.48, top + 0.13, z), 6, () => brew > 0, 0.04);
    const coffee: Good = { kind: 'cup', v: 0, name: 'ホットコーヒー S', price: 100 };
    W.interact({
      box: box3(4.38, top, z - 0.3, 4.82, top + 0.62, z + 0.3),
      label: () => (brew > 0 ? '咖啡正在出杯…' : '自助咖啡  ホット S  ¥100'),
      use: () => {
        if (brew > 0) return;
        brew = 3.2;
        cup.visible = true;
        W.sfx.pour();
      },
    });
    W.tick.push((dt) => {
      if (brew <= 0) return;
      brew -= dt;
      if (brew <= 0) {
        cup.visible = false;
        cart.add(coffee);
        W.sfx.beep();
        W.say('咖啡好了（已放进购物袋，记得去收银台结账）');
      }
    });
  }

  // 店员一侧：烟柜（东墙）+ 后面的工作台
  k.push({ x: 6.79, y: F, z: -5.8, ry: -PI / 2 });
  k.box(2.6, 1.3, 0.25, { y: 0.9 }, 0x1a1a1c);
  k.box(2.5, 1.2, 0.01, { y: 0.95, z: 0.126 }, 0xffffff, { tex: A.get('cigs'), glow: 1.0 });
  k.box(2.6, 0.9, 0.5, {}, 0xe8e8e4);
  k.box(0.3, 0.3, 0.02, { x: 1.6, y: 2.3 }, 0xffffff, { tex: A.get('clock') });
  // 购物袋、打印机、零钱
  k.box(0.3, 0.25, 0.04, { x: -0.8, y: 0.9, z: 0.3 }, 0xf8f8f8);
  k.box(0.32, 0.2, 0.28, { x: 0.6, y: 0.9, z: 0.2 }, 0x3a3a40);
  k.pop();
  W.solids.add(6.3, F, -7.1, 6.8, F + 2.2, -4.5);
  // 柜台和墙之间的门帘（员工通道入口：柜台北头）
  k.box(0.02, 0.1, 0.02, { x: 4.6, y: STORE.ceil - 0.1, z: -8.9 }, 0x777777);

  void swings;
}

// ================================================================ 东北角：ATM、复印机、快递柜、冰柜、员工门
function buildBackCorner(W: World, k: Kit, cart: Cart, swings: Swing[]): void {
  const A = W.atlas;
  const zb = -11.8;
  // ATM
  {
    k.push({ x: 2.5, y: F, z: zb });
    k.box(0.62, 1.55, 0.5, { z: 0.25 }, 0xe8e8e4);
    k.box(0.6, 1.0, 0.01, { y: 0.5, z: 0.505 }, 0xffffff, { tex: A.sub('atm', 0, 0.12, 1, 1) });
    k.push({ y: 0.95, z: 0.55, rx: 0.5 });
    k.box(0.5, 0.02, 0.14, {}, 0xd0d0cc);
    k.pop();
    k.box(0.62, 0.22, 0.04, { y: 1.55, z: 0.48 }, 0xd8202a, { glow: 1.3 });
    k.pop();
    const sk = W.kit();
    const scr = [sk.mark(), sk.plane(0.44, 0.27, { x: 2.5, y: F + 1.25, z: zb + 0.512 }, 0xffffff, { tex: A.get('atmScr0'), glow: 1.15 }).end()];
    const scr2 = sk.mark().plane(0.44, 0.27, { x: 2.5, y: F + 1.25, z: zb + 0.514 }, 0xffffff, { tex: A.get('atmScr1'), glow: 1.15 }).end();
    void scr;
    W.add(sk.build('atmScreen'));
    sk.setHidden(scr2, true);
    let t = -1;
    W.interact({
      box: box3(2.19, F, zb, 2.81, F + 1.6, zb + 0.6),
      label: () => 'ATM  查询余额',
      use: () => {
        sk.setHidden(scr2, false);
        t = 4;
        W.sfx.beep();
        W.sfx.beep(0.15);
      },
    });
    W.tick.push((dt) => {
      if (t < 0) return;
      t -= dt;
      if (t < 0) sk.setHidden(scr2, true);
    });
    W.solids.add(2.19, F, zb, 2.81, F + 1.6, zb + 0.55);
  }
  // 复印机：按一下吐出一张纸
  {
    k.push({ x: 3.45, y: F, z: zb });
    k.box(0.9, 0.95, 0.6, { z: 0.3 }, 0xf0f0ec);
    k.box(0.88, 0.5, 0.01, { y: 0.4, z: 0.605 }, 0xffffff, { tex: A.get('copier') });
    k.box(0.86, 0.05, 0.56, { y: 0.95, z: 0.3 }, 0x5a5a60);
    k.box(0.3, 0.02, 0.2, { x: 0.55, y: 0.6, z: 0.35 }, 0xd8d8d8);
    k.pop();
    const paper = new Group();
    const pk = W.kit();
    pk.box(0.21, 0.003, 0.297, {}, 0xffffff);
    paper.add(pk.build('paper'));
    paper.position.set(3.45 + 0.55, F + 0.62, zb + 0.35);
    paper.visible = false;
    W.add(paper);
    let p = -1;
    W.interact({
      box: box3(3.0, F, zb, 3.9, F + 1.0, zb + 0.62),
      label: () => '复印机  打印一张',
      use: () => {
        p = 0;
        paper.visible = true;
        W.sfx.swing();
      },
    });
    W.tick.push((dt) => {
      if (p < 0) return;
      p += dt;
      paper.position.x = 3.45 + 0.3 + Math.min(1, p / 1.5) * 0.25;
      if (p > 6) {
        p = -1;
        paper.visible = false;
      }
    });
    W.solids.add(3.0, F, zb, 3.9, F + 1.0, zb + 0.62);
  }
  // 快递柜：3 列 × 5 行的小门，每个都能开
  {
    const x0 = 4.12;
    const w = 0.96;
    k.push({ x: x0 + w / 2, y: F, z: zb });
    k.box(w, 1.95, 0.5, { z: 0.25 }, 0xc8cacc);
    k.box(w, 0.24, 0.01, { y: 1.95 - 0.24, z: 0.505 }, 0xffffff, { tex: A.sub('lockers', 0, 0.88, 1, 1), glow: 1.05 });
    k.box(0.22, 0.3, 0.01, { y: 0.9, z: 0.506 }, 0x1a1a2a);
    k.box(0.18, 0.18, 0.01, { y: 0.96, z: 0.51 }, 0x40a0ff, { glow: 1.3 });
    k.pop();
    const cw = w / 3;
    const ch = 1.66 / 5;
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 5; r++) {
        if (c === 1 && (r === 2 || r === 3)) continue; // 中间是操作屏
        const g = new Group();
        const dk = W.kit();
        dk.shadows = false;
        dk.box(cw - 0.012, ch - 0.012, 0.02, { x: (cw - 0.012) / 2, y: 0 }, 0xdcdee0);
        dk.box(0.012, 0.06, 0.02, { x: cw - 0.05, y: ch / 2 - 0.03, z: 0.015 }, 0x555555);
        dk.box(0.02, 0.02, 0.004, { x: cw - 0.05, y: ch - 0.06, z: 0.012 }, (c + r) % 3 ? 0x30ff60 : 0xff3030, { glow: 2 });
        g.add(dk.build('locker'));
        const lx = x0 + c * cw + 0.006;
        const ly = F + 0.05 + r * ch;
        g.position.set(lx, ly, zb + 0.5);
        W.add(g);
        const sw: Swing = { g, open: 0, want: 0, max: 1.9, auto: 6, autoT: 0 };
        swings.push(sw);
        W.interact({
          box: box3(lx, ly, zb + 0.45, lx + cw, ly + ch, zb + 0.56),
          label: () => (sw.want ? '关上柜门' : `打开 ${r * 3 + c + 1} 号快递柜`),
          use: () => {
            sw.want = sw.want ? 0 : 1;
            sw.autoT = sw.auto;
            W.sfx.click();
          },
        });
      }
    }
    W.solids.add(x0, F, zb, x0 + w, F + 1.95, zb + 0.5);
  }
  // 冰柜：平放的卧式冰柜，玻璃盖左右滑开
  {
    const x0 = 2.3;
    const x1 = 3.6;
    const z0 = -9.4;
    const z1 = -8.5;
    const h = 0.85;
    k.box(x1 - x0, h, z1 - z0, { x: (x0 + x1) / 2, y: F, z: (z0 + z1) / 2 }, 0xf0f2f4);
    k.box(x1 - x0 + 0.01, 0.12, z1 - z0 + 0.01, { x: (x0 + x1) / 2, y: F + 0.3, z: (z0 + z1) / 2 }, 0x2a6ac8);
    k.box(x1 - x0 - 0.1, 0.01, z1 - z0 - 0.1, { x: (x0 + x1) / 2, y: F + h - 0.15, z: (z0 + z1) / 2 }, 0xffffff, { tex: A.get('ice'), faces: ['py'] });
    k.box(0.5, 0.18, 0.02, { x: (x0 + x1) / 2, y: F + h + 0.1, z: z0 + 0.1 }, 0xffffff, { tex: A.get('cat6'), faces: ['pz', 'nz'] });
    const lids: Group[] = [];
    for (const s of [0, 1]) {
      const g = new Group();
      const gk = glassKit(W, 0xe0f4ff, 0.16, false);
      gk.box((x1 - x0) / 2, 0.015, z1 - z0 - 0.04, {}, 0xffffff);
      g.add(glassGroup(gk.build()));
      const fr = W.kit();
      fr.box((x1 - x0) / 2, 0.025, 0.03, { z: (z1 - z0) / 2 - 0.035 }, 0x9aa0a8);
      fr.box((x1 - x0) / 2, 0.025, 0.03, { z: -(z1 - z0) / 2 + 0.035 }, 0x9aa0a8);
      g.add(fr.build());
      g.position.set(x0 + (x1 - x0) * (s ? 0.75 : 0.25), F + h + (s ? 0.02 : 0), (z0 + z1) / 2);
      W.add(g);
      lids.push(g);
    }
    let open = 0;
    let want = 0;
    W.tick.push((dt) => {
      open += Math.sign(want - open) * Math.min(Math.abs(want - open), dt * 2.5);
      (lids[0] as Group).position.x = x0 + (x1 - x0) * (0.25 + 0.48 * open);
    });
    W.interact({
      box: box3(x0, F, z0, x1, F + h + 0.05, z1),
      label: () => (want ? (open > 0.9 ? '拿一支冰淇淋  ¥160' : '') : '滑开冰柜的盖子'),
      use: () => {
        if (!want) {
          want = 1;
          W.sfx.swing();
        } else if (open > 0.9) {
          cart.add(goodInfo('ice', 0));
          W.sfx.pick();
          want = 0;
          setTimeout(() => W.sfx.swing(), 200);
        }
      },
    });
    W.solids.add(x0, F, z0, x1, F + h + 0.04, z1);
  }
  // 员工门：后墙门洞，往店里开，通到后院
  {
    const { x0, x1 } = BACK_DOOR;
    const g = new Group();
    const dk = W.kit();
    dk.shadows = false;
    dk.box(x1 - x0 - 0.04, 1.96, 0.05, { x: (x1 - x0 - 0.04) / 2 }, 0x8a9098);
    dk.box(0.18, 0.06, 0.012, { x: x1 - x0 - 0.18, y: 1.0, z: 0.03 }, 0xc8ccd4);
    dk.box(0.3, 0.1, 0.006, { x: (x1 - x0) / 2, y: 1.5, z: 0.03 }, 0xffffff, { tex: A.get('staff') });
    dk.box(0.3, 0.3, 0.006, { x: (x1 - x0) / 2, y: 1.3, z: -0.03 }, 0xd8d8d0);
    g.add(dk.build('backDoor'));
    g.position.set(x0 + 0.02, F, -12 + 0.17);
    W.add(g);
    const solid = W.solids.add(x0, F, -12, x1, 2.3, -11.8);
    const sw: Swing = { g, open: 0, want: 0, max: 1.6, auto: -1, autoT: 0 };
    swings.push(sw);
    W.interact({
      box: box3(x0, F, -12.05, x1, 2.3, -11.75),
      label: () => (sw.want ? '关上员工门' : '打开员工门（去后院）'),
      use: () => {
        sw.want = sw.want ? 0 : 1;
        solid.on = !sw.want;
        W.sfx.swing();
      },
    });
    // 门开着的时候，人从门洞穿过去；门板转到墙边不挡路
    W.tick.push(() => {
      solid.on = sw.open < 0.6;
    });
    // 非常口指示灯
    k.box(0.4, 0.13, 0.04, { x: (x0 + x1) / 2, y: 2.4, z: -11.78 }, 0xffffff, { tex: A.get('exit'), glow: 1.6 });
  }
  // 员工区的折叠梯、纸箱
  k.box(0.5, 0.4, 0.4, { x: 6.4, y: F, z: -10.4 }, 0xc8a070);
  k.box(0.45, 0.3, 0.38, { x: 6.42, y: F + 0.4, z: -10.42 }, 0xb8905a);
  W.solids.add(6.15, F, -10.6, 6.65, F + 0.7, -10.2);
  void cart;
}

export const _b = new Box3();
