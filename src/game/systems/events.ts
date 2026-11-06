import type { Game } from '../sim';
import { HALF_H, HALF_W } from '../world/grid';
import { FEATURES } from '../data/features';

/**
 * 风险事件（M17）：白天开始时有一定概率出现一个，横幅说明代价和奖励，玩家在工坊里决定接不接。
 * 和夜晚词缀不同：词缀是强制的，事件是可选的——接了就要承担代价、拿到奖励，不接什么都不发生。
 *
 * 状态跟检查点一起存（Game.ev）；每日挑战里固定没有事件（大家条件一样）。
 */
export type RiskId = 'broadcast' | 'fuel' | 'survivor' | 'migration' | 'market';

export interface RiskDef {
  id: RiskId;
  name: string;
  cost: string;
  reward: string;
}

export const RISKS: Record<RiskId, RiskDef> = {
  broadcast: { id: 'broadcast', name: '军事广播', cost: '今夜多一只精英首领随从', reward: '今夜击杀的熟练度经验 ×2' },
  fuel: { id: 'fuel', name: '燃料告急', cost: '今夜发电机不能自修、炮塔射速 −20%', reward: '补给 +80（结算时）' },
  survivor: { id: 'survivor', name: '幸存者求救', cost: '白天去地图边缘的信号弹处，按住 E 4 秒（周围有守卫）', reward: '下一个黎明多 1 张卡牌可选' },
  migration: { id: 'migration', name: '尸潮迁徙', cost: '今夜一半的僵尸都从同一个入口来（会预告是哪个）', reward: '这一夜的勋章 ×1.3' },
  market: { id: 'market', name: '黑市商人', cost: '花 150 零件', reward: '下一次工坊升级免费' },
};
export const RISK_ORDER: RiskId[] = ['broadcast', 'fuel', 'survivor', 'migration', 'market'];

/** 出现概率（每个白天，第 2 天起） */
export const RISK_CHANCE = 0.25;
export const RISK_FX = { fuelTurret: 0.8, fuelSupplies: 80, survivorHold: 4, survivorGuards: 3, migrationShare: 0.5, migrationMedals: 1.3, marketCost: 150 };

export interface RiskState {
  /** 今天的事件（'' = 没有） */
  id: string;
  /** 0 = 没接，1 = 接了（生效中），2 = 完成 / 结算过 */
  stage: number;
  /** 尸潮迁徙：今晚哪个入口（刷怪点下标） */
  gate: number;
  /** 幸存者：信号弹的位置、按住 E 的进度（秒） */
  x: number;
  z: number;
  hold: number;
  /** 下一个黎明多一张卡（幸存者完成后置 1） */
  extraCard: number;
  /** 下一次工坊升级免费（黑市） */
  freeUpgrade: number;
  /** 本局累计：燃料告急给的补给、尸潮迁徙夜的勋章加成（结算时用） */
  supplies: number;
  migrationNights: number[];
  /** 这一夜熟练度经验 ×2（军事广播） */
  doubleXp: number;
  /** 军事广播的精英已经刷出来了 */
  eliteDone: number;
}

export const newRisk = (): RiskState => ({ id: '', stage: 0, gate: -1, x: 0, z: 0, hold: 0, extraCard: 0, freeUpgrade: 0, supplies: 0, migrationNights: [], doubleXp: 0, eliteDone: 0 });

/** 白天开始：按概率抽一个事件（不接也会预告） */
export function planRisk(g: Game): void {
  const e = g.ev;
  e.id = '';
  e.stage = 0;
  e.gate = -1;
  e.hold = 0;
  e.doubleXp = 0;
  e.eliteDone = 0;
  if (!FEATURES.riskEvents || !g.config.extras || g.config.daily || g.config.training || g.run.night < 2) return;
  if (g.rng.next() >= RISK_CHANCE) return;
  e.id = RISK_ORDER[g.rng.int(0, RISK_ORDER.length - 1)] as RiskId;
  if (e.id === 'migration') e.gate = g.rng.int(0, g.map.spawns.length - 1);
  if (e.id === 'survivor') placeFlare(g);
  const d = RISKS[e.id as RiskId];
  g.events.emit('banner', { text: `事件 · ${d.name}`, sub: `代价：${d.cost} · 奖励：${d.reward} · 去工坊决定接不接` });
}

