export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'launcher';

export const WEAPON_ORDER: WeaponKind[] = ['pistol', 'smg', 'shotgun', 'rifle', 'launcher'];

export interface WeaponStats {
  /** 单发（每颗弹丸）伤害；榴弹为直击 + 爆炸 */
  damage: number;
  pellets: number;
  /** 每秒射速 */
  rate: number;
  mag: number;
  /** 换弹时间（秒） */
  reload: number;
  /** 散布（度，半角） */
  spread: number;
  range: number;
  /** 可穿透的额外目标数 */
  pierce: number;
  /** 弹速（格/秒），0 = 瞬发射线 */
  speed: number;
  /** 爆炸半径，0 = 无 */
  aoe: number;
  /** 灼烧每秒伤害（持续 3 秒），0 = 无 */
  burn: number;
  /** 持续射击时射速最多增加的比例 */
  ramp: number;
  /** 爆炸后分裂的小炸弹数 */
  split: number;
}

export interface UpgradeDef {
  name: string;
  desc: string;
  cost: number;
  patch: Partial<WeaponStats>;
}

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  /** 购买价，0 = 初始拥有 */
  price: number;
  base: WeaponStats;
  /** 5 级固定升级路线 */
  upgrades: UpgradeDef[];
}

const s = (o: Partial<WeaponStats>): WeaponStats => ({
  damage: 10,
  pellets: 1,
  rate: 1,
  mag: 10,
  reload: 2,
  spread: 3,
  range: 12,
  pierce: 0,
  speed: 0,
  aoe: 0,
  burn: 0,
  ramp: 0,
  split: 0,
  ...o,
});

