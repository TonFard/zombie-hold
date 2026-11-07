export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'lmg' | 'launcher';

/** 数字键 1–7 的顺序 */
export const WEAPON_ORDER: WeaponKind[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'lmg', 'launcher'];

/** 武器等级上限（第 6–8 级是后期升级，零件更贵） */
export const MAX_TIER = 8;

export interface WeaponStats {
  /** 单发（每颗弹丸）伤害；榴弹为直击 + 爆炸 */
  damage: number;
  pellets: number;
  /** 每秒射速 */
  rate: number;
  mag: number;
  /** 换弹时间（秒，打空后的完整换弹；弹匣里还有子弹时快 15%） */
  reload: number;
  /** 腰射散布（度，半角） */
  spread: number;
  /** 射程（米）：子弹飞过这么远就消失 */
  range: number;
  /** 可穿透的额外目标数 */
  pierce: number;
  /** 弹速（格/秒），0 = 走子弹弹道；> 0 = 榴弹抛射体 */
  speed: number;
  /** 爆炸半径，0 = 无 */
  aoe: number;
  /** 灼烧每秒伤害（持续 3 秒），0 = 无 */
  burn: number;
  /** 持续射击时射速最多增加的比例 */
  ramp: number;
  /** 爆炸后分裂的小炸弹数 */
  split: number;
  /** 从腰射到完全举镜所需秒数 */
  adsTime: number;
  /** 完全举镜时移动速度降低的比例 */
  adsSlow: number;
  /** 招牌：爆头击杀返还的子弹数（狙击） */
  refund: number;
  /** 招牌：命中后让僵尸减速的比例，持续 1.2 秒（轻机枪） */
  slowHit: number;
}

export interface UpgradeDef {
  name: string;
  desc: string;
  cost: number;
  patch: Partial<WeaponStats>;
}

/** 右键瞄准（ADS）的参数 */
export interface AdsDef {
  /** 完全瞄准时散布的剩余比例（0.25 = 只剩四分之一） */
  spread: number;
  /** 视野放大倍数 */
  zoom: number;
  /** 是否是瞄准镜（画面出现镜框遮罩，隐藏枪模） */
  scope?: boolean;
  /** 升到这一级后装上瞄准镜：之后按瞄准镜处理，视野放大到 scopeZoom */
  scopeTier?: number;
  scopeZoom?: number;
}

/** 后坐力：每发把视线抬高多少（度），水平随机左右摆多少（度） */
export interface RecoilDef {
  v: number;
  h: number;
}

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  /** 购买价，0 = 初始拥有 */
  price: number;
  base: WeaponStats;
  /** 8 级固定升级路线 */
  upgrades: UpgradeDef[];
  /** 枪口初速（米/秒）。0 = 不走弹道（榴弹发射器用自己的抛射体） */
  muzzle: number;
  /** 归零距离（米）：枪口微微上抬，让子弹在这个距离正好穿过准星，再远就开始下坠 */
  zero: number;
  /** 爆头伤害倍率（再乘以僵尸自己的头部脆弱系数和卡牌加成） */
  headMult: number;
  /**
   * 距离衰减：[开始衰减的位置（射程的比例）, 射程尽头剩下的伤害比例]。
   * 例如 [0.6, 0.7] = 前 60% 射程满伤害，之后线性降到 70%。
   */
  falloff: [number, number];
  ads: AdsDef;
  recoil: RecoilDef;
  /**
   * 重量（千克）。正式局里真的会生效：拿在手上越重走得越慢、冲刺越耗体力、切枪 / 举镜越慢；
   * 身上另一把枪也算一半重量（背着走）
   */
  weight: number;
  /** 弹药：pack = 大厅里一份补给的发数，price = 一份多少补给点；手枪无限子弹 */
  ammo: { pack: number; price: number } | null;
  /** 这把枪最好用的场景（工坊和大厅里显示） */
  role: string;
  /** 3 米内的伤害倍率（霰弹枪的贴脸加成）；缺省 1 */
  close?: number;
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
  adsTime: 0.2,
  adsSlow: 0.45,
  refund: 0,
  slowHit: 0,
  ...o,
});

/** 费用约为购买价的 0.25 / 0.4 / 0.6 / 0.9 / 1.3 / 1.7 / 2.1 / 2.6 倍，取整到 5 */
const costs = (price: number): number[] => [0.25, 0.4, 0.6, 0.9, 1.3, 1.7, 2.1, 2.6].map((k) => Math.round((price * k) / 5) * 5);

