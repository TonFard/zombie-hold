import type { RunConfig } from '../config';
import { newRisk, type RiskState } from '../systems/events';
import { newLoot, type LootState } from '../systems/loot';
import { CARD_BY_ID } from '../data/cards';
import { isDifficulty } from '../data/difficulty';
import { STRUCTURES, STRUCTURE_ORDER, type StructureKind } from '../data/structures';
import { MAX_TIER, WEAPON_ORDER, effectiveStats, type WeaponKind } from '../data/weapons';
import { GUN_BY_ID, defaultGuns, gunFits } from '../data/guns';
import { FINAL_NIGHT } from '../data/waves';
import { ZOMBIES, type ZombieKind } from '../data/zombies';
import type { Bullet } from '../entities/bullet';
import type { Projectile } from '../entities/projectile';
import type { Structure } from '../entities/structure';
import { Zombie } from '../entities/zombie';
import type { Game, GameStats, Mods, NightLog, PlayerInput, PlayerState, WeaponSlot } from '../sim';
import type { HazardState } from '../systems/hazards';
import { wireChallenges, type RunState } from '../systems/run';
import { SaveError, isObj, num } from './schema';
import { CARRY_MAX } from '../data/carry';
import { isMapId, type MapId } from '../world/maps';

export const RUN_KEY = 'zombie-hold-run-v1';

type Fields = Record<string, unknown>;

/**
 * 一局的检查点：每个白天开始时（含开局）自动保存，一局结束时删除，夜里退出丢掉这一夜。
 * 存的是"让模拟逐帧继续"所需的全部状态：读档后继续模拟的结果和不存档直接继续完全一致（sim:meta 检查）。
 */
