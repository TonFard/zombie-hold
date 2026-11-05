import { reactive } from 'vue';
import { costOf, type StructureKind } from '../game/data/structures';
import { MAX_TIER, WEAPON_ORDER, WEAPONS, adsAt, statsAt, sustainedDps, type WeaponKind } from '../game/data/weapons';
import { CARRY_MAX, type Game } from '../game/sim';
import { reasonText } from '../game/systems/building';
import { CHALLENGES, FLASHLIGHT, comboMult, nightMod } from '../game/data/modifiers';
import { PULSE } from '../game/systems/hazards';
import { HALF_H, HALF_W } from '../game/world/grid';
import type { Phase } from '../game/systems/run';
import { CARD_BY_ID, type CardRarity } from '../game/data/cards';
import type { MetaApplied } from '../game/config';

export interface HurtMark {
  /** 相对当前视线的顺时针角度（弧度，0 = 正前方），每次同步时按攻击者的方位重算 */
  a: number;
  /** 攻击者相对玩家的世界方位（atan2(dx, dz)） */
  world: number;
  life: number;
}

export interface WeaponRow {
  kind: WeaponKind;
  key: number;
  name: string;
  owned: boolean;
  equipped: boolean;
  tier: number;
  price: number;
  dps: number;
  /** 下一级升级（满级为空） */
  nextName: string;
  nextDesc: string;
  nextCost: number;
  /** 买下后（或升级后）的 DPS，用来让玩家看到收益 */
  dpsAfter: number;
  canBuy: boolean;
  canUpgrade: boolean;
  /** 特殊能力标签：穿透、范围、点燃…… */
  specials: string[];
  /** 射程（米）和射程内伤害衰减后剩下的比例 */
  range: number;
  rangeMin: number;
  headMult: number;
  /** 这一局的等级上限（局外成长决定，5–8） */
  cap: number;
  /** 还没在大厅解锁，工坊里买不了 */
  locked: boolean;
  /** 已解锁但零件不够时还差多少（够了或已拥有为 0） */
  short: number;
  /** 买不了时的原因（locked 时显示） */
  lockNote: string;
  /** 已经带满两把时，买这把会换掉谁（空串 = 不换） */
  swapOut: string;
}

const specialsOf = (kind: WeaponKind, tier: number): string[] => {
  const st = statsAt(kind, tier);
  const out: string[] = [];
  if (st.pierce > 0) out.push(`穿透 ${st.pierce}`);
  if (st.aoe > 0) out.push(`范围 ${st.aoe}`);
  if (st.burn > 0) out.push('点燃');
  if (st.ramp > 0) out.push('射速递增');
  if (st.split > 0) out.push('分裂');
  if (st.pellets > 1) out.push(`${st.pellets} 弹丸`);
  if (st.refund > 0) out.push('爆头返弹');
  if (st.slowHit > 0) out.push(`减速 ${Math.round(st.slowHit * 100)}%`);
  if (adsAt(kind, tier).scope) out.push('瞄准镜');
  return out;
};