/** 给一条升级路线按顺序填上费用 */
function route(price: number, ups: Array<Omit<UpgradeDef, 'cost'>>): UpgradeDef[] {
  const c = costs(price);
  return ups.map((u, i) => ({ ...u, cost: c[i] as number }));
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  pistol: {
    kind: 'pistol',
    weight: 1.0,
    ammo: null,
    role: '备用枪，子弹无限；双持后近距离火力翻倍',
    name: 'M9 手枪',
    price: 0,
    muzzle: 160,
    zero: 10,
    headMult: 1.6,
    falloff: [0.6, 0.6],
    ads: { spread: 0.35, zoom: 1.25 },
    recoil: { v: 0.9, h: 0.35 },
    base: s({ damage: 20, rate: 3.0, mag: 12, reload: 1.3, spread: 2.5, range: 20, adsTime: 0.14 }),
    upgrades: [
      { name: '加长枪管', desc: '伤害 +15%，射程 +2', cost: 40, patch: { damage: 23, range: 22 } },
      { name: '扩容弹匣', desc: '弹匣 12 → 16', cost: 60, patch: { mag: 16 } },
      { name: '轻量击锤', desc: '射速 3.0 → 3.8', cost: 90, patch: { rate: 3.8 } },
      { name: '速装弹夹', desc: '换弹 1.3 → 0.9 秒', cost: 130, patch: { reload: 0.9 } },
      { name: '空尖弹', desc: '伤害 +25%', cost: 180, patch: { damage: 29 } },
      // 6–8 级只改手感，不加伤害：手枪永远是备用枪
      { name: '轻量套筒', desc: '举枪 0.14 → 0.09 秒', cost: 220, patch: { adsTime: 0.09 } },
      { name: '竞赛扳机', desc: '腰射散布 2.5° → 1.6°', cost: 280, patch: { spread: 1.6 } },
      { name: '战术握把', desc: '瞄准时不再减速', cost: 350, patch: { adsSlow: 0 } },
    ],
  },
  smg: {
    kind: 'smg',
    weight: 2.6,
    ammo: { pack: 120, price: 6 },
    role: '城区巷战、室内：射速高、走得快',
    name: '蝰蛇冲锋枪',
    price: 350,
    muzzle: 190,
    zero: 9,
    headMult: 1.7,
    falloff: [0.5, 0.55],
    ads: { spread: 0.5, zoom: 1.35 },
    recoil: { v: 0.32, h: 0.28 },
    base: s({ damage: 10, rate: 13, mag: 36, reload: 1.7, spread: 6, range: 16, adsTime: 0.16, adsSlow: 0.35 }),
    upgrades: route(350, [
      { name: '钢芯弹', desc: '伤害 10 → 12', patch: { damage: 12 } },
      { name: '弹鼓', desc: '弹匣 36 → 48，射速 +1', patch: { mag: 48, rate: 14 } },
      { name: '减震枪托', desc: '散布大幅下降，射速 +1', patch: { spread: 3.5, rate: 15 } },
      { name: '高速弹', desc: '伤害 → 14，换弹 1.2 秒', patch: { damage: 14, reload: 1.2 } },
      { name: '过热弹链', desc: '伤害 → 16；持续射击射速最多 +40%', patch: { damage: 16, ramp: 0.4 } },
      { name: '加长枪管', desc: '伤害 → 18，射程 16 → 19', patch: { damage: 18, range: 19 } },
      { name: '双联弹鼓', desc: '弹匣 48 → 64', patch: { mag: 64 } },
      { name: '超频枪机', desc: '射速 15 → 17', patch: { rate: 17 } },
    ]),
  },
  shotgun: {
    kind: 'shotgun',
    weight: 3.9,
    ammo: { pack: 24, price: 6 },
    role: '门口、走廊等狭窄入口：一枪打一片；3 米内伤害 +15%',
    // sim:progress：霰弹枪是最难练的枪（机器人每局只有 46 经验），贴脸加成让它在门口真正好用
    close: 1.15,
    name: '铁砧霰弹枪',
    price: 450,
    muzzle: 130,
    zero: 6,
    headMult: 1.75,
    falloff: [0.35, 0.55],
    ads: { spread: 0.7, zoom: 1.2 },
    // 全自动（AA-12 式）：按住左键连发，每秒 3.5 发，8 发弹匣。单丸伤害比泵动时低，靠射速和覆盖面清怪
    recoil: { v: 2.2, h: 0.9 },
    base: s({ damage: 8, pellets: 9, rate: 3.5, mag: 8, reload: 2.4, spread: 14, range: 13, adsTime: 0.2 }),
    upgrades: route(450, [
      { name: '加粗弹丸', desc: '每丸伤害 8 → 9', patch: { damage: 9 } },
      { name: '弹鼓', desc: '弹匣 8 → 10', patch: { mag: 10 } },
      { name: '十一弹丸', desc: '每发 9 → 11 颗弹丸', patch: { pellets: 11 } },
      { name: '快速装填', desc: '换弹 2.4 → 1.8 秒', patch: { reload: 1.8 } },
      { name: '龙息弹', desc: '伤害 → 10，穿透 1，点燃 3 秒', patch: { damage: 10, pierce: 1, burn: 12 } },
      { name: '收束扼流', desc: '散布 14° → 11°，射程 13 → 16', patch: { spread: 11, range: 16 } },
      { name: '大容量弹鼓', desc: '弹匣 10 → 14', patch: { mag: 14 } },
      { name: '导气加速', desc: '射速 3.5 → 4.2', patch: { rate: 4.2 } },
    ]),
  },
  rifle: {
    kind: 'rifle',
    weight: 3.6,
    ammo: { pack: 90, price: 7 },
    role: '荒野开阔地：中远距离点射，穿透一串',
    name: '铁壁突击步枪',
    price: 600,
    muzzle: 240,
    zero: 20,
    headMult: 2.5,
    falloff: [0.7, 0.75],
    ads: { spread: 0.25, zoom: 1.6, scopeTier: 5, scopeZoom: 2.6 },
    recoil: { v: 0.55, h: 0.3 },
    // 定位：中远距离点射 + 穿透打穿一串。近距离贴脸 DPS 不如冲锋枪，但从一开始就能穿透 1，
    // 僵尸排着队冲过来时（门口、走廊、入口）一枪打两三只，清怪效率反超
    base: s({ damage: 24, rate: 6.5, mag: 30, reload: 1.9, spread: 2, range: 32, pierce: 1, adsTime: 0.22 }),
    upgrades: route(600, [
      { name: '精准弹', desc: '伤害 24 → 27', patch: { damage: 27 } },
      { name: '改良导气', desc: '射速 6.5 → 7.5', patch: { rate: 7.5 } },
      { name: '穿甲弹', desc: '伤害 → 30，穿透 2', patch: { damage: 30, pierce: 2 } },
      { name: '扩容弹匣', desc: '弹匣 30 → 36，换弹 1.5 秒', patch: { mag: 36, reload: 1.5 } },
      { name: '三点爆发', desc: '伤害 → 34，穿透 3', patch: { damage: 34, pierce: 3 } },
      { name: '重枪管', desc: '伤害 → 38，射程 32 → 38', patch: { damage: 38, range: 38 } },
      { name: '调校枪机', desc: '射速 7.5 → 8.5', patch: { rate: 8.5 } },
      { name: '贫铀弹芯', desc: '伤害 → 42，穿透 4', patch: { damage: 42, pierce: 4 } },
    ]),
  },
  sniper: {
    kind: 'sniper',
    weight: 5.8,
    ammo: { pack: 15, price: 8 },
    role: '湖畔、长街：远距离点杀首领和精英',
    name: '寒鸦狙击步枪',
    price: 800,
    muzzle: 420,
    zero: 30,
    headMult: 3.0,
    falloff: [1, 1],
    ads: { spread: 0.04, zoom: 3.5, scope: true },
    recoil: { v: 4.2, h: 0.6 },
    base: s({ damage: 110, rate: 1.2, mag: 5, reload: 2.6, spread: 4.5, range: 60, pierce: 2, adsTime: 0.35, adsSlow: 0.55 }),
    upgrades: route(800, [
      { name: '比赛级弹药', desc: '伤害 110 → 140', patch: { damage: 140 } },
      { name: '扩容弹仓', desc: '弹仓 5 → 7', patch: { mag: 7 } },
      { name: '顺滑枪栓', desc: '射速 1.2 → 1.5', patch: { rate: 1.5 } },
      { name: '快拆弹匣', desc: '换弹 2.6 → 1.9 秒', patch: { reload: 1.9 } },
      { name: '猎首', desc: '伤害 → 170；爆头击杀返还 1 发子弹', patch: { damage: 170, refund: 1 } },
      { name: '轻量镜架', desc: '举镜 0.35 → 0.26 秒，伤害 → 190', patch: { adsTime: 0.26, damage: 190 } },
      { name: '双动枪栓', desc: '射速 1.5 → 1.7', patch: { rate: 1.7 } },
      { name: '钨芯穿甲弹', desc: '伤害 → 220，穿透 3', patch: { damage: 220, pierce: 3 } },
    ]),
  },
  lmg: {
    kind: 'lmg',
    weight: 8.5,
    ammo: { pack: 150, price: 9 },
    role: '守据点：压住一整个入口，但扛着走不快',
    name: '铁幕轻机枪',
    // 1000 → 800：前三夜买不起，解锁了也用不上（sim:progress）
    price: 800,
    muzzle: 220,
    zero: 15,
    headMult: 1.8,
    falloff: [0.65, 0.7],
    ads: { spread: 0.4, zoom: 1.45 },
    recoil: { v: 0.42, h: 0.4 },
    base: s({ damage: 12, rate: 11, mag: 100, reload: 4.0, spread: 5, range: 26, adsTime: 0.3, adsSlow: 0.55 }),
    upgrades: route(800, [
      { name: '重弹头', desc: '伤害 12 → 14', patch: { damage: 14 } },
      { name: '两脚架', desc: '散布 5° → 3.5°', patch: { spread: 3.5, damage: 15 } },
      { name: '快拆供弹盖', desc: '换弹 4.0 → 3.0 秒', patch: { reload: 3.0 } },
      { name: '加速枪机', desc: '射速 11 → 12.5', patch: { rate: 12.5 } },
      { name: '压制射击', desc: '伤害 → 20；命中让僵尸减速 35%', patch: { damage: 20, slowHit: 0.35 } },
      { name: '150 发弹链', desc: '弹链 100 → 150', patch: { mag: 150 } },
      { name: '穿甲弹链', desc: '伤害 → 23，穿透 1', patch: { damage: 23, pierce: 1 } },
      { name: '速射枪管', desc: '射速 12.5 → 14', patch: { rate: 14 } },
    ]),
  },
  launcher: {
    kind: 'launcher',
    weight: 6.4,
    ammo: { pack: 8, price: 10 },
    role: '尸潮扎堆时：范围爆炸，别对着脚下打',
    name: '炼狱榴弹发射器',
    // 1100 → 850：同上
    price: 850,
    muzzle: 0,
    zero: 0,
    headMult: 1,
    falloff: [1, 1],
    ads: { spread: 0.7, zoom: 1.3 },
    recoil: { v: 3.6, h: 0.5 },
    base: s({ damage: 120, rate: 1.2, mag: 6, reload: 2.4, spread: 1.5, range: 14, speed: 16, aoe: 2.2, adsTime: 0.25 }),
    upgrades: route(850, [
      { name: '高爆弹', desc: '伤害 120 → 140', patch: { damage: 140 } },
      { name: '扩容弹仓', desc: '弹仓 6 → 8，射速 +0.2', patch: { mag: 8, rate: 1.4 } },
      { name: '扩大杀伤', desc: '伤害 → 160，爆炸半径 → 3.0', patch: { damage: 160, aoe: 3.0 } },
      { name: '快速装填', desc: '换弹 2.4 → 1.8 秒', patch: { reload: 1.8 } },
      { name: '集束弹', desc: '伤害 → 180，爆炸后分裂 3 枚小炸弹', patch: { damage: 180, split: 3 } },
      { name: '高速推进', desc: '弹速 16 → 20，射程 14 → 18', patch: { speed: 20, range: 18 } },
      { name: '温压装药', desc: '伤害 → 200，爆炸半径 → 3.4', patch: { damage: 200, aoe: 3.4 } },
      { name: '五联集束', desc: '伤害 → 220，分裂 5 枚', patch: { damage: 220, split: 5 } },
    ]),
  },
};