export interface RunCheckpoint {
  version: 1;
  /** 保存时的现实时间（毫秒），界面显示用 */
  savedAt: number;
  rng: number;
  nextId: number;
  nextBulletId: number;
  time: number;
  tick: number;
  scrap: number;
  scrapEarned: number;
  config: RunConfig;
  run: RunState;
  player: PlayerState;
  /** 最后一帧的输入（瞄准点等）：读档后第一帧和原来一样 */
  input: PlayerInput;
  mods: Mods;
  stats: GameStats;
  core: { hp: number; maxHp: number };
  loadout: Record<WeaponKind, WeaponSlot>;
  cardCounts: Record<string, number>;
  scrapBoxes: boolean[];
  structures: Array<Pick<Structure, 'id' | 'kind' | 'cx' | 'cy' | 'hp' | 'maxHp' | 'aim' | 'cd' | 'sinceShot' | 'target'>>;
  zombies: Fields[];
  bullets: Bullet[];
  projectiles: Projectile[];
  nav: { cell: number; fieldCell: number; accum: number; dirty: boolean };
  buildKind: StructureKind;
  hz: HazardState;
  combo: number;
  comboT: number;
  hurtT: number;
  healPool: number;
  ammo: Partial<Record<WeaponKind, number>>;
  healT: number;
  battery: number;
  flashOn: boolean;
  airdrop: { stage: number; t: number; x: number; z: number };
  ev: RiskState;
  loot: LootState;
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 僵尸里不进存档的字段：def 由 kind 推出来 */
const ZOMBIE_SKIP = new Set(['def']);

/** 枪械型号（config.guns / trialGuns）是后来才加的：旧存档里没有就按默认型号、没有试用枪 */
function withGuns(c: unknown): unknown {
  if (!isObj(c)) return c;
  // 删掉的榴弹发射器：从解锁列表里去掉（shaped 按模板重建，tierCap / stars / guns 里多出来的 launcher 会自动丢掉）
  const weapons = Array.isArray(c.weapons) ? c.weapons.filter((k) => k !== GONE_WEAPON) : c.weapons;
  return { ...c, weapons, ...('guns' in c ? {} : { guns: defaultGuns() }), ...('trialGuns' in c ? {} : { trialGuns: [] }) };
}

/** 已经删掉的武器（旧检查点里可能还在用） */
const GONE_WEAPON = 'launcher';

/** 旧检查点：手里拿着榴弹发射器就换回手枪（等级用手枪自己的）；别的字段（loadout.launcher 等）按模板重建时自然丢掉 */
function withoutGone(p: unknown, loadout: unknown): unknown {
  if (!isObj(p) || p.weapon !== GONE_WEAPON) return p;
  const pistol = isObj(loadout) && isObj(loadout.pistol) ? loadout.pistol : null;
  return { ...p, weapon: 'pistol', tier: typeof pistol?.tier === 'number' ? pistol.tier : 0 };
}
/** 后来才加的僵尸字段：读旧存档时缺了不算错 */
const ZOMBIE_ADDED = ['leapState', 'leapT', 'leapDur', 'leapX0', 'leapZ0', 'leapX1', 'leapZ1', 'leapCd', 'pounce', 'airY', 'minion', 'plateHp', 'skill', 'skillStage', 'skillT', 'skillDX', 'skillDZ', 'hookCd', 'cleaveCd', 'lobCd', 'shriekCd', 'summonCd', 'broodT', 'sacs', 'sacDmg', 'rage'];

export function serialize(g: Game, savedAt = 0): RunCheckpoint {
  const zombies = g.zombies
    .filter((z) => z.alive)
    .map((z) => {
      const o: Fields = {};
      for (const [k, v] of Object.entries(z)) if (!ZOMBIE_SKIP.has(k)) o[k] = v;
      return o;
    });
  return plain({
    version: 1 as const,
    savedAt,
    rng: g.rng.state,
    nextId: g.nextId,
    nextBulletId: g.nextBulletId,
    time: g.time,
    tick: g.tick,
    scrap: g.scrap,
    scrapEarned: g.scrapEarned,
    config: g.config,
    run: g.run,
    player: g.player,
    input: g.input,
    mods: g.mods,
    stats: g.stats,
    core: { hp: g.core.hp, maxHp: g.core.maxHp },
    loadout: g.loadout,
    cardCounts: g.cardCounts,
    scrapBoxes: g.scrapBoxes.map((b) => b.alive),
    structures: [...g.structures.values()].map((s) => ({ id: s.id, kind: s.kind, cx: s.cx, cy: s.cy, hp: s.hp, maxHp: s.maxHp, aim: s.aim, cd: s.cd, sinceShot: s.sinceShot, target: s.target })),
    zombies,
    bullets: g.bullets,
    projectiles: g.projectiles,
    nav: g.nav.exportState(),
    buildKind: g.buildKind,
    hz: g.hz,
    combo: g.combo,
    comboT: g.comboT,
    hurtT: g.hurtT,
    healPool: g.healPool,
    ammo: g.ammo,
    healT: g.healT,
    battery: g.battery,
    flashOn: g.flashOn,
    airdrop: g.airdrop,
    ev: g.ev,
    loot: g.loot,
  });
}

// ---------------------------------------------------------------- 校验

/**
 * 按模板的形状校验：模板里的每个字段都必须存在、类型相同（数字必须有限）；嵌套对象递归；字符串数组逐项是字符串。
 * 多出来的字段丢掉。返回一份新对象。
 */
function parseAmmo(v: unknown): Partial<Record<WeaponKind, number>> {
  const out: Partial<Record<WeaponKind, number>> = {};
  if (!isObj(v)) return out;
  for (const k of WEAPON_ORDER) {
    const n = v[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = Math.min(1e7, Math.floor(n));
  }
  return out;
}

function shaped<T>(template: T, v: unknown, path: string): T {
  if (typeof template === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SaveError(`${path} 不是数字`);
    return v as T;
  }
  if (typeof template === 'boolean' || typeof template === 'string') {
    if (typeof v !== typeof template) throw new SaveError(`${path} 类型不对`);
    return v as T;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(v)) throw new SaveError(`${path} 不是数组`);
    for (const x of v) if (typeof x !== 'string' && typeof x !== 'number') throw new SaveError(`${path} 里有非法元素`);
    return [...v] as T;
  }
  if (template === null || typeof template !== 'object') throw new SaveError(`${path} 无法校验`);
  if (!isObj(v)) throw new SaveError(`${path} 缺失`);
  const out: Fields = {};
  for (const [k, t] of Object.entries(template as Fields)) {
    if (!(k in v)) throw new SaveError(`${path}.${k} 缺失`);
    out[k] = shaped(t, v[k], `${path}.${k}`);
  }
  return out as T;
}

/** 统计：nights 是对象数组（每夜一条复盘），shaped 只认字符串 / 数字数组，单独按模板逐条校验 */
function parseStats(g: Game, v: unknown): GameStats {
  if (!isObj(v)) throw new SaveError('stats 缺失');
  const { nights: _n, ...rest } = g.stats;
  // 后来才加的僵尸种类：旧存档的击杀统计里没有这个键，按 0 补上
  if (isObj(v.killsBy)) v = { ...v, killsBy: { ...Object.fromEntries(Object.keys(rest.killsBy).map((k) => [k, 0])), ...v.killsBy } };
  if (!isObj(v)) throw new SaveError('stats 缺失');
  const out = shaped(rest, v, 'stats') as Omit<GameStats, 'nights'>;
  if (!Array.isArray(v.nights) || v.nights.length > 1000) throw new SaveError('stats.nights 不合法');
  const tpl: NightLog = { night: 0, kills: 0, coreLow: 0, lost: 0, hurt: 0, boss: 0, elite: 0, challenge: 0, mod: '' };
  return { ...out, nights: v.nights.map((x, i) => shaped(tpl, x, `stats.nights[${i}]`)) };
}

const range = (v: number, min: number, max: number, path: string): void => {
  if (v < min || v > max) throw new SaveError(`${path} 越界（${v}）`);
};

const isWeapon = (v: unknown): v is WeaponKind => typeof v === 'string' && (WEAPON_ORDER as string[]).includes(v);
const isStructure = (v: unknown): v is StructureKind => typeof v === 'string' && (STRUCTURE_ORDER as string[]).includes(v);
const isZombie = (v: unknown): v is ZombieKind => typeof v === 'string' && v in ZOMBIES;

/** 危险区状态：每个列表按元素模板校验；爆炸物数量必须和地图一致（0 = 这一局没开 M12 玩法） */
function parseHazards(g: Game, v: unknown): HazardState {
  if (!isObj(v)) throw new SaveError('hz 缺失');
  const base = shaped({ frags: 0, fires: 0, useFire: false, shoveCd: 0, pulseCharge: 0, pulseCd: 0 }, v, 'hz');
  const throwT = isObj(v) && typeof v.throwT === 'number' && Number.isFinite(v.throwT) ? Math.max(0, Math.min(1, v.throwT)) : 0;
  const throwCd = isObj(v) && typeof v.throwCd === 'number' && Number.isFinite(v.throwCd) ? Math.max(0, Math.min(5, v.throwCd)) : 0;
  const list = <T>(key: string, t: T): T[] => {
    const a = v[key];
    if (!Array.isArray(a) || a.length > 512) throw new SaveError(`hz.${key} 不合法`);
    return a.map((x) => shaped(t, x, `hz.${key}`));
  };
  const hazards = list('hazards', { kind: '', x: 0, z: 0, r: 0, life: 0 });
  if (!hazards.every((h) => h.kind === 'fire' || h.kind === 'acid' || h.kind === 'gas')) throw new SaveError('hz.hazards 种类不合法');
  const explosives = list('explosives', { kind: '', x0: 0, y0: 0, x1: 0, y1: 0, x: 0, z: 0, hp: 0, alive: false });
  if (!explosives.every((e) => e.kind === 'barrel' || e.kind === 'pump' || e.kind === 'car')) throw new SaveError('hz.explosives 种类不合法');
  const expected = g.map.props.filter((p) => p.kind === 'barrel' || p.kind === 'pump' || p.kind === 'car').length;
  if (explosives.length !== 0 && explosives.length !== expected) throw new SaveError('爆炸物数量和地图不一致');
  // 首领的预警圈、尖啸震慑是后来加的：旧存档里没有就是空的
  const marks = Array.isArray(v.marks) ? list('marks', { kind: '', x: 0, z: 0, r: 0, t: 0, damage: 0 }) : [];
  if (!marks.every((m) => m.kind === 'rock' || m.kind === 'acid')) throw new SaveError('hz.marks 种类不合法');
  const dazeT = typeof v.dazeT === 'number' && Number.isFinite(v.dazeT) ? Math.max(0, Math.min(10, v.dazeT)) : 0;
  return {
    ...base,
    throwT,
    throwCd,
    hazards: hazards as HazardState['hazards'],
    explosives: explosives as HazardState['explosives'],
    spits: list('spits', { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }),
    thrown: list('thrown', { fire: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 }),
    marks: marks as HazardState['marks'],
    dazeT,
  };
}

/** 校验一份检查点，template 是同一张地图上新建的 Game（提供各字段的形状和格子数据）。不合法时抛 SaveError */
export function parseCheckpoint(template: Game, v: unknown): RunCheckpoint {
  if (!isObj(v)) throw new SaveError('不是对象');
  if (v.version !== 1) throw new SaveError('检查点版本不对');
  const g = template;
  const out: RunCheckpoint = {
    version: 1,
    savedAt: num(v, 'savedAt', 0, 1e15),
    rng: num(v, 'rng', 0, 0xffffffff, true),
    nextId: num(v, 'nextId', 1, 1e9, true),
    nextBulletId: num(v, 'nextBulletId', 1, 1e12, true),
    time: num(v, 'time', 0, 1e7),
    tick: num(v, 'tick', 0, 1e9, true),
    scrap: num(v, 'scrap', 0, 1e7),
    scrapEarned: num(v, 'scrapEarned', 0, 1e8),
    config: shaped(g.config, withGuns(v.config), 'config'),
    run: shaped(g.run, v.run, 'run'),
    player: shaped(g.player, withoutGone(v.player, v.loadout), 'player'),
    input: shaped(g.input, v.input, 'input'),
    mods: shaped(g.mods, v.mods, 'mods'),
    stats: parseStats(g, v.stats),
    core: shaped({ hp: 0, maxHp: 0 }, v.core, 'core'),
    loadout: shaped(g.loadout, v.loadout, 'loadout'),
    cardCounts: {},
    scrapBoxes: [],
    structures: [],
    zombies: [],
    bullets: [],
    projectiles: [],
    nav: shaped({ cell: 0, fieldCell: 0, accum: 0, dirty: false }, v.nav, 'nav'),
    buildKind: isStructure(v.buildKind) ? v.buildKind : 'barricade',
    hz: parseHazards(g, v.hz),
    combo: num(v, 'combo', 0, 1e6, true),
    comboT: num(v, 'comboT', 0, 60),
    hurtT: num(v, 'hurtT', 0, 1e9),
    healPool: num(v, 'healPool', 0, 1000),
    ammo: parseAmmo(v.ammo),
    healT: num(v, 'healT', 0, 10),
    battery: num(v, 'battery', 0, 60),
    flashOn: v.flashOn === true,
    airdrop: shaped({ stage: 0, t: 0, x: 0, z: 0 }, v.airdrop, 'airdrop'),
    ev: shaped(newRisk(), v.ev, 'ev'),
    loot: shaped(newLoot(), v.loot, 'loot'),
  };

  // ---- 枚举和范围 ----
  const c = out.config;
  if (!isDifficulty(c.difficulty)) throw new SaveError('config.difficulty 不合法');
  if (c.chapter !== g.mapId) throw new SaveError('检查点的地图和当前地图不一致');
  if (!c.weapons.every(isWeapon) || !c.structures.every(isStructure)) throw new SaveError('config 里有未知的武器 / 建筑');
  for (const k of WEAPON_ORDER) range(c.tierCap[k], 0, MAX_TIER, `config.tierCap.${k}`);
  range(c.zombieHp, 0.1, 10, 'config.zombieHp');
  range(c.zombieCount, 0.1, 10, 'config.zombieCount');
  range(c.zombieDamage, 0.1, 10, 'config.zombieDamage');
  range(c.cardChoices, 1, 6, 'config.cardChoices');
  if (c.training) throw new SaveError('训练场不存档');
  if (c.daily) throw new SaveError('每日挑战不存档');
  for (const k of WEAPON_ORDER) if (!gunFits(k, c.guns[k])) throw new SaveError(`config.guns.${k} 不是这一类的型号`);
  if (!c.trialGuns.every((id) => id in GUN_BY_ID)) throw new SaveError('config.trialGuns 里有未知的型号');
  const r = out.run;
  if (!['day', 'night', 'cards'].includes(r.phase)) throw new SaveError(`run.phase 不能存档（${r.phase}）`);
  range(r.night, 1, r.endless ? 999 : FINAL_NIGHT, 'run.night');
  if (!['', 'player', 'core'].includes(r.lostReason)) throw new SaveError('run.lostReason 不合法');
  if (!r.cardChoices.every((id) => typeof id === 'string' && id in CARD_BY_ID)) throw new SaveError('run.cardChoices 里有未知的卡牌');
  const p = out.player;
  if (!isWeapon(p.weapon)) throw new SaveError('player.weapon 不合法');
  range(p.maxHp, 1, 1e4, 'player.maxHp');
  range(p.hp, 0, p.maxHp, 'player.hp');
  if (!p.alive || p.hp <= 0) throw new SaveError('玩家已经死亡');
  if (!g.grid.inBounds(g.grid.cellX(p.x), g.grid.cellY(p.z)) || g.grid.solid[g.grid.indexAt(p.x, p.z)]) throw new SaveError('玩家卡在墙里或地图外');
  range(out.core.maxHp, 1, 1e5, 'core.maxHp');
  range(out.core.hp, 0.01, out.core.maxHp, 'core.hp');
  for (const k of WEAPON_ORDER) {
    const s = out.loadout[k];
    range(s.tier, 0, MAX_TIER, `loadout.${k}.tier`);
    if (!Number.isInteger(s.tier)) throw new SaveError(`loadout.${k}.tier 不是整数`);
    range(s.mag, 0, effectiveStats(k, s.tier, out.config.weaponMods?.[k], GUN_BY_ID[out.config.guns[k]]).mag, `loadout.${k}.mag`);
  }
  if (!out.loadout[p.weapon].owned) throw new SaveError('当前武器没有拥有');
  if (out.config.extras && WEAPON_ORDER.filter((k) => out.loadout[k].owned && out.loadout[k].carried).length > CARRY_MAX) throw new SaveError('身上的枪超过上限');

  // ---- 卡牌 ----
  if (!isObj(v.cardCounts)) throw new SaveError('cardCounts 缺失');
  for (const [id, n] of Object.entries(v.cardCounts)) {
    const card = CARD_BY_ID[id];
    if (!card) throw new SaveError(`未知的卡牌 ${id}`);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > card.max) throw new SaveError(`卡牌 ${id} 层数越界`);
    out.cardCounts[id] = n;
  }