/** UI 读取的游戏状态快照。逻辑层不依赖 Vue，由应用层把状态抄进来 */
export const hud = reactive({
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  weaponName: '',
  weaponKind: 'pistol' as WeaponKind,
  /** M12：手雷、推搡、手电、脉冲、连杀、词缀和挑战 */
  extras: {
    on: false,
    frags: 0,
    fires: 0,
    useFire: false,
    shoveCd: 0,
    battery: 1,
    flashOn: false,
    pulseCd: 0,
    pulseCharge: 0,
    pulseNear: false,
    combo: 0,
    comboMult: 1,
    mod: '',
    challenge: '',
    chDone: false,
    chProgress: '',
  },
  /** 雷达范围倍率（浓雾夜减半） */
  radarScale: 1,
  /** 训练场统计（由应用层抄进来） */
  training: { hits: 0, headHits: 0, kills: 0, headKills: 0, lastDist: 0, lastHead: false },
  tier: 0,
  /** 当前武器射程（米） */
  range: 0,
  /** 瞄准进度 0–1，瞄准镜武器完全举镜时显示镜框 */
  ads: 0,
  scope: false,
  /** 爆头命中标记 */
  hitHead: false,
  crouch: 0,
  sliding: false,
  mag: 0,
  magMax: 0,
  /** 换弹进度 0–1，-1 = 没在换弹 */
  reload: -1,
  scrap: 0,
  kills: 0,
  coreHp: 500,
  coreMaxHp: 500,
  /** 受伤红屏 0–1 */
  hurt: 0,
  /** 鼠标是否已锁定；没锁定时提示玩家点一下画面 */
  locked: true,
  /** 命中标记 0–1（打中僵尸）、击杀标记 0–1、是否暴击 */
  hit: 0,
  hitCrit: false,
  kill: 0,
  /** 发电机刚被打，0–1 */
  coreHurt: 0,
  /** 受击方向：a 是相对视线的顺时针角度（弧度，0 = 正前方），life 1→0 */
  hurtMarks: [] as HurtMark[],
  /** 准星张开程度（像素） */
  spread: 14,
  alive: true,
  phase: 'menu' as Phase,
  night: 1,
  /** 这一夜还没打死的敌人（含没刷出来的） */
  remaining: 0,
  total: 0,
  dayTimer: 0,
  benchNear: false,
  benchDist: 99,
  bossName: '',
  bossHp: 0,
  bossMax: 1,
  weapons: [] as WeaponRow[],
  buildMode: false,
  buildKind: 'barricade' as StructureKind,
  /** 光标处不能建的原因；空串 = 可以建 */
  buildMsg: '',
  buildOk: false,
  /** 这一局能建的建筑、已建炮塔数 / 上限 */
  buildKinds: [] as StructureKind[],
  /** 这一局每种建筑的价格（正式局炮塔更贵） */
  buildCosts: {} as Partial<Record<StructureKind, number>>,
  turrets: 0,
  turretCap: 0,
  /** 零件计数器：显示值朝真实值滚动（花钱时直接跳过去） */
  scrapShown: 0,
  /** 短时间内的零件收入合并成一个"+N"：n 累计，life 1→0，bump 每次有新收入加一（让数字弹一下），box = 其中有零件箱 */
  scrapGain: { n: 0, life: 0, bump: 0, box: false },
  /** 回血 / 返弹的小数字（同样合并）：life 1→0 */
  healPop: { n: 0, life: 0, bump: 0 },
  ammoPop: { n: 0, life: 0, bump: 0 },
  /** 这一局拿到的卡牌（按拿到的先后），n = 叠了几张 */
  buffs: [] as BuffRow[],
  /** 卡牌触发时的闪光：卡牌 id → 1→0 */
  procs: {} as Record<string, number>,
  /** 局外（大厅买的）数值加成，一行一条 */
  metaLines: [] as string[],
  /** 白天：今天还没捡的零件箱数 / 总数、最近一个的距离（米） */
  boxesLeft: 0,
  boxesTotal: 0,
  boxDist: 99,
  /** 卡牌「战意」当前的伤害加成（0.12 = +12%） */
  comboDmg: 0,
});

export interface BuffRow {
  id: string;
  name: string;
  desc: string;
  rarity: CardRarity;
  n: number;
}

/** 局外加成的文字说明（和大厅里的说法一致） */
export function metaLinesOf(m: MetaApplied): string[] {
  const out: string[] = [];
  const pct = (v: number) => Math.round(Math.abs(v - 1) * 100);
  if (m.maxHp) out.push(`生命 +${m.maxHp}`);
  if (m.coreHp) out.push(`发电机 +${m.coreHp}`);
  if (m.armor < 1) out.push(`受到伤害 −${pct(m.armor)}%`);
  if (m.regen) out.push(`脱战回血 ${m.regen}/秒`);
  if (m.speed > 1) out.push(`移速 +${pct(m.speed)}%`);
  if (m.fireRate > 1) out.push(`射速 +${pct(m.fireRate)}%`);
  if (m.turretDamage > 1) out.push(`炮塔伤害 +${pct(m.turretDamage)}%`);
  if (m.structHp > 1) out.push(`建筑生命 +${pct(m.structHp)}%`);
  if (m.scrapGain > 1) out.push(`零件收益 +${pct(m.scrapGain)}%`);
  return out;
}

/** 卡牌触发：闪一下对应的卡牌格（没拿这张牌就不闪） */
export function procCard(game: Game, id: string): void {
  if (game.cardCounts[id]) hud.procs[id] = 1;
}

