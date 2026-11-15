import type { Vehicle } from './vehicle';

/**
 * 下车以后人站在哪。
 *
 * 按顺序试：驾驶员那边的门外 → 副驾那边的门外 → 车尾 → 车头；都不行就绕着车一圈一圈往外找最近的空地（先找离驾驶员的门近的）。
 * 一个点「能站」的条件（和 player.ts 的走路规则一致：半径 0.34、身高 1.75、能迈 0.45 的台阶）：
 *   不卡在墙 / 树 / 石头 / 别的车里（world.collide 推不动它，或者只推开一点点），当然也不在自己这台车的外壳里；
 *   水不深（不到小腿）；和车差不多高（不是坎上、沟里）、不是陡坡；
 *   从车身到这个点之间没有东西挡着（不然会「下车」下到墙的另一边、隔壁屋里）。
 * 条件一轮比一轮松（见 LEVELS），所以不会找不到：最差也是驾驶员门外那个点被 collide 推到的位置。
 */

/** 和 player.ts 一样 */
const R = 0.34;
const H = 1.75;
const STEP = 0.45;
/** 水深超过这个不算能落脚（米） */
const WADE = 0.5;

export interface ExitWorld {
  groundAt(x: number, z: number): number;
  waterDepth(x: number, z: number): number;
  topAt(x: number, z: number, r: number, feet: number, step: number): number;
  collide(p: { x: number; z: number }, feet: number, height: number, r: number, step: number, withDynamic?: boolean): boolean;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, terrain?: boolean): number;
}

export type ExitKind = 'driver' | 'passenger' | 'rear' | 'front' | 'search' | 'forced';

export interface ExitSpot {
  x: number;
  z: number;
  /** 脚底的高度 */
  feet: number;
  kind: ExitKind;
  /** 用的是第几轮的条件（0 = 全部满足） */
  level: number;
}

/** 一轮比一轮松：要不要「和车之间没东西挡着」、水最深多少、要不要看高度差和坡度 */
const LEVELS: ReadonlyArray<{ los: boolean; water: number; shape: boolean }> = [
  { los: true, water: WADE, shape: true },
  { los: false, water: 1.0, shape: true },
  { los: false, water: Infinity, shape: false },
];

const _p = { x: 0, z: 0 };
const _q = { x: 0, z: 0 };

/** 脚底：地形和能站的顶面（地板、台子）里高的那个——和 Player.teleport 算的一样 */
function feetAt(w: ExitWorld, x: number, z: number): number {
  const g = w.groundAt(x, z);
  return Math.max(g, w.topAt(x, z, R, g, STEP));
}

/** 从车身外壳上最近的那一点到 (x, z) 之间有没有东西挡着（墙、树、石头、别的车） */
function clear(w: ExitWorld, v: Vehicle, x: number, z: number, feet: number, carY: number): boolean {
  const [lx, lz] = v.toHull(x, z);
  const qx = Math.max(-v.hull.hx, Math.min(v.hull.hx, lx));
  const qz = Math.max(-v.hull.hz, Math.min(v.hull.hz, lz));
  const d = Math.hypot(lx - qx, lz - qz);
  if (d < 0.06) return true;
  // 从外壳外面两厘米起：射线不会打到自己这台车
  const k = 0.02 / d;
  const [sx, sz] = v.fromHull(qx + (lx - qx) * k, qz + (lz - qz) * k);
  const dx = x - sx;
  const dz = z - sz;
  const L = Math.hypot(dx, dz);
  if (L < 0.05) return true;
  const base = Math.max(feet, carY);
  for (const h of [0.55, 1.25]) if (w.raycast(sx, base + h, sz, dx / L, 0, dz / L, L, false) < L - 0.02) return false;
  return true;
}

function test(w: ExitWorld, v: Vehicle, x: number, z: number, level: number, carY: number, out: ExitSpot): boolean {
  const rule = LEVELS[level] as (typeof LEVELS)[number];
  // 便宜的先查：水
  if (w.waterDepth(x, z) > rule.water) return false;
  let feet = feetAt(w, x, z);
  _p.x = x;
  _p.z = z;
  if (w.collide(_p, feet, H, R, STEP, true)) {
    // 被推了一下：推得不远、推完以后不再碰东西才算
    if (Math.hypot(_p.x - x, _p.z - z) > 0.4) return false;
    feet = feetAt(w, _p.x, _p.z);
    _q.x = _p.x;
    _q.z = _p.z;
    if (w.collide(_q, feet, H, R, STEP, true) && Math.hypot(_q.x - _p.x, _q.z - _p.z) > 0.01) return false;
    if (w.waterDepth(_p.x, _p.z) > rule.water) return false;
  }
  if (rule.shape) {
    // 和车差太多（坎上、沟里）、太陡的地方不要
    if (Math.abs(feet - carY) > 1.5) return false;
    const sx = Math.abs(w.groundAt(_p.x + 0.5, _p.z) - w.groundAt(_p.x - 0.5, _p.z));
    const sz = Math.abs(w.groundAt(_p.x, _p.z + 0.5) - w.groundAt(_p.x, _p.z - 0.5));
    if (Math.max(sx, sz) > 1.1) return false;
  }
  if (rule.los && !clear(w, v, _p.x, _p.z, feet, carY)) return false;
  out.x = _p.x;
  out.z = _p.z;
  out.feet = feet;
  out.level = level;
  return true;
}

/** 绕着车一圈一圈往外找时，每一圈离外壳多远（人的圆心到外壳，米） */
const RINGS = [0.55, 0.95, 1.4, 1.9, 2.5, 3.2, 4.0, 5.0, 6.2, 7.6, 9.2, 11, 13, 15.5, 18.5, 22];

