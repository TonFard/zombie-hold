import { hash2 } from '../world/noise';
import { siteLevel, type Interior, type Site } from '../world/sites';
import type { World } from '../world/world';
import type { Nav } from './zombie-nav';
import type { ZKind } from './zombie-types';

/**
 * 丧尸住在哪（纯逻辑）。世界上到处是「坑位」：每个坑位是一只丧尸平时待的地方，位置、种类都由种子算出来，
 * 所以同一栋房子里每次去都是那几只。玩家走近了坑位才变成真的丧尸（horde.ts），打死以后坑位空一个游戏日以上。
 *
 *   地点里：每栋房子按大小和危险等级住 0–5 只（站在屋里的空格上），院子按地块面积撒，穿过地点的路上、路边再放一批（玩家最先看到的就是它们）；
 *   野地里：64 米一格，大约十格才有一只，路上稍多一点；
 *   夜里：每处多出差不多一倍（night = true 的坑位），野地里偶尔有三只一伙的。
 * 营地（出生点）和它周围不放：开局手里什么都没有。
 */

export interface Slot {
  key: number;
  x: number;
  z: number;
  /** 住在哪栋房子里（屋外的是 null） */
  house: Interior | null;
  /** 所在地点的危险等级 1–5 */
  level: number;
  /** 只在夜里有 */
  night: boolean;
  /** 0–1：决定是哪一种 */
  u: number;
}

