import { turn } from '../../game/world/modules';
import { BED_FRAME, CHAIRS, DAY_BED, DRESS, FRONT_X, FURN, HOUSES, KINDS, LOCKER, SKIN_IN, SMALL_SHELVES, STANDS, deckOf, type Deck, type HouseId, type HousePlan, type Item, type Piece, type RoofPart, type RoomKind, type Theme } from './houses';
import type { LootPlace } from '../game/items';
import type { Box, Circle } from './colliders';
import type { Builder, Door, RoofTex, Skin, SlabTex } from './sites';

/**
 * 按平面图（houses.ts）搭一栋房子。
 *
 * 墙：平面图里墙占一格（方便画图、算连通），搭出来是格子中线上的一道薄墙——外墙 26 厘米、隔墙 14 厘米。
 *   横竖两个方向各自连成「墙线」，转角归横墙、丁字口归穿过去的那道墙，所以没有重叠的面、没有缝。
 *   外墙朝外一面是外墙材质，朝屋里一面是那个房间的墙面（墙纸 / 抹灰），每个房间各刷各的颜色。
 * 门窗：窗有窗框、窗台、玻璃（碎了的没有、有的钉着木板）；门有门框和开着的门扇；宽门是卷帘门或者推拉的谷仓门。
 * 屋顶：一栋房子可以由几块拼成（主屋双坡 + 侧翼 + 单坡的披屋 + 平顶女儿墙），门廊、车棚是柱子撑着的单坡顶。
 * 屋里：平面图里画的大件家具 → 墙边少量杂物 → 墙上的挂件 → 地毯、吊灯 → 战利品的位置（桌上、架子上、床上、墙角）。
 * 方向的约定：0 北（-z）1 东（+x）2 南（+z）3 西（-x）；f = 这件东西的正面朝哪边；模型的正面是 +Z。
 */

export interface HouseOpts {
  skin?: Skin;
  tint?: number;
  /** 内墙面（null = 不做，屋里直接是外墙的材质） */
  inner?: Skin | null;
  /** 屋面的材质和颜色 */
  roofTex?: RoofTex;
  rtint?: number;
  /** 换一套摆设（军事基地里的仓库放的是军用物资） */
  theme?: Theme;
  /** 窗户钉木板的比例 */
  board?: number;
  /** 左右镜像（同一种房子在街上不会一模一样） */
  mirror?: boolean;
  /** 门窗框的颜色 */
  trim?: number;
}

/**
 * 搭完以后告诉模板（都是地块的本地坐标）：墙的外轮廓、整张平面图占的范围（含门廊、车棚）、
 * 每扇外门（s = 门朝哪边开：0 后 1 右 2 前 3 左，n = 门宽几格）、车棚
 */
export interface HouseOut {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  gx0: number;
  gz0: number;
  gx1: number;
  gz1: number;
  doors: Array<{ x: number; z: number; s: number; n: number }>;
  ports: Array<{ x0: number; z0: number; x1: number; z1: number }>;
}

/** 外墙、隔墙的厚度 */
export const T_OUT = 0.26;
const T_IN = 0.14;

const dx = (f: number): number => (f === 1 ? 1 : f === 3 ? -1 : 0);
const dz = (f: number): number => (f === 0 ? -1 : f === 2 ? 1 : 0);
/** 「沿墙」的方向（模型的 +X 转过去以后） */
const wx = (f: number): number => (f === 2 ? 1 : f === 0 ? -1 : 0);
const wz = (f: number): number => (f === 3 ? 1 : f === 1 ? -1 : 0);
const ryOf = (f: number): number => (-(f - 2) * Math.PI) / 2;

const WALLPAPER = [0xffffff, 0xe6ddc8, 0xd4dccd, 0xd2d8e0, 0xe6d2c8, 0xdcd6c4, 0xcfd8c8, 0xe2d6b8];
const PLASTER_IN = [0xf2efe6, 0xe9e4d6, 0xdfe5e0, 0xe8e0d8];
const DOOR_TINT = [0xb48e66, 0x93a48c, 0x9cacb8, 0xbc7e68, 0xdcd5c5, 0xa08062];
const AWNING = [0xb83a30, 0x2f6a4a, 0x2c4a78, 0xc49a3a, 0x7a3a34];
const PLINTH = 0xb4b0a8;

const isSolid = (c: string): boolean => c === '#' || c === '|' || c === 'R';
const isWin = (c: string): boolean => c === 'W' || c === 'G' || c === 'H';
const isDoor = (c: string): boolean => c === 'D' || c === 'd';
const shell = (c: string): boolean => isSolid(c) || isWin(c) || isDoor(c);
const porchy = (c: string): boolean => c === 'p' || c === 'y';
const inside = (c: string): boolean => c !== ' ' && !shell(c) && !porchy(c);
/** 家具可以靠着的（实墙、窗下的墙） */
const wallish = (c: string): boolean => isSolid(c) || isWin(c);

/** 房子占多大（格 = 米）：[宽, 进深, 正面有几行是门廊] */
export function houseDims(id: HouseId): [number, number, number] {
  const rows = (HOUSES[id] as HousePlan).rows;
  let porch = 0;
  for (let z = rows.length - 1; z >= 0 && ![...(rows[z] as string)].some(shell); z--) porch++;
  return [Math.max(...rows.map((s) => s.length)), rows.length, porch];
}

/** 正门（正面那道墙上的第一扇外门）在第几列（格子中心，镜像以后的） */
export function houseDoor(id: HouseId, mirror = false): number {
  const rows = (HOUSES[id] as HousePlan).rows;
  const [w, d, porch] = houseDims(id);
  const x = (rows[d - 1 - porch] as string).indexOf('D');
  const c = x < 0 ? w / 2 : x + 0.5;
  return mirror ? w - c : c;
}

interface Placed {
  p: Piece;
  cx: number;
  cz: number;
  f: number;
  W: number;
  D: number;
  sy: number;
  top: number;
}

interface Chain {
  horiz: boolean;
  line: number;
  a: number;
  b: number;
  T: number;
}

type Face = readonly [Skin, number];

