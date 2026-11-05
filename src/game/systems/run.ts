import { CARD_BY_ID, drawCards } from '../data/cards';
import { WEAPON_ORDER } from '../data/weapons';
import { CHAPTER_BY_ID } from '../data/chapters';
import { ALIVE_CAP, DAY_FIRST, DAY_LEN, FINAL_NIGHT, START_SCRAP, batchInterval, batchSize, bossFor, hpScale, nightBonus, nightCount, pickKind } from '../data/waves';
import { CHALLENGES, CHALLENGE_ORDER, CHALLENGE_SCRAP, ELITE_HP, NIGHT_MOD_ORDER, nightMod } from '../data/modifiers';
import type { ZombieKind } from '../data/zombies';
import type { Game } from '../sim';
import { HEAL_TICK, POOL_PER_TICK, REGEN_DELAY } from '../data/heal';
import { planAirdrop } from './airdrop';
import { GRENADE, registerExplosives } from './hazards';

export type Phase = 'menu' | 'day' | 'night' | 'cards' | 'won' | 'lost' | 'training';

export interface RunState {
  phase: Phase;
  /** 当前是第几夜（白天属于它后面那一夜） */
  night: number;
  /** 白天倒计时 */
  timer: number;
  /** 这一夜还没刷出来的普通僵尸 */
  toSpawn: number;
  /** 这一夜的普通僵尸总数 */
  total: number;
  spawnTimer: number;
  /** 本局用时（秒） */
  time: number;
  cardChoices: string[];
  lostReason: 'player' | 'core' | '';
  /** 这一夜是否有首领 */
  bossId: number;
  /** 这个黎明还能重抽几次卡牌 */
  rerollsLeft: number;
  /** 下一夜 / 这一夜的词缀（空串 = 没有）；夜里生效的系数 */
  mod: string;
  modSpeed: number;
  modScrap: number;
  /** 这一夜的挑战和进度（kills / heads 是这一夜的击杀和爆头击杀，breached = 有路障被拆，window = 闪电战的击杀时间戳） */
  challenge: string;
  chKills: number;
  chHeads: number;
  chPistol: number;
  chBreached: boolean;
  chWindow: number[];
  chDone: boolean;
  /** 无尽模式：通关后继续 */
  endless: boolean;
  /** 已经结算过的勋章（通关时结算一次；无尽模式结束时只补差额） */
  medalsPaid: number;
}

export function newRunState(): RunState {
  return { phase: 'menu', night: 1, timer: 0, toSpawn: 0, total: 0, spawnTimer: 0, time: 0, cardChoices: [], lostReason: '', bossId: -1, rerollsLeft: 0, mod: '', modSpeed: 1, modScrap: 1, challenge: '', chKills: 0, chHeads: 0, chPistol: 0, chBreached: false, chWindow: [], chDone: false, endless: false, medalsPaid: 0 };
}

function setPhase(g: Game, phase: Phase): void {
  g.run.phase = phase;
  g.events.emit('phase', { phase, night: g.run.night });
}

/**
 * 正式局的尸潮密度：总数 ×1.4、每批 ×1.5、批次间隔 ×0.8（同屏上限 ALIVE_CAP 不变）。
 * 只升级手枪 + 四座炮塔也能守到第九夜，太松了。沙盒（模拟脚本）照旧
 */
export const RANKED_DENSITY = { count: 1.4, batch: 1.5, interval: 0.8 };

/** 开始新的一局：第 1 天 */
/** 受伤后多久开始自动回血（秒） */
export { REGEN_DELAY } from '../data/heal';

export function startRun(g: Game): void {
  g.run.night = 1;
  g.run.time = 0;
  g.run.lostReason = '';
  g.scrap += START_SCRAP;
  g.scrapEarned += START_SCRAP;
  if (g.config.extras) {
    registerExplosives(g);
    wireChallenges(g);
  }
  startDay(g, true);
}

/** 挑战的进度统计：订阅击杀和建筑被拆事件（检查点读档后由 boot 重新调用一次） */
const wired = new WeakSet<Game>();

export function wireChallenges(g: Game): void {
  if (wired.has(g)) return;
  wired.add(g);
  g.events.on('zombieDied', ({ head }) => {
    const r = g.run;
    if (r.phase !== 'night' || !r.challenge || r.chDone) return;
    r.chKills++;
    if (head) r.chHeads++;
    if (g.player.weapon === 'pistol') r.chPistol++;
    r.chWindow.push(r.time);
    while (r.chWindow.length && r.time - (r.chWindow[0] as number) > 30) r.chWindow.shift();
    checkChallenge(g, false);
  });
  g.events.on('structureRemoved', ({ structure, destroyed }) => {
    if (destroyed && structure.kind === 'barricade' && g.run.phase === 'night') g.run.chBreached = true;
  });
}

