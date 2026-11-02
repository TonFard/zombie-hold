import { CARD_BY_ID, drawCards } from '../data/cards';
import { WEAPON_ORDER, statsAt } from '../data/weapons';
import { ALIVE_CAP, DAY_FIRST, DAY_LEN, FINAL_NIGHT, START_SCRAP, batchInterval, batchSize, bossFor, hpScale, nightBonus, nightCount, pickKind } from '../data/waves';
import type { Game } from '../sim';

export type Phase = 'menu' | 'day' | 'night' | 'cards' | 'won' | 'lost';

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
}

export function newRunState(): RunState {
  return { phase: 'menu', night: 1, timer: 0, toSpawn: 0, total: 0, spawnTimer: 0, time: 0, cardChoices: [], lostReason: '', bossId: -1 };
}

function setPhase(g: Game, phase: Phase): void {
  g.run.phase = phase;
  g.events.emit('phase', { phase, night: g.run.night });
}

/** 开始新的一局：第 1 天 */
export function startRun(g: Game): void {
  g.run.night = 1;
  g.run.time = 0;
  g.run.lostReason = '';
  g.scrap += START_SCRAP;
  g.scrapEarned += START_SCRAP;
  startDay(g, true);
}

function startDay(g: Game, first = false): void {
  const r = g.run;
  r.timer = first ? DAY_FIRST : DAY_LEN;
  // 搜刮点刷新
  g.scrapBoxes.forEach((b, i) => {
    b.alive = true;
    g.events.emit('scrapBox', { index: i, taken: false });
  });
  // 武器装满，人恢复一点
  for (const k of WEAPON_ORDER) {
    const slot = g.loadout[k];
    if (slot.owned) slot.mag = statsAt(k, slot.tier).mag;
  }
  g.player.reloadTimer = 0;
  if (!first) g.player.hp = Math.min(g.player.maxHp, g.player.hp + 30);
  setPhase(g, 'day');
  g.events.emit('banner', { text: first ? '白天 · 准备' : `第 ${r.night} 天 · 准备`, sub: '搜刮零件、布置防线、升级武器。按 Enter 可提前开始夜晚' });
}

export function skipDay(g: Game): void {
  if (g.run.phase === 'day') startNight(g);
}

function startNight(g: Game): void {
  const r = g.run;
  r.total = nightCount(r.night);
  r.toSpawn = r.total;
  r.spawnTimer = 2.5;
  r.bossId = -1;
  g.buildMode = false;
  setPhase(g, 'night');
  const boss = bossFor(r.night);
  g.events.emit('banner', { text: `第 ${r.night} 夜`, sub: boss ? `首领来袭 · ${boss.title}` : '尸潮来袭' });
  if (boss) {
    // 首领和随从一起从同一个入口出现
    const gate = g.rng.int(0, g.map.spawns.length - 1);
    const b = g.spawnAtGate(boss.kind, gate, boss.hpScale);
    if (b) r.bossId = b.id;
    for (let i = 0; i < boss.escorts; i++) g.spawnAtGate(i % 2 ? 'breaker' : 'bloater', gate, hpScale(r.night));
  }
}

function endNight(g: Game): void {
  const r = g.run;
  const bonus = Math.round(nightBonus(r.night) * g.mods.scrap);
  g.scrap += bonus;
  g.scrapEarned += bonus;
  g.events.emit('scrap', { x: g.player.x, z: g.player.z, amount: bonus });
  if (r.night >= FINAL_NIGHT) {
    setPhase(g, 'won');
    g.events.emit('runEnded', { won: true, reason: '' });
    return;
  }
  r.cardChoices = drawCards(g).map((c) => c.id);
  setPhase(g, 'cards');
  g.events.emit('banner', { text: '黎明', sub: `撑过了第 ${r.night} 夜，奖励 ${bonus} 零件` });
  g.events.emit('cardsOffered', { ids: r.cardChoices });
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
      const want = Math.min(batchSize(r.night), r.toSpawn, ALIVE_CAP - g.zombies.length);
      const gates = pickGates(g, 1 + g.rng.int(0, 2));
      let made = 0;
      for (let i = 0; i < want; i++) {
        const z = g.spawnAtGate(pickKind(r.night, g.rng.next()), gates[i % gates.length] as number, hpScale(r.night));
        if (z) made++;
      }
      r.toSpawn -= made;
      r.spawnTimer = made < want ? 0.6 : batchInterval(r.night);
    }
    return;
  }
  if (g.zombies.length === 0) endNight(g);
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
      const amount = Math.round(g.rng.range(10, 25) * g.mods.scrap);
      g.scrap += amount;
      g.scrapEarned += amount;
      g.events.emit('scrap', { x: b.x, z: b.z, amount });
      g.events.emit('scrapBox', { index: i, taken: true });
    }
  }
}

export function updateRun(g: Game, dt: number): void {
  const r = g.run;
  if (r.phase === 'menu' || r.phase === 'won' || r.phase === 'lost') return;
  r.time += dt;

  if (g.mods.coreRegen > 0 && g.core.hp > 0) g.core.hp = Math.min(g.core.maxHp, g.core.hp + g.mods.coreRegen * dt);
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