/** 在本地 (lx, lz)（左后角）搭一栋房子，r 0–3 顺时针转 90°；r = 0 时正面（平面图最后一行）朝路 */
export function buildHouse(b: Builder, id: HouseId, lx: number, lz: number, r: number, o: HouseOpts = {}): HouseOut {
  const plan: HousePlan = HOUSES[id];
  const rng = b.rng;
  /** 这栋房子自己的碰撞体从哪儿开始（最后检查战利品够不够得着时只看它们） */
  const box0 = b.cols.boxes.length;
  const circle0 = b.cols.circles.length;
  const H = plan.rows.length;
  const W = Math.max(...plan.rows.map((s) => s.length));
  const R = r & 3;
  const mir = !!o.mirror;
  const PW = R % 2 ? H : W;
  const PH = R % 2 ? W : H;
  /** 平面图的格子 → 转过、镜像过以后的格子；平面图的方向 → 现在的方向 */
  const tr = (x: number, z: number): [number, number] => turn(mir ? W - 1 - x : x, z, W, H, R);
  const sideOf = (s: number): number => ((mir && s % 2 === 1 ? (s + 2) % 4 : s) + R) & 3;
  const grid: string[][] = Array.from({ length: PH }, () => Array<string>(PW).fill(' '));
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const [px, pz] = tr(x, z);
      (grid[pz] as string[])[px] = plan.rows[z]?.[x] ?? ' ';
    }
  }
  const ch = (x: number, z: number): string => grid[z]?.[x] ?? ' ';
  const at = (x: number, z: number): number => z * PW + x;
  const inGrid = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < PW && z < PH;

  const skin = o.skin ?? plan.wall;
  const tint = o.tint ?? 0xffffff;
  const roofless = plan.roof === 'none';
  const inner = roofless ? null : o.inner !== undefined ? o.inner : plan.inner;
  const theme = o.theme ?? plan.theme;
  const h = plan.h;
  /** 地板面的高度（没有地板的废墟：泥地） */
  const F = plan.floor ? 0.04 : -0.02;
  const EXT: Face = [skin, tint];
  /** 没有另做内墙面的房子，墙朝屋里的那一面。废墟没有屋顶，里外一样 */
  const EXT_IN: Face = roofless ? EXT : [SKIN_IN[skin] ?? skin, tint];
  const trimSkin: Skin = skin === 'planks' ? 'planks' : 'plaster';
  const trimTint = o.trim ?? (skin === 'planks' ? 0x8a7a66 : theme === 'mil' || skin === 'metal' ? 0x8f8f88 : 0xe9e5da);
  const roofTex: RoofTex = o.roofTex ?? plan.roofTex ?? (plan.roof === 'metal' ? 'wall_metal' : 'roof_tiles');
  const rtint = o.rtint ?? (roofTex === 'wall_metal' ? 0x9aa09c : 0xffffff);

  // ---------------------------------------------------------------- 屋顶分块、每格的墙高

  interface Part {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    kind: RoofPart['kind'];
    h: number;
    ridgeX: boolean;
    join: number;
    hi: number;
    attach: boolean;
    rise: number;
    ceil: boolean;
    floor: SlabTex | null;
  }
  const rawParts: readonly RoofPart[] = plan.parts ?? [{ r: [0, 0, W - 1, H - 1 - houseDims(id)[2]], kind: plan.roof === 'metal' ? 'gable' : plan.roof }];
  const parts: Part[] = rawParts.map((p) => {
    const [ax, az] = tr(p.r[0], p.r[1]);
    const [bx, bz] = tr(p.r[2], p.r[3]);
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const z0 = Math.min(az, bz);
    const z1 = Math.max(az, bz);
    const ridgeX = p.ridge ? (p.ridge === 'x') === (R % 2 === 0) : x1 - x0 >= z1 - z0;
    const span = (ridgeX ? z1 - z0 : x1 - x0) + T_OUT;
    const metal = roofTex === 'wall_metal' || roofTex === 'rust';
    const rise = p.rise ?? (p.kind === 'shed' ? 0.5 : metal ? Math.min(1.5, span * 0.17) : Math.min(2.5, span * 0.29));
    return { x0, z0, x1, z1, kind: p.kind, h: p.h ?? h, ridgeX, join: p.join === undefined ? -1 : sideOf(p.join), hi: sideOf(p.hi ?? 0), attach: !!p.attach, rise, ceil: p.ceil ?? (plan.roof === 'gable' && p.kind === 'gable'), floor: p.floor ?? null };
  });
  const hGrid = new Float32Array(PW * PH).fill(h);
  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      let m = 0;
      for (const p of parts) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) m = Math.max(m, p.h);
      if (m > 0) hGrid[at(x, z)] = m;
      // 废墟：墙塌得高高低低
      if (roofless && isSolid(ch(x, z))) hGrid[at(x, z)] = h * rng.pick([1, 1, 0.82, 0.62, 0.45]);
    }
  }
  const hAt = (x: number, z: number): number => (inGrid(x, z) ? (hGrid[at(x, z)] as number) : h);
  const partAt = (x: number, z: number): Part | null => {
    let best: Part | null = null;
    for (const p of parts) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && (!best || p.h > best.h)) best = p;
    return best;
  };

  // ---------------------------------------------------------------- 房间

  const roomOf = new Int16Array(PW * PH).fill(-1);
  const rooms: Array<{ cells: Array<[number, number]>; kind: RoomKind; letters: string }> = [];
  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      if (!inside(ch(x, z)) || roomOf[at(x, z)] !== -1) continue;
      const idx = rooms.length;
      const cells: Array<[number, number]> = [];
      let letters = '';
      const stack: Array<[number, number]> = [[x, z]];
      roomOf[at(x, z)] = idx;
      while (stack.length) {
        const [cx, cz] = stack.pop() as [number, number];
        cells.push([cx, cz]);
        const c = ch(cx, cz);
        if (c !== '.' && c !== ',' && !letters.includes(c)) letters += c;
        for (let s = 0; s < 4; s++) {
          const nx = cx + dx(s);
          const nz = cz + dz(s);
          if (!inGrid(nx, nz) || !inside(ch(nx, nz)) || roomOf[at(nx, nz)] !== -1) continue;
          roomOf[at(nx, nz)] = idx;
          stack.push([nx, nz]);
        }
      }
      rooms.push({ cells, kind: 'storage', letters });
    }
  }
  const biggest = rooms.reduce((m, q) => Math.max(m, q.cells.length), 0);
  for (const q of rooms) {
    const has = (s: string): boolean => [...s].some((c) => q.letters.includes(c));
    if (theme === 'home') q.kind = has('b') ? 'bed' : has('koOtsvlafe') ? 'living' : 'storage';
    else if (theme === 'shop') q.kind = has('i') || q.cells.length === biggest ? 'shop' : 'storage';
    else if (theme === 'office') q.kind = 'office';
    else if (theme === 'mil') q.kind = 'mil';
    else q.kind = 'storage';
  }
  const kindAt = (x: number, z: number): RoomKind => rooms[inGrid(x, z) ? (roomOf[at(x, z)] as number) : -1]?.kind ?? 'storage';
  /** 每个房间的墙面：住宅的卧室、客厅各贴各的墙纸，储物间是旧抹灰；别的房子全屋一种 */
  const houseFin: Face | null = inner ? [inner === 'plaster' ? 'plaster_in' : inner, inner === 'wallpaper' ? rng.pick(WALLPAPER) : inner === 'plaster' ? rng.pick(PLASTER_IN) : 0xffffff] : null;
  const fin: Array<Face | null> = rooms.map((q) => {
    if (!houseFin) return null;
    if (theme !== 'home' || inner !== 'wallpaper') return q.kind === 'storage' && theme === 'shop' ? (['plaster_old', 0xffffff] as const) : houseFin;
    if (q.kind === 'bed') return ['wallpaper', rng.pick(WALLPAPER)] as const;
    if (q.kind === 'storage') return ['plaster_old', 0xffffff] as const;
    return q.letters.includes('k') && !q.letters.includes('s') ? (['plaster_in', rng.pick(PLASTER_IN)] as const) : houseFin;
  });

  // ---------------------------------------------------------------- 墙线

  const chains: Chain[] = [];
  const chH = new Int16Array(PW * PH).fill(-1);
  const chV = new Int16Array(PW * PH).fill(-1);
  for (const horiz of [true, false]) {
    const nLine = horiz ? PH : PW;
    const nAcross = horiz ? PW : PH;
    for (let line = 0; line < nLine; line++) {
      let i = 0;
      while (i < nAcross) {
        if (!shell(horiz ? ch(i, line) : ch(line, i))) {
          i++;
          continue;
        }
        let e = i;
        while (e < nAcross && shell(horiz ? ch(e, line) : ch(line, e))) e++;
        if (e - i >= 2) {
          for (let k = i; k < e; k++) (horiz ? chH : chV)[horiz ? at(k, line) : at(line, k)] = chains.length;
          chains.push({ horiz, line, a: i, b: e - 1, T: T_OUT });
        }
        i = e;
      }
    }
  }
  // 墙线多厚：自己独占的那些格子里有外墙 / 门窗 → 外墙；只有隔墙、内门 → 隔墙
  for (const c of chains) {
    let thick = false;
    let thin = false;
    let allHash = true;
    for (let i = c.a; i <= c.b; i++) {
      const q = c.horiz ? ch(i, c.line) : ch(c.line, i);
      if (q !== '#') allHash = false;
      if ((c.horiz ? chV : chH)[c.horiz ? at(i, c.line) : at(c.line, i)] >= 0) continue;
      if (q === '|' || q === 'd') thin = true;
      else thick = true;
    }
    c.T = thick || (!thin && allHash) ? T_OUT : T_IN;
  }
  /** 格子 (x, z) 朝 s 那一侧的墙面比格子的边线靠后多少（那一侧不是墙返回 0） */
  const gapOf = (x: number, z: number, s: number): number => {
    const nx = x + dx(s);
    const nz = z + dz(s);
    if (!inGrid(nx, nz) || !shell(ch(nx, nz))) return 0;
    const k = (s % 2 === 0 ? chH : chV)[at(nx, nz)] as number;
    return 0.5 - (k >= 0 ? (chains[k] as Chain).T : T_OUT) / 2;
  };

  const seg = (horiz: boolean, line: number, v0: number, v1: number, T: number, y0: number, y1: number, sk: Skin, tn: number, neg?: Face, pos?: Face): void => {
    if (v1 - v0 < 0.005 || y1 - y0 < 0.005) return;
    b.seg(horiz, (horiz ? lz : lx) + line, (horiz ? lx : lz) + v0, (horiz ? lx : lz) + v1, T, y0, y1, sk, tn, neg, pos);
  };
  const col = (horiz: boolean, line: number, v0: number, v1: number, T: number, y0: number, y1: number): void => {
    if (v1 - v0 < 0.005 || y1 - y0 < 0.005) return;
    b.box(lx + (horiz ? (v0 + v1) / 2 : line), lz + (horiz ? line : (v0 + v1) / 2), horiz ? (v1 - v0) / 2 : T / 2, horiz ? T / 2 : (v1 - v0) / 2, 0, y0, y1);
  };

  /** 不能再放东西的格子（门口） */
  const reserved = new Uint8Array(PW * PH);
  /** 墙面被门扇占了：`x,z,朝哪面墙` */
  const faceBusy = new Set<string>();
  const doorTint = rng.pick(DOOR_TINT);
  const doorSkin: Skin = theme === 'mil' || skin === 'metal' ? 'shutter' : 'plaster';
  const board = o.board ?? 0.3;
  const doors: Door[] = [];
  const outDoors: HouseOut['doors'] = [];
  const ports: HouseOut['ports'] = [];
  let entry: [number, number] | null = null;
  /** 入口记的是正面的门（没有就用第一扇） */
  let entryFront = false;
  const frontSide = sideOf(2);
  const plinth = plan.plinth !== false && !roofless;

  for (const c of chains) {
    const { horiz, line, a, b: e, T } = c;
    const mid = line + 0.5;
    const cellAt = (i: number): string => (horiz ? ch(i, line) : ch(line, i));
    const perp = (i: number): Chain | null => {
      const k = (horiz ? chV : chH)[horiz ? at(i, line) : at(line, i)] as number;
      return k < 0 ? null : (chains[k] as Chain);
    };
    /** 这一头到哪为止：没有别的墙 → 自己封口；转角归横墙；丁字口顶在对方的墙面上 */
    const endAt = (i: number, dir: number): number => {
      const p = perp(i);
      if (!p) return i + 0.5 + (dir * T) / 2;
      const corner = p.a === line || p.b === line;
      if (corner) return horiz ? i + 0.5 + (dir * p.T) / 2 : i + 0.5 - (dir * p.T) / 2;
      return i + 0.5 - (dir * p.T) / 2;
    };
    const u0 = endAt(a, -1);
    const u1 = endAt(e, 1);
    const sNeg = horiz ? 0 : 3;
    const sPos = horiz ? 2 : 1;
    /** 这格墙朝 s 那一面是什么：屋里 → 那个房间的墙面；屋外 → 外墙。half = 这格的前半 / 后半（丁字口两边是两个房间） */
    const face = (i: number, s: number, half: number): Face => {
      let fx = (horiz ? i : line) + dx(s);
      let fz = (horiz ? line : i) + dz(s);
      if (shell(ch(fx, fz))) {
        if (horiz) fx += half ? 1 : -1;
        else fz += half ? 1 : -1;
      }
      if (inGrid(fx, fz) && inside(ch(fx, fz))) return fin[roomOf[at(fx, fz)] as number] ?? EXT_IN;
      return EXT;
    };
    const base: Face = T === T_IN ? (houseFin ?? EXT_IN) : EXT;

    // ---- 窗
    const windowAt = (k: string, v0: number, v1: number, hh: number, n: Face, p: Face, i0: number): void => {
      const [sill, head] = k === 'G' ? [0.5, Math.min(2.5, hh - 0.25)] : k === 'H' ? [Math.min(1.6, hh - 0.95), Math.min(2.25, hh - 0.2)] : [0.92, Math.min(2.12, hh - 0.2)];
      seg(horiz, mid, v0, v1, T, -0.5, sill, base[0], base[1], n, p);
      seg(horiz, mid, v0, v1, T, head, hh, base[0], base[1], n, p);
      col(horiz, mid, v0, v1, T, -0.5, sill);
      col(horiz, mid, v0, v1, T, head, hh);
      if (roofless) return;
      // 哪一面朝外
      const out = inside(ch((horiz ? i0 : line) + dx(sNeg), (horiz ? line : i0) + dz(sNeg))) ? 1 : -1;
      const fr = 0.06;
      const dp = T + 0.06;
      seg(horiz, mid, v0, v0 + fr, dp, sill, head, trimSkin, trimTint);
      seg(horiz, mid, v1 - fr, v1, dp, sill, head, trimSkin, trimTint);
      seg(horiz, mid, v0 + fr, v1 - fr, dp, head - fr, head, trimSkin, trimTint);
      seg(horiz, mid, v0 + fr, v1 - fr, dp, sill, sill + 0.045, trimSkin, trimTint);
      const n1 = Math.round(v1 - v0);
      for (let q = 1; q < n1; q++) seg(horiz, mid, v0 + q - 0.025, v0 + q + 0.025, 0.07, sill + 0.045, head - fr, trimSkin, trimTint);
      if (k === 'W') {
        const bar = sill + (head - sill) * 0.56;
        seg(horiz, mid, v0 + fr, v1 - fr, 0.05, bar - 0.018, bar + 0.018, trimSkin, trimTint);
      }
      // 窗台板（朝外挑出一点）
      if (k !== 'H') seg(horiz, mid + out * (T / 2 + 0.04), v0 - 0.06, v1 + 0.06, 0.1, sill - 0.05, sill + 0.004, trimSkin, trimTint);
      if (rng.chance(k === 'H' ? board * 0.3 : board)) {
        // 钉着木板
        const nb = k === 'G' ? 4 : k === 'H' ? 1 : 3;
        for (let q = 0; q < nb; q++) {
          if (!rng.chance(0.85)) continue;
          const y = sill + 0.14 + ((head - sill - 0.42) * q) / Math.max(1, nb - 1) + rng.range(-0.05, 0.05);
          seg(horiz, mid + out * (T / 2 + 0.05), v0 - 0.12, v1 + 0.12, 0.03, y, y + 0.17, 'planks', 0xd8d0c4);
        }
        return;
      }
      // 玻璃：一格一块，有的碎了
      for (let q = 0; q < n1; q++) {
        if (!rng.chance(k === 'G' ? 0.62 : 0.7)) continue;
        const g0 = v0 + q + (q === 0 ? fr : 0.025);
        const g1 = v0 + q + 1 - (q === n1 - 1 ? fr : 0.025);
        b.pane(horiz, (horiz ? lz : lx) + mid, (horiz ? lx : lz) + g0, (horiz ? lx : lz) + g1, sill + 0.045, head - fr, rng.range(0.25, 0.6));
      }
    };

    // ---- 门
    const doorAt = (k: string, v0: number, v1: number, hh: number, n: Face, p: Face, i0: number): void => {
      const n1 = Math.round(v1 - v0);
      const wide = n1 >= 3;
      const lintel = Math.min(wide ? (plan.doorH ?? 2.6) : 2.1, hh - 0.18);
      seg(horiz, mid, v0, v1, T, lintel, hh, base[0], base[1], n, p);
      col(horiz, mid, v0, v1, T, lintel, hh);
      const x0 = horiz ? i0 : line;
      const z0 = horiz ? line : i0;
      const negIn = inside(ch(x0 + dx(sNeg), z0 + dz(sNeg)));
      // 门里、门外那一格不放东西
      for (let q = 0; q < n1; q++) {
        for (const s of [sNeg, sPos]) {
          const nx = (horiz ? i0 + q : line) + dx(s);
          const nz = (horiz ? line : i0 + q) + dz(s);
          if (inGrid(nx, nz) && inside(ch(nx, nz))) reserved[at(nx, nz)] = 1;
        }
      }
      const ext = k === 'D';
      /** 外门：朝外的方向（+1 = 朝 sPos） */
      const out = ext ? (negIn ? 1 : -1) : 0;
      if (ext) {
        const s = out > 0 ? sPos : sNeg;
        for (let q = 0; q < n1; q++) {
          const cx = (horiz ? i0 + q : line) + 0.5;
          const cz = (horiz ? line : i0 + q) + 0.5;
          const [ox, oz] = b.pt(lx + cx + dx(s) * 1.7, lz + cz + dz(s) * 1.7);
          const [ix, iz] = b.pt(lx + cx - dx(s) * 1.0, lz + cz - dz(s) * 1.0);
          doors.push({ x: ix, z: iz, ox, oz });
          if (!entry || (!entryFront && s === frontSide)) {
            entry = [ox, oz];
            entryFront = s === frontSide;
          }
        }
        outDoors.push({ x: lx + (horiz ? (v0 + v1) / 2 : mid), z: lz + (horiz ? mid : (v0 + v1) / 2), s, n: n1 });
      }
      if (roofless) return;
      const top = lintel - 0.06;
      // 门框
      const fsk: Skin = wide ? 'shutter' : trimSkin;
      const ftn = wide ? 0x8c8c86 : trimTint;
      seg(horiz, mid, v0, v0 + 0.05, T + 0.05, F, lintel, fsk, ftn);
      seg(horiz, mid, v1 - 0.05, v1, T + 0.05, F, lintel, fsk, ftn);
      seg(horiz, mid, v0 + 0.05, v1 - 0.05, T + 0.05, top, lintel, fsk, ftn);
      if (ext && !wide) {
        // 门口的台阶 / 门槛（门外是门廊的不用）
        const s = out > 0 ? sPos : sNeg;
        if (!porchy(ch(x0 + dx(s), z0 + dz(s)))) {
          const off = out * (T / 2 + 0.26);
          b.slab(lx + (horiz ? (v0 + v1) / 2 : mid + off), lz + (horiz ? mid + off : (v0 + v1) / 2), horiz ? n1 + 0.3 : 0.52, horiz ? 0.52 : n1 + 0.3, -0.25, 0.29, 'concrete');
        }
      }
      if (wide) {
        const o2 = out || 1;
        if (plan.gate === 'slide') {
          // 谷仓门：两扇大木门推到两边，上面一根滑轨
          const w2 = n1 / 2;
          const l0 = Math.max(u0 + 0.05, v0 - w2 + 0.15);
          const l1 = Math.min(u1 - 0.05, v1 + w2 - 0.15);
          const off = mid + o2 * (T / 2 + 0.05);
          seg(horiz, off, l0, v0 + 0.15, 0.07, F + 0.04, lintel + 0.04, 'planks', 0xb8a890);
          seg(horiz, off, v1 - 0.15, l1, 0.07, F + 0.04, lintel + 0.04, 'planks', 0xb8a890);
          seg(horiz, off, l0, l1, 0.09, lintel + 0.04, lintel + 0.13, 'shutter', 0x6a6a66);
        } else {
          // 卷帘门：卷上去了，留一截帘子
          const drop = Math.min(rng.range(0.2, 0.7), lintel - F - 2.0);
          if (drop > 0.08) seg(horiz, mid, v0 + 0.05, v1 - 0.05, 0.06, lintel - drop, top, 'shutter', 0xc8c8c0);
          // 门口一小段水泥坡
          const off = o2 * (T / 2 + 0.6);
          b.slab(lx + (horiz ? (v0 + v1) / 2 : mid + off), lz + (horiz ? mid + off : (v0 + v1) / 2), horiz ? n1 + 0.4 : 1.2, horiz ? 1.2 : n1 + 0.4, -0.25, 0.28, 'concrete');
        }
        return;
      }
      // 门扇：开到 90°（旁边就是墙角）或者开到底、平贴在墙上，都不挡路
      const leafH: [number, number] = [F + 0.01, top];
      const tryLeaf = (endDir: number, sd: number): boolean => {
        const edge = endDir < 0 ? v0 : v1;
        const wi = endDir < 0 ? i0 - 1 : i0 + n1;
        if (wi < a || wi > e || !isSolid(cellAt(wi))) return false;
        const s = sd > 0 ? sPos : sNeg;
        const dxc = (horiz ? wi : line) + dx(s);
        const dzc = (horiz ? line : wi) + dz(s);
        const diag = ch(dxc, dzc);
        if (shell(diag) && (!ext || sd !== out)) {
          // 墙角：门扇和这道墙垂直，贴着旁边的墙
          const lu = edge - endDir * 0.03;
          const q0 = mid + sd * (T / 2);
          const q1 = mid + sd * (T / 2 + 0.9);
          seg(!horiz, lu, Math.min(q0, q1), Math.max(q0, q1), 0.045, leafH[0], leafH[1], doorSkin, doorTint);
          return true;
        }
        if (ext ? sd !== out : diag !== '.') return false;
        // 平贴在门边的墙上
        const l0 = Math.min(edge, edge + endDir * 0.9);
        seg(horiz, mid + sd * (T / 2 + 0.03), l0, l0 + 0.9, 0.045, leafH[0], leafH[1], doorSkin, doorTint);
        if (!ext && inGrid(dxc, dzc)) {
          reserved[at(dxc, dzc)] = 1;
          faceBusy.add(`${dxc},${dzc},${(s + 2) % 4}`);
        }
        return true;
      };
      for (let q = 0, left = n1; q < 2 && left > 0; q++) {
        if (rng.chance(0.22)) {
          left--;
          continue;
        }
        const ends = n1 === 2 ? [q === 0 ? -1 : 1] : rng.chance(0.5) ? [-1, 1] : [1, -1];
        const sides = ext ? [-out, out] : rng.chance(0.5) ? [-1, 1] : [1, -1];
        let done = false;
        // 先找墙角，再找能平贴的墙
        for (const pass of [0, 1]) {
          for (const ed of ends) {
            for (const sd of sides) {
              if (done) break;
              if (pass === 0) {
                const wi = ed < 0 ? i0 - 1 : i0 + n1;
                const s = sd > 0 ? sPos : sNeg;
                if (!shell(ch((horiz ? wi : line) + dx(s), (horiz ? line : wi) + dz(s)))) continue;
              }
              done = tryLeaf(ed, sd);
            }
          }
        }
        left -= n1 === 2 ? 1 : 2;
      }
    };

    // ---- 沿着这条线一段一段地出
    interface Run {
      k: string;
      hh: number;
      n: Face;
      p: Face;
      v0: number;
      v1: number;
      i0: number;
    }
    let run: Run | null = null;
    let colRun: [number, number, number] | null = null;
    let plRun: [number, number] | null = null;
    const flushCol = (): void => {
      if (colRun) col(horiz, mid, colRun[0], colRun[1], T, -0.5, colRun[2]);
      colRun = null;
    };
    const flushPl = (): void => {
      // 勒脚：墙根一圈混凝土，屋里看是踢脚线
      if (plRun && plinth && T === T_OUT) seg(horiz, mid, plRun[0] - (plRun[0] === u0 ? 0.035 : 0), plRun[1] + (plRun[1] === u1 ? 0.035 : 0), T + 0.07, -0.5, 0.3, 'compound', PLINTH);
      plRun = null;
    };
    const flush = (): void => {
      const q = run;
      run = null;
      if (!q) return;
      if (q.k === '#' || q.k === 'R') {
        if (q.k === 'R') {
          // 关着的卷帘门：凹进去的一块铁皮 + 上面的门楣
          const lintel = Math.min(plan.doorH ?? 2.6, q.hh - 0.18);
          seg(horiz, mid, q.v0, q.v1, T, lintel, q.hh, base[0], base[1], q.n, q.p);
          seg(horiz, mid, q.v0, q.v1, 0.08, -0.3, lintel, 'shutter', 0xc8c8c0);
          seg(horiz, mid, q.v0, q.v0 + 0.05, T + 0.05, F, lintel, 'shutter', 0x8c8c86);
          seg(horiz, mid, q.v1 - 0.05, q.v1, T + 0.05, F, lintel, 'shutter', 0x8c8c86);
        } else seg(horiz, mid, q.v0, q.v1, T, -0.5, q.hh, base[0], base[1], q.n === base ? undefined : q.n, q.p === base ? undefined : q.p);
        if (colRun && colRun[2] === q.hh && Math.abs(colRun[1] - q.v0) < 1e-6) colRun[1] = q.v1;
        else {
          flushCol();
          colRun = [q.v0, q.v1, q.hh];
        }
      } else {
        flushCol();
        if (isWin(q.k)) windowAt(q.k, q.v0, q.v1, q.hh, q.n, q.p, q.i0);
        else doorAt(q.k, q.v0, q.v1, q.hh, q.n, q.p, q.i0);
      }
      if (isDoor(q.k)) flushPl();
      else if (plRun) plRun[1] = q.v1;
      else plRun = [q.v0, q.v1];
    };
    for (let i = a; i <= e; i++) {
      const cc = cellAt(i);
      const k = cc === '|' ? '#' : cc;
      const hh = hAt(horiz ? i : line, horiz ? line : i);
      const junction = !!perp(i);
      for (let half = 0; half < 2; half++) {
        const v0 = Math.max(u0, i + half * 0.5);
        const v1 = Math.min(u1, i + half * 0.5 + 0.5);
        if (v1 - v0 < 1e-6) continue;
        // 线头上那半格被另一道墙挡着，跟旁边那半格一样
        const hf = k !== '#' ? 0 : junction && ((i === a && half === 0) || (i === e && half === 1)) ? half ^ 1 : half;
        const n = face(i, sNeg, hf);
        const p = face(i, sPos, hf);
        const cur = run as Run | null;
        if (cur && cur.k === k && cur.hh === hh && cur.n === n && cur.p === p) cur.v1 = v1;
        else {
          flush();
          run = { k, hh, n, p, v0, v1, i0: i };
        }
      }
    }
    flush();
    flushCol();
    flushPl();
  }

  // ---------------------------------------------------------------- 地板、屋顶

  const tex: SlabTex | null = plan.floor;
  const t2 = T_OUT / 2;
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  let partNo = 0;
  for (const p of parts) {
    // 两块搭接的地方（墙底下、门洞里）两层地板一样高会闪：后面的每块低 3 毫米
    const sunk = partNo++ * 0.003;
    const ox0 = p.x0 + 0.5 - t2;
    const oz0 = p.z0 + 0.5 - t2;
    const ox1 = p.x1 + 0.5 + t2;
    const oz1 = p.z1 + 0.5 + t2;
    bx0 = Math.min(bx0, ox0);
    bz0 = Math.min(bz0, oz0);
    bx1 = Math.max(bx1, ox1);
    bz1 = Math.max(bz1, oz1);
    const mx = lx + (ox0 + ox1) / 2;
    const mz = lz + (oz0 + oz1) / 2;
    const w = ox1 - ox0;
    const d = oz1 - oz0;
    if (tex) {
      b.slab(mx, mz, w - 0.02, d - 0.02, -0.3, 0.3 + F - sunk, p.floor ?? tex);
      // 地板也是碰撞体：顶面只比地面高 4 厘米，不挡人，人站在它上面
      b.box(mx, mz, w / 2 - 0.01, d / 2 - 0.01, 0, -0.3, F);
      // 有地板的房子：记下外轮廓，里面不长草
      const [ax, az] = b.pt(lx + ox0, lz + oz0);
      const [cx, cz] = b.pt(lx + ox1, lz + oz1);
      b.houses.push({ x0: Math.min(ax, cx), z0: Math.min(az, cz), x1: Math.max(ax, cx), z1: Math.max(az, cz) });
    }
    if (p.kind === 'none') continue;
    if (p.kind === 'flat') {
      b.slab(mx, mz, w - 0.1, d - 0.1, p.h, 0.16, 'roof');
      b.slab(mx, mz, w - T_OUT, d - T_OUT, p.h - 0.05, 0.05, 'ceil');
      // 女儿墙 = 外墙接着往上（这一边有更高的墙就不做）；店面那一边高一截，是招牌墙
      const front = plan.awning ? sideOf(2) : -1;
      for (let s = 0; s < 4; s++) {
        const alongX = s % 2 === 0;
        const line = s === 0 ? p.z0 : s === 2 ? p.z1 : s === 3 ? p.x0 : p.x1;
        let ok = true;
        for (let i = alongX ? p.x0 : p.z0; i <= (alongX ? p.x1 : p.z1) && ok; i++) if (hAt(alongX ? i : line, alongX ? line : i) > p.h + 0.01) ok = false;
        if (!ok) continue;
        const ph = s === front ? 0.95 : 0.45;
        const v0 = alongX ? ox0 : oz0 + T_OUT;
        const v1 = alongX ? ox1 : oz1 - T_OUT;
        seg(alongX, line + 0.5, v0, v1, T_OUT, p.h, p.h + ph, skin, tint);
        b.slab(lx + (alongX ? (v0 + v1) / 2 : line + 0.5), lz + (alongX ? line + 0.5 : (v0 + v1) / 2), alongX ? v1 - v0 + 0.08 : T_OUT + 0.08, alongX ? T_OUT + 0.08 : v1 - v0 + 0.08, p.h + ph, 0.05, 'pillar');
      }
      b.cover(lx + ox0, lz + oz0, lx + ox1, lz + oz1, p.h + 0.16);
      continue;
    }
    if (p.kind === 'shed') {
      // 单坡：高的一边靠着更高的墙时，从那道墙朝这边的墙面开始，不出檐
      const r = [oz0, ox1, oz1, ox0];
      if (p.attach) r[p.hi] = (p.hi === 0 ? p.z0 : p.hi === 2 ? p.z1 : p.hi === 3 ? p.x0 : p.x1) + 0.5 + (p.hi === 0 || p.hi === 3 ? t2 : -t2);
      const over: [number, number, number, number] = [0.3, 0.3, 0.3, 0.3];
      const ends: [boolean, boolean, boolean, boolean] = [true, true, true, true];
      if (p.attach) {
        over[p.hi] = 0;
        ends[p.hi] = false;
      }
      b.roof('shed', lx + (r[3] as number), lz + (r[0] as number), lx + (r[1] as number), lz + (r[2] as number), p.h, p.rise, over, false, p.hi, ends, skin, tint, roofTex, rtint);
      b.cover(lx + ox0, lz + oz0, lx + ox1, lz + oz1, p.h + p.rise);
      continue;
    }
    // 双坡。屋脊的一头可以伸进主屋的屋顶里（丁字、L 形的房子）
    const metal = roofTex === 'wall_metal' || roofTex === 'rust';
    const eave = metal ? 0.32 : 0.45;
    const verge = metal ? 0.25 : 0.35;
    const half = (p.ridgeX ? d : w) / 2;
    const over: [number, number, number, number] = p.ridgeX ? [eave, verge, eave, verge] : [verge, eave, verge, eave];
    const ends: [boolean, boolean, boolean, boolean] = p.ridgeX ? [false, true, false, true] : [true, false, true, false];
    if (p.join >= 0) {
      over[p.join] = half + 0.7;
      ends[p.join] = false;
    }
    b.roof('gable', lx + ox0, lz + oz0, lx + ox1, lz + oz1, p.h, p.rise, over, p.ridgeX, 0, ends, skin, tint, roofTex, rtint);
    // 住宅有吊顶，仓库、谷仓直接看到屋架
    if (p.ceil) b.slab(mx, mz, w - T_OUT, d - T_OUT, p.h - 0.06, 0.06, 'ceil');
    b.cover(lx + ox0, lz + oz0, lx + ox1, lz + oz1, p.h + p.rise);
  }
  /** 屋里这个位置的顶有多高（挂灯用） */
  const ceilAt = (hx: number, hz: number): number => {
    const p = partAt(Math.floor(hx), Math.floor(hz));
    if (!p) return h - 0.06;
    if (p.kind === 'flat' || p.ceil) return p.h - 0.06;
    if (p.kind === 'shed') {
      const t = p.hi === 0 ? (p.z1 + 1 - hz) / (p.z1 + 1 - p.z0) : p.hi === 2 ? (hz - p.z0) / (p.z1 + 1 - p.z0) : p.hi === 3 ? (p.x1 + 1 - hx) / (p.x1 + 1 - p.x0) : (hx - p.x0) / (p.x1 + 1 - p.x0);
      return p.h + p.rise * Math.max(0, Math.min(1, t)) - 0.1;
    }
    const span = (p.ridgeX ? p.z1 - p.z0 : p.x1 - p.x0) + 1;
    const off = Math.abs(p.ridgeX ? hz - (p.z0 + p.z1 + 1) / 2 : hx - (p.x0 + p.x1 + 1) / 2);
    return p.h + p.rise * Math.max(0, 1 - off / (span / 2)) - 0.05;
  };

  // ---------------------------------------------------------------- 门廊、车棚（柱子撑着的单坡顶）

  const seenP = new Uint8Array(PW * PH);
  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      const c0 = ch(x, z);
      if (!porchy(c0) || seenP[at(x, z)]) continue;
      let x1 = x;
      while (ch(x1 + 1, z) === c0) x1++;
      let z1 = z;
      const rowOk = (zz: number): boolean => {
        for (let i = x; i <= x1; i++) if (ch(i, zz) !== c0) return false;
        return true;
      };
      while (rowOk(z1 + 1)) z1++;
      for (let q = z; q <= z1; q++) for (let i = x; i <= x1; i++) seenP[at(i, q)] = 1;
      // 靠着房子的是哪一边：挨着墙最多的那边
      let att = 0;
      let best = -1;
      for (let s = 0; s < 4; s++) {
        let n = 0;
        if (s % 2 === 0) for (let i = x; i <= x1; i++) n += shell(ch(i, s === 0 ? z - 1 : z1 + 1)) ? 1 : 0;
        else for (let i = z; i <= z1; i++) n += shell(ch(s === 3 ? x - 1 : x1 + 1, i)) ? 1 : 0;
        if (n > best) {
          best = n;
          att = s;
        }
      }
      const car = c0 === 'y';
      // 范围：靠墙的几边一直贴到墙面
      const r = [z, x1 + 1, z1 + 1, x];
      const walled = [false, false, false, false];
      for (let s = 0; s < 4; s++) {
        const nb = s % 2 === 0 ? ch(x, s === 0 ? z - 1 : z1 + 1) : ch(s === 3 ? x - 1 : x1 + 1, z);
        const nb2 = s % 2 === 0 ? ch(x1, s === 0 ? z - 1 : z1 + 1) : ch(s === 3 ? x - 1 : x1 + 1, z1);
        if (shell(nb) || shell(nb2)) {
          walled[s] = true;
          r[s] = (r[s] as number) + (s === 0 || s === 3 ? -(0.5 - t2) : 0.5 - t2);
        }
      }
      const [rz0, rx1, rz1, rx0] = r as [number, number, number, number];
      const pmx = lx + (rx0 + rx1) / 2;
      const pmz = lz + (rz0 + rz1) / 2;
      const top = car ? 0.03 : F;
      b.slab(pmx, pmz, rx1 - rx0, rz1 - rz0, -0.25, 0.25 + top, car ? 'concrete' : 'deck');
      b.box(pmx, pmz, (rx1 - rx0) / 2, (rz1 - rz0) / 2, 0, -0.25, top);
      const lo = Math.min(car ? 2.45 : 2.3, hAt(x, z) - 0.55);
      const rise = car ? 0.28 : 0.42;
      const over: [number, number, number, number] = [0.25, 0.25, 0.25, 0.25];
      for (let s = 0; s < 4; s++) if (walled[s]) over[s] = 0;
      b.roof('shed', lx + rx0, lz + rz0, lx + rx1, lz + rz1, lo, rise, over, false, att, [false, false, false, false], null, 0xffffff, car ? 'wall_metal' : roofTex, car ? 0x9aa09c : rtint);
      b.cover(lx + rx0, lz + rz0, lx + rx1, lz + rz1, lo + rise);
      // 柱子：外侧那条边上，两头各一根，中间每三米左右一根；门正对着的地方不立
      const outS = (att + 2) % 4;
      const alongX = outS % 2 === 0;
      const a0 = alongX ? rx0 : rz0;
      const a1 = alongX ? rx1 : rz1;
      const lineO = (outS === 0 ? rz0 : outS === 2 ? rz1 : outS === 3 ? rx0 : rx1) + (outS === 0 || outS === 3 ? 0.1 : -0.1);
      const doorsAt: number[] = [];
      for (let i = alongX ? x : z; i <= (alongX ? x1 : z1); i++) {
        const q = alongX ? ch(i, att === 0 ? z - 1 : z1 + 1) : ch(att === 3 ? x - 1 : x1 + 1, i);
        if (q === 'D') doorsAt.push(i + 0.5);
      }
      const nSpan = Math.max(1, Math.ceil((a1 - a0) / 3.2));
      const posts: number[] = [];
      for (let k = 0; k <= nSpan; k++) {
        const u = a0 + 0.1 + ((a1 - a0 - 0.2) * k) / nSpan;
        if (k > 0 && k < nSpan && doorsAt.some((q) => Math.abs(q - u) < 0.95)) continue;
        // 这一头贴着墙：不用柱子
        const endS = alongX ? (k === 0 ? 3 : 1) : k === 0 ? 0 : 2;
        if ((k === 0 || k === nSpan) && walled[endS]) continue;
        posts.push(u);
        const px = lx + (alongX ? u : lineO);
        const pz = lz + (alongX ? lineO : u);
        b.wall(px, pz, 0.13, true, -0.2, lo + 0.25, car ? 'shutter' : trimSkin, car ? 0x8c8c86 : trimTint, 0.13, false);
        b.circle(px, pz, 0.09, -0.2, lo);
      }
      if (car) {
        // 车棚里：有时停着一辆废车，有时是空的车位
        ports.push({ x0: lx + rx0, z0: lz + rz0, x1: lx + rx1, z1: lz + rz1 });
        const tag = b.houseTag;
        b.houseTag = -1;
        const long = rx1 - rx0 >= rz1 - rz0;
        // 车头朝哪边：车棚的长边和房子的正面同向 → 朝正面（路那边）；不然朝外
        const fr = sideOf(2);
        const head = (fr % 2 === 0) === !long ? fr : outS;
        // 车靠外侧停：贴着房子的那一边留出一条走道（侧门开在这儿）
        const across = alongX ? rz1 - rz0 : rx1 - rx0;
        const shift = long === alongX ? Math.max(0, across / 2 - 1.3) : 0;
        const cmx = pmx + dx(outS) * shift;
        const cmz = pmz + dz(outS) * shift;
        if (rng.chance(0.4)) b.car(cmx, cmz, long ? 0 : Math.PI / 2, rng.pick([0, 1, 3]), top);
        else b.park(cmx, cmz, head === 2 ? 0 : head === 1 ? Math.PI / 2 : head === 0 ? Math.PI : -Math.PI / 2);
        b.houseTag = tag;
        continue;
      }
      // 栏杆：柱子之间上下两根横杆，正对门的那一跨空着；两侧也围上
      const rail = (alongR: boolean, line: number, v0: number, v1: number): void => {
        if (v1 - v0 < 0.5) return;
        const cxr = lx + (alongR ? (v0 + v1) / 2 : line);
        const czr = lz + (alongR ? line : (v0 + v1) / 2);
        b.wall(cxr, czr, v1 - v0, alongR, 0.84, 0.08, trimSkin, trimTint, 0.07, false);
        b.wall(cxr, czr, v1 - v0, alongR, 0.3, 0.06, trimSkin, trimTint, 0.05, false);
        b.box(cxr, czr, alongR ? (v1 - v0) / 2 : 0.04, alongR ? 0.04 : (v1 - v0) / 2, 0, 0, 0.92);
      };
      const stops = [...posts];
      if (!stops.length || (stops[0] as number) > a0 + 0.2) stops.unshift(a0);
      if ((stops[stops.length - 1] as number) < a1 - 0.2) stops.push(a1);
      for (let k = 0; k + 1 < stops.length; k++) {
        const v0 = stops[k] as number;
        const v1 = stops[k + 1] as number;
        if (doorsAt.some((q) => q > v0 - 0.3 && q < v1 + 0.3)) continue;
        rail(alongX, lineO, v0, v1);
      }
      for (const s of alongX ? [3, 1] : [0, 2]) {
        if (walled[s]) continue;
        const line = (s === 0 ? rz0 : s === 2 ? rz1 : s === 3 ? rx0 : rx1) + (s === 0 || s === 3 ? 0.1 : -0.1);
        const d0 = alongX ? rz0 : rx0;
        const d1 = alongX ? rz1 : rx1;
        rail(!alongX, line, d0 + (walled[att] && (att === 0 || att === 3) ? 0 : 0.1), d1 - 0.1);
      }
    }
  }

  // ---------------------------------------------------------------- 烟囱、雨棚

  if (plan.chimney && !roofless) {
    const [cx, cz] = tr(plan.chimney[0], plan.chimney[1]);
    const p = partAt(cx, cz);
    const topY = (p ? p.h + (p.kind === 'gable' ? p.rise : 0) : h) + 0.65;
    if (shell(ch(cx, cz))) {
      // 山墙外面的烟囱垛
      let s = 0;
      for (let q = 0; q < 4; q++) if (!inGrid(cx + dx(q), cz + dz(q)) || ch(cx + dx(q), cz + dz(q)) === ' ') s = q;
      const px = lx + cx + 0.5 + dx(s) * (t2 + 0.2);
      const pz = lz + cz + 0.5 + dz(s) * (t2 + 0.2);
      b.wall(px, pz, 0.85, s % 2 === 0, -0.4, topY + 0.4, 'brick', 0xd8d0c8, 0.46, false);
      b.box(px, pz, s % 2 === 0 ? 0.42 : 0.23, s % 2 === 0 ? 0.23 : 0.42, 0, -0.4, topY);
    } else b.wall(lx + cx + 0.5, lz + cz + 0.5, 0.7, true, (p?.h ?? h) - 0.1, topY - (p?.h ?? h) + 0.1, 'brick', 0xd8d0c8, 0.7, false);
  }
  if (plan.awning && !roofless) {
    // 店面：门窗上面一条雨棚，再上面是招牌
    const s = sideOf(2);
    const p = parts[0] as Part;
    const alongX = s % 2 === 0;
    const line = s === 0 ? p.z0 : s === 2 ? p.z1 : s === 3 ? p.x0 : p.x1;
    let a0 = Infinity;
    let a1 = -Infinity;
    for (let i = alongX ? p.x0 : p.z0; i <= (alongX ? p.x1 : p.z1); i++) {
      const q = alongX ? ch(i, line) : ch(line, i);
      if (q === 'G' || q === 'D') {
        a0 = Math.min(a0, i);
        a1 = Math.max(a1, i + 1);
      }
    }
    if (a1 > a0) {
      const sg = s === 0 || s === 3 ? -1 : 1;
      const faceAt = line + 0.5 + sg * t2;
      const colr = rng.pick(AWNING);
      const v0 = a0 - 0.35;
      const v1 = a1 + 0.35;
      const mid = (v0 + v1) / 2;
      const off = faceAt + sg * 0.7;
      b.slab(lx + (alongX ? mid : off), lz + (alongX ? off : mid), alongX ? v1 - v0 : 1.4, alongX ? 1.4 : v1 - v0, 2.6, 0.09, 'canopy', colr);
      const o1 = faceAt + sg * 1.38;
      b.slab(lx + (alongX ? mid : o1), lz + (alongX ? o1 : mid), alongX ? v1 - v0 : 0.04, alongX ? 0.04 : v1 - v0, 2.38, 0.25, 'canopy', colr);
      const [c0x, c0z] = alongX ? [v0, Math.min(faceAt, faceAt + sg * 1.4)] : [Math.min(faceAt, faceAt + sg * 1.4), v0];
      b.cover(lx + c0x, lz + c0z, lx + c0x + (alongX ? v1 - v0 : 1.4), lz + c0z + (alongX ? 1.4 : v1 - v0), 2.6);
      seg(alongX, faceAt + sg * 0.035, v0, v1, 0.07, 2.82, Math.min(p.h + 0.8, 3.5), 'plaster', rng.pick([0xe8e2d2, 0xd8c8a0, 0xc8d4d8, 0xd2b8a0]));
    }
  }

  // ---------------------------------------------------------------- 摆东西的工具

  const size = (mid: string): [number, number, number] => b.size(mid);
  const put = (mid: string, hx: number, hz: number, ry: number, s: number | [number, number, number], dy: number, rx = 0): void => {
    b.put(mid, lx + hx, lz + hz, ry, s, rx ? { dy, rx, small: true } : { dy, small: true });
  };
  /** 平放：立着建模的东西（枪、锯、轮胎）绕自身的 X 轴放倒，正面朝上，底面落在 y */
  const flat = (mid: string, hx: number, hz: number, ry: number, s: number, y: number): void => {
    const [, my, mzz] = size(mid);
    const k = (my * s) / 2;
    put(mid, hx + Math.sin(ry) * k, hz + Math.cos(ry) * k, ry, s, y + (mzz * s) / 2, -Math.PI / 2);
  };
  /** 格子 (x, z) 里：u 沿墙（-0.5…0.5），v 离背后的格子边多远（0…1，负数 = 伸进墙那一格）→ 房子坐标 */
  const cellPt = (x: number, z: number, f: number, u: number, v: number): [number, number] => [x + 0.5 + wx(f) * u + dx(f) * (v - 0.5), z + 0.5 + wz(f) * u + dz(f) * (v - 0.5)];

  const blocked = new Uint8Array(PW * PH);
  const topH = new Float32Array(PW * PH);
  const mark = (x: number, z: number, w: number, d: number, top: number, blocks = true): void => {
    for (let a = z; a < z + d; a++) {
      for (let c = x; c < x + w; c++) {
        if (!inGrid(c, a)) continue;
        if (blocks) blocked[at(c, a)] = 1;
        topH[at(c, a)] = Math.max(topH[at(c, a)] as number, top);
      }
    }
  };

  // ---- 战利品的候选位置（房子坐标）：w 越大越优先
  const lootC: Array<{ x: number; z: number; y: number; w: number }> = [];
  const lootRange = plan.loot;
  const pSurf = { home: 0.4, shop: 0.3, store: 0.3, office: 0.4, mil: 0.42 }[theme];

  const dimsOf = (p: Piece, grow = 1, squeeze = 1): { s: [number, number, number]; W: number; D: number; top: number } => {
    const [sx0, sy0, sz0] = size(p.id);
    const s: [number, number, number] = typeof p.s === 'number' ? [p.s, p.s, p.s] : [p.s[0], p.s[1], p.s[2]];
    if (p.front === 'x') {
      s[0] *= grow;
      s[2] *= squeeze;
    } else {
      s[2] *= grow;
      s[0] *= squeeze;
    }
    return { s, W: p.front === 'x' ? sz0 * s[2] : sx0 * s[0], D: p.front === 'x' ? sx0 * s[0] : sz0 * s[2], top: (sy0 + (p.lift ?? 0)) * s[1] };
  };
  /** 摆一件家具。不到 0.75 米高的（椅子、茶几、床头柜）不挡人：屋里只有大件会撞到 */
  const setPiece = (p: Piece, cx: number, cz: number, f: number, grow = 1, squeeze = 1, jitter = 0): Placed => {
    const q = dimsOf(p, grow, squeeze);
    put(p.id, cx, cz, ryOf(f) - (p.front === 'x' ? Math.PI / 2 : 0) + jitter, q.s, F + (p.lift ?? 0) * q.s[1]);
    const solid = p.solid ?? q.top;
    if (solid >= 0.55 && !p.soft) b.box(lx + cx, lz + cz, (q.W / 2) * 0.94, (q.D / 2) * 0.94, ryOf(f) + jitter, F - 0.1, F + solid);
    return { p, cx, cz, f, W: q.W, D: q.D, sy: q.s[1], top: q.top };
  };

  /** 一个面上摆东西：中心 (cx, cz)、朝 f、宽 Ws、进深范围 va…vb（相对中心，朝前为正）、高度 y、净高 clear */
  const surface = (deck: Deck, cx: number, cz: number, f: number, Ws: number, va: number, vb: number, y: number, clear: number, shelf: boolean, kind: string): void => {
    const taken: number[] = [];
    // 先给战利品留一个位置：摆设不会压在它上面
    if (clear >= 0.3 && Ws >= 0.36 && kind !== 'tv' && kind !== 'sofa' && kind !== 'stove' && kind !== 'cart' && y < F + 1.55 && rng.chance(kind === 'shelf' ? pSurf * 0.6 : pSurf)) {
      const u = Ws < 0.6 ? 0 : rng.range(-Ws / 2 + 0.2, Ws / 2 - 0.2);
      const v = (va + vb) / 2;
      taken.push(u - 0.2, u + 0.2);
      lootC.push({ x: cx + wx(f) * u + dx(f) * v, z: cz + wz(f) * u + dz(f) * v, y: y + 0.004, w: kind === 'shelf' ? 2 : 3 });
    }
    const drop = (it: Item, u: number): boolean => {
      const [mid, s, mode] = it;
      const [ix, iy, iz] = size(mid);
      const lying = mode === 'f';
      const iw = ix * s;
      const ih = (lying ? iz : iy) * s;
      const idp = (lying ? iy : iz) * s;
      if (ih > clear || iw > Ws + 0.12) return false;
      const a = Math.max(-Ws / 2, Math.min(Ws / 2 - iw, u - iw / 2));
      for (let k = 0; k < taken.length; k += 2) if (a - 0.02 < (taken[k + 1] as number) && a + iw + 0.02 > (taken[k] as number)) return false;
      taken.push(a, a + iw);
      const v = shelf || vb - va < idp + 0.04 ? (va + vb) / 2 + (shelf ? rng.range(-0.03, 0.03) : 0) : rng.range(va + idp / 2, vb - idp / 2);
      const uc = a + iw / 2;
      const hx = cx + wx(f) * uc + dx(f) * v;
      const hz = cz + wz(f) * uc + dz(f) * v;
      const yaw = ryOf(f) + (mode === 'a' ? rng.range(-0.12, 0.12) - (FRONT_X.has(mid) ? Math.PI / 2 : 0) : rng.range(-0.3, 0.3) + (rng.chance(0.5) ? Math.PI : 0));
      if (lying) flat(mid, hx, hz, yaw, s, y);
      else put(mid, hx, hz, yaw, s, y);
      return true;
    };
    if (deck.mains && rng.chance(deck.pMain ?? 1)) drop(rng.pick(deck.mains), (deck.at ?? 0) * Ws * 0.5 + rng.range(-0.05, 0.05));
    if (deck.fill <= 0 || !deck.items.length) return;
    const n = Math.max(1, Math.floor(Ws / 0.32));
    for (let i = 0; i < n; i++) {
      if (rng.chance(deck.fill)) drop(rng.pick(deck.items), -Ws / 2 + ((i + 0.5) * Ws) / n + rng.range(-0.04, 0.04));
    }
  };
  const dressTops = (pl: Placed, rk: RoomKind, letter: string): void => {
    const tops = pl.p.tops;
    if (!tops) return;
    const [v0, v1] = pl.p.td ?? [-0.36, 0.36];
    const Ws = pl.W * (pl.p.tx ?? 0.84);
    for (let i = 0; i < tops.length; i++) {
      const t = tops[i] as readonly [number, string];
      if (t[1] === 'cap') continue;
      const nx = tops[i + 1];
      const clear = nx ? (nx[0] - t[0]) * pl.sy - 0.05 : 9;
      surface(deckOf(t[1], rk, letter), pl.cx, pl.cz, pl.f, Ws, v0 * pl.D, v1 * pl.D, F + t[0] * pl.sy + 0.004, clear, t[1] === 'shelf', t[1]);
    }
  };

  /** 一组格子 (x0, z0, w, d) 的家具朝哪边：[朝向, 是不是背靠着墙] */
  const faceFor = (x0: number, z0: number, w: number, d: number, c: string, unit: boolean): [number, boolean] => {
    let sides: number[];
    if (w > d) sides = [0, 2];
    else if (d > w) sides = [1, 3];
    else if (ch(x0 - 1, z0) === c || ch(x0 + w, z0) === c) sides = [0, 2];
    else if (ch(x0, z0 - 1) === c || ch(x0, z0 + d) === c) sides = [1, 3];
    else sides = [0, 1, 2, 3];
    /** 这一组朝 s 那一侧紧挨着的格子 */
    const edge = (s: number, k = 1): string[] => {
      const out: string[] = [];
      if (s % 2 === 0) for (let i = 0; i < w; i++) out.push(ch(x0 + i, s === 0 ? z0 - k : z0 + d - 1 + k));
      else for (let i = 0; i < d; i++) out.push(ch(s === 1 ? x0 + w - 1 + k : x0 - k, z0 + i));
      return out;
    };
    let best = 0;
    let back = -1;
    for (const s of sides) {
      const cells = edge(s);
      const share = cells.reduce((sum, q) => sum + (isSolid(q) || (unit && q === c) ? 1 : isWin(q) ? 0.55 : 0), 0) / cells.length;
      if (share <= 0) continue;
      const score = share + (edge((s + 2) % 4).every((q) => q === '.') ? 0.3 : 0) + rng.next() * 0.1;
      if (score > best) {
        best = score;
        back = s;
      }
    }
    if (back >= 0) return [(back + 2) % 4, true];
    // 不靠墙：沙发朝茶几 / 电视，桌子朝椅子
    const look = c === 's' || c === 'a' ? 'lvt' : c === 'e' || c === 'u' || c === 'i' ? 'c' : '';
    if (look) {
      for (let k = 1; k <= (look === 'c' ? 1 : 3); k++) for (const s of sides) if (edge(s, k).some((q) => q !== ' ' && look.includes(q))) return [s, false];
    }
    return [sides.includes(0) ? 2 : 1, false];
  };
  /**
   * 家具中心的位置。背靠墙的：一直推到墙面上（墙面在墙那一格的中线附近，比格子的边线靠后三十多厘米）；
   * snap = 一侧是墙、另一侧不是的，再顺着墙挪到墙角里
   */
  const anchor = (x0: number, z0: number, w: number, d: number, f: number, Wp: number, D: number, against: boolean, snap: boolean): [number, number] => {
    let cx = x0 + w / 2;
    let cz = z0 + d / 2;
    if (!against) return [cx, cz];
    const back = (f + 2) % 4;
    const bxc = back === 1 ? x0 + w - 1 : x0;
    const bzc = back === 2 ? z0 + d - 1 : z0;
    const off = (f % 2 === 0 ? d : w) / 2 + gapOf(bxc, bzc, back) - 0.02 - D / 2;
    cx -= dx(f) * off;
    cz -= dz(f) * off;
    if (snap) {
      const span = f % 2 === 0 ? w : d;
      const sA = f % 2 === 0 ? 3 : 0;
      const sB = f % 2 === 0 ? 1 : 2;
      const gA = wallish(ch(x0 + dx(sA), z0 + dz(sA))) ? gapOf(x0, z0, sA) : 0;
      const gB = wallish(ch(x0 + w - 1 + dx(sB), z0 + d - 1 + dz(sB))) ? gapOf(x0 + w - 1, z0 + d - 1, sB) : 0;
      let shift = 0;
      if (gA > 0 && gB <= 0) shift = -Math.max(0, span / 2 + gA - 0.04 - Wp / 2);
      else if (gB > 0 && gA <= 0) shift = Math.max(0, span / 2 + gB - 0.04 - Wp / 2);
      if (f % 2 === 0) cx += shift;
      else cz += shift;
    }
    return [cx, cz];
  };

  // ---------------------------------------------------------------- 平面图里的家具

  const done = new Uint8Array(PW * PH);
  const unitVar = new Map<string, Piece>();
  const forced: Array<[number, number]> = [];
  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, z);
      const def = FURN[c];
      if (!def || done[at(x, z)]) continue;
      const max = def.kind === 'car' ? 9 : (def.max ?? 1);
      let w = 1;
      while (w < max && ch(x + w, z) === c && !done[at(x + w, z)]) w++;
      let d = 1;
      const rowFull = (zz: number): boolean => {
        for (let i = 0; i < w; i++) if (ch(x + i, zz) !== c || done[at(x + i, zz)]) return false;
        return true;
      };
      // 竖着的一条；桌子和车可以是一整块
      if (w === 1 || c === 't' || def.kind === 'car' || def.kind === 'pallet') while (d < max && rowFull(z + d)) d++;
      for (let a = z; a < z + d; a++) for (let q = x; q < x + w; q++) done[at(q, a)] = 1;
      const rk = kindAt(x, z);
      const cx = x + w / 2;
      const cz = z + d / 2;
      const len = Math.max(w, d);
      switch (def.kind) {
        case 'piece':
        case 'unit': {
          const homey = rk === 'bed' || rk === 'living' || rk === 'office';
          const all = def.v ?? [];
          const plain = all.filter((q) => !q.home);
          const v = homey || !plain.length ? all : plain;
          let p: Piece;
          let squeeze = 1;
          if (def.kind === 'unit') {
            p = unitVar.get(c) ?? rng.pick(v);
            unitVar.set(c, p);
          } else {
            const fit = v.filter((q) => (q.n ?? 1) === Math.min(len, 2));
            if (fit.length) p = rng.pick(fit);
            else {
              // 只有两格长的款式，位置只有一格：压短一半
              p = rng.pick(v);
              squeeze = len / (p.n ?? 1);
            }
          }
          const [f, against] = faceFor(x, z, w, d, c, def.kind === 'unit');
          const grow = p.grow && w > 1 && d > 1 ? 1.5 : 1;
          const q = dimsOf(p, grow, squeeze);
          const [px, pz] = anchor(x, z, w, d, f, q.W, q.D, against, def.kind === 'piece');
          const pl = setPiece(p, px, pz, f, grow, squeeze);
          dressTops(pl, rk, c);
          mark(x, z, w, d, pl.top);
          break;
        }
        case 'bed': {
          const vert = d >= w;
          // 床头顶着哪面墙；旁边有没有侧墙
          const head = vert ? (wallish(ch(x, z - 1)) || !wallish(ch(x, z + d)) ? 0 : 2) : wallish(ch(x - 1, z)) || !wallish(ch(x + w, z)) ? 3 : 1;
          const side = vert ? (wallish(ch(x - 1, z)) ? 3 : wallish(ch(x + w, z)) ? 1 : -1) : wallish(ch(x, z - 1)) ? 0 : wallish(ch(x, z + d)) ? 2 : -1;
          const squeeze = len < 2 ? 0.5 : 1;
          // 往床头那面墙、侧墙各推到贴上
          const hg = wallish(ch(x + (head === 3 ? -1 : head === 1 ? w : 0), z + (head === 0 ? -1 : head === 2 ? d : 0))) ? gapOf(head === 1 ? x + w - 1 : x, head === 2 ? z + d - 1 : z, head) - 0.03 : 0;
          const sg = side >= 0 ? gapOf(side === 1 ? x + w - 1 : x, side === 2 ? z + d - 1 : z, side) - 0.04 : 0;
          const bcx = cx + dx(head) * hg + (side >= 0 ? dx(side) * sg : 0);
          const bcz = cz + dz(head) * hg + (side >= 0 ? dz(side) * sg : 0);
          if (theme === 'home' && side >= 0 && squeeze === 1 && rng.chance(0.3)) {
            // 沙发床：靠背贴着侧墙
            const f = (side + 2) % 4;
            const q = dimsOf(DAY_BED);
            const off = 0.5 - 0.02 - q.D / 2 + sg + 0.04;
            const pl = setPiece(DAY_BED, cx - dx(f) * off + dx(head) * hg, cz - dz(f) * off + dz(head) * hg, f);
            mark(x, z, w, d, pl.top);
            lootC.push({ x: pl.cx - dx(head) * 0.5, z: pl.cz - dz(head) * 0.5, y: F + 0.6, w: 2 });
            break;
          }
          const q = dimsOf(BED_FRAME, 1, squeeze);
          const ry = head === 0 ? -Math.PI / 2 : head === 2 ? Math.PI / 2 : head === 3 ? 0 : Math.PI;
          put(BED_FRAME.id, bcx, bcz, ry, q.s, F);
          b.box(lx + bcx, lz + bcz, q.W / 2 - 0.03, q.D / 2 - 0.02, ry, F - 0.1, F + 0.6);
          mark(x, z, w, d, 1.0);
          // 床脚那一头可能放着东西
          if (squeeze < 1 || rng.chance(theme === 'mil' ? 0.08 : 0.15)) break;
          lootC.push({ x: bcx - dx(head) * 0.5, z: bcz - dz(head) * 0.5, y: F + 0.59, w: 2 });
          // 床垫、被子、枕头（床架是光板）
          const L = q.W - 0.12;
          const Wm = q.D - 0.08;
          b.slab(lx + bcx, lz + bcz, vert ? Wm : L, vert ? L : Wm, F + 0.4, 0.17, 'mattress');
          const hx = -dx(head);
          const hz = -dz(head);
          if (rng.chance(0.78)) {
            const Lb = L * rng.range(0.52, 0.66);
            const o2 = (L - Lb) / 2 + 0.02;
            b.slab(lx + bcx + hx * o2, lz + bcz + hz * o2, vert ? Wm + 0.05 : Lb, vert ? Lb : Wm + 0.05, F + 0.425, 0.16, theme === 'mil' ? 'blanket3' : rng.chance(0.5) ? 'blanket' : 'blanket2');
          }
          if (rng.chance(theme === 'mil' ? 0.5 : 0.85)) put('throw_pillows_01', bcx - hx * (L / 2 - 0.25), bcz - hz * (L / 2 - 0.25), (vert ? 0 : Math.PI / 2) + rng.range(-0.15, 0.15), 0.62, F + 0.572);
          break;
        }
        case 'chair': {
          let f = -1;
          let off = 0;
          for (let s = 0; s < 4 && f < 0; s++) {
            const q = ch(x + dx(s), z + dz(s));
            if (q !== ' ' && 'teui'.includes(q)) {
              f = s;
              off = 0.2;
            }
          }
          for (let s = 0; s < 4 && f < 0; s++) {
            if (wallish(ch(x + dx(s), z + dz(s)))) {
              f = (s + 2) % 4;
              off = -0.16 - gapOf(x, z, s);
            }
          }
          if (f < 0) f = rng.int(0, 3);
          const pl = setPiece(rng.pick(CHAIRS), x + 0.5 + dx(f) * off, z + 0.5 + dz(f) * off, f, 1, 1, rng.range(-0.22, 0.22));
          mark(x, z, 1, 1, pl.top);
          break;
        }
        case 'locker': {
          const [f, against] = faceFor(x, z, 1, 1, c, true);
          const q = dimsOf(LOCKER);
          const [px, pz] = anchor(x, z, 1, 1, f, q.W, q.D, against, false);
          mark(x, z, 1, 1, setPiece(LOCKER, px, pz, f).top);
          // 柜子前面的地上
          lootC.push({ x: px + dx(f) * (q.D / 2 + 0.22), z: pz + dz(f) * (q.D / 2 + 0.22), y: F + 0.01, w: 2 });
          break;
        }
        case 'crate': {
          // 靠墙的一摞往墙上靠
          let s0 = -1;
          for (let s = 0; s < 4 && s0 < 0; s++) if (isSolid(ch(x + dx(s), z + dz(s)))) s0 = s;
          const g = s0 >= 0 ? gapOf(x, z, s0) * 0.8 : 0;
          const mil = rk === 'mil';
          const px = x + 0.5 + (s0 >= 0 ? dx(s0) * g : 0);
          const pz = z + 0.5 + (s0 >= 0 ? dz(s0) * g : 0);
          const n = rng.int(mil ? 2 : 1, mil ? 4 : 3);
          const topY = b.crates(lx + px, lz + pz, (s0 >= 0 && s0 % 2 === 1 ? Math.PI / 2 : 0) + rng.range(-0.1, 0.1), n, mil, F, mil ? 0.98 : 0.9);
          mark(x, z, 1, 1, 1.2);
          if (n <= 2) lootC.push({ x: px, z: pz, y: topY + 0.01, w: 1.5 });
          break;
        }
        case 'barrel':
          b.barrel(lx + x + 0.5 + rng.range(-0.1, 0.1), lz + z + 0.5 + rng.range(-0.1, 0.1), F);
          mark(x, z, 1, 1, 0.92);
          break;
        case 'pallet':
          b.solid(b.real('pallets', lx + cx, lz + cz, w >= d ? 0 : Math.PI / 2, len - 0.15, 0.9, Math.min(w, d) - 0.1, { dy: F, small: true }), 0.95);
          mark(x, z, w, d, 0.9);
          // 垛顶上的东西放在靠走道的那一边（垛有两米见方，放中间够不着）
          for (let k = 0, s1 = rng.int(0, 3); k < 4; k++) {
            const sd = (s1 + k) % 4;
            const i = rng.int(0, (sd % 2 === 0 ? w : d) - 1);
            if (ch(sd === 1 ? x + w : sd === 3 ? x - 1 : x + i, sd === 0 ? z - 1 : sd === 2 ? z + d : z + i) !== '.') continue;
            lootC.push({ x: sd % 2 === 0 ? x + i + 0.5 : sd === 1 ? x + w - 0.38 : x + 0.38, z: sd % 2 === 1 ? z + i + 0.5 : sd === 2 ? z + d - 0.38 : z + 0.38, y: F + 0.905, w: 1.5 });
            break;
          }
          break;
        case 'sandbag':
          b.sandbagLine(lx + cx - (w >= d ? len / 2 : 0), lz + cz - (w >= d ? 0 : len / 2), lx + cx + (w >= d ? len / 2 : 0), lz + cz + (w >= d ? 0 : len / 2));
          mark(x, z, w, d, 0.85);
          break;
        case 'car':
          if (rng.chance(plan.carP ?? 0.7)) {
            b.car(lx + cx, lz + cz, (d > w ? Math.PI / 2 : 0) + (rng.chance(0.5) ? Math.PI : 0), rng.pick([0, 1, 2, 4]), F - 0.01);
            mark(x, z, w, d, 1.4);
          }
          break;
        default:
          // 'junk'：这一格一定堆点东西，和自动添置的一起处理
          forced.push([x, z]);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- 墙边的杂物

  /** 从门口走得到的空格数（没有门的废墟：从任意一个空格出发） */
  const seenR = new Uint8Array(PW * PH);
  const stackR: number[] = [];
  const reach = (): number => {
    seenR.fill(0);
    stackR.length = 0;
    const pass = (x: number, z: number): boolean => {
      const c = ch(x, z);
      return isDoor(c) || (inside(c) && !blocked[at(x, z)]);
    };
    for (let z = 0; z < PH && !stackR.length; z++) for (let x = 0; x < PW; x++) if (ch(x, z) === 'D') stackR.push(at(x, z));
    if (!stackR.length) for (let z = 0; z < PH && !stackR.length; z++) for (let x = 0; x < PW && !stackR.length; x++) if (inside(ch(x, z)) && !blocked[at(x, z)]) stackR.push(at(x, z));
    for (const k of stackR) seenR[k] = 1;
    let n = 0;
    while (stackR.length) {
      const k = stackR.pop() as number;
      const x = k % PW;
      const z = (k - x) / PW;
      if (inside(ch(x, z))) n++;
      for (let s = 0; s < 4; s++) {
        const nx = x + dx(s);
        const nz = z + dz(s);
        if (!inGrid(nx, nz) || seenR[at(nx, nz)] || !pass(nx, nz)) continue;
        seenR[at(nx, nz)] = 1;
        stackR.push(at(nx, nz));
      }
    }
    return n;
  };
  const pickW = (list: ReadonlyArray<readonly [string, number]>, ok: (k: string) => boolean): string | null => {
    let total = 0;
    for (const [k, wgt] of list) if (ok(k)) total += wgt;
    if (total <= 0) return null;
    let t = rng.next() * total;
    for (const [k, wgt] of list) {
      if (!ok(k)) continue;
      t -= wgt;
      if (t <= 0) return k;
    }
    return null;
  };
  /** 把一件杂物放进格子 (x, z)（背靠 f 的反方向那面墙，一直靠到墙面上）。返回它有多高。只有大件（架子、铁皮柜、成摞的箱子、油桶）挡人 */
  const clutter = (kind: string, x: number, z: number, f: number, rk: RoomKind): number => {
    const g = gapOf(x, z, (f + 2) % 4) - 0.01;
    const pt = (u: number, v: number): [number, number] => cellPt(x, z, f, u, v - g);
    const yaw = ryOf(f);
    switch (kind) {
      case 'boxes': {
        const [, bh, bd] = size('cardboard_box_01');
        const s0 = rng.range(0.95, 1.35);
        const u0 = rng.range(-0.1, 0.1);
        const [hx, hz] = pt(u0, 0.05 + (bd * s0) / 2);
        put('cardboard_box_01', hx, hz, yaw + rng.range(-0.2, 0.2), s0, F);
        let y = bh * s0;
        for (let k = rng.int(0, 2), s = s0; k > 0 && y < 1.1; k--) {
          s *= rng.range(0.68, 0.9);
          const [qx, qz] = pt(u0 + rng.range(-0.06, 0.06), 0.05 + (bd * s0) / 2 + rng.range(-0.03, 0.03));
          put('cardboard_box_01', qx, qz, yaw + rng.range(-0.5, 0.5), s, F + y);
          y += bh * s;
        }
        return y;
      }
      case 'suitcase': {
        const [hx, hz] = pt(0, 0.13);
        put('vintage_suitcase', hx, hz, yaw + rng.range(-0.06, 0.06), 0.58, F);
        return 0.33;
      }
      case 'stand': {
        const p = rng.pick(STANDS);
        const q = dimsOf(p);
        const [hx, hz] = pt(rng.range(-0.12, 0.12), 0.04 + q.D / 2);
        const pl = setPiece(p, hx, hz, f);
        dressTops(pl, rk, 'n');
        return pl.top;
      }
      case 'chair': {
        const p = rng.pick(CHAIRS);
        const q = dimsOf(p);
        const [hx, hz] = pt(rng.range(-0.1, 0.1), 0.06 + q.D / 2);
        return setPiece(p, hx, hz, f, 1, 1, rng.range(-0.25, 0.25)).top;
      }
      case 'sshelf': {
        const p = rng.pick(SMALL_SHELVES);
        const q = dimsOf(p);
        const [hx, hz] = pt(0, 0.03 + q.D / 2);
        const pl = setPiece(p, hx, hz, f);
        dressTops(pl, rk, 'h');
        return pl.top;
      }
      case 'locker': {
        const q = dimsOf(LOCKER);
        const [hx, hz] = pt(0, 0.03 + q.D / 2);
        lootC.push({ x: hx + dx(f) * (q.D / 2 + 0.22), z: hz + dz(f) * (q.D / 2 + 0.22), y: F + 0.01, w: 2 });
        return setPiece(LOCKER, hx, hz, f).top;
      }
      case 'bags': {
        const [hx, hz] = pt(rng.range(-0.12, 0.12), 0.3);
        put('trashbag', hx, hz, rng.range(0, 6.28), rng.range(0.85, 1.1), F - 0.02);
        if (rng.chance(0.5)) {
          const [qx, qz] = pt(rng.range(-0.3, 0.3), 0.62);
          put('trashbag', qx, qz, rng.range(0, 6.28), rng.range(0.7, 0.9), F - 0.02);
        }
        return 0.6;
      }
      case 'bucket': {
        const [hx, hz] = pt(rng.range(-0.2, 0.2), rng.range(0.2, 0.4));
        put('wooden_bucket_01', hx, hz, rng.range(0, 6.28), 0.8, F);
        return 0.45;
      }
      case 'bin': {
        const [hx, hz] = pt(0, 0.2);
        put('metal_trash_can', hx, hz, yaw + rng.range(-0.05, 0.05), 0.52, F);
        return 0.47;
      }
      case 'mcrate':
      case 'crates': {
        const mil = rk === 'mil' || kind === 'mcrate';
        const [hx, hz] = pt(0, mil ? 0.34 : 0.3);
        b.crates(lx + hx, lz + hz, yaw + rng.range(-0.08, 0.08), rng.int(mil ? 2 : 1, mil ? 4 : 3), mil, F, mil ? 0.98 : 0.9);
        return 1.3;
      }
      case 'barrel': {
        const [hx, hz] = pt(rng.range(-0.1, 0.1), 0.36);
        b.barrel(lx + hx, lz + hz, F);
        return 0.92;
      }
      case 'tyres': {
        const n = rng.int(2, 4);
        const [hx, hz] = pt(rng.range(-0.08, 0.08), 0.37);
        for (let k = 0; k < n; k++) flat('old_tyre', hx + rng.range(-0.03, 0.03) - 0.3 * Math.sin(yaw), hz + rng.range(-0.03, 0.03) - 0.3 * Math.cos(yaw), yaw, 1, F + k * 0.17);
        return n * 0.17;
      }
      case 'cans': {
        for (let k = rng.int(1, 3), u = rng.range(-0.3, -0.1); k > 0; k--, u += rng.range(0.24, 0.34)) {
          const [hx, hz] = pt(Math.min(0.36, u), rng.range(0.12, 0.2));
          put(rk === 'mil' ? 'metal_jerrycan_green' : rng.pick(['plastic_jerrycan', 'metal_jerrycan_green']), hx, hz, yaw + Math.PI / 2 + rng.range(-0.3, 0.3), 1, F);
        }
        return 0.5;
      }
      case 'cement': {
        const n = rng.int(2, 5);
        const [hx, hz] = pt(0, 0.3);
        for (let k = 0; k < n; k++) put('cement_bag', hx + rng.range(-0.03, 0.03), hz + rng.range(-0.03, 0.03), yaw + rng.range(-0.12, 0.12), 1, F + k * 0.17);
        return n * 0.17;
      }
      case 'propane': {
        const [hx, hz] = pt(rng.range(-0.15, 0.15), 0.26);
        put('propane_tank', hx, hz, rng.range(0, 6.28), 1.15, F);
        return 0.63;
      }
      case 'ladder': {
        const [hx, hz] = pt(0, 0.34);
        put('wooden_ladder_02', hx, hz, yaw, 0.95, F);
        return 1.63;
      }
      case 'truck': {
        const [hx, hz] = pt(rng.range(-0.1, 0.1), 0.3);
        put('hand_truck', hx, hz, yaw + rng.range(-0.15, 0.15), 0.85, F);
        return 1.2;
      }
      case 'ammo': {
        const n = rng.int(3, 6);
        for (let k = 0; k < n; k++) {
          const [hx, hz] = pt(-0.3 + (k % 3) * 0.3 + rng.range(-0.03, 0.03), 0.14 + rng.range(-0.03, 0.03));
          put('ammo_box', hx, hz, yaw + rng.range(-0.2, 0.2), 1.25, F + Math.floor(k / 3) * 0.222);
        }
        return 0.45;
      }
      case 'pcrate': {
        const n = rng.int(2, 4);
        const [hx, hz] = pt(rng.range(-0.08, 0.08), 0.3);
        for (let k = 0; k < n; k++) put('plastic_crate_02', hx, hz, yaw + rng.range(-0.08, 0.08), 1.2, F + k * 0.29);
        return n * 0.3;
      }
      case 'sign': {
        const [hx, hz] = pt(rng.range(-0.2, 0.2), rng.range(0.3, 0.6));
        put('WetFloorSign_01', hx, hz, rng.range(0, 6.28), 1, F);
        return 0.63;
      }
      case 'ext': {
        const [hx, hz] = pt(rng.range(-0.25, 0.25), 0.16);
        put('korean_fire_extinguisher_01', hx, hz, yaw, 0.85, F);
        return 0.56;
      }
      case 'gen': {
        const [hx, hz] = pt(0, 0.36);
        put('portable_generator', hx, hz, yaw + rng.range(-0.1, 0.1), 1, F);
        return 0.58;
      }
      default:
        return 0;
    }
  };

  const cluttered = new Uint8Array(PW * PH);
  const isForced = (x: number, z: number): boolean => forced.some((q) => q[0] === x && q[1] === z);
  let reachable = -1;
  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, z);
      const must = isForced(x, z);
      if ((c !== '.' && c !== ',' && !must) || blocked[at(x, z)] || (reserved[at(x, z)] && !must)) continue;
      // 背靠哪面墙：实墙优先，窗下只能放矮的
      let back = -1;
      let walls = 0;
      let low = false;
      for (let s = 0; s < 4; s++) {
        const q = ch(x + dx(s), z + dz(s));
        if (!wallish(q) || faceBusy.has(`${x},${z},${s}`)) continue;
        walls++;
        if (back < 0 || (low && !isWin(q))) {
          back = s;
          low = isWin(q) && q !== 'H';
        }
      }
      if (back < 0) continue;
      const rk = kindAt(x, z);
      const dress = DRESS[rk];
      if (!must && !rng.chance(dress.wall * (walls > 1 ? 1.5 : 1))) continue;
      const f = (back + 2) % 4;
      let kind = pickW(dress.kinds, (k) => !low || (KINDS[k]?.low ?? false));
      if (!kind) continue;
      if (KINDS[kind]?.blocks) {
        if (reachable < 0) reachable = reach();
        blocked[at(x, z)] = 1;
        if (reach() !== reachable - 1) {
          // 堵路了：换一件不挡路的
          blocked[at(x, z)] = 0;
          kind = pickW(dress.kinds, (k) => !(KINDS[k]?.blocks ?? true));
          if (!kind) continue;
        } else reachable--;
      }
      const top = clutter(kind, x, z, f, rk);
      cluttered[at(x, z)] = 1;
      topH[at(x, z)] = Math.max(topH[at(x, z)] as number, top);
    }
  }

  // ---------------------------------------------------------------- 墙上的东西

  if (!roofless) {
    const hung = new Set<string>();
    for (let z = 0; z < PH; z++) {
      for (let x = 0; x < PW; x++) {
        if (!inside(ch(x, z))) continue;
        const rk = kindAt(x, z);
        const dress = DRESS[rk];
        for (let s = 0; s < 4; s++) {
          if (!isSolid(ch(x + dx(s), z + dz(s))) || ch(x + dx(s), z + dz(s)) === 'R' || faceBusy.has(`${x},${z},${s}`)) continue;
          const below = topH[at(x, z)] as number;
          // 灶台、台面上方多半有搁板
          const kitchen = 'kK'.includes(ch(x, z)) && below < 1.1;
          if (!rng.chance(kitchen ? 0.75 : dress.deco)) continue;
          // 同一面墙上隔一格才挂下一件
          if (hung.has(`${x - wx(s)},${z - wz(s)},${s}`) || hung.has(`${x + wx(s)},${z + wz(s)},${s}`)) continue;
          const kind = kitchen ? 'wshelf' : pickW(dress.decos, (k) => below + 0.2 < (k === 'wshelf' ? 1.42 : k === 'mask' ? 1.15 : k === 'dart' ? 1.25 : 1.35));
          if (!kind) continue;
          hung.add(`${x},${z},${s}`);
          const f = (s + 2) % 4;
          const yaw = ryOf(f);
          /** 墙面在格子边线后面多远 */
          const fv = -gapOf(x, z, s);
          const pt = (u: number, v: number): [number, number] => cellPt(x, z, f, u, v);
          switch (kind) {
            case 'picture': {
              const sc = rng.range(0.9, 1.5);
              const [hx, hz] = pt(rng.range(-0.08, 0.08), fv + 0.014 * sc);
              put('fancy_picture_frame_01', hx, hz, yaw, sc, F + 1.62 - 0.23 * sc);
              break;
            }
            case 'clock': {
              const [hx, hz] = pt(0, fv + 0.03);
              put('wall_clock', hx, hz, yaw, rng.range(1, 1.25), F + 1.75);
              break;
            }
            case 'dart': {
              const [hx, hz] = pt(0, fv + 0.025);
              put('dartboard', hx, hz, yaw, 1, F + 1.33);
              break;
            }
            case 'mask': {
              const [hx, hz] = pt(rng.range(-0.15, 0.15), fv + 0.075);
              put('old_gas_mask', hx, hz, yaw, 0.6, F + 1.18);
              break;
            }
            default: {
              // 搁板：一块木板 + 上面的东西
              const [hx, hz] = pt(0, fv + 0.125);
              b.wall(lx + hx, lz + hz, 0.92, f % 2 === 0, F + 1.42, 0.035, 'planks', 0xd0c2a8, 0.25, false);
              surface(deckOf('shelf', rk, kitchen ? 'k' : 'h'), hx, hz, f, 0.8, -0.02, 0.02, F + 1.459, Math.min(0.5, ceilAt(x + 0.5, z + 0.5) - 1.5), true, 'wall');
              break;
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- 地上的零碎、地毯、吊灯

  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, z);
      if ((c !== '.' && c !== ',') || blocked[at(x, z)] || cluttered[at(x, z)]) continue;
      const dress = DRESS[kindAt(x, z)];
      if (!dress.litter.length || !rng.chance(dress.floor)) continue;
      const [mid, s, mode] = rng.pick(dress.litter);
      const hx = x + rng.range(0.2, 0.8);
      const hz = z + rng.range(0.2, 0.8);
      if (mode === 'f') flat(mid, hx, hz, rng.range(0, 6.28), s, F + 0.004);
      else put(mid, hx, hz, rng.range(0, 6.28), s, F + 0.004);
    }
  }
  if (tex) {
    /** 这块矩形是不是整个落在同一个房间的地面上 */
    const fits = (room: number, hx: number, hz: number, w: number, d: number): boolean => {
      for (const [ux, uz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, 0],
      ] as const) {
        const qx = Math.floor(hx + (ux * w) / 2 - ux * 0.02);
        const qz = Math.floor(hz + (uz * d) / 2 - uz * 0.02);
        if (!inGrid(qx, qz) || roomOf[at(qx, qz)] !== room) return false;
      }
      return true;
    };
    const rug = (room: number, hx: number, hz: number, w: number, d: number, t: SlabTex): void => {
      for (let k = 0; k < 3; k++, w *= 0.78, d *= 0.78) {
        if (!fits(room, hx, hz, w, d)) continue;
        b.slab(lx + hx, lz + hz, w, d, F - 0.01, 0.022, t);
        return;
      }
    };
    rooms.forEach((q, room) => {
      const dress = DRESS[q.kind];
      // 吊灯：房间中间（最靠近中心的那一格）
      if (q.cells.length >= 6 && !roofless) {
        let ax = 0;
        let az = 0;
        for (const [cx, cz] of q.cells) {
          ax += cx + 0.5;
          az += cz + 0.5;
        }
        ax /= q.cells.length;
        az /= q.cells.length;
        let bestD = Infinity;
        let px = ax;
        let pz = az;
        for (const [cx, cz] of q.cells) {
          const dd = Math.hypot(cx + 0.5 - ax, cz + 0.5 - az);
          if (dd < bestD) {
            bestD = dd;
            px = cx + 0.5;
            pz = cz + 0.5;
          }
        }
        const top = ceilAt(px, pz);
        if (q.kind === 'office' || q.kind === 'shop') put('mounted_fluorescent_lights', px, pz, PW >= PH ? 0 : Math.PI / 2, 1.3, top - 0.06);
        else {
          const lamp = q.kind === 'bed' || q.kind === 'living' ? 'modern_ceiling_lamp_01' : 'hanging_industrial_lamp';
          const sc = lamp === 'modern_ceiling_lamp_01' ? 0.7 : 0.55;
          put(lamp, px, pz, rng.range(0, 6.28), sc, top - size(lamp)[1] * sc);
        }
      }
      if (!dress.rug) return;
      // 地毯：客厅铺在茶几 / 沙发下面，卧室铺在床边，办公室铺在房间中间
      const find = (letters: string): [number, number] | null => {
        let hit: [number, number] | null = null;
        for (const [cx, cz] of q.cells) if (letters.includes(ch(cx, cz)) && (!hit || cz < hit[1] || (cz === hit[1] && cx < hit[0]))) hit = [cx, cz];
        return hit;
      };
      const t: SlabTex = dress.rug === 'carpet' ? 'carpet' : rng.chance(0.5) ? 'rug' : 'rug2';
      if (q.kind === 'bed') {
        for (const [cx, cz] of q.cells) {
          if (ch(cx, cz) !== 'b' || ch(cx, cz - 1) === 'b' || ch(cx - 1, cz) === 'b') continue;
          const vert = ch(cx, cz + 1) === 'b';
          // 床的哪一侧是空的
          for (const s of vert ? [1, 3] : [2, 0]) {
            if (ch(cx + dx(s), cz + dz(s)) !== '.') continue;
            rug(room, cx + 0.5 + dx(s) * 1.0 + (vert ? 0 : 0.5), cz + 0.5 + dz(s) * 1.0 + (vert ? 0.5 : 0), vert ? 0.95 : 1.6, vert ? 1.6 : 0.95, t);
            break;
          }
        }
      } else if (rng.chance(0.85)) {
        const seat = find('l') ?? find('s') ?? find('t');
        if (seat) {
          const horiz = ch(seat[0] + 1, seat[1]) === ch(seat[0], seat[1]);
          rug(room, seat[0] + (horiz ? 1 : 0.5), seat[1] + (horiz ? 0.5 : 1), horiz ? 3.3 : 2.4, horiz ? 2.4 : 3.3, t);
        } else if (q.cells.length >= 9) {
          let ax = 0;
          let az = 0;
          for (const [cx, cz] of q.cells) {
            ax += cx + 0.5;
            az += cz + 0.5;
          }
          rug(room, ax / q.cells.length, az / q.cells.length, 3.2, 2.2, t);
        }
      }
    });
  }

  // ---------------------------------------------------------------- 屋里能站人的空格

  const free: number[] = [];
  for (let z = 0; z < PH; z++) for (let x = 0; x < PW; x++) if (inside(ch(x, z)) && !blocked[at(x, z)]) free.push(...b.pt(lx + x + 0.5, lz + z + 0.5));
  const [rx0, rz0] = b.pt(lx + bx0, lz + bz0);
  const [rx1, rz1] = b.pt(lx + bx1, lz + bz1);
  b.interiors.push({ id, rect: { x0: Math.min(rx0, rx1), z0: Math.min(rz0, rz1), x1: Math.max(rx0, rx1), z1: Math.max(rz0, rz1) }, y: b.h + F, entry, doors, free });

  // ---------------------------------------------------------------- 战利品的位置

  // 墙角、墙根的地上：贴着墙面的那一条本来就没人走，东西放那儿不挡路
  for (let z = 0; z < PH; z++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, z);
      if ((c !== '.' && c !== ',') || blocked[at(x, z)] || cluttered[at(x, z)] || reserved[at(x, z)]) continue;
      let ox = 0;
      let oz = 0;
      let n = 0;
      for (let s = 0; s < 4; s++) {
        if (!isSolid(ch(x + dx(s), z + dz(s)))) continue;
        const g = gapOf(x, z, s);
        ox += dx(s) * (0.5 + g - 0.24);
        oz += dz(s) * (0.5 + g - 0.24);
        n++;
      }
      if (!n) continue;
      lootC.push({ x: x + 0.5 + ox + (ox ? 0 : rng.range(-0.25, 0.25)), z: z + 0.5 + oz + (oz ? 0 : rng.range(-0.25, 0.25)), y: F + 0.01, w: n > 1 ? 1.2 : 0.6 });
    }
  }
  const place: LootPlace = theme === 'home' ? 'home' : theme === 'shop' ? 'shop' : theme === 'office' ? 'office' : theme === 'mil' ? 'mil' : 'store';
  const want = rng.int(lootRange[0], lootRange[1]);
  const chosen: Array<{ x: number; z: number; y: number }> = [];
  // 只要够得着的（杂物是后添的，可能把先前的候选位置围住）：用真正的碰撞体量——
  // 一米出头的范围里有个站得住的点，而且那个点在从门口走得到的空格里，或者紧挨着一个
  reach();
  // 挡人的碰撞体（顶面比迈得上去的高、底面比头顶低）：只挑这栋房子自己的，一个点一个点地量比走空间索引便宜得多
  const feet = b.h + F;
  const solidB: Box[] = [];
  const solidC: Circle[] = [];
  for (let k = box0; k < b.cols.boxes.length; k++) {
    const q = b.cols.boxes[k] as Box;
    if (q.y1 > feet + 0.45 && q.y0 < feet + 1.75) solidB.push(q);
  }
  for (let k = circle0; k < b.cols.circles.length; k++) {
    const q = b.cols.circles[k] as Circle;
    if (q.y1 > feet + 0.45 && q.y0 < feet + 1.75) solidC.push(q);
  }
  const RP = 0.345;
  const standing = (hx: number, hz: number): boolean => {
    const [px, pz] = b.pt(lx + hx, lz + hz);
    for (const q of solidB) {
      const ex = px - q.x;
      const ez = pz - q.z;
      const ax = Math.abs(ex * q.c - ez * q.s) - q.hx;
      if (ax >= RP) continue;
      const az = Math.abs(ex * q.s + ez * q.c) - q.hz;
      if (az >= RP) continue;
      if (ax <= 0 || az <= 0 || ax * ax + az * az < RP * RP) return false;
    }
    for (const q of solidC) if (Math.hypot(px - q.x, pz - q.z) < q.r + RP) return false;
    return true;
  };
  const okCell = (x: number, z: number): boolean => inGrid(x, z) && seenR[at(x, z)] === 1 && inside(ch(x, z));
  const handy = (qx: number, qz: number): boolean => {
    for (const rad of [0.6, 0.85, 1.1]) {
      for (let k = 0; k < 8; k++) {
        const sx = qx + Math.cos(k * 0.7854) * rad;
        const sz = qz + Math.sin(k * 0.7854) * rad;
        const cx0 = Math.floor(sx);
        const cz0 = Math.floor(sz);
        if (!inGrid(cx0, cz0) || !standing(sx, sz)) continue;
        if (okCell(cx0, cz0)) return true;
        for (let sd = 0; sd < 4; sd++) {
          const nx = cx0 + dx(sd);
          const nz = cz0 + dz(sd);
          if (okCell(nx, nz) && standing((sx + nx + 0.5) / 2, (sz + nz + 0.5) / 2)) return true;
        }
      }
    }
    return false;
  };
  const take = (n: number): void => {
    while (chosen.length < n && lootC.length) {
      let total = 0;
      for (const q of lootC) total += q.w;
      let t = rng.next() * total;
      let pick = lootC.length - 1;
      for (let k = 0; k < lootC.length; k++) {
        t -= (lootC[k] as { w: number }).w;
        if (t <= 0) {
          pick = k;
          break;
        }
      }
      const q = lootC.splice(pick, 1)[0] as { x: number; z: number; y: number };
      // 两件东西别挤在一起
      if (chosen.some((c) => Math.abs(c.y - q.y) < 0.3 && Math.hypot(c.x - q.x, c.z - q.z) < 0.55) || !handy(q.x, q.z)) continue;
      chosen.push(q);
      b.lootAt(lx + q.x, lz + q.z, q.y, place);
    }
  };
  take(want);
  if (chosen.length < lootRange[0]) {
    // 候选位置不够（很小的棚子、东西堆满了）：走得到的空地中间也算
    for (let z = 0; z < PH; z++) {
      for (let x = 0; x < PW; x++) {
        if (okCell(x, z) && !cluttered[at(x, z)]) lootC.push({ x: x + 0.5 + rng.range(-0.15, 0.15), z: z + 0.5 + rng.range(-0.15, 0.15), y: F + 0.01, w: reserved[at(x, z)] ? 0.2 : 1 });
      }
    }
    take(lootRange[0]);
  }

  return { x0: lx + bx0, z0: lz + bz0, x1: lx + bx1, z1: lz + bz1, gx0: lx, gz0: lz, gx1: lx + PW, gz1: lz + PH, doors: outDoors, ports };
}