/** 挑战判定。final = 这一夜结束时的最终判定（"一个路障都不被拆" / 爆头率只能在结束时算） */
export function checkChallenge(g: Game, final: boolean): boolean {
  const r = g.run;
  if (!r.challenge || r.chDone) return r.chDone;
  let done = false;
  switch (r.challenge) {
    case 'pistol':
      done = r.chPistol >= CHALLENGES.pistol.goal;
      break;
    case 'blitz':
      done = r.chWindow.length >= CHALLENGES.blitz.goal;
      break;
    case 'nobreach':
      done = final && !r.chBreached;
      break;
    case 'headshot':
      done = final && r.chKills >= 15 && r.chHeads / r.chKills >= CHALLENGES.headshot.goal / 100;
      break;
  }
  if (!done) return false;
  r.chDone = true;
  g.stats.challenges++;
  g.scrap += CHALLENGE_SCRAP;
  g.scrapEarned += CHALLENGE_SCRAP;
  g.events.emit('challenge', { id: r.challenge, done: true });
  g.events.emit('banner', { text: '挑战完成', sub: `${CHALLENGES[r.challenge as keyof typeof CHALLENGES].name} · +${CHALLENGE_SCRAP} 零件` });
  return true;
}

/** 每个白天：预告下一夜的词缀（第 2 夜起）和挑战 */
function planNight(g: Game): void {
  const r = g.run;
  r.mod = r.night >= 2 ? (NIGHT_MOD_ORDER[g.rng.int(0, NIGHT_MOD_ORDER.length - 1)] as string) : '';
  if (g.config.fixedMod && r.night >= 2) r.mod = g.config.fixedMod;
  r.challenge = CHALLENGE_ORDER[g.rng.int(0, CHALLENGE_ORDER.length - 1)] as string;
}

function startDay(g: Game, first = false): void {
  const r = g.run;
  r.timer = first ? DAY_FIRST : DAY_LEN;
  // 搜刮点刷新
  g.scrapBoxes.forEach((b, i) => {
    b.alive = true;
    g.events.emit('scrapBox', { index: i, taken: false });
  });
  // 武器装满（有限弹药时从备弹里补），人恢复一点
  for (const k of WEAPON_ORDER) {
    const slot = g.loadout[k];
    if (slot.owned) slot.mag += g.takeAmmo(k, g.statsOf(k, slot.tier).mag - slot.mag);
  }
  g.player.reloadTimer = 0;
  if (!first) g.player.hp = Math.min(g.player.maxHp, g.player.hp + 30);
  let sub = '搜刮零件、布置防线、升级武器。按 Enter 可提前开始夜晚';
  if (g.config.extras) {
    // 手雷补到 2 颗；预告今晚
    g.hz.frags = Math.max(g.hz.frags, GRENADE.max + g.mods.extraFrags);
    g.hz.fires = Math.max(g.hz.fires, GRENADE.fireMax);
    planNight(g);
    planAirdrop(g);
    const m = r.mod ? nightMod(r.mod) : null;
    const ch = CHALLENGES[r.challenge as keyof typeof CHALLENGES];
    sub = `${m ? `今晚：${m.name}（${m.desc}）· ` : ''}挑战：${ch.desc}`;
  }
  setPhase(g, 'day');
  g.events.emit('banner', { text: first ? '白天 · 准备' : `第 ${r.night} 天 · 准备`, sub });
}

export function skipDay(g: Game): void {
  if (g.run.phase === 'day') startNight(g);
}

function startNight(g: Game): void {
  const r = g.run;
  const m = nightMod(r.mod);
  r.modSpeed = r.mod ? m.speed : 1;
  r.modScrap = r.mod ? m.scrap : 1;
  r.chKills = r.chHeads = r.chPistol = 0;
  r.chBreached = false;
  r.chWindow = [];
  r.chDone = false;
  r.total = Math.round(nightCount(r.night) * g.config.zombieCount * (r.mod ? m.count : 1) * (g.config.extras ? RANKED_DENSITY.count : 1));
  r.toSpawn = r.total;
  r.spawnTimer = 2.5;
  r.bossId = -1;
  g.buildMode = false;
  setPhase(g, 'night');
  const boss = bossFor(r.night);
  g.events.emit('banner', { text: `第 ${r.night} 夜`, sub: boss ? `首领来袭 · ${boss.title}` : r.mod ? `${m.name} · ${m.desc}` : '尸潮来袭' });
  if (boss) {
    // 首领和随从一起从同一个入口出现
    const gate = g.rng.int(0, g.map.spawns.length - 1);
    const b = g.spawnAtGate(boss.kind, gate, boss.hpScale * g.config.zombieHp);
    if (b) r.bossId = b.id;
    for (let i = 0; i < boss.escorts; i++) g.spawnAtGate(i % 2 ? 'breaker' : 'bloater', gate, hpScale(r.night) * g.config.zombieHp);
  }
}