/** 回血 / 返弹数字：上一个还没消失就累加 */
export function bumpPop(p: { n: number; life: number; bump: number }, amount: number): void {
  p.n = p.life > 0.05 ? p.n + amount : amount;
  p.life = 1;
  p.bump++;
}

let lastHp = 100;
let lastScrap = -1;
let buffKey = '';
let metaKey = '';

/** 雷达用的快照。数据量大且每帧变，所以不放进 reactive，由雷达组件自己用 canvas 读取绘制 */
export const radar = {
  px: 0,
  pz: 0,
  /** 玩家朝向（0 = 面向 +Z） */
  yaw: 0,
  /** 僵尸：每 3 个数一组 [x, z, 种类编号] */
  zombies: [] as number[],
  /** 建筑：每 3 个数一组 [x, z, 种类编号] */
  structs: [] as number[],
  /** 还没捡的零件箱：每 2 个数一组 [x, z] */
  boxes: [] as number[],
  coreX: 0,
  coreZ: 0,
  benchX: 0,
  benchZ: 0,
  /** 地形阻挡（引用逻辑层的格子数组，只读） */
  solid: null as Uint8Array | null,
};

const ZOMBIE_CODE: Record<string, number> = { walker: 0, runner: 1, bloater: 2, breaker: 3, colossus: 4, spitter: 5, screamer: 6 };
const STRUCT_CODE: Record<string, number> = { barricade: 0, turret: 1, spikes: 2, hmg: 1, flamer: 1, mortar: 1 };

let pendingBox = false;
/** 零件箱被捡走：下一次零件收入的"+N"标成零件箱 */
export function markBoxTaken(): void {
  pendingBox = true;
}

const LIVE: ReadonlySet<Phase> = new Set<Phase>(['day', 'night', 'cards']);

/** 零件滚动、收入合并、卡牌列表、局外加成、零件箱统计 */
function syncFeedback(game: Game, dt: number): void {
  const live = LIVE.has(game.run.phase);
  const g = hud.scrapGain;
  // 收入：只在局内、而且上一次也是局内时才算（开局的初始零件、读档不弹"+N"）
  if (lastScrap >= 0 && live && game.scrap > lastScrap) {
    const d = game.scrap - lastScrap;
    if (g.life > 0.05) {
      g.n += d;
      g.box = g.box || pendingBox;
    } else {
      g.n = d;
      g.box = pendingBox;
    }
    g.life = 1;
    g.bump++;
    pendingBox = false;
  }
  lastScrap = live ? game.scrap : -1;
  if (!live) hud.scrapShown = game.scrap;
  // 花钱：直接跳；赚钱：数字滚上去（约 0.3 秒追平）
  if (game.scrap <= hud.scrapShown || dt <= 0) hud.scrapShown = game.scrap;
  else hud.scrapShown = Math.min(game.scrap, hud.scrapShown + Math.max(1, Math.ceil((game.scrap - hud.scrapShown) * Math.min(1, dt * 9))));
  g.life = Math.max(0, g.life - dt * 0.55);
  hud.healPop.life = Math.max(0, hud.healPop.life - dt * 0.8);
  hud.ammoPop.life = Math.max(0, hud.ammoPop.life - dt * 0.8);
  for (const k in hud.procs) {
    const v = (hud.procs[k] as number) - dt * 1.6;
    if (v <= 0) delete hud.procs[k];
    else hud.procs[k] = v;
  }

  // 卡牌：张数变了才重建列表
  const ids = Object.keys(game.cardCounts);
  const key = ids.map((id) => `${id}:${game.cardCounts[id]}`).join(',');
  if (key !== buffKey) {
    buffKey = key;
    hud.buffs = ids
      .filter((id) => CARD_BY_ID[id] && (game.cardCounts[id] ?? 0) > 0)
      .map((id) => {
        const c = CARD_BY_ID[id]!;
        return { id, name: c.name, desc: c.desc, rarity: c.rarity, n: game.cardCounts[id] ?? 0 };
      });
  }
  const m = game.config.meta;
  const mk = JSON.stringify(m);
  if (mk !== metaKey) {
    metaKey = mk;
    hud.metaLines = metaLinesOf(m);
  }

  // 零件箱：还剩几个、最近的多远
  let left = 0;
  let best = 99;
  const p = game.player;
  for (const b of game.scrapBoxes) {
    if (!b.alive) continue;
    left++;
    best = Math.min(best, Math.hypot(b.x - p.x, b.z - p.z));
  }
  hud.boxesLeft = left;
  hud.boxesTotal = game.scrapBoxes.length;
  hud.boxDist = best;
  hud.comboDmg = game.mods.comboDamage > 0 && game.comboT > 0 ? game.mods.comboDamage * Math.min(10, game.combo) : 0;
}