/** 离外壳 d 米的那一圈（圆角矩形）上每隔 0.7 米一个点，外壳坐标 */
function ring(v: Vehicle, d: number, out: Array<[number, number]>): void {
  out.length = 0;
  const hx = v.hull.hx;
  const hz = v.hull.hz;
  const step = 0.7;
  const nz = Math.max(1, Math.round((2 * hz) / step));
  const nx = Math.max(1, Math.round((2 * hx) / step));
  for (let i = 0; i <= nz; i++) {
    const z = -hz + (2 * hz * i) / nz;
    out.push([-(hx + d), z], [hx + d, z]);
  }
  for (let i = 0; i <= nx; i++) {
    const x = -hx + (2 * hx * i) / nx;
    out.push([x, -(hz + d)], [x, hz + d]);
  }
  // 四个圆角：至少各有中间 45° 那一个点
  const na = Math.max(2, Math.round((Math.PI * d) / 2 / step) + 1);
  for (let i = 1; i < na; i++) {
    const a = (i / na) * (Math.PI / 2);
    const c = Math.cos(a) * d;
    const s = Math.sin(a) * d;
    out.push([hx + c, hz + s], [-hx - c, hz + s], [hx + c, -hz - s], [-hx - c, -hz - s]);
  }
}

const _ring: Array<[number, number]> = [];

/** 车门大概这么长（米）；人站在门扫过的弧线外面这么远 */
const DOOR_LEN = 1.15;
const DOOR_CLEAR = 0.3;

/** 驾驶员那扇门外面的点（外壳坐标：x 右、z 后） */
export function doorPoint(v: Vehicle, sideSign: number): [number, number] {
  // 车包里的 exitR 是从车身中线量的；人的圆和外壳之间至少留 12 厘米
  const out = Math.max(v.def.layout.exitR || 0, v.hull.hx + R + 0.12);
  let z = -(v.def.layout.exitF ?? 0);
  // 门是往前开的（铰链在前）：站得靠后一点，门开关的时候不会从脸上扫过去。两边取一样的位置
  const piv = v.driverDoor ? v.def.bones[v.driverDoor] : undefined;
  if (piv) {
    const dx = out - Math.abs(piv[0]);
    const need = DOOR_LEN + DOOR_CLEAR;
    if (dx < need) z = Math.max(z, piv[2] + Math.sqrt(need * need - dx * dx));
  }
  return [sideSign * out - v.hull.cx, z - v.hull.cz];
}

export function findExit(w: ExitWorld, v: Vehicle): ExitSpot {
  v.updateHull();
  const side = v.side || -1;
  const carY = v.bottom - v.hull.y0;
  const spot: ExitSpot = { x: 0, z: 0, feet: 0, kind: 'forced', level: 0 };
  const door = doorPoint(v, side);
  const first: Array<[ExitKind, number, number]> = [
    ['driver', door[0], door[1]],
    ['passenger', -door[0], door[1]],
    ['rear', 0, v.hull.hz + R + 0.45],
    ['front', 0, -(v.hull.hz + R + 0.45)],
  ];
  for (let level = 0; level < LEVELS.length; level++) {
    for (const [kind, lx, lz] of first) {
      const [x, z] = v.fromHull(lx, lz);
      if (test(w, v, x, z, level, carY, spot)) {
        spot.kind = kind;
        return spot;
      }
    }
    for (const d of RINGS) {
      ring(v, d, _ring);
      // 一圈里先试离驾驶员的门近的
      _ring.sort((a, b) => Math.hypot(a[0] - door[0], a[1] - door[1]) - Math.hypot(b[0] - door[0], b[1] - door[1]));
      for (const [lx, lz] of _ring) {
        const [x, z] = v.fromHull(lx, lz);
        if (test(w, v, x, z, level, carY, spot)) {
          spot.kind = 'search';
          return spot;
        }
      }
    }
  }
  // 哪儿都不行（实际上到不了这里）：驾驶员门外那个点，让 collide 把人推到不卡的地方
  const [x, z] = v.fromHull(door[0], door[1]);
  _p.x = x;
  _p.z = z;
  w.collide(_p, feetAt(w, x, z), H, R, STEP, true);
  spot.x = _p.x;
  spot.z = _p.z;
  spot.feet = feetAt(w, _p.x, _p.z);
  spot.kind = 'forced';
  spot.level = LEVELS.length;
  return spot;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 下车以后脸朝哪：尽量接着相机原来看的方向（want）；那边一米多就是墙（或者正对着自己的车）就换——
 * 车头方向、背对车、车尾方向里第一个前面有两米空地的；都没有就取最空的那个。
 * 朝向的约定和玩家一样：yaw 对应的方向是 (sin yaw, cos yaw)。
 */
export function exitYaw(w: ExitWorld, v: Vehicle, spot: ExitSpot, want: number, eye: number): number {
  const heading = v.body.heading();
  const [lx, lz] = v.toHull(spot.x, spot.z);
  const qx = Math.max(-v.hull.hx, Math.min(v.hull.hx, lx));
  const qz = Math.max(-v.hull.hz, Math.min(v.hull.hz, lz));
  const [cx, cz] = v.fromHull(qx, qz);
  const away = Math.atan2(spot.x - cx, spot.z - cz);
  const list = [want, heading + Math.PI, away, heading];
  let best = want;
  let bestD = -1;
  for (const yaw of list) {
    const d = Math.min(6, w.raycast(spot.x, spot.feet + eye, spot.z, Math.sin(yaw), 0, Math.cos(yaw), 6, false));
    if (d >= 2) return wrap(yaw);
    if (d > bestD) {
      bestD = d;
      best = yaw;
    }
  }
  return wrap(best);
}