  // ---- 零件箱 ----
  if (!Array.isArray(v.scrapBoxes) || v.scrapBoxes.length !== g.scrapBoxes.length || !v.scrapBoxes.every((b) => typeof b === 'boolean')) throw new SaveError('scrapBoxes 不合法');
  out.scrapBoxes = [...(v.scrapBoxes as boolean[])];

  // ---- 建筑：种类、位置合法、不重叠 ----
  if (!Array.isArray(v.structures)) throw new SaveError('structures 不是数组');
  const cells = new Set<number>();
  const ids = new Set<number>();
  const sTemplate = { id: 0, kind: '', cx: 0, cy: 0, hp: 0, maxHp: 0, aim: 0, cd: 0, sinceShot: 0, target: 0 };
  for (const raw of v.structures) {
    const s = shaped(sTemplate, raw, 'structure');
    if (!isStructure(s.kind)) throw new SaveError(`未知的建筑 ${s.kind}`);
    if (!Number.isInteger(s.cx) || !Number.isInteger(s.cy) || !g.grid.inBounds(s.cx, s.cy)) throw new SaveError('建筑在地图外');
    const i = g.grid.idx(s.cx, s.cy);
    if (g.grid.solid[i]) throw new SaveError(`建筑落在墙里（${s.cx}, ${s.cy}）`);
    if (cells.has(i)) throw new SaveError('两座建筑在同一格');
    if (ids.has(s.id) || s.id >= out.nextId) throw new SaveError('建筑 id 不合法');
    range(s.maxHp, 1, 1e5, 'structure.maxHp');
    range(s.hp, 0.01, s.maxHp, 'structure.hp');
    cells.add(i);
    ids.add(s.id);
    out.structures.push({ ...s, kind: s.kind });
  }

