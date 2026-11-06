import type { Game } from '../sim';
import type { LootPoint } from '../world/types';
import { FEATURES } from '../data/features';

/**
 * 地图纵深（M18）：白天去据点外的搜刮点，按住 E 读条，受伤会打断。每个街区给的东西不一样：
 * 居民区补给 + 医疗、加油站手雷 / 燃烧弹、仓库大量零件、停车场熟练度经验。
 * 三个危险区（军事检查站 / 地下避难所 / 污染区）每局只开放一处，奖励更好、守卫更多、读条更久。
 *
 * 搜刮点放在 MapData.loot（地图数据），状态（搜过没有、读条进度）放在 Game.loot；每个白天刷新。
 */
export type LootKind = 'homes' | 'gas' | 'depot' | 'cars' | 'checkpoint' | 'bunker' | 'toxic';

export interface LootDef {
  name: string;
  /** 读条秒数 */
  hold: number;
  /** 附近刷几只守卫（危险区更多） */
  guards: number;
  reward: string;
}

export const LOOT: Record<LootKind, LootDef> = {
  homes: { name: '居民区', hold: 3, guards: 2, reward: '补给 +15、医疗包（回血 40）' },
  gas: { name: '加油站', hold: 3, guards: 2, reward: '手雷 +1、燃烧弹 +1' },
  depot: { name: '仓库', hold: 3, guards: 3, reward: '零件 +70' },
  cars: { name: '停车场', hold: 3, guards: 2, reward: '手上那把枪 +25 熟练度经验' },
  checkpoint: { name: '军事检查站', hold: 4, guards: 5, reward: '手上那把枪 +80 熟练度经验（升星用）' },
  bunker: { name: '地下避难所', hold: 5, guards: 4, reward: '医疗包回满 + 下一个黎明多 1 张卡' },
  toxic: { name: '污染区', hold: 4, guards: 3, reward: '补给 +50（地上的污水会持续伤人）' },
};

export const DANGER: LootKind[] = ['checkpoint', 'bunker', 'toxic'];
export const isDanger = (k: LootKind): boolean => DANGER.includes(k);

export interface LootState {
  /** 每个搜刮点：0 = 可以搜、1 = 搜过了 */
  taken: number[];
  /** 这一局开放的危险区（地图里危险区的下标；-1 = 没有） */
  open: number;
  /** 正在读条的搜刮点和进度（秒） */
  at: number;
  hold: number;
  /** 本局累计：搜刮给的补给（结算时加） */
  supplies: number;
}

export const newLoot = (): LootState => ({ taken: [], open: -1, at: -1, hold: 0, supplies: 0 });

/** 开局：随机挑一个危险区开放（每局只开一处） */
export function planLoot(g: Game): void {
  const pts = g.map.loot ?? [];
  const L = g.loot;
  L.taken = pts.map(() => 0);
  const dangers = pts.map((p, i) => (isDanger(p.kind) ? i : -1)).filter((i) => i >= 0);
  L.open = dangers.length ? (dangers[g.rng.int(0, dangers.length - 1)] as number) : -1;
  L.at = -1;
  L.hold = 0;
}

/** 某个搜刮点现在能不能搜：白天、没搜过、危险区要是本局开放的那一处 */
export function lootAvailable(g: Game, i: number): boolean {
  const p = (g.map.loot ?? [])[i];
  if (!p || g.run.phase !== 'day' || !g.config.extras || !FEATURES.lootSpots) return false;
  if (g.loot.taken[i]) return false;
  return !isDanger(p.kind) || g.loot.open === i;
}

/** 每个白天：普通搜刮点刷新（危险区一局只能搜一次），并在它们周围放守卫 */
export function refreshLoot(g: Game): void {
  const pts = g.map.loot ?? [];
  if (!g.config.extras || !FEATURES.lootSpots || !pts.length) return;
  if (g.loot.taken.length !== pts.length) planLoot(g);
  pts.forEach((p, i) => {
    if (!isDanger(p.kind)) g.loot.taken[i] = 0;
    if (!lootAvailable(g, i) || g.run.night < 2) return;
    // 守卫：围着搜刮点站一圈，玩家靠近就会追
    const def = LOOT[p.kind];
    for (let k = 0; k < def.guards; k++) {
      const a = (k / def.guards) * Math.PI * 2 + 0.4;
      const kind = isDanger(p.kind) ? (k === 0 && g.run.night >= 4 ? 'armored' : k === 1 && g.run.night >= 3 ? 'crawler' : 'walker') : 'walker';
      const z = g.spawnZombie(kind, p.x + Math.cos(a) * 2.6, p.z + Math.sin(a) * 2.6);
      if (z) z.goal = 'player';
    }
  });
}

/** 每帧：靠近可搜的点、按住 E 读条；离开或受伤就清零 */
export function updateLoot(g: Game, dt: number, holding: boolean): void {
  const pts = g.map.loot ?? [];
  if (!pts.length || g.run.phase !== 'day' || !g.config.extras) {
    g.loot.at = -1;
    g.loot.hold = 0;
    return;
  }
  const p = g.player;
  let near = -1;
  let bd = 1.8;
  pts.forEach((q, i) => {
    if (!lootAvailable(g, i)) return;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) {
      bd = d;
      near = i;
    }
  });
  const L = g.loot;
  if (near !== L.at) L.hold = 0;
  L.at = near;
  // 受伤打断读条（0.3 秒内挨过打）
  if (near < 0 || !holding || g.hurtT < 0.3) {
    L.hold = Math.max(0, L.hold - dt * 2);
    return;
  }
  L.hold += dt;
  const q = pts[near] as LootPoint;
  if (L.hold >= LOOT[q.kind].hold) {
    L.taken[near] = 1;
    L.hold = 0;
    L.at = -1;
    grant(g, q);
  }
}

/** 搜刮成功：按种类给奖励 */
function grant(g: Game, q: LootPoint): void {
  const L = g.loot;
  const p = g.player;
  const w = p.weapon;
  switch (q.kind) {
    case 'homes':
      L.supplies += 15;
      p.hp = Math.min(p.maxHp, p.hp + 40);
      break;
    case 'gas':
      g.hz.frags += 1;
      g.hz.fires += 1;
      break;
    case 'depot': {
      const n = Math.round(70 * g.mods.scrap);
      g.scrap += n;
      g.scrapEarned += n;
      g.events.emit('scrap', { x: q.x, z: q.z, amount: n });
      break;
    }
    case 'cars':
      g.stats.bonusXp[w] += 25;
      break;
    case 'checkpoint':
      g.stats.bonusXp[w] += 80;
      break;
    case 'bunker':
      p.hp = p.maxHp;
      g.ev.extraCard = 1;
      break;
    case 'toxic':
      L.supplies += 50;
      break;
  }
  g.events.emit('banner', { text: `搜刮 · ${q.name}`, sub: LOOT[q.kind].reward });
  g.events.emit('lootTaken', { x: q.x, z: q.z, kind: q.kind });
}

/** 污染区：污水范围内持续掉血（玩家，不分白天黑夜） */
export function toxicTick(g: Game, dt: number): void {
  if (!FEATURES.lootSpots) return;
  for (const q of g.map.loot ?? []) {
    if (q.kind !== 'toxic' || !q.r) continue;
    const p = g.player;
    if (p.alive && Math.hypot(p.x - q.x, p.z - q.z) < q.r) g.damagePlayer(6 * dt);
  }
}