/** 某武器升到 tier 级（0–8）时的属性 */
export function statsAt(kind: WeaponKind, tier: number): WeaponStats {
  const def = WEAPONS[kind];
  const out = { ...def.base };
  for (let i = 0; i < Math.min(tier, def.upgrades.length); i++) Object.assign(out, (def.upgrades[i] as UpgradeDef).patch);
  return out;
}

/** 持续单体 DPS：包含换弹时间，霰弹按全部弹丸命中计算，范围 / 穿透 / 灼烧 / 爆头不计入 */
export function sustainedDps(st: WeaponStats): number {
  return (st.damage * st.pellets * st.mag) / (st.mag / st.rate + st.reload);
}

/** 把某武器升到 upTo 级所需的总花费（默认升满） */
export function totalUpgradeCost(kind: WeaponKind, upTo = MAX_TIER): number {
  return WEAPONS[kind].upgrades.slice(0, upTo).reduce((a, u) => a + u.cost, 0);
}

/** 某个等级的瞄准参数（有的枪升级后会装上瞄准镜） */
export function adsAt(kind: WeaponKind, tier: number): { spread: number; zoom: number; scope: boolean } {
  const a = WEAPONS[kind].ads;
  const late = a.scopeTier !== undefined && tier >= a.scopeTier;
  return { spread: a.spread, zoom: late ? (a.scopeZoom ?? a.zoom) : a.zoom, scope: !!a.scope || late };
}