  // ---- 僵尸 / 子弹 / 榴弹：按新建实例的形状校验 ----
  if (!Array.isArray(v.zombies) || v.zombies.length > 256) throw new SaveError('zombies 不合法');
  const zTemplate: Fields = {};
  for (const [k, x] of Object.entries(new Zombie(1, 'walker', 0, 0, 1, 1))) if (!ZOMBIE_SKIP.has(k)) zTemplate[k] = x;
  for (const raw of v.zombies) {
    // 跳跃者 / 裂殖者加的字段：更早的存档里没有，按新建僵尸的值补上
    const filled = isObj(raw) ? { ...raw } : raw;
    if (isObj(filled)) for (const k of ZOMBIE_ADDED) if (!(k in filled)) filled[k] = zTemplate[k];
    const z = shaped(zTemplate, filled, 'zombie');
    if (!isZombie(z.kind)) throw new SaveError('未知的僵尸种类');
    out.zombies.push(z);
  }
  const bTemplate: Bullet = { id: 0, kind: 'pistol', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, damage: 0, pierceLeft: 0, traveled: 0, range: 0, burn: 0, slowHit: 0, refund: 0, hit: [] };
  if (!Array.isArray(v.bullets) || !Array.isArray(v.projectiles)) throw new SaveError('子弹列表不合法');
  for (const raw of v.bullets) {
    const b = shaped(bTemplate, raw, 'bullet');
    if (!isWeapon(b.kind)) throw new SaveError('子弹武器种类不合法');
    // 团队死斗加的字段：僵尸模式里子弹都是玩家打的（缺省 owner -1、team 0）
    const r = raw as { owner?: unknown; team?: unknown };
    b.owner = typeof r.owner === 'number' && Number.isInteger(r.owner) ? r.owner : -1;
    b.team = r.team === 1 ? 1 : 0;
    out.bullets.push(b);
  }
  const prTemplate: Projectile = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, damage: 0, aoe: 0, split: 0, bomblet: false };
  for (const raw of v.projectiles) out.projectiles.push(shaped(prTemplate, raw, 'projectile'));
  return out;
}

