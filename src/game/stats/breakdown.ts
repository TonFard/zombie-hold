import { CARD_BY_ID } from '../data/cards';
import { CHAPTER_BY_ID } from '../data/chapters';
import { DIFFICULTIES } from '../data/difficulty';
import { nightMod } from '../data/modifiers';
import { WEAPONS, statsAt, type WeaponKind, type WeaponStats } from '../data/weapons';
import { DUAL, weightOf } from '../data/weapons';
import { defaultMods, type Game, type Mods } from '../sim';

/**
 * 数值后台（Tab 面板）：每一项属性 = 基础值 × 各来源，逐项列出来。
 *
 * 不是另起一套记账：所有数据都从游戏已经存着的状态里重算——局外加成在 config.meta、
 * 难度 / 章节在 config、卡牌在 cardCounts、词缀在 run.mod、武器台在 config.weaponMods、重量现算。
 * 卡牌的效果用"探针"测：在一份空白 Mods 上执行一次 card.apply，看它改了哪些字段、改了多少。
 * 这样卡牌表以后怎么改都不用同步这里；sim:stats 检查"各来源乘起来 = 游戏里实际的 g.mods"，对不上就失败。
 */

export type SourceKind = 'base' | 'meta' | 'card' | 'difficulty' | 'chapter' | 'mod' | 'bench' | 'weight' | 'dual' | 'tier';

export interface Part {
  kind: SourceKind;
  name: string;
  /** 乘法类：倍率（1.1 = +10%）；加法类：加多少 */
  value: number;
}

export interface StatLine {
  id: string;
  name: string;
  /** 乘法（各来源相乘）还是加法（相加） */
  op: 'mul' | 'add';
  base: number;
  parts: Part[];
  /** 各来源合起来的最终值（截断之前） */
  raw: number;
  /** 截断之后的最终值（有上下限的项；没有就等于 raw） */
  final: number;
  /** 被上下限截断了 */
  capped: boolean;
  /** 越大越好（受到伤害、体力消耗是越小越好） */
  higherBetter: boolean;
  /** 显示格式 */
  fmt: 'pct' | 'num' | 'rate';
  unit?: string;
}

/** Mods 里每个字段：显示名、加法还是乘法、越大越好吗 */
const FIELDS: Array<{ key: keyof Mods; name: string; op: 'mul' | 'add'; good: boolean; fmt: StatLine['fmt']; unit?: string }> = [
  { key: 'damage', name: '武器伤害', op: 'mul', good: true, fmt: 'pct' },
  { key: 'crit', name: '暴击率', op: 'add', good: true, fmt: 'pct' },
  { key: 'head', name: '爆头加成', op: 'mul', good: true, fmt: 'pct' },
  { key: 'fireRate', name: '射速', op: 'mul', good: true, fmt: 'pct' },
  { key: 'reload', name: '换弹速度', op: 'mul', good: true, fmt: 'pct' },
  { key: 'speed', name: '移动速度', op: 'mul', good: true, fmt: 'pct' },
  { key: 'armor', name: '受到伤害', op: 'mul', good: false, fmt: 'pct' },
  { key: 'staminaUse', name: '体力消耗', op: 'mul', good: false, fmt: 'pct' },
  { key: 'adsSpread', name: '瞄准散布', op: 'mul', good: false, fmt: 'pct' },
  { key: 'turret', name: '炮塔伤害', op: 'mul', good: true, fmt: 'pct' },
  { key: 'turretRate', name: '炮塔射速', op: 'mul', good: true, fmt: 'pct' },
  { key: 'structHp', name: '建筑生命', op: 'mul', good: true, fmt: 'pct' },
  { key: 'scrap', name: '零件收益', op: 'mul', good: true, fmt: 'pct' },
  { key: 'regen', name: '脱战回血', op: 'add', good: true, fmt: 'rate', unit: '/秒' },
  { key: 'lifesteal', name: '击杀回血', op: 'add', good: true, fmt: 'num', unit: '点/杀' },
  { key: 'coreRegen', name: '发电机自修', op: 'add', good: true, fmt: 'rate', unit: '/秒' },
  { key: 'closeDamage', name: '近身伤害', op: 'mul', good: true, fmt: 'pct' },
  { key: 'comboDamage', name: '连杀伤害', op: 'add', good: true, fmt: 'pct', unit: '/连杀' },
  { key: 'chainBlast', name: '连锁爆炸', op: 'add', good: true, fmt: 'num' },
  { key: 'headRefund', name: '爆头返弹', op: 'add', good: true, fmt: 'num', unit: '发' },
  { key: 'shoveCd', name: '推搡冷却', op: 'mul', good: false, fmt: 'pct' },
  { key: 'extraFrags', name: '额外手雷', op: 'add', good: true, fmt: 'num', unit: '颗/天' },
];

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * 一张卡叠了 n 层，对每个 Mods 字段的效果：在空白 Mods 上 apply n 次（用一个只够 apply 不出错的假 Game）。
 * 乘法字段返回总倍率，加法字段返回总增量
 */
