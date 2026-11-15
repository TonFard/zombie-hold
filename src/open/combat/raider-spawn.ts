import { GUN_LIST, type GunInfo } from '../game/api';
import { hash2 } from '../world/noise';
import { GRID } from '../world/roads';
import { siteLevel, type Interior, type Site } from '../world/sites';
import type { World } from '../world/world';
import type { Poi } from './raider-brain';
import type { Nav } from './zombie-nav';

/**
 * 带枪的人平时住在哪（纯逻辑）。和丧尸的坑位一个道理：哪个地点有一伙、几个人、拿什么枪，都按世界种子算，
 * 所以同一个地方每次去都是同一伙人；打光了以后空三个游戏日左右（raiders.ts 记账）。
 *
 *   起点和危险等级 1 的地点没有（开局手里什么都没有）；
 *   离出生点 1.2 公里以内的地点也没有，检查站和军事基地除外（SAFE_KM）：第一个镇子离起点 0.96 公里，是玩家头一个大的搜刮点，
 *     到那里时多半还是空手或者一根球棒；量过一个等级 2 拿格洛克的人 16 米外 6 秒打掉 125 血，那里要是有一伙就是必死；
 *   镇子、货场、加油站（等级 2 以上）大约三个里有一个有人；检查站、军事基地多半有，人更多、枪更好；农场、木屋偶尔有；
 *   等级 3 以上的地方（离出生点 2.2 公里以外），路上偶尔有两个人结伴走。
 * 枪是稀缺资源：等级低的拿一二级的枪（手枪、短管猎枪），四级的枪只在军事基地。
 */

/** 离出生点这么多公里以内的地点没有人（检查站、军事基地除外），路上结伴走的也没有 */
export const SAFE_KM = 1.2;

export interface Member {
  x: number;
  z: number;
  level: number;
  gun: string;
  /** 站岗的那个：不进屋搜，站在外面四处看 */
  watch: boolean;
  /** 军装（基地、检查站的人）：有头盔 */
  mil: boolean;
  name: string;
}

export interface Group {
  key: number;
  /** 这一伙待的地方（玩家离它多远决定出不出现） */
  x: number;
  z: number;
  level: number;
  members: Member[];
  /** 平时搜的几栋房子（路上走的那种是路上的两个点） */
  pois: Poi[] | null;
}

const NAMES = ['老周', '阿坤', '大刘', '瘸子', '眼镜', '小马', '铁头', '老六', '黑子', '阿亮', '胖虎', '秃鹫', '麻子', '二狗', '哑巴', '阿飞', '老猫', '钉子', '柱子', '豁牙', '长毛', '石磊', '冬子', '刀疤', '强子', '三炮', '阿杰', '栓子', '大奎', '耗子'];

const BY_TIER: GunInfo[][] = [[], [], [], [], []];
for (const g of GUN_LIST) (BY_TIER[g.tier] as GunInfo[]).push(g);

/** 路上那种的 key 从这里往上排（地点的 key × 4 到不了这么大） */
const ROAD = 2 ** 40;

export const nameFor = (u: number): string => NAMES[Math.floor(u * NAMES.length) % NAMES.length] as string;

/**
 * 按等级挑一把枪。u、v = 两个 0–1 的随机数（定哪一级、定这一级里的哪一把）；base = 军事基地的人（四级的枪只有他们有）
 *   等级 1–2：八成一级（手枪、短管猎枪），两成二级；等级 3：一级 45%、二级 40%、三级 15%；
 *   等级 4：一级 15%、二级 50%、三级 35%；等级 5：二级 45%、三级 55%。基地里等级 4 以上的两三成拿四级的
 */
export function pickGun(level: number, base: boolean, u: number, v: number): string {
  let tier = 1;
  if (level <= 2) tier = u < 0.8 ? 1 : 2;
  else if (level === 3) tier = u < 0.45 ? 1 : u < 0.85 ? 2 : 3;
  else if (level === 4) tier = base && u > 0.8 ? 4 : u < 0.15 ? 1 : u < 0.65 ? 2 : 3;
  else tier = base && u > 0.7 ? 4 : u < 0.45 ? 2 : 3;
  const list = BY_TIER[tier] as GunInfo[];
  return (list[Math.floor(v * list.length) % list.length] as GunInfo).id;
}