// ---------------------------------------------------------------- 恢复

/** 把检查点放进一个新建的 Game（同一张地图，还没开局）。数据必须先经过 parseCheckpoint */
export function applyCheckpoint(g: Game, cp: RunCheckpoint): void {
  g.rng.state = cp.rng;
  g.nextId = cp.nextId;
  g.nextBulletId = cp.nextBulletId;
  g.time = cp.time;
  g.tick = cp.tick;
  g.scrap = cp.scrap;
  g.scrapEarned = cp.scrapEarned;
  g.config = cp.config;
  Object.assign(g.run, cp.run);
  Object.assign(g.player, cp.player);
  Object.assign(g.input, cp.input);
  Object.assign(g.mods, cp.mods);
  Object.assign(g.stats, cp.stats);
  g.core.hp = cp.core.hp;
  g.core.maxHp = cp.core.maxHp;
  for (const k of WEAPON_ORDER) Object.assign(g.loadout[k], cp.loadout[k]);
  for (const id of Object.keys(g.cardCounts)) delete g.cardCounts[id];
  Object.assign(g.cardCounts, cp.cardCounts);
  cp.scrapBoxes.forEach((alive, i) => {
    const b = g.scrapBoxes[i];
    if (b) b.alive = alive;
  });
  for (const s of cp.structures) g.restoreStructure({ ...s, def: STRUCTURES[s.kind] });
  g.zombies.length = 0;
  for (const raw of cp.zombies) {
    const z = new Zombie(raw.id as number, raw.kind as ZombieKind, 0, 0, 1, raw.seed as number);
    Object.assign(z, raw);
    g.zombies.push(z);
  }
  g.bullets.length = 0;
  g.bullets.push(...cp.bullets);
  g.projectiles.length = 0;
  g.projectiles.push(...cp.projectiles);
  g.buildKind = cp.buildKind;
  g.buildMode = false;
  Object.assign(g.hz, cp.hz);
  g.combo = cp.combo;
  g.comboT = cp.comboT;
  g.hurtT = cp.hurtT;
  g.healPool = cp.healPool;
  g.ammo = { ...cp.ammo };
  g.healT = cp.healT;
  g.battery = cp.battery;
  Object.assign(g.airdrop, cp.airdrop);
  Object.assign(g.ev, cp.ev);
  Object.assign(g.loot, cp.loot);
  if (g.ev.id === 'survivor' && g.ev.stage === 1) g.events.emit('riskFlare', { x: g.ev.x, z: g.ev.z, on: true });
  if (g.airdrop.stage === 2) g.events.emit('airdrop', { stage: 'land', x: g.airdrop.x, z: g.airdrop.z });
  g.flashOn = cp.flashOn;
  if (g.config.extras) wireChallenges(g);
  g.hz.explosives.forEach((e, i) => {
    if (!e.alive) g.events.emit('propExploded', { index: i, x: e.x, z: e.z, silent: true });
  });
  g.nav.importState(cp.nav);
  // 让画面 / 声音跟上：零件箱、昼夜
  g.scrapBoxes.forEach((b, i) => g.events.emit('scrapBox', { index: i, taken: !b.alive }));
  g.events.emit('phase', { phase: g.run.phase, night: g.run.night });
}

