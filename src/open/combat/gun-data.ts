import { GUN_BY_ID } from '../../game/data/guns';
import { NO_MOD, WEAPONS, adsAt, effectiveStats, type WeaponKind, type WeaponStats } from '../../game/data/weapons';
import { AMMO_ITEM, GUN_LIST, type AmmoId, type GunClass } from '../game/api';

/**
 * 开放世界里每把枪的数值。伤害、射速、弹匣、换弹、散布、后坐、穿透全部来自主游戏
 * （data/weapons.ts 的 0 级数值 × data/guns.ts 的型号倍率），这样和丧尸模块用的主游戏血量对得上。
 * 这里只补开放世界才有的东西：半自动 / 全自动、打多远、枪声引多远、哪几把带瞄准镜。
 */

const DEG = Math.PI / 180;

export interface GunSpec {
  id: string;
  name: string;
  /** 开放世界里的分类（界面、枪声引多远、战利品表） */
  cls: GunClass;
  /** 主游戏里的分类：数值和视角模型按这个来（SKS 在主游戏里算射手步枪，所以带镜、单发重） */
  kind: WeaponKind;
  ammo: AmmoId;
  /** 弹药在背包里的物品 id */
  ammoItem: string;
  st: WeaponStats;
  /** 按住连发；false = 点一下打一发 */
  auto: boolean;
  /** 瞄准时是瞄准镜（满举镜后枪模藏起来，换成镜框） */
  scope: boolean;
  /** 瞄准时视野放大几倍 */
  zoom: number;
  /** 完全瞄准时散布剩下的比例 */
  adsSpread: number;
  /** 每发把视线抬高 / 左右摆多少（弧度） */
  recoilV: number;
  recoilH: number;
  /** 距离衰减：falloff0 米以内满伤害，到 reach 米降到 falloffMin，再远保持 */
  falloff0: number;
  reach: number;
  falloffMin: number;
  /** 子弹最远飞多远（米） */
  maxDist: number;
  /** 枪声引来多远的丧尸（米） */
  noise: number;
  /** 边走边腰射时散布变大的幅度 */
  moveSpread: number;
  /** 3 米内的伤害倍率（霰弹枪贴脸） */
  close: number;
}

/**
 * 主游戏的射程是按 60 米见方的据点地图调的（手枪 20 米、步枪 32 米）；开放世界一眼能看几百米，
 * 有效射程按枪类放大，子弹飞到 MAX_DIST 才消失
 */
const RANGE_K: Record<WeaponKind, number> = { pistol: 1.5, smg: 1.6, shotgun: 1.25, rifle: 2.2, sniper: 3, lmg: 2.2 };
const MAX_DIST: Record<WeaponKind, number> = { pistol: 120, smg: 110, shotgun: 45, rifle: 300, sniper: 500, lmg: 280 };
const NOISE: Record<GunClass, number> = { pistol: 60, smg: 70, rifle: 90, shotgun: 110, sniper: 110, lmg: 100 };
/** 这几把是半自动 / 栓动 / 泵动；其余的冲锋枪、步枪、机枪按住连发 */
const SEMI = new Set(['sks_tactical']);
/** 个别型号的瞄准倍率（SKS 上的是 1–6 倍的低倍镜，不是狙击镜） */
const ZOOM: Record<string, number> = { sks_tactical: 2.6 };

function build(): Record<string, GunSpec> {
  const out: Record<string, GunSpec> = {};
  for (const g of GUN_LIST) {
    const def = GUN_BY_ID[g.id];
    // 主游戏里没有这个型号（不该发生）：按开放世界的分类取这一类的基础数值
    const kind: WeaponKind = def?.cls ?? g.cls;
    const w = WEAPONS[kind];
    const st = effectiveStats(kind, 0, NO_MOD, def);
    const ads = adsAt(kind, 0);
    const reach = st.range * RANGE_K[kind];
    out[g.id] = {
      id: g.id,
      name: g.name,
      cls: g.cls,
      kind,
      ammo: g.ammo,
      ammoItem: AMMO_ITEM[g.ammo],
      st,
      auto: (kind === 'smg' || kind === 'rifle' || kind === 'lmg') && !SEMI.has(g.id),
      scope: ads.scope,
      zoom: ZOOM[g.id] ?? ads.zoom,
      adsSpread: ads.spread,
      recoilV: w.recoil.v * (def?.recoil ?? 1) * DEG,
      recoilH: w.recoil.h * (def?.recoil ?? 1) * DEG,
      falloff0: reach * w.falloff[0],
      reach,
      falloffMin: w.falloff[1],
      maxDist: MAX_DIST[kind],
      noise: NOISE[g.cls],
      moveSpread: w.moveSpread ?? 1,
      close: w.close ?? 1,
    };
  }
  return out;
}

export const GUN_SPECS: Record<string, GunSpec> = build();

/**
 * 别人开枪时放的采样：枪包里给第三人称录的那一份（比自己开枪的那份短、没有贴着耳朵的机械声）。
 * 相对 public/tacz/<枪 id>/sfx/，不带扩展名；左轮、SVD 的枪包自己没有，借的是同口径的
 */
const SHOT_FAR: Record<string, string> = {
  glock_17: 'glock_17/glock17_shoot_3p',
  m1911: 'm1911/m1911_shoot_3p',
  rhino357: 'deagle/deagle_shoot_3p',
  deagle: 'deagle/deagle_shoot_3p',
  uzi: 'uzi/uzi_shoot_3p',
  hk_mp5a5: 'hk_mp5a5/hk_mp5a5_shoot_3p',
  ump45: 'ump45/ump45_shoot_3p',
  db_short: 'db_short/db_shoot_3p',
  m870: 'm870/m870_shoot_3p',
  m1014: 'm1014/m1014_shoot_3p',
  sks_tactical: 'sks/sks_shoot_3p',
  ak47: 'ak47/ak47_shoot_3p',
  m4a1: 'm4a1/m4a1_shoot_3p',
  scar_h: 'scar_h/scar_h_shoot_3p',
  kar98: 'kar98/kar98_shoot_3p',
  svd: 'sks/sks_shoot_3p',
  rpk: 'rpk/rpk_shoot_3p',
  m249: 'm249/m249_shoot_3p',
};

const farUrls = new Map<string, string>();

/** 这把枪「别人开枪」的采样地址；不认识的枪返回空串。拼一次就记住（带枪的人每开一枪都来问一次） */
export function farShotUrl(id: string): string {
  let u = farUrls.get(id);
  if (u === undefined) {
    const f = SHOT_FAR[id];
    u = f ? `${import.meta.env.BASE_URL}tacz/${id}/sfx/${f}.ogg` : '';
    farUrls.set(id, u);
  }
  return u;
}

export const specOf = (id: string): GunSpec | undefined => GUN_SPECS[id];

/** 飞了 dist 米以后剩多少伤害 */
export function falloff(s: GunSpec, dist: number): number {
  if (dist <= s.falloff0 || s.falloffMin >= 1) return 1;
  if (dist >= s.reach) return s.falloffMin;
  return 1 + (s.falloffMin - 1) * ((dist - s.falloff0) / (s.reach - s.falloff0));
}