/** 其他武器：费用约为购买价的 0.25 / 0.4 / 0.6 / 0.9 / 1.3 倍，取整到 5 */
const costs = (price: number): number[] => [0.25, 0.4, 0.6, 0.9, 1.3].map((k) => Math.round((price * k) / 5) * 5);

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  pistol: {
    kind: 'pistol',
    name: 'M9 手枪',
    price: 0,
    base: s({ damage: 20, rate: 3.0, mag: 12, reload: 1.3, spread: 2.5, range: 14 }),
    upgrades: [
      { name: '加长枪管', desc: '伤害 +15%，射程 +2', cost: 40, patch: { damage: 23, range: 16 } },
      { name: '扩容弹匣', desc: '弹匣 12 → 16', cost: 60, patch: { mag: 16 } },
      { name: '轻量击锤', desc: '射速 3.0 → 3.8', cost: 90, patch: { rate: 3.8 } },
      { name: '速装弹夹', desc: '换弹 1.3 → 0.9 秒', cost: 130, patch: { reload: 0.9 } },
      { name: '空尖弹', desc: '伤害 +25%', cost: 180, patch: { damage: 29 } },
    ],
  },
  smg: {
    kind: 'smg',
    name: '蝰蛇冲锋枪',
    price: 350,
    base: s({ damage: 10, rate: 13, mag: 36, reload: 1.7, spread: 6, range: 12 }),
    upgrades: [
      { name: '钢芯弹', desc: '伤害 10 → 12', cost: costs(350)[0] as number, patch: { damage: 12 } },
      { name: '弹鼓', desc: '弹匣 36 → 48，射速 +1', cost: costs(350)[1] as number, patch: { mag: 48, rate: 14 } },
      { name: '减震枪托', desc: '散布大幅下降，射速 +1', cost: costs(350)[2] as number, patch: { spread: 3.5, rate: 15 } },
      { name: '高速弹', desc: '伤害 → 14，换弹 1.2 秒', cost: costs(350)[3] as number, patch: { damage: 14, reload: 1.2 } },
      { name: '过热弹链', desc: '伤害 → 16；持续射击射速最多 +40%', cost: costs(350)[4] as number, patch: { damage: 16, ramp: 0.4 } },
    ],
  },
  shotgun: {
    kind: 'shotgun',
    name: '铁砧霰弹枪',
    price: 450,
    base: s({ damage: 11, pellets: 8, rate: 1.3, mag: 6, reload: 2.2, spread: 12, range: 9 }),
    upgrades: [
      { name: '加粗弹丸', desc: '每丸伤害 → 13，射速 +0.1', cost: costs(450)[0] as number, patch: { damage: 13, rate: 1.4 } },
      { name: '加长管状弹仓', desc: '弹仓 6 → 8，射速 +0.1', cost: costs(450)[1] as number, patch: { mag: 8, rate: 1.5 } },
      { name: '十弹丸', desc: '每发 8 → 10 颗弹丸', cost: costs(450)[2] as number, patch: { pellets: 10 } },
      { name: '快速装填', desc: '换弹 2.2 → 1.6 秒', cost: costs(450)[3] as number, patch: { reload: 1.6 } },
      { name: '龙息弹', desc: '伤害 → 15，穿透 1，点燃 3 秒', cost: costs(450)[4] as number, patch: { damage: 15, pierce: 1, burn: 12 } },
    ],
  },
  rifle: {
    kind: 'rifle',
    name: '铁壁突击步枪',
    price: 600,
    base: s({ damage: 20, rate: 6.5, mag: 30, reload: 2.1, spread: 2, range: 18 }),
    upgrades: [
      { name: '精准弹', desc: '伤害 20 → 23', cost: costs(600)[0] as number, patch: { damage: 23 } },
      { name: '改良导气', desc: '射速 6.5 → 7.5', cost: costs(600)[1] as number, patch: { rate: 7.5 } },
      { name: '穿甲弹', desc: '伤害 → 26，穿透 1', cost: costs(600)[2] as number, patch: { damage: 26, pierce: 1 } },
      { name: '扩容弹匣', desc: '弹匣 30 → 36，换弹 1.6 秒', cost: costs(600)[3] as number, patch: { mag: 36, reload: 1.6 } },
      { name: '三点爆发', desc: '伤害 → 30，穿透 2', cost: costs(600)[4] as number, patch: { damage: 30, pierce: 2 } },
    ],
  },
  launcher: {
    kind: 'launcher',
    name: '炼狱榴弹发射器',
    price: 1100,
    base: s({ damage: 120, rate: 1.2, mag: 6, reload: 2.4, spread: 1.5, range: 14, speed: 16, aoe: 2.2 }),
    upgrades: [
      { name: '高爆弹', desc: '伤害 120 → 140', cost: costs(1100)[0] as number, patch: { damage: 140 } },
      { name: '扩容弹仓', desc: '弹仓 6 → 8，射速 +0.2', cost: costs(1100)[1] as number, patch: { mag: 8, rate: 1.4 } },
      { name: '扩大杀伤', desc: '伤害 → 160，爆炸半径 → 3.0', cost: costs(1100)[2] as number, patch: { damage: 160, aoe: 3.0 } },
      { name: '快速装填', desc: '换弹 2.4 → 1.8 秒', cost: costs(1100)[3] as number, patch: { reload: 1.8 } },
      { name: '集束弹', desc: '伤害 → 180，爆炸后分裂 3 枚小炸弹', cost: costs(1100)[4] as number, patch: { damage: 180, split: 3 } },
    ],
  },
};

/** 某武器升到 tier 级（0–5）时的属性 */
export function statsAt(kind: WeaponKind, tier: number): WeaponStats {
  const def = WEAPONS[kind];
  const out = { ...def.base };
  for (let i = 0; i < Math.min(tier, def.upgrades.length); i++) Object.assign(out, (def.upgrades[i] as UpgradeDef).patch);
  return out;
}

/** 持续单体 DPS：包含换弹时间，霰弹按全部弹丸命中计算，范围 / 穿透 / 灼烧不计入 */
export function sustainedDps(st: WeaponStats): number {
  return (st.damage * st.pellets * st.mag) / (st.mag / st.rate + st.reload);
}

/** 把某武器升满所需的总花费 */
export function totalUpgradeCost(kind: WeaponKind): number {
  return WEAPONS[kind].upgrades.reduce((a, u) => a + u.cost, 0);
}