function probeCard(id: string, n: number): Partial<Record<keyof Mods, number>> {
  const card = CARD_BY_ID[id];
  if (!card) return {};
  const mods = defaultMods();
  // 卡牌除了改 mods，还会改生命、建筑、手雷：给它一个不会报错的空壳
  const fake = { mods, player: { maxHp: 100, hp: 100 }, core: { maxHp: 500, hp: 500 }, structures: new Map(), hz: { frags: 0 } } as unknown as Game;
  for (let i = 0; i < n; i++) card.apply(fake);
  const base = defaultMods();
  const out: Partial<Record<keyof Mods, number>> = {};
  for (const f of FIELDS) {
    const v = mods[f.key];
    const b = base[f.key];
    if (f.op === 'mul' ? !near(v, b) : !near(v, b)) out[f.key] = f.op === 'mul' ? v / b : v - b;
  }
  return out;
}

/** g.mods 的每个字段拆成来源 */
export function modsBreakdown(g: Game): StatLine[] {
  const c = g.config;
  const m = c.meta;
  const diff = DIFFICULTIES[c.difficulty];
  const ch = CHAPTER_BY_ID[c.chapter];
  const lines: StatLine[] = [];
  const probes = Object.entries(g.cardCounts).map(([id, n]) => ({ id, n, name: CARD_BY_ID[id]?.name ?? id, fx: probeCard(id, n) }));
  for (const f of FIELDS) {
    const base = defaultMods()[f.key];
    const parts: Part[] = [];
    const add = (kind: SourceKind, name: string, value: number) => {
      if (f.op === 'mul' ? !near(value, 1) : !near(value, 0)) parts.push({ kind, name, value });
    };
    // 局外（applyMeta 里写进 g.mods 的那几项）；scrapGain 和难度、章节一起乘
    if (f.key === 'turret') add('meta', '局外·炮塔伤害', m.turretDamage);
    if (f.key === 'structHp') add('meta', '局外·建筑生命', m.structHp);
    if (f.key === 'armor') add('meta', '局外·防弹插板', m.armor);
    if (f.key === 'regen') add('meta', '局外·急救训练', m.regen);
    if (f.key === 'speed') add('meta', '局外·负重训练', m.speed);
    if (f.key === 'fireRate') add('meta', '局外·射击训练', m.fireRate);
    if (f.key === 'scrap') {
      add('meta', '局外·零件收益', m.scrapGain);
      // 难度 / 章节：只有正式出征（applyMeta）才乘，记在 meta.scrapEnv 里；拆成两项显示
      if (!near(m.scrapEnv, 1)) {
        add('difficulty', `难度·${diff.name}`, diff.scrap);
        if (ch) add('chapter', ch.name.split(' · ')[1] ?? ch.name, m.scrapEnv / diff.scrap);
      }
    }
    for (const p of probes) {
      const v = p.fx[f.key];
      if (v !== undefined) add('card', p.n > 1 ? `${p.name} ×${p.n}` : p.name, v);
    }
    const raw = f.op === 'mul' ? parts.reduce((a, x) => a * x.value, base) : parts.reduce((a, x) => a + x.value, base);
    lines.push({ id: f.key, name: f.name, op: f.op, base, parts, raw, final: raw, capped: false, higherBetter: f.good, fmt: f.fmt, ...(f.unit ? { unit: f.unit } : {}) });
  }
  return lines;
}

/**
 * 当前生效的总倍率（Tab 面板显示的那一列）：在 g.mods 之外，还有只在某些时候生效的乘区——
 * 夜晚词缀（零件、炮塔射速）、身上的重量（移速、体力）。这些不在 g.mods 里，单独追加
 */
export function liveBreakdown(g: Game): StatLine[] {
  const lines = modsBreakdown(g);
  const by = (id: string) => lines.find((l) => l.id === id) as StatLine;
  const push = (l: StatLine, kind: SourceKind, name: string, v: number) => {
    if (near(v, 1)) return;
    l.parts.push({ kind, name, value: v });
    l.raw *= v;
    l.final = l.raw;
  };
  const night = g.run.phase === 'night';
  if (night && g.run.mod) {
    const mod = nightMod(g.run.mod);
    push(by('scrap'), 'mod', `词缀·${mod.name}`, g.run.modScrap);
    if (g.run.mod === 'blackout') push(by('turretRate'), 'mod', `词缀·${mod.name}`, 0.6);
  }
  const w = g.weightNow();
  const sp = by('speed');
  push(sp, 'weight', `重量 ${(w.hand + w.back * 0.5).toFixed(1)} kg`, w.speed);
  push(by('staminaUse'), 'weight', '重量', w.stamina);
  // 重量减速的下限 0.76 在 weightEffects 里已经截断了：截到了就标出来
  if (w.speed <= 0.7600001 && w.hand + w.back * 0.5 - 3 > (1 - 0.76) / 0.03) sp.capped = true;
  return lines;
}