/** 飞过 traveled 米时的距离衰减系数 */
export function falloffAt(kind: WeaponKind, traveled: number, range: number): number {
  const [start, min] = WEAPONS[kind].falloff;
  if (start >= 1) return 1;
  const k = traveled / range;
  if (k <= start) return 1;
  return 1 + (min - 1) * Math.min(1, (k - start) / (1 - start));
}

/**
 * 局外每把枪自己的强化（大厅 · 军械库里每把枪一张工作台）：伤害、后坐、减重、扩容各 3 级。
 * 数值是倍率 / 增量，正式局里套在 statsAt 的结果上（effectiveStats）
 */
export interface WeaponMod {
  /** 伤害倍率 */
  damage: number;
  /** 后坐力倍率（< 1 更稳） */
  recoil: number;
  /** 重量减少的千克数 */
  lighter: number;
  /** 弹匣容量倍率 */
  mag: number;
  /** 射速倍率（枪机） */
  rate: number;
}

export const NO_MOD: WeaponMod = { damage: 1, recoil: 1, lighter: 0, mag: 1, rate: 1 };

export function noMods(): Record<WeaponKind, WeaponMod> {
  const o = {} as Record<WeaponKind, WeaponMod>;
  for (const k of WEAPON_ORDER) o[k] = { ...NO_MOD };
  return o;
}