/** 检查点的摘要（大厅显示 "继续"、放弃时结算勋章用）；读不出来返回 null */
export function peekCheckpoint(raw: string | null): { night: number; phase: string; difficulty: string; chapter: MapId; savedAt: number; kills: number; headshotKills: number; scrap: number; hp: number; maxHp: number; ammo: Partial<Record<WeaponKind, number>>; weaponKills: Partial<Record<WeaponKind, number>>; weaponHeads: Partial<Record<WeaponKind, number>> } | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { ammo?: unknown; run?: { night?: unknown; phase?: unknown }; config?: { difficulty?: unknown; chapter?: unknown }; savedAt?: unknown; scrap?: unknown; player?: { hp?: unknown; maxHp?: unknown }; stats?: { kills?: unknown; headshotKills?: unknown; weaponKills?: unknown; weaponHeads?: unknown } };
    const night = o.run?.night;
    const phase = o.run?.phase;
    const difficulty = o.config?.difficulty;
    if (typeof night !== 'number' || typeof phase !== 'string' || !isDifficulty(difficulty)) return null;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const chapter = isMapId(o.config?.chapter) ? o.config.chapter : 'outpost';
    return { night, phase, difficulty, chapter, ammo: parseAmmo(o.ammo), weaponKills: parseAmmo(o.stats?.weaponKills), weaponHeads: parseAmmo(o.stats?.weaponHeads), savedAt: n(o.savedAt), kills: n(o.stats?.kills), headshotKills: n(o.stats?.headshotKills), scrap: n(o.scrap), hp: n(o.player?.hp), maxHp: n(o.player?.maxHp) };
  } catch {
    return null;
  }
}

/** 从字符串读档：成功返回 null，失败返回原因（不抛异常，也不改动 g） */
export function loadCheckpoint(g: Game, raw: string | null): string | null {
  if (!raw) return '没有检查点';
  let cp: RunCheckpoint;
  try {
    cp = parseCheckpoint(g, JSON.parse(raw));
  } catch (e) {
    return e instanceof SaveError ? e.message : 'JSON 损坏';
  }
  applyCheckpoint(g, cp);
  return null;
}