/** 幸存者的信号弹：据点外、离发电机 20–32 米、可走的格子 */
function placeFlare(g: Game): void {
  for (let i = 0; i < 80; i++) {
    const cx = g.rng.int(4, 75);
    const cy = g.rng.int(4, 75);
    const idx = g.grid.idx(cx, cy);
    if (g.grid.solid[idx] || g.grid.buildable[idx]) continue;
    const x = cx - HALF_W + 0.5;
    const z = cy - HALF_H + 0.5;
    const d = Math.hypot(x - g.core.x, z - g.core.z);
    if (d < 20 || d > 32) continue;
    g.ev.x = x;
    g.ev.z = z;
    return;
  }
  g.ev.id = '';
}

/** 在工坊里接下事件。返回是否成功（黑市要够零件） */
export function acceptRisk(g: Game): boolean {
  const e = g.ev;
  if (!e.id || e.stage !== 0 || g.run.phase !== 'day') return false;
  if (e.id === 'market') {
    if (g.scrap < RISK_FX.marketCost) return false;
    g.scrap -= RISK_FX.marketCost;
    e.freeUpgrade = 1;
    e.stage = 2;
    g.events.emit('banner', { text: '黑市商人', sub: '下一次工坊升级免费' });
    return true;
  }
  e.stage = 1;
  if (e.id === 'survivor') {
    for (let i = 0; i < RISK_FX.survivorGuards; i++) {
      const a = (i / RISK_FX.survivorGuards) * Math.PI * 2;
      const z = g.spawnZombie(i === 0 && g.run.night >= 4 ? 'armored' : 'walker', e.x + Math.cos(a) * 2.4, e.z + Math.sin(a) * 2.4);
      if (z) z.goal = 'player';
    }
    g.events.emit('riskFlare', { x: e.x, z: e.z, on: true });
  }
  if (e.id === 'broadcast') e.doubleXp = 1;
  if (e.id === 'migration') g.events.emit('banner', { text: '尸潮迁徙', sub: `今晚一半的僵尸从 ${e.gate + 1} 号入口来` });
  return true;
}

/** 每帧：幸存者的按 E 读条（白天才算），入夜时结算各事件 */
export function updateRisk(g: Game, dt: number, holdingUse: boolean): void {
  const e = g.ev;
  if (e.id !== 'survivor' || e.stage !== 1) return;
  if (g.run.phase !== 'day') {
    // 入夜还没救到：作废
    e.stage = 2;
    g.events.emit('riskFlare', { x: e.x, z: e.z, on: false });
    return;
  }
  const p = g.player;
  const near = Math.hypot(p.x - e.x, p.z - e.z) < 1.8;
  e.hold = near && holdingUse ? e.hold + dt : Math.max(0, e.hold - dt * 2);
  if (e.hold >= RISK_FX.survivorHold) {
    e.stage = 2;
    e.extraCard = 1;
    g.events.emit('riskFlare', { x: e.x, z: e.z, on: false });
    g.events.emit('banner', { text: '幸存者获救', sub: '下一个黎明多 1 张卡牌可选' });
  }
}

/** 受伤打断幸存者的读条（守卫会打你） */
export function interruptRisk(g: Game): void {
  if (g.ev.id === 'survivor' && g.ev.stage === 1) g.ev.hold = 0;
}

/** 入夜时调用：燃料告急 / 尸潮迁徙 / 军事广播的这一夜效果从这里开始 */
export function nightRisk(g: Game): void {
  const e = g.ev;
  if (e.stage !== 1) return;
  if (e.id === 'fuel') e.supplies += RISK_FX.fuelSupplies;
  if (e.id === 'migration') e.migrationNights.push(g.run.night);
}

/** 这一夜某个效果是否生效 */
export const riskOn = (g: Game, id: RiskId): boolean => g.ev.id === id && g.ev.stage === 1 && g.run.phase === 'night';