function endNight(g: Game): void {
  const r = g.run;
  if (g.config.extras) checkChallenge(g, true);
  r.modSpeed = 1;
  r.modScrap = 1;
  const bonus = Math.round(nightBonus(r.night) * g.mods.scrap);
  g.scrap += bonus;
  g.scrapEarned += bonus;
  g.events.emit('scrap', { x: g.player.x, z: g.player.z, amount: bonus });
  if (r.night >= FINAL_NIGHT && !r.endless) {
    setPhase(g, 'won');
    g.events.emit('runEnded', { won: true, reason: '' });
    return;
  }
  r.cardChoices = drawCards(g, g.config.cardChoices).map((c) => c.id);
  r.rerollsLeft = g.config.rerolls;
  setPhase(g, 'cards');
  g.events.emit('banner', { text: '黎明', sub: `撑过了第 ${r.night} 夜，奖励 ${bonus} 零件` });
  g.events.emit('cardsOffered', { ids: r.cardChoices });
}

/** 重抽这个黎明的卡牌（局外成长「卡牌重抽」） */
export function rerollCards(g: Game): boolean {
  const r = g.run;
  if (r.phase !== 'cards' || r.rerollsLeft <= 0) return false;
  r.rerollsLeft--;
  r.cardChoices = drawCards(g, g.config.cardChoices).map((c) => c.id);
  g.events.emit('cardsOffered', { ids: r.cardChoices });
  return true;
}

/** 这一局已经撑过了几夜（结算勋章用；中途放弃也按它算） */
export function nightsSurvived(r: RunState): number {
  if (r.phase === 'won') return Math.max(FINAL_NIGHT, r.night);
  if (r.phase === 'cards') return r.night;
  if (r.phase === 'menu' || r.phase === 'training') return 0;
  return r.night - 1;
}

/** 选一张卡，进入下一天 */
export function chooseCard(g: Game, id: string): boolean {
  if (g.run.phase !== 'cards' || !g.run.cardChoices.includes(id)) return false;
  const card = CARD_BY_ID[id];
  if (!card) return false;
  card.apply(g);
  g.cardCounts[id] = (g.cardCounts[id] ?? 0) + 1;
  g.run.cardChoices = [];
  g.run.night++;
  startDay(g);
  return true;
}

/** 通关后选择继续：进入无尽模式（夜数无限增长，每 5 夜一个首领） */
export function continueEndless(g: Game): boolean {
  const r = g.run;
  if (r.phase !== 'won' || !g.config.endless) return false;
  r.endless = true;
  r.cardChoices = drawCards(g, g.config.cardChoices).map((c) => c.id);
  r.rerollsLeft = g.config.rerolls;
  setPhase(g, 'cards');
  g.events.emit('banner', { text: '无尽之夜', sub: '每 5 夜一个首领，看你能撑多久' });
  g.events.emit('cardsOffered', { ids: r.cardChoices });
  return true;
}

function loseRun(g: Game, reason: 'player' | 'core'): void {
  g.run.lostReason = reason;
  g.buildMode = false;
  setPhase(g, 'lost');
  g.events.emit('runEnded', { won: false, reason });
}

/** 刷怪点：这一批随机用 1–3 个入口 */
function pickGates(g: Game, n: number): number[] {
  const all = g.map.spawns.map((_, i) => i);
  const out: number[] = [];
  while (out.length < n && all.length) out.push(all.splice(g.rng.int(0, all.length - 1), 1)[0] as number);
  return out;
}

function updateNight(g: Game, dt: number): void {
  const r = g.run;
  if (r.toSpawn > 0) {
    r.spawnTimer -= dt;
    if (r.spawnTimer <= 0 && g.zombies.length < ALIVE_CAP) {
      const dense = g.config.extras ? RANKED_DENSITY : null;
      const want = Math.min(Math.round(batchSize(r.night) * (dense?.batch ?? 1)), r.toSpawn, ALIVE_CAP - g.zombies.length);
      const gates = pickGates(g, 1 + g.rng.int(0, 2));
      let made = 0;
      const m = nightMod(r.mod);
      const hp = hpScale(r.night) * g.config.zombieHp * (r.mod ? m.hp : 1);
      for (let i = 0; i < want; i++) {
        const kind = g.config.extras ? pickKindExtra(g, r.night, m.runner) : pickKind(r.night, g.rng.next());
        // 精英夜：每批第一只是精英
        const elite = g.config.extras && r.mod === 'elite' && i === 0;
        const z = g.spawnAtGate(kind, gates[i % gates.length] as number, hp * (elite ? ELITE_HP : 1));
        if (z) {
          z.elite = elite;
          made++;
        }
      }
      r.toSpawn -= made;
      r.spawnTimer = made < want ? 0.6 : batchInterval(r.night) * (dense?.interval ?? 1);
    }
    return;
  }
  if (g.zombies.length === 0) endNight(g);
}