/** 武器五项属性（伤害、射速、弹匣、换弹、重量），每项从基础一路算到最终 */
export interface WeaponLine {
  id: 'damage' | 'rate' | 'mag' | 'reload' | 'weight' | 'recoil';
  name: string;
  base: number;
  parts: Part[];
  final: number;
  higherBetter: boolean;
  unit: string;
  digits: number;
}

export function weaponBreakdown(g: Game, kind: WeaponKind, tier: number): WeaponLine[] {
  const c = g.config;
  const wm = c.weaponMods[kind];
  const dual = c.dual && kind === 'pistol';
  const b0: WeaponStats = statsAt(kind, 0);
  const bt: WeaponStats = statsAt(kind, tier);
  const mods = liveBreakdown(g);
  const modOf = (id: string) => mods.find((l) => l.id === id);
  const out: WeaponLine[] = [];
  const line = (id: WeaponLine['id'], name: string, base: number, unit: string, digits: number, higherBetter: boolean, steps: Array<[SourceKind, string, number]>) => {
    const parts = steps.filter(([, , v]) => !near(v, 1)).map(([k, n, v]) => ({ kind: k, name: n, value: v }));
    out.push({ id, name, base, parts, final: parts.reduce((a, p) => a * p.value, base), higherBetter, unit, digits });
  };
  const cardDmg = modOf('damage');
  // 霰弹：每发伤害 = 每颗 × 弹丸数，弹丸数也会随工坊等级变（9 → 11），所以按"整发"算倍率
  line('damage', '伤害', b0.damage * b0.pellets, bt.pellets > 1 ? `（${bt.pellets} 颗）` : '', 1, true, [
    ['tier', `工坊 ${tier + 1} 级`, (bt.damage * bt.pellets) / (b0.damage * b0.pellets)],
    ['bench', '武器台·弹药改装', wm.damage],
    ...((cardDmg?.parts ?? []).map((p) => [p.kind, p.name, p.value]) as Array<[SourceKind, string, number]>),
  ]);
  const rate = modOf('fireRate');
  line('rate', '射速', b0.rate * 60, 'RPM', 0, true, [
    ['tier', `工坊 ${tier + 1} 级`, bt.rate / b0.rate],
    ['bench', '武器台·枪机', wm.rate],
    ['dual', '双持', dual ? DUAL.rate : 1],
    ...((rate?.parts ?? []).map((p) => [p.kind, p.name, p.value]) as Array<[SourceKind, string, number]>),
  ]);
  line('mag', '弹匣', b0.mag, '发', 0, true, [
    ['tier', `工坊 ${tier + 1} 级`, bt.mag / b0.mag],
    ['bench', '武器台·扩容', Math.max(1, Math.round(bt.mag * wm.mag)) / bt.mag],
    ['dual', '双持', dual ? DUAL.mag : 1],
  ]);
  const rl = modOf('reload');
  // 换弹速度倍率越大越快：换弹时间 = 基础 ÷ 倍率
  line('reload', '换弹', b0.reload, '秒', 2, false, [
    ['tier', `工坊 ${tier + 1} 级`, bt.reload / b0.reload],
    ...((rl?.parts ?? []).map((p) => [p.kind, p.name, 1 / p.value]) as Array<[SourceKind, string, number]>),
  ]);
  const def = WEAPONS[kind];
  out.push({
    id: 'weight',
    name: '重量',
    base: def.weight,
    parts: [
      ...(wm.lighter > 0 ? [{ kind: 'bench' as const, name: '武器台·轻量化', value: (def.weight - wm.lighter) / def.weight }] : []),
      ...(dual ? [{ kind: 'dual' as const, name: '双持', value: (def.weight + DUAL.weight - wm.lighter) / Math.max(0.01, def.weight - wm.lighter) }] : []),
    ],
    // 这把枪自己的重量（不是手上那把：背着的枪也要显示它自己的）
    final: weightOf(kind, wm, c.dual),
    higherBetter: false,
    unit: 'kg',
    digits: 1,
  });
  line('recoil', '后坐', def.recoil.v, '°', 2, false, [
    ['bench', '武器台·制退器', wm.recoil],
    ['dual', '双持', dual ? DUAL.recoil : 1],
  ]);
  return out;
}

/** sim:stats 用：重算出来的 Mods（应该和 g.mods 逐字段相等） */
export function rebuiltMods(g: Game): Mods {
  const out = defaultMods();
  for (const l of modsBreakdown(g)) (out as unknown as Record<string, number>)[l.id] = l.raw;
  return out;
}