/**
 * 弹药有限开关。现在的难度下子弹有限太紧，先全部无限；买子弹、库存、结算退回的代码都留着，
 * 改成 true 就恢复（大厅武器台的"弹药库存"也跟着出现）
 */
export const AMMO_LIMITED = false;

/**
 * 双持手枪：左右手各一把（左右交替开火）。
 * 收益：弹匣 ×2、射速 ×1.7。
 * 代价：换弹更慢（两把都要装弹，×1.35）、重量翻倍、散布变大、不能举镜瞄准。
 */
export const DUAL = { mag: 2, rate: 1.7, spread: 1.5, recoil: 0.8, reload: 1.35, weight: 1.0 };

/** 局外强化 + 双持之后的实际属性 */
export function effectiveStats(kind: WeaponKind, tier: number, mod: WeaponMod = NO_MOD, dual = false): WeaponStats {
  const st = statsAt(kind, tier);
  if (mod.damage !== 1) st.damage *= mod.damage;
  if (mod.mag !== 1) st.mag = Math.max(1, Math.round(st.mag * mod.mag));
  if (mod.rate !== 1) st.rate *= mod.rate;
  if (dual && kind === 'pistol') {
    st.mag *= DUAL.mag;
    st.rate *= DUAL.rate;
    st.spread *= DUAL.spread;
    // 两把枪都要装弹：换弹时间变长
    st.reload *= DUAL.reload;
  }
  return st;
}

/**
 * 实际重量（千克）：局外减重之后，双持时手上是两把手枪——重量翻倍（多背一把）。
 * 手枪 1.0 kg → 双持 2.0 kg。
 */
export function weightOf(kind: WeaponKind, mod: WeaponMod = NO_MOD, dual = false): number {
  const w = WEAPONS[kind].weight + (dual && kind === 'pistol' ? DUAL.weight : 0) - mod.lighter;
  return Math.max(0.6, w);
}

/**
 * 重量的效果（正式局）：carry = 手上的枪 + 背着的另一把的一半。
 * 3 千克以内不减速，之后每千克 −3% 移速（最多 −24%）；冲刺耗体力每千克 +4%；切枪和举镜随手上的枪变慢
 */
export function weightEffects(hand: number, back: number): { speed: number; stamina: number; handling: number } {
  const carry = hand + back * 0.5;
  const over = Math.max(0, carry - 3);
  return {
    speed: Math.max(0.76, 1 - 0.03 * over),
    stamina: 1 + 0.04 * over,
    handling: 1 + Math.max(0, hand - 2) * 0.06,
  };
}