/** 带新僵尸的出场表：第 3 夜起吐酸者、第 6 夜起尖啸者；浓雾夜奔袭者更多 */
function pickKindExtra(g: Game, n: number, runnerK: number): ZombieKind {
  // 章节的额外构成：按权重先抽一次（第 2 夜以后）
  const mix = CHAPTER_BY_ID[g.config.chapter]?.mix ?? {};
  if (n >= 2) {
    let acc = 0;
    const q = g.rng.next();
    for (const [kind, w] of Object.entries(mix) as Array<[ZombieKind, number]>) {
      acc += w;
      if (q < acc) return kind;
    }
  }
  const r = g.rng.next();
  const spitter = n >= 3 ? Math.min(0.04 + (n - 3) * 0.015, 0.12) : 0;
  const screamer = n >= 6 ? Math.min(0.03 + (n - 6) * 0.01, 0.08) : 0;
  if (r < spitter) return 'spitter';
  if (r < spitter + screamer) return 'screamer';
  const k = pickKind(n, (r - spitter - screamer) / (1 - spitter - screamer));
  if (k === 'walker' && runnerK > 1 && g.rng.next() < (runnerK - 1) * 0.25) return 'runner';
  return k;
}

/**
 * 正式局的零件箱奖励：基础 12–22，按天数增长（第 n 天 ×(1 + 0.1(n−1))），离发电机越远越多（每 10 米 +10%）。
 * 新地图房子多、路绕，跑一趟捡箱子要花不少白天时间；之前固定 10–25，后期根本不值得去。
 * 沙盒照旧 10–25（旧的 sim 结果不变）
 */
export function boxReward(g: Game, x: number, z: number): number {
  if (!g.config.extras) return g.rng.range(10, 25);
  const day = 1 + 0.1 * Math.max(0, g.run.night - 1);
  const far = 1 + 0.01 * Math.hypot(x - g.core.x, z - g.core.z);
  return g.rng.range(12, 22) * day * far;
}

/** 地图上的零件箱：走近就捡 */
function updatePickups(g: Game): void {
  const p = g.player;
  if (!p.alive) return;
  for (let i = 0; i < g.scrapBoxes.length; i++) {
    const b = g.scrapBoxes[i]!;
    if (!b.alive) continue;
    if (Math.hypot(b.x - p.x, b.z - p.z) < 1.35) {
      b.alive = false;
      const amount = Math.round(boxReward(g, b.x, b.z) * g.mods.scrap);
      g.scrap += amount;
      g.scrapEarned += amount;
      g.events.emit('scrap', { x: b.x, z: b.z, amount });
      g.events.emit('scrapBox', { index: i, taken: true });
    }
  }
}

export function updateRun(g: Game, dt: number): void {
  const r = g.run;
  if (r.phase === 'menu' || r.phase === 'won' || r.phase === 'lost' || r.phase === 'training') return;
  r.time += dt;

  if (g.mods.coreRegen > 0 && g.core.hp > 0) g.core.hp = Math.min(g.core.maxHp, g.core.hp + g.mods.coreRegen * dt);
  // 玩家脱战回血（局外「急救训练」）：4 秒没受伤后开始
  g.hurtT += dt;
  const p = g.player;
  // 回血按节拍结算：每 HEAL_TICK 秒回一小口（嗜血池 + 脱战回血），不会一下跳满
  g.healT += dt;
  while (g.healT >= HEAL_TICK) {
    g.healT -= HEAL_TICK;
    if (!p.alive) {
      g.healPool = 0;
      break;
    }
    let heal = 0;
    if (g.healPool > 0) {
      const k = Math.min(g.healPool, POOL_PER_TICK);
      g.healPool -= k;
      heal += k;
    }
    if (g.mods.regen > 0 && g.hurtT >= REGEN_DELAY) heal += g.mods.regen * HEAL_TICK;
    if (heal > 0 && p.hp < p.maxHp) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + heal);
      g.stats.healed += p.hp - before;
      g.events.emit('healed', { amount: p.hp - before });
    }
  }
  updatePickups(g);

  if (g.input.confirm) {
    g.input.confirm = false;
    skipDay(g);
  }

  if (r.phase === 'day') {
    r.timer -= dt;
    if (r.timer <= 0) startNight(g);
  } else if (r.phase === 'night') {
    updateNight(g, dt);
  }

  // 上面的阶段函数可能已经把阶段改成了 won，所以这里重新读一次
  const now: Phase = g.run.phase;
  if (now !== 'won' && now !== 'lost') {
    if (!g.player.alive) loseRun(g, 'player');
    else if (g.core.hp <= 0) loseRun(g, 'core');
  }
}
