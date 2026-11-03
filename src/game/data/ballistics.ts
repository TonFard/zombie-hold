import { WEAPONS, type WeaponKind } from './weapons';

/** 眼睛离地高度（米），子弹从这里出膛，视角相机也在这个高度 */
export const EYE_HEIGHT = 1.62;

/**
 * 子弹受到的重力加速度（米/秒²）。比真实的 9.8 大得多：真实子弹在这么短的射程里几乎不下坠，
 * 这里要让"远处要抬枪、子弹有飞行时间"在 20–30 米上能感觉到。
 */
export const BULLET_GRAVITY = 50;

/** 静态障碍（围墙、建筑、车辆）的高度。低于它的子弹会被挡住，高于它的会飞过去 */
export const WALL_HEIGHT = 3.2;
export const BARRICADE_HEIGHT = 1.15;
export const TURRET_HEIGHT = 1.4;

/** 子弹出膛点离眼睛多远（沿瞄准方向），避免子弹一出来就卡在自己脚边的东西里 */
export const MUZZLE_OFFSET = 0.55;

/**
 * 归零抬角：枪口微微上抬，让子弹在 zero 米处回到准星线上。
 * 平射公式 D = v²·sin(2θ)/g 反解。
 */
export function zeroPitch(kind: WeaponKind): number {
  const w = WEAPONS[kind];
  if (w.muzzle <= 0 || w.zero <= 0) return 0;
  const k = Math.min(1, (BULLET_GRAVITY * w.zero) / (w.muzzle * w.muzzle));
  return 0.5 * Math.asin(k);
}

/** 平射（准星水平）时，子弹飞出 dist 米（水平距离）后的离地高度。测试和平衡检查用 */
export function bulletHeightAt(kind: WeaponKind, dist: number, eye = EYE_HEIGHT): number {
  const w = WEAPONS[kind];
  const th = zeroPitch(kind);
  const vx = w.muzzle * Math.cos(th);
  const t = dist / vx;
  return eye + w.muzzle * Math.sin(th) * t - 0.5 * BULLET_GRAVITY * t * t;
}

/** 平射时子弹飞出 dist 米（水平距离）所用的时间 */
export function flightTime(kind: WeaponKind, dist: number): number {
  const w = WEAPONS[kind];
  return dist / (w.muzzle * Math.cos(zeroPitch(kind)));
}