const CELL = 64;
/** 野地坑位的 key 从这里往上排（地点的 key × 4096 到不了这么大） */
const WILD = 2 ** 44;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class Spawner {
  private readonly bySite = new Map<number, Slot[]>();
  private readonly byCell = new Map<number, Slot[]>();
  /** 打死过的坑位：key → 什么时候才会再有（Horde 的时钟，秒） */
  readonly cleared = new Map<number, number>();
  private readonly hit: Site[] = [];
  private readonly probe: Site[] = [];
  private readonly seed: number;
  private readonly camp: { x: number; z: number };

  constructor(
    private readonly world: World,
    private readonly nav: Nav,
  ) {
    this.seed = world.seed;
    const c = world.sites.at(0, 0);
    this.camp = c ? { x: c.x, z: c.z } : { x: 0, z: 0 };
  }

  /** 按坑位的随机数、危险等级和现在多黑定种类：大多是行尸，夜里和危险的地方奔袭者多，等级 3 以上偶尔有肿胀者 / 重装 */
  kindFor(s: Slot, night: number): ZKind {
    const L = s.level;
    let u = s.u;
    const tough = L >= 3 ? 0.045 + 0.03 * (L - 3) : 0;
    if (u < tough) return u < tough * 0.5 ? 'bloater' : 'armored';
    u = (u - tough) / (1 - tough);
    const runner = 0.06 + 0.035 * L + 0.13 * night;
    if (u < runner) return 'runner';
    if (u < runner + 0.07) return 'crawler';
    return 'walker';
  }

  /** (px, pz) 周围 r 米以内的所有坑位（out 会被清空重填） */
  collect(px: number, pz: number, r: number, out: Slot[]): void {
    out.length = 0;
    const hit = this.hit;
    hit.length = 0;
    this.world.sites.near(px, pz, r, hit);
    const r2 = r * r;
    for (const s of hit) {
      const list = this.siteSlots(s);
      if (!list) continue;
      for (const q of list) if ((q.x - px) ** 2 + (q.z - pz) ** 2 < r2) out.push(q);
    }
    const c0 = Math.floor((px - r) / CELL);
    const c1 = Math.floor((px + r) / CELL);
    const d0 = Math.floor((pz - r) / CELL);
    const d1 = Math.floor((pz + r) / CELL);
    for (let cz = d0; cz <= d1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        for (const q of this.wildSlots(cx, cz)) if ((q.x - px) ** 2 + (q.z - pz) ** 2 < r2) out.push(q);
      }
    }
  }

  /** 一个地点的坑位。地点的内容还没生成（玩家离得远）时返回 null，不触发生成 */
  private siteSlots(s: Site): Slot[] | null {
    const hit = this.bySite.get(s.key);
    if (hit) return hit;
    const c = this.world.sites.peek(s);
    if (!c) return null;
    const list: Slot[] = [];
    if (this.bySite.size > 24) this.bySite.clear();
    this.bySite.set(s.key, list);
    if (s.kind === 'camp') return list;
    const level = siteLevel(s);
    const grid = this.nav.at(s.x, s.z);
    const h = (n: number): number => hash2(s.i * 131 + n, s.j * 173 - n, this.seed + 500);
    const base = s.key * 4096;
    const inHouse = (x: number, z: number): boolean => {
      for (const it of c.interiors) if (x > it.rect.x0 - 1.2 && x < it.rect.x1 + 1.2 && z > it.rect.z0 - 1.2 && z < it.rect.z1 + 1.2) return true;
      return false;
    };
    // ---- 屋里
    c.interiors.forEach((it, hi) => {
      const cells = it.free.length / 2;
      if (cells < 6 || hi >= 60) return;
      const want = (0.4 + 0.42 * level) * clamp(cells / 32, 0.6, 2.2);
      const day = Math.floor(want) + (h(hi * 31 + 1) < want % 1 ? 1 : 0);
      const night = Math.ceil(day * 0.6) + (h(hi * 31 + 2) < 0.5 ? 1 : 0);
      const used = new Set<number>();
      const n = Math.min(15, day + night, cells);
      for (let k = 0; k < n; k++) {
        let ci = Math.floor(h(hi * 31 + 5 + k) * cells);
        while (used.has(ci)) ci = (ci + 1) % cells;
        used.add(ci);
        list.push({ key: base + hi * 16 + k, x: it.free[ci * 2] as number, z: it.free[ci * 2 + 1] as number, house: it, level, night: k >= day, u: h(hi * 31 + 40 + k) });
      }
    });
    // ---- 院子、街上：每块地按面积撒
    const place = (key: number, n: number, x0: number, z0: number, x1: number, z1: number, day: boolean): void => {
      for (let t = 0; t < 5; t++) {
        const x = x0 + h(n * 13 + t * 3 + 1) * (x1 - x0);
        const z = z0 + h(n * 13 + t * 3 + 2) * (z1 - z0);
        if (inHouse(x, z) || (grid && grid.blockedAt(x, z))) continue;
        list.push({ key, x, z, house: null, level, night: !day, u: h(n * 13 + 9) });
        return;
      }
    };
    s.lots.forEach((l, li) => {
      if (li >= 4) return;
      const day = Math.round((((l.x1 - l.x0) * (l.z1 - l.z0)) / 2300) * (1.5 + 1.2 * level));
      const total = Math.min(60, day * 2);
      for (let k = 0; k < total; k++) place(base + 1024 + li * 64 + k, 1000 + li * 100 + k, l.x0 + 2, l.z0 + 2, l.x1 - 2, l.z1 - 2, k < day);
    });
    // ---- 街上：穿过地点的路上、路边。院子里的大多被房子挡着，从街上走过时看到的主要是这一批
    const R = Math.min(60, s.r * 0.75);
    const segs = this.world.roads.segsIn(s.nx - R, s.nz - R, s.nx + R, s.nz + R, 0);
    // 每段路在这个范围里的有多长（八等分，数一数有几份在里面）
    const lens: number[] = [];
    let road = 0;
    for (const sg of segs) {
      let inside = 0;
      for (let q = 0; q < 8; q++) {
        const u = (q + 0.5) / 8;
        if (Math.abs(sg.ax + (sg.bx - sg.ax) * u - s.nx) <= R && Math.abs(sg.az + (sg.bz - sg.az) * u - s.nz) <= R) inside++;
      }
      const len = (Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) * inside) / 8;
      lens.push(len);
      road += len;
    }
    // 一只管多长的路：等级 1 是 30 米，等级 5 是 10 米（夜里再多一倍）。镇子的十字路口白天十来只，林子里的小屋门口两三只
    const street = Math.min(24, Math.round(((1 + level) * road) / 60));
    for (let k = 0; k < street * 2; k++) {
      const n = 2000 + k;
      for (let t = 0; t < 5; t++) {
        // 按长度挑一段路，在它上面随便取一点，再往两边偏一点（路面、路肩、人行道）
        let pick = h(n * 13 + t * 3 + 1) * road;
        let si = 0;
        while (si < segs.length - 1 && pick > (lens[si] as number)) pick -= lens[si++] as number;
        const sg = segs[si];
        if (!sg) break;
        const u = h(n * 13 + t * 3 + 2);
        const dx = sg.bx - sg.ax;
        const dz = sg.bz - sg.az;
        const L = Math.hypot(dx, dz) || 1;
        const off = (h(n * 13 + t * 3 + 3) - 0.5) * (sg.w + 7);
        const x = sg.ax + dx * u + (-dz / L) * off;
        const z = sg.az + dz * u + (dx / L) * off;
        if (Math.abs(x - s.nx) > R + 4 || Math.abs(z - s.nz) > R + 4) continue;
        if (inHouse(x, z) || (grid && grid.blockedAt(x, z)) || this.world.waterDepth(x, z) > 0.15) continue;
        list.push({ key: base + 2048 + k, x, z, house: null, level, night: k >= street, u: h(n * 13 + 9) });
        break;
      }
    }
    return list;
  }

  /** 野地：64 米一格 */
  private wildSlots(cx: number, cz: number): Slot[] {
    const key = (cx + 32768) * 65536 + (cz + 32768);
    const hit = this.byCell.get(key);
    if (hit) return hit;
    const list: Slot[] = [];
    if (this.byCell.size > 3000) this.byCell.clear();
    this.byCell.set(key, list);
    const w = this.world;
    const sd = this.seed;
    const x0 = cx * CELL;
    const z0 = cz * CELL;
    const level = clamp(1 + Math.floor(Math.hypot(x0, z0) / 1100), 1, 5);
    const add = (k: number, x: number, z: number, night: boolean): void => {
      // 水里、地点里（地点自己有坑位）、出生的营地周围不放
      if (w.waterDepth(x, z) > 0.15 || Math.hypot(x - this.camp.x, z - this.camp.z) < 110) return;
      const near = this.probe;
      near.length = 0;
      w.sites.near(x, z, 4, near);
      if (near.length) return;
      list.push({ key: WILD + key * 8 + k, x, z, house: null, level, night, u: hash2(cx * 7 + k, cz * 11 - k, sd + 605) });
    };
    const u = hash2(cx, cz, sd + 601);
    const at = (k: number): [number, number] => [x0 + hash2(cx + k * 17, cz, sd + 602) * CELL, z0 + hash2(cx, cz + k * 17, sd + 603) * CELL];
    if (u < 0.1) add(0, ...at(0), false);
    // 夜里：再多一些，偶尔三只一伙
    const v = hash2(cx, cz, sd + 604);
    if (v < 0.2) {
      const [x, z] = at(1);
      add(1, x, z, true);
      if (v < 0.05) {
        add(2, x + 2.2, z + 1.1, true);
        add(3, x - 1.4, z + 2.3, true);
      }
    }
    // 路上：路过这一格的路上偶尔站着一只
    const r = hash2(cx, cz, sd + 606);
    if (r < 0.3) {
      const segs = w.roads.segsIn(x0, z0, x0 + CELL, z0 + CELL, 0);
      const sg = segs[0];
      if (sg) {
        const t = hash2(cx, cz, sd + 607);
        const off = (hash2(cx, cz, sd + 608) - 0.5) * sg.w;
        const dx = sg.bx - sg.ax;
        const dz = sg.bz - sg.az;
        const L = Math.hypot(dx, dz) || 1;
        add(4, sg.ax + dx * t + (-dz / L) * off, sg.az + dz * t + (dx / L) * off, r >= 0.12);
      }
    }
    return list;
  }
}
