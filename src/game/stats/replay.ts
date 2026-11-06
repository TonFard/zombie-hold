import { WEAPON_ORDER, WEAPONS } from '../data/weapons';
import { DAMAGE_SRC, type DamageSrc, type GameStats, type NightLog } from '../sim';

/** 结算页「复盘」：每个来源的伤害 / 击杀占比、每夜时间线、关键事件和一句建议 */
export interface ReplayShare {
  id: string;
  name: string;
  damage: number;
  kills: number;
  /** 伤害占比 0–1 */
  share: number;
  /** 枪：开火时间（秒） */
  fire?: number;
}

export interface Replay {
  shares: ReplayShare[];
  totalDamage: number;
  nights: NightLog[];
  /** 关键事件（1–3 条） */
  moments: string[];
  /** 一句建议 */
  tips: string[];
  structDamage: number;
  coreDamage: number;
}

export const SRC_NAME: Record<DamageSrc, string> = { turret: '炮塔', spikes: '地刺', explosive: '爆炸物', grenade: '手雷', pulse: '电击脉冲', chain: '连锁爆炸', fire: '火焰', other: '其他' };

export function buildReplay(s: GameStats, lostReason: string): Replay {
  const shares: ReplayShare[] = [];
  for (const k of WEAPON_ORDER) {
    if (s.weaponDamage[k] > 0 || s.weaponKills[k] > 0) shares.push({ id: k, name: WEAPONS[k].name, damage: s.weaponDamage[k], kills: s.weaponKills[k], share: 0, fire: s.fireTime[k] });
  }
  for (const k of DAMAGE_SRC) {
    if (s.srcDamage[k] > 0 || s.srcKills[k] > 0) shares.push({ id: k, name: SRC_NAME[k], damage: s.srcDamage[k], kills: s.srcKills[k], share: 0 });
  }
  const total = shares.reduce((a, x) => a + x.damage, 0);
  for (const x of shares) x.share = total > 0 ? x.damage / total : 0;
  shares.sort((a, b) => b.damage - a.damage);

  const nights = s.nights.map((n) => ({ ...n }));
  const moments: string[] = [];
  const worst = [...nights].sort((a, b) => a.coreLow - b.coreLow)[0];
  if (worst && worst.coreLow < 0.95) moments.push(`第 ${worst.night} 夜发电机最危险，只剩 ${Math.round(worst.coreLow * 100)}%`);
  const firstLost = nights.find((n) => n.lost > 0);
  if (firstLost) moments.push(`第 ${firstLost.night} 夜第一次有建筑被拆（${firstLost.lost} 座）`);
  const boss = nights.find((n) => n.boss > 0);
  if (boss) moments.push(`第 ${boss.night} 夜击败首领`);
  const hurt = [...nights].sort((a, b) => b.hurt - a.hurt)[0];
  if (moments.length < 3 && hurt && hurt.hurt > 60) moments.push(`第 ${hurt.night} 夜受伤最多（${Math.round(hurt.hurt)} 点）`);

  // 建议：按规则挑最相关的一两条
  const tips: string[] = [];
  const turret = (s.srcDamage.turret + s.srcDamage.spikes) / Math.max(1, total);
  const top = shares[0];
  if (turret > 0.6) tips.push('炮塔打了六成以上的伤害——主武器可以多升几级，别把零件全放在炮塔上');
  else if (turret < 0.1 && s.kills > 50) tips.push('炮塔几乎没出力：在入口放一两座，夜里能替你挡住侧翼');
  if (lostReason === 'core' && worst) tips.push(`发电机在第 ${worst.night} 夜被打穿：看看是哪个入口进来的，在那里多放路障`);
  if (lostReason === 'player') tips.push('是你先倒下的：多用推搡（V）和后撤，别被围住；局外的「防弹插板」「急救训练」也有用');
  if (top && top.id === 'pistol' && s.kills > 80) tips.push('大部分伤害还是手枪打的：攒零件早点买主武器');
  if (s.kills > 0 && s.headshotKills / s.kills < 0.08) tips.push(`爆头击杀只有 ${Math.round((s.headshotKills / s.kills) * 100)}%：爆头给双倍熟练度经验，瞄头更快升级`);
  return { shares, totalDamage: total, nights, moments: moments.slice(0, 3), tips: tips.slice(0, 2), structDamage: s.structDamage, coreDamage: s.coreDamage };
}