export function syncHud(game: Game, dt: number, input: { locked: boolean; yaw: number }): void {
  const p = game.player;
  // ---- 雷达快照 ----
  radar.px = p.x;
  radar.pz = p.z;
  radar.yaw = input.yaw;
  radar.coreX = game.core.x;
  radar.coreZ = game.core.z;
  radar.benchX = game.map.workbench.x;
  radar.benchZ = game.map.workbench.z;
  radar.solid = game.grid.solid;
  radar.zombies.length = 0;
  for (const z of game.zombies) if (z.alive) radar.zombies.push(z.x, z.z, ZOMBIE_CODE[z.kind] ?? 0);
  radar.structs.length = 0;
  for (const s of game.structures.values()) radar.structs.push(s.cx - HALF_W + 0.5, s.cy - HALF_H + 0.5, STRUCT_CODE[s.kind] ?? 0);
  radar.boxes.length = 0;
  for (const b of game.scrapBoxes) if (b.alive) radar.boxes.push(b.x, b.z);

  // ---- 命中标记、受击方向的衰减 ----
  hud.hit = Math.max(0, hud.hit - dt * 7);
  hud.kill = Math.max(0, hud.kill - dt * 3.2);
  hud.coreHurt = Math.max(0, hud.coreHurt - dt * 1.6);
  for (let i = hud.hurtMarks.length - 1; i >= 0; i--) {
    const m = hud.hurtMarks[i] as HurtMark;
    m.life -= dt * 0.8;
    if (m.life <= 0) {
      hud.hurtMarks.splice(i, 1);
      continue;
    }
    // 玩家转头时，指示跟着攻击者的方位走。yaw 变小是向右转，所以右边的敌人 world - yaw < 0，屏幕角度取反
    let rel = m.world - input.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    m.a = -rel;
  }
  const st = statsAt(p.weapon, p.tier);
  const slot = game.loadout[p.weapon];
  hud.hp = Math.ceil(p.hp);
  hud.maxHp = p.maxHp;
  hud.stamina = p.stamina;
  hud.maxStamina = p.maxStamina;
  hud.weaponName = WEAPONS[p.weapon].name;
  hud.weaponKind = p.weapon;
  hud.tier = p.tier;
  hud.range = st.range;
  hud.ads = p.ads;
  hud.scope = adsAt(p.weapon, p.tier).scope;
  hud.crouch = p.crouch;
  hud.sliding = p.slide > 0;
  hud.mag = slot.mag;
  hud.magMax = st.mag;
  hud.reload = p.reloadTimer > 0 ? 1 - p.reloadTimer / p.reloadTotal : -1;
  hud.scrap = game.scrap;
  syncFeedback(game, dt);
  hud.kills = game.stats.kills;
  hud.coreHp = Math.ceil(game.core.hp);
  hud.coreMaxHp = game.core.maxHp;
  hud.alive = p.alive;
  if (p.hp < lastHp - 0.01) hud.hurt = Math.min(1, hud.hurt + (lastHp - p.hp) / 25);
  lastHp = p.hp;
  hud.hurt = Math.max(0, hud.hurt - dt * 1.8);
  hud.locked = input.locked;
  // 准星随散布和后坐力张开
  // 准星随散布、移动、后坐力张开，瞄准时收拢（和 fireWeapon 里的散布同一套系数）
  const moveK = Math.min(1, Math.hypot(p.vx, p.vz) / 3.4);
  const hip = (1 + 0.35 * moveK) * (1 - 0.2 * p.crouch);
  hud.spread = (6 + st.spread * 2.4 * hip + p.recoil * 10 + (p.sprinting ? 10 : 0)) * (1 - 0.8 * p.ads);
  const run = game.run;
  hud.phase = run.phase;
  hud.night = run.night;
  hud.total = run.total;
  hud.remaining = run.phase === 'night' ? run.toSpawn + game.zombies.length : 0;
  hud.dayTimer = Math.max(0, run.timer);
  const wb = game.map.workbench;
  hud.benchDist = Math.hypot(p.x - wb.x, p.z - wb.z);
  hud.benchNear = run.phase === 'day' && hud.benchDist < 3.8;
  const boss = game.zombies.find((z) => z.alive && z.kind === 'colossus');
  hud.bossName = boss ? (run.night >= 10 ? '巨像·终焉' : '巨像·初代') : '';
  hud.bossHp = boss ? boss.hp : 0;
  hud.bossMax = boss ? boss.maxHp : 1;

  // 工坊：每把武器的购买 / 升级信息。只在工坊相关阶段刷新，省一点开销
  if (run.phase === 'day' || hud.weapons.length === 0) {
    hud.weapons = WEAPON_ORDER.map((k, i) => {
      const slot = game.loadout[k];
      const def = WEAPONS[k];
      const cap = Math.min(MAX_TIER, game.config.tierCap[k]);
      const state = game.buyState(k);
      const locked = state === 'locked';
      const up = slot.tier < cap ? def.upgrades[slot.tier] : undefined;
      const dps = sustainedDps(statsAt(k, slot.tier));
      return {
        kind: k,
        key: i + 1,
        name: def.name,
        owned: slot.owned,
        equipped: p.weapon === k,
        tier: slot.tier,
        price: def.price,
        dps,
        nextName: up?.name ?? '',
        nextDesc: up?.desc ?? '',
        nextCost: up?.cost ?? 0,
        dpsAfter: slot.owned ? (up ? sustainedDps(statsAt(k, slot.tier + 1)) : dps) : sustainedDps(statsAt(k, 1)),
        canBuy: state === 'ok',
        short: state === 'scrap' ? Math.ceil(def.price - game.scrap) : 0,
        swapOut: !slot.owned && game.config.extras && game.carried().length >= CARRY_MAX ? WEAPONS[p.weapon].name : '',
        lockNote: !locked ? '' : game.config.daily ? '每日挑战只能用限定武器' : '未解锁（大厅 · 军械库）',
        canUpgrade: slot.owned && !!up && game.scrap >= up.cost,
        specials: specialsOf(k, slot.owned ? slot.tier : MAX_TIER),
        range: statsAt(k, slot.tier).range,
        rangeMin: def.falloff[1],
        headMult: def.headMult,
        cap,
        locked,
      };
    });
  }
  // ---- M12 ----
  const x = hud.extras;
  x.on = game.config.extras;
  if (x.on) {
    const h = game.hz;
    x.frags = h.frags;
    x.fires = h.fires;
    x.useFire = h.useFire && h.fires > 0;
    x.shoveCd = h.shoveCd;
    x.battery = game.battery / FLASHLIGHT.battery;
    x.flashOn = game.flashOn;
    x.pulseCd = h.pulseCd;
    x.pulseCharge = h.pulseCharge;
    x.pulseNear = Math.hypot(p.x - game.core.x, p.z - game.core.z) <= PULSE.reach;
    x.combo = game.comboT > 0 ? game.combo : 0;
    x.comboMult = comboMult(game.combo);
    x.mod = run.mod;
    x.challenge = run.challenge;
    x.chDone = run.chDone;
    x.chProgress =
      run.challenge === 'pistol'
        ? `${run.chPistol} / ${CHALLENGES.pistol.goal}`
        : run.challenge === 'blitz'
          ? `${run.chWindow.length} / ${CHALLENGES.blitz.goal}`
          : run.challenge === 'headshot'
            ? `${run.chKills ? Math.round((run.chHeads / run.chKills) * 100) : 0}%（${run.chKills} 杀）`
            : run.challenge === 'nobreach'
              ? run.chBreached
                ? '已失败'
                : '保持中'
              : '';
  }
  hud.radarScale = run.phase === 'night' && run.mod ? nightMod(run.mod).radar : 1;
  hud.buildMode = game.buildMode;
  hud.buildKind = game.buildKind;
  hud.buildOk = game.buildCursor.valid;
  hud.buildMsg = reasonText(game.buildCursor.reason);
  if (hud.buildKinds.length !== game.config.structures.length) {
    hud.buildKinds = [...game.config.structures];
    hud.buildCosts = Object.fromEntries(game.config.structures.map((k) => [k, costOf(k, game.config.extras)]));
  }
  hud.turrets = game.turretCount();
  hud.turretCap = game.config.turretCap;
}