export class Planner {
  private readonly bySite = new Map<number, Group | null>();
  private readonly byEdge = new Map<number, Group | null>();
  private readonly hit: Site[] = [];
  private readonly seed: number;
  private readonly P = { x: 0, z: 0 };

  constructor(
    private readonly world: World,
    private readonly nav: Nav,
  ) {
    this.seed = world.seed;
  }

  /** (px, pz) 周围 r 米以内的所有的伙（out 会被清空重填）。地点的内容还没生成的先不算 */
  collect(px: number, pz: number, r: number, out: Group[]): void {
    out.length = 0;
    const hit = this.hit;
    hit.length = 0;
    this.world.sites.near(px, pz, r, hit);
    for (const s of hit) {
      const g = this.siteGroup(s);
      if (g && Math.hypot(g.x - px, g.z - pz) < r) out.push(g);
    }
    const i0 = Math.floor((px - r) / GRID) - 1;
    const i1 = Math.floor((px + r) / GRID) + 1;
    const j0 = Math.floor((pz - r) / GRID) - 1;
    const j1 = Math.floor((pz + r) / GRID) + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let a = 0; a < 2; a++) {
          const g = this.roadGroup(a, i, j);
          if (g && Math.hypot(g.x - px, g.z - pz) < r) out.push(g);
        }
      }
    }
  }

  /** 这个地点有没有人（只看种子，不用等内容生成；调试、地图用） */
  has(s: Site): boolean {
    if (s.kind === 'camp' || siteLevel(s) < 2) return false;
    // 出生点附近：只有检查站和军事基地有人（玩家走到第一个镇子时手里多半还没有枪）
    if (s.danger < SAFE_KM && s.kind !== 'post' && s.kind !== 'base') return false;
    const p = s.kind === 'base' ? 0.9 : s.kind === 'post' ? 0.7 : s.kind === 'town' || s.kind === 'yard' || s.kind === 'gas' ? 0.34 : 0.15;
    return hash2(s.i * 197 + 1, s.j * 229 - 1, this.seed + 900) < p;
  }

  private siteGroup(s: Site): Group | null {
    const cached = this.bySite.get(s.key);
    if (cached !== undefined) return cached;
    if (!this.has(s)) {
      this.bySite.set(s.key, null);
      return null;
    }
    const c = this.world.sites.peek(s);
    // 内容还没生成（玩家离得远）：下次再说
    if (!c) return null;
    if (this.bySite.size > 60) this.bySite.clear();
    const h = (n: number): number => hash2(s.i * 197 + n, s.j * 229 - n, this.seed + 900);
    const level = siteLevel(s);
    const base = s.kind === 'base';
    const grid = this.nav.at(s.x, s.z);
    // ---- 搜哪几栋房子：先按种子挑一栋，再加上离它最近的三栋（一伙人不会散到镇子两头去）
    const ok: Interior[] = [];
    for (const it of c.interiors) if (it.doors.length && it.free.length >= 16) ok.push(it);
    let pois: Poi[] | null = null;
    let ax = s.nx;
    let az = s.nz;
    if (ok.length) {
      const first = ok[Math.floor(h(3) * ok.length) % ok.length] as Interior;
      const cx = (first.rect.x0 + first.rect.x1) / 2;
      const cz = (first.rect.z0 + first.rect.z1) / 2;
      ok.sort((a, b) => Math.hypot((a.rect.x0 + a.rect.x1) / 2 - cx, (a.rect.z0 + a.rect.z1) / 2 - cz) - Math.hypot((b.rect.x0 + b.rect.x1) / 2 - cx, (b.rect.z0 + b.rect.z1) / 2 - cz));
      pois = [];
      for (let k = 0; k < ok.length && k < 4; k++) {
        const it = ok[k] as Interior;
        const d = it.doors[Math.floor(h(20 + k) * it.doors.length) % it.doors.length] as { ox: number; oz: number };
        const cells: number[] = [];
        const n = it.free.length / 2;
        for (let q = 0; q < 6; q++) {
          const ci = Math.floor(h(40 + k * 8 + q) * n) % n;
          cells.push(it.free[ci * 2] as number, it.free[ci * 2 + 1] as number);
        }
        pois.push({ x: d.ox, z: d.oz, cells });
      }
      ax = (pois[0] as Poi).x;
      az = (pois[0] as Poi).z;
    } else if (grid && grid.freeNear(s.x, s.z, this.P, 12)) {
      ax = this.P.x;
      az = this.P.z;
    }
    const n = base ? 3 + Math.floor(h(2) * 1.99) : 2 + Math.floor(h(2) * (level >= 4 ? 2.99 : 1.99));
    const members: Member[] = [];
    for (let k = 0; k < n; k++) {
      // 围着门口站开
      const a = h(60 + k) * 6.283;
      const r = 1.2 + 1.3 * k * 0.6 + h(70 + k);
      let x = ax + Math.sin(a) * r;
      let z = az + Math.cos(a) * r;
      if (grid && grid.blockedAt(x, z)) {
        if (grid.freeNear(x, z, this.P, 6)) {
          x = this.P.x;
          z = this.P.z;
        } else {
          x = ax;
          z = az;
        }
      }
      const lv = Math.max(2, level - (k > 0 && h(80 + k) < 0.4 ? 1 : 0));
      members.push({ x, z, level: lv, gun: pickGun(lv, base, h(90 + k), h(100 + k)), watch: k === 0, mil: base || s.kind === 'post' || lv >= 4, name: nameFor(h(110 + k)) });
    }
    const g: Group = { key: s.key * 4 + 1, x: ax, z: az, level, members, pois };
    this.bySite.set(s.key, g);
    return g;
  }

  /** 路上结伴走的两个人：路口 (i, j) 往东（a = 0）/ 往南（a = 1）的那条路上。大约八条路里有一条，而且要够远（等级 3 以上） */
  private roadGroup(a: number, i: number, j: number): Group | null {
    const key = ((i + 4096) * 8192 + (j + 4096)) * 2 + a;
    const cached = this.byEdge.get(key);
    if (cached !== undefined) return cached;
    if (this.byEdge.size > 400) this.byEdge.clear();
    let g: Group | null = null;
    const h = (n: number): number => hash2(i * 211 + n + a * 7, j * 241 - n, this.seed + 950);
    if (h(1) < 0.12) {
      const e = this.world.roads.edge(a === 0 ? 'h' : 'v', i, j);
      if (e && e.len > 200) {
        // 路中间那一段上的两个点，隔 70 米：两个人在这一段来回走
        const at = (s: number, out: { x: number; z: number }): void => {
          const p = e.pts;
          const cum = e.cum;
          let k = 1;
          while (k < cum.length - 1 && (cum[k] as number) < s) k++;
          const s0 = cum[k - 1] as number;
          const t = ((s - s0) / Math.max(1e-3, (cum[k] as number) - s0)) as number;
          out.x = (p[(k - 1) * 2] as number) + ((p[k * 2] as number) - (p[(k - 1) * 2] as number)) * t;
          out.z = (p[(k - 1) * 2 + 1] as number) + ((p[k * 2 + 1] as number) - (p[(k - 1) * 2 + 1] as number)) * t;
        };
        const s = e.len * (0.35 + 0.3 * h(2));
        const A = { x: 0, z: 0 };
        const B = { x: 0, z: 0 };
        at(s, A);
        at(s + 70, B);
        const level = Math.max(1, Math.min(5, 1 + Math.floor(Math.hypot(A.x, A.z) / 1100)));
        const w = this.world;
        // 等级 3 = 离出生点 2.2 公里以外，本来就比 SAFE_KM 远；两头都再查一遍，以后改了等级的算法也不会漏
        const far = Math.min(Math.hypot(A.x, A.z), Math.hypot(B.x, B.z)) >= SAFE_KM * 1000;
        if (level >= 3 && far && w.heightAt(A.x, A.z) > -11 && w.heightAt(B.x, B.z) > -11) {
          const members: Member[] = [];
          for (let k = 0; k < 2; k++) members.push({ x: A.x + (k ? 1.4 : -0.6), z: A.z + (k ? 0.8 : -0.5), level, gun: pickGun(level, false, h(10 + k), h(20 + k)), watch: false, mil: level >= 4, name: nameFor(h(30 + k)) });
          g = { key: ROAD + key, x: A.x, z: A.z, level, members, pois: [{ x: A.x, z: A.z, cells: [] }, { x: B.x, z: B.z, cells: [] }] };
        }
      }
    }
    this.byEdge.set(key, g);
    return g;
  }
}
