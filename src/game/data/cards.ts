import type { Game } from '../sim';

export type CardRarity = 'common' | 'rare' | 'epic';

export interface CardDef {
  id: string;
  name: string;
  desc: string;
  rarity: CardRarity;
  /** 最多叠几张 */
  max: number;
  apply(g: Game): void;
}

export const RARITY_WEIGHT: Record<CardRarity, number> = { common: 70, rare: 25, epic: 5 };
export const RARITY_NAME: Record<CardRarity, string> = { common: '普通', rare: '稀有', epic: '史诗' };

/** 建筑生命倍率变化时，已经建好的建筑按比例调整 */
function scaleStructures(g: Game, ratio: number): void {
  for (const s of g.structures.values()) {
    if (s.kind === 'spikes') continue;
    s.maxHp = Math.round(s.maxHp * ratio);
    s.hp = Math.round(s.hp * ratio);
  }
}

export const CARDS: CardDef[] = [
  // ---- 普通 ----
  { id: 'vitality', name: '强健体魄', desc: '最大生命 +20，并立刻恢复 20', rarity: 'common', max: 4, apply: (g) => { g.player.maxHp += 20; g.player.hp = Math.min(g.player.maxHp, g.player.hp + 20); } },
  { id: 'agility', name: '轻装上阵', desc: '移动速度 +8%', rarity: 'common', max: 3, apply: (g) => { g.mods.speed *= 1.08; } },
  { id: 'fortify', name: '加固路障', desc: '路障和炮塔生命 +30%', rarity: 'common', max: 3, apply: (g) => { g.mods.structHp *= 1.3; scaleStructures(g, 1.3); } },
  { id: 'overclock', name: '炮塔超频', desc: '炮塔射速 +20%', rarity: 'common', max: 3, apply: (g) => { g.mods.turretRate *= 1.2; } },
  { id: 'scavenger', name: '拾荒者', desc: '零件收益 +15%', rarity: 'common', max: 3, apply: (g) => { g.mods.scrap *= 1.15; } },
  { id: 'quickhands', name: '快手装填', desc: '换弹速度 +10%', rarity: 'common', max: 3, apply: (g) => { g.mods.reload *= 1.1; } },
  { id: 'endurance', name: '肾上腺素', desc: '冲刺体力消耗 −25%', rarity: 'common', max: 2, apply: (g) => { g.mods.staminaUse *= 0.75; } },
  { id: 'medkit', name: '战地急救', desc: '立刻恢复 60 点生命', rarity: 'common', max: 99, apply: (g) => { g.player.hp = Math.min(g.player.maxHp, g.player.hp + 60); } },
  // ---- 稀有 ----
  { id: 'crit', name: '致命一击', desc: '暴击率 +8%（暴击双倍伤害）', rarity: 'rare', max: 3, apply: (g) => { g.mods.crit += 0.08; } },
  { id: 'ap', name: '钢芯炮弹', desc: '炮塔和地刺伤害 +25%', rarity: 'rare', max: 3, apply: (g) => { g.mods.turret *= 1.25; } },
  { id: 'armor', name: '重型护甲', desc: '受到的伤害 −12%', rarity: 'rare', max: 3, apply: (g) => { g.mods.armor *= 0.88; } },
  { id: 'corehp', name: '发电机强化', desc: '发电机最大生命 +150，并修复 150', rarity: 'rare', max: 3, apply: (g) => { g.core.maxHp += 150; g.core.hp = Math.min(g.core.maxHp, g.core.hp + 150); } },
  { id: 'gunsmith', name: '弹药专家', desc: '所有武器伤害 +10%', rarity: 'rare', max: 4, apply: (g) => { g.mods.damage *= 1.1; } },
  // ---- 史诗 ----
  { id: 'lifesteal', name: '嗜血', desc: '每次击杀恢复 2 点生命', rarity: 'epic', max: 3, apply: (g) => { g.mods.lifesteal += 2; } },
  { id: 'regen', name: '自动修复', desc: '发电机每秒自动恢复 1.5 点生命', rarity: 'epic', max: 3, apply: (g) => { g.mods.coreRegen += 1.5; } },
  { id: 'berserk', name: '狂热', desc: '暴击率 +15%，移动速度 +5%', rarity: 'epic', max: 2, apply: (g) => { g.mods.crit += 0.15; g.mods.speed *= 1.05; } },
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** 抽三张不重复、没叠满的牌，按稀有度加权 */
export function drawCards(g: Game, n = 3): CardDef[] {
  const pool = CARDS.filter((c) => (g.cardCounts[c.id] ?? 0) < c.max);
  const out: CardDef[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, c) => a + RARITY_WEIGHT[c.rarity], 0);
    let r = g.rng.next() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= RARITY_WEIGHT[(pool[i] as CardDef).rarity];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool.splice(idx, 1)[0] as CardDef);
  }
  return out;
}
