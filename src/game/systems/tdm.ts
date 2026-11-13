import { clamp } from '../core/math';
import { BULLET_GRAVITY, zeroPitch } from '../data/ballistics';
import { WEAPONS, falloffAt, statsAt, type WeaponKind } from '../data/weapons';
import type { Brain, Soldier } from '../entities/soldier';
import type { Game } from '../sim';
import { resolveCircleVsGrid } from '../world/collision';
import { GRID_W, HALF_H, HALF_W } from '../world/grid';
import { arenaSpawns } from '../world/map-arena';
import { obstruction } from './combat';
import { segCylinder, segSphere } from './hitvolume';

/**
 * 5v5 团队死斗（单机）：玩家 + 4 个队友人机 对 5 个敌方人机。
 * 先到 TDM.score 杀或时间到时杀得多的一方赢；死后 TDM.respawn 秒在己方出生点复活，出生后短暂无敌。
 *
 * 人机"像真人"靠的是这几件事：
 *   - 反应时间：看见敌人后要 0.2–0.5 秒（按技术水平）才开第一枪，背对时更慢；
 *   - 准星误差：刚看见时偏差很大，持续瞄准慢慢收敛；连射时后坐力把准星往上顶，过几发才压住；
 *   - 有记忆：看不见了会去最后看见 / 听见枪声的地方搜，而不是忘掉；
 *   - 交火时左右横移、蹲下，残血或换弹时找掩体躲；
 *   - 分路：每个人负责一条路（左翼 / 中路 / 右翼），队友之间有间距，不会挤成一团。
 */
export const TDM = {
  score: 50,
  time: 8 * 60,
  respawn: 4,
  shield: 2,
  hp: 100,
  /** 视野：最远看见距离（米）、视野半角（弧度，正前方 ±80°）、听见枪声的距离 */
  sight: 46,
  fov: (80 * Math.PI) / 180,
  hear: 30,
  speed: 3.6,
  /** 人机和玩家对打时的伤害倍率（人机用的是同一套枪，但玩家的生命比人机少不了多少，乘一点让对枪更公平） */
  botDamage: 0.8,
  /** 士兵的身体：半径、高度、头 */
  radius: 0.32,
  height: 1.75,
  headY: 1.62,
  headR: 0.13,
};

/**
 * 团队死斗里每种枪对人的伤害倍率：僵尸模式的数值是按"打一大群慢吞吞的僵尸"调的，直接拿来对人，
 * 步枪远距离精准又有穿透，冲锋枪 / 霰弹枪在射程边缘被衰减吃掉一大半，结果步枪一家独大。
 * 这里按"贴脸时每种枪都能在 0.4–0.8 秒内打死一个满血的人"重新拉平
 */
// 霰弹 1.4 → 1.0、狙击 0.9 → 0.8：2026-11 这两把枪在打僵尸的模式里加强了（每丸 9 → 12.5、每发 140 → 160），这里每一下的伤害保持不变
export const TDM_DMG: Record<WeaponKind, number> = { pistol: 1.4, smg: 2.1, shotgun: 1.0, rifle: 0.75, sniper: 0.8, lmg: 0.85 };
/** 人机开火的最远距离（占射程的比例）：近战枪要贴近再打，不在射程边缘放空枪 */
const FIRE_AT: Partial<Record<WeaponKind, number>> = { smg: 1.05, shotgun: 0.85, pistol: 0.9 };

const NAMES = ['老鹰', '石头', '野狼', '幽灵', '铁锤', '飞鱼', '孤狼', '火狐', '冰刃', '夜枭', '黑熊', '雷霆', '山猫', '影子', '北风', '刺猬', '猎犬', '灰熊', '鹰眼', '疾风'];
/** 人机的枪：按路线分（中路长枪多，两翼近战枪多），带一点随机 */
const LOADOUT: WeaponKind[][] = [
  // 两翼掩体多、距离近：冲锋枪和步枪各半；中路开阔：步枪为主，偶尔狙击 / 机枪
  ['rifle', 'smg', 'rifle'],
  ['rifle', 'rifle', 'sniper', 'lmg'],
  ['rifle', 'smg', 'lmg'],
];

export interface TdmState {
  on: boolean;
  soldiers: Soldier[];
  score: [number, number];
  time: number;
  over: boolean;
  winner: -1 | 0 | 1;
  /** 玩家的战绩和复活倒计时 */
  playerKills: number;
  playerDeaths: number;
  playerRespawn: number;
  playerShield: number;
  /** 击杀信息（右上角滚动） */
  feed: Array<{ killer: string; victim: string; kt: 0 | 1; vt: 0 | 1; weapon: WeaponKind; head: boolean; t: number }>;
}

export const newTdm = (): TdmState => ({ on: false, soldiers: [], score: [0, 0], time: TDM.time, over: false, winner: -1, playerKills: 0, playerDeaths: 0, playerRespawn: 0, playerShield: 0, feed: [] });

const PLAYER = -1;
/** 敌人目标：士兵或玩家 */
interface Tgt {
  id: number;
  team: 0 | 1;
  x: number;
  z: number;
  eye: number;
  alive: boolean;
}

function targets(g: Game): Tgt[] {
  const out: Tgt[] = [];
  const p = g.player;
  out.push({ id: PLAYER, team: 0, x: p.x, z: p.z, eye: p.eye, alive: p.alive && g.tdm.playerShield <= 0 });
  for (const s of g.tdm.soldiers) out.push({ id: s.id, team: s.team, x: s.x, z: s.z, eye: s.crouch ? 1.1 : TDM.headY, alive: s.alive && s.spawnShield <= 0 });
  return out;
}

const newBrain = (g: Game, lane: number): Brain => ({
  skill: 0.65 + g.rng.next() * 0.5,
  target: null,
  reactT: 0,
  aimErrYaw: 0,
  aimErrPitch: 0,
  lastSeenX: 0,
  lastSeenZ: 0,
  lastSeenT: -99,
  mode: 'advance',
  goalX: 0,
  goalZ: 0,
  path: [],
  pathT: 0,
  modeT: 0,
  coverX: 0,
  coverZ: 0,
  strafe: 1,
  strafeT: 0,
  lane,
  thinkT: 0,
});

/** 开一局团队死斗：生成 4 个队友 + 5 个敌人，玩家放到蓝队出生点 */
export function startTdm(g: Game): void {
  const t = g.tdm;
  Object.assign(t, newTdm());
  t.on = true;
  g.zombies.length = 0;
  const names = [...NAMES].sort(() => g.rng.next() - 0.5);
  let n = 0;
  for (const team of [0, 1] as const) {
    const count = team === 0 ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const lane = i % 3;
      const pool = LOADOUT[lane] as WeaponKind[];
      const weapon = pool[g.rng.int(0, pool.length - 1)] as WeaponKind;
      const s: Soldier = {
        id: 1000 + n,
        team,
        name: names[n++ % names.length] as string,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        yaw: 0,
        aimYaw: 0,
        aimPitch: 0,
        hp: TDM.hp,
        maxHp: TDM.hp,
        alive: true,
        respawnT: 0,
        spawnShield: 0,
        weapon,
        mag: statsAt(weapon, 2).mag,
        reloadT: 0,
        fireT: 0,
        burst: 0,
        crouch: false,
        walkPhase: 0,
        kills: 0,
        deaths: 0,
        sinceShot: 9,
        sinceHurt: 9,
        brain: newBrain(g, lane),
      };
      t.soldiers.push(s);
      respawn(g, s);
    }
  }
  respawnPlayer(g);
}

/** 出生点：挑离敌人最远的那个，免得一出生就被打 */
function pickSpawn(g: Game, team: 0 | 1): { x: number; z: number; yaw: number } {
  const pts = arenaSpawns(g.map, team);
  let best = pts[0]!;
  let bestD = -1;
  for (const sp of pts) {
    let d = 99;
    for (const e of targets(g)) if (e.team !== team && e.alive) d = Math.min(d, Math.hypot(e.x - sp.x, e.z - sp.z));
    d += g.rng.next() * 6;
    if (d > bestD) {
      bestD = d;
      best = sp;
    }
  }
  return { x: best.x + (g.rng.next() - 0.5), z: best.z + (g.rng.next() - 0.5), yaw: team === 0 ? Math.PI : 0 };
}

function respawn(g: Game, s: Soldier): void {
  const sp = pickSpawn(g, s.team);
  s.x = sp.x;
  s.z = sp.z;
  s.yaw = s.aimYaw = sp.yaw;
  s.aimPitch = 0;
  s.hp = s.maxHp;
  s.alive = true;
  s.spawnShield = TDM.shield;
  s.mag = statsAt(s.weapon, 2).mag;
  s.reloadT = 0;
  s.burst = 0;
  s.brain.target = null;
  s.brain.mode = 'advance';
  s.brain.path = [];
  s.brain.lastSeenT = -99;
}

function respawnPlayer(g: Game): void {
  const p = g.player;
  const sp = pickSpawn(g, 0);
  p.x = sp.x;
  p.z = sp.z;
  p.yaw = sp.yaw;
  p.hp = p.maxHp;
  p.alive = true;
  p.vx = p.vz = 0;
  g.tdm.playerShield = TDM.shield;
  g.events.emit('tdmRespawn', { yaw: sp.yaw });
}

// ---------------------------------------------------------------- 寻路（格子 BFS，人机少，够用）

const _dist = new Int32Array(GRID_W * GRID_W);
const _queue = new Int32Array(GRID_W * GRID_W);

/** 从 (x0,z0) 到 (x1,z1) 的格子路径（不含起点），走不到返回空 */
function findPath(g: Game, x0: number, z0: number, x1: number, z1: number): number[] {
  const grid = g.grid;
  const start = grid.indexAt(x0, z0);
  const goal = grid.indexAt(x1, z1);
  if (start === goal) return [];
  _dist.fill(-1);
  let head = 0;
  let tail = 0;
  _queue[tail++] = goal;
  _dist[goal] = goal;
  while (head < tail) {
    const u = _queue[head++] as number;
    if (u === start) break;
    const ux = u % GRID_W;
    const uy = (u / GRID_W) | 0;
    for (let k = 0; k < 8; k++) {
      const dx = [1, -1, 0, 0, 1, 1, -1, -1][k] as number;
      const dy = [0, 0, 1, -1, 1, -1, 1, -1][k] as number;
      const nx = ux + dx;
      const ny = uy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const v = ny * GRID_W + nx;
      if (_dist[v] !== -1 || grid.isBlocked(nx, ny)) continue;
      // 斜着走不能切墙角
      if (dx && dy && (grid.isBlocked(ux + dx, uy) || grid.isBlocked(ux, uy + dy))) continue;
      _dist[v] = u;
      _queue[tail++] = v;
    }
  }
  if (_dist[start] === -1) return [];
  const out: number[] = [];
  let c = _dist[start] as number;
  for (let i = 0; i < 400 && c !== goal; i++) {
    out.push(c);
    c = _dist[c] as number;
  }
  out.push(goal);
  return out;
}

const cellWX = (c: number) => (c % GRID_W) - HALF_W + 0.5;
const cellWZ = (c: number) => ((c / GRID_W) | 0) - HALF_H + 0.5;

// ---------------------------------------------------------------- 视线

/** 两点之间有没有遮挡（墙、高过视线的障碍），按眼睛高度连线 */
function canSee(g: Game, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  return !obstruction(g, ax, ay, az, bx - ax, by - ay, bz - az);
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ---------------------------------------------------------------- 每帧

export function updateTdm(g: Game, dt: number): void {
  const t = g.tdm;
  if (!t.on || t.over) return;
  t.time -= dt;
  for (const f of t.feed) f.t += dt;
  while (t.feed.length && (t.feed[0] as { t: number }).t > 6) t.feed.shift();

  // 玩家复活
  t.playerShield = Math.max(0, t.playerShield - dt);
  if (!g.player.alive) {
    t.playerRespawn -= dt;
    if (t.playerRespawn <= 0) respawnPlayer(g);
  }

  const all = targets(g);
  for (const s of t.soldiers) {
    s.sinceShot += dt;
    s.sinceHurt += dt;
    if (!s.alive) {
      s.respawnT -= dt;
      if (s.respawnT <= 0) respawn(g, s);
      continue;
    }
    s.spawnShield = Math.max(0, s.spawnShield - dt);
    think(g, s, all, dt);
    move(g, s, dt);
    shoot(g, s, dt);
  }

  if (t.score[0] >= TDM.score || t.score[1] >= TDM.score || t.time <= 0) {
    t.over = true;
    t.winner = t.score[0] === t.score[1] ? -1 : t.score[0] > t.score[1] ? 0 : 1;
    g.events.emit('tdmOver', { winner: t.winner, score: [...t.score] as [number, number] });
  }
}

/** 选目标、决定意图 */
function think(g: Game, s: Soldier, all: Tgt[], dt: number): void {
  const br = s.brain;
  br.thinkT -= dt;
  br.modeT -= dt;
  const eyeY = s.crouch ? 1.1 : TDM.headY;
  // ---- 找看得见的敌人（每 0.1 秒看一次，像人眼扫视，不是每帧全知）----
  if (br.thinkT <= 0) {
    br.thinkT = 0.1;
    let best: Tgt | null = null;
    let bestScore = 1e9;
    // 拿近战枪的人不和远处的长枪对枪（打不着还送命），除非正在挨打——那就先找掩体
    const close = s.weapon === 'smg' || s.weapon === 'shotgun';
    const reach = close && s.sinceHurt > 1.5 ? statsAt(s.weapon, 2).range * 1.1 : TDM.sight;
    for (const e of all) {
      if (e.team === s.team || !e.alive) continue;
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (d > reach) continue;
      const ang = Math.abs(angDiff(Math.atan2(e.x - s.x, e.z - s.z), s.aimYaw));
      // 视野外的只有很近（4 米内，听得见脚步）才察觉
      if (ang > TDM.fov && d > 4) continue;
      if (!canSee(g, s.x, eyeY, s.z, e.x, e.eye - 0.2, e.z)) continue;
      const score = d + ang * 8 - (e.id === br.target ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      if (br.target !== best.id) {
        // 新目标：反应时间 + 一个大的初始准星误差（越远、技术越差越大；从背后转过来更慢）
        const ang = Math.abs(angDiff(Math.atan2(best.x - s.x, best.z - s.z), s.aimYaw));
        br.reactT = (0.18 + 0.32 * g.rng.next()) / br.skill + ang * 0.25;
        const d = Math.hypot(best.x - s.x, best.z - s.z);
        br.aimErrYaw = (g.rng.next() - 0.5) * (0.12 + d * 0.006) / br.skill;
        br.aimErrPitch = (g.rng.next() - 0.5) * 0.06 / br.skill;
        s.burst = 0;
      }
      br.target = best.id;
      br.lastSeenX = best.x;
      br.lastSeenZ = best.z;
      br.lastSeenT = g.run.time;
    } else if (br.target !== null && g.run.time - br.lastSeenT > 0.6) {
      // 目标躲到掩体后面 0.6 秒以上才算丢了：之前扫一眼看不见就立刻丢，
      // 对方左右晃过一根柱子就要重新反应、重新瞄，近战枪几乎开不了火
      br.target = null;
    }
  }

  const tgt = br.target === null ? null : all.find((e) => e.id === br.target) ?? null;
  const st = statsAt(s.weapon, 2);
  const low = s.hp < s.maxHp * 0.35;
  const reloading = s.reloadT > 0;

  // ---- 意图 ----
  if (tgt) {
    const d = Math.hypot(tgt.x - s.x, tgt.z - s.z);
    // 残血 / 换弹 / 刚被打得很疼：找掩体（不是每次都躲，看性格）
    if ((low || reloading) && br.mode !== 'cover' && br.modeT <= 0 && g.rng.next() < 0.6) {
      const c = findCover(g, s, tgt);
      if (c) {
        br.mode = 'cover';
        br.coverX = c.x;
        br.coverZ = c.z;
        br.modeT = 2.5;
        setGoal(g, s, c.x, c.z);
      }
    } else if (br.mode !== 'cover' || br.modeT <= 0) {
      br.mode = 'fight';
      // 保持自己枪的舒服距离：近战枪不会在远处站着对枪，而是先躲进掩体、绕过去再打；长枪往后退一点
      const want = st.range * 0.55;
      const close = s.weapon === 'smg' || s.weapon === 'shotgun';
      if (close && d > st.range * 0.75 && br.modeT <= 0) {
        // 打不到：正在挨打就先躲到掩体后面，否则躲开对方视线往前摸（掩体之间跳），不正面硬冲
        const c = s.sinceHurt < 1.5 ? (findCover(g, s, tgt) ?? flank(g, s, tgt)) : flank(g, s, tgt);
        br.mode = 'cover';
        br.modeT = 1.6;
        if (c) setGoal(g, s, c.x, c.z);
        else setGoal(g, s, tgt.x, tgt.z);
      } else if (d > want + 6 || !canSee(g, s.x, TDM.headY, s.z, tgt.x, tgt.eye, tgt.z)) setGoal(g, s, tgt.x, tgt.z);
      else if (d < want * 0.4 && !close) setGoal(g, s, s.x - (tgt.x - s.x) * 0.3, s.z - (tgt.z - s.z) * 0.3);
      else br.path = [];
    }
    // 交火时横移，每 0.5–1.2 秒换一次方向；技术好的更爱动
    br.strafeT -= dt;
    if (br.strafeT <= 0) {
      br.strafeT = 0.5 + g.rng.next() * 0.7;
      br.strafe = g.rng.next() < 0.5 ? -1 : 1;
      if (g.rng.next() < 0.25) br.strafe = 0;
      // 用长枪的偶尔蹲下打
      s.crouch = (s.weapon === 'sniper' || s.weapon === 'lmg' || s.weapon === 'rifle') && g.rng.next() < 0.35;
    }
  } else {
    s.crouch = false;
    if (g.run.time - br.lastSeenT < 8 && br.mode !== 'search') {
      // 刚丢了目标：去最后看见的地方搜
      br.mode = 'search';
      br.modeT = 6;
      setGoal(g, s, br.lastSeenX, br.lastSeenZ);
    } else if (br.mode === 'search' && (br.modeT <= 0 || br.path.length === 0)) {
      br.mode = 'advance';
      br.path = [];
    }
    if (br.mode === 'advance' || br.mode === 'cover' || br.mode === 'fight') {
      br.mode = 'advance';
      if (br.path.length === 0 || br.pathT <= 0) advance(g, s);
    }
  }
  br.pathT -= dt;
}

/** 推进：沿自己的路线往对面走，到了对面出生点附近就换一条路线 */
function advance(g: Game, s: Soldier): void {
  const br = s.brain;
  const laneX = [-26, 0, 26][br.lane] as number;
  // 往敌方半场推进，终点在对面出生区前面一点，加一点随机，免得几个人走完全一样的线
  const enemyZ = s.team === 0 ? -24 : 24;
  const myZ = s.team === 0 ? 24 : -24;
  const mid = Math.abs(s.z - myZ) < 10 ? 0 : enemyZ;
  const gx = laneX + (g.rng.next() - 0.5) * 8;
  const gz = mid + (g.rng.next() - 0.5) * 10;
  setGoal(g, s, gx, gz);
  br.pathT = 6 + g.rng.next() * 4;
  if (Math.abs(s.z - enemyZ) < 8) br.lane = g.rng.int(0, 2);
}

function setGoal(g: Game, s: Soldier, x: number, z: number): void {
  const br = s.brain;
  // 目标点在墙里：找附近能站的格子
  let cx = g.grid.cellX(x);
  let cy = g.grid.cellY(z);
  for (let r = 0; r < 6 && g.grid.isBlocked(cx, cy); r++) {
    cx += g.rng.int(-1, 1);
    cy += g.rng.int(-1, 1);
  }
  br.goalX = g.grid.centerX(cx);
  br.goalZ = g.grid.centerZ(cy);
  br.path = findPath(g, s.x, s.z, br.goalX, br.goalZ);
  br.pathT = 1.5;
}

/** 侧翼前进：往目标方向前进 4–9 米、并且对方看不见的点（绕着掩体摸过去） */
function flank(g: Game, s: Soldier, tgt: Tgt): { x: number; z: number } | null {
  const base = Math.atan2(tgt.x - s.x, tgt.z - s.z);
  let best: { x: number; z: number } | null = null;
  let bestD = 1e9;
  for (let i = 0; i < 28; i++) {
    const a = base + (g.rng.next() - 0.5) * 2.2;
    const r = 4 + g.rng.next() * 5;
    const x = s.x + Math.sin(a) * r;
    const z = s.z + Math.cos(a) * r;
    if (g.grid.isBlocked(g.grid.cellX(x), g.grid.cellY(z))) continue;
    if (canSee(g, tgt.x, tgt.eye, tgt.z, x, 1.3, z)) continue;
    const d = Math.hypot(x - tgt.x, z - tgt.z);
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  }
  return best;
}

/** 掩体：附近 8 米内、能挡住目标视线的格子（障碍物背后） */
function findCover(g: Game, s: Soldier, tgt: Tgt): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = 1e9;
  for (let i = 0; i < 24; i++) {
    const a = g.rng.next() * Math.PI * 2;
    const r = 2 + g.rng.next() * 6;
    const x = s.x + Math.sin(a) * r;
    const z = s.z + Math.cos(a) * r;
    if (g.grid.isBlocked(g.grid.cellX(x), g.grid.cellY(z))) continue;
    if (canSee(g, tgt.x, tgt.eye, tgt.z, x, 1.2, z)) continue;
    const d = r + Math.hypot(x - tgt.x, z - tgt.z) * -0.1;
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  }
  return best;
}

function move(g: Game, s: Soldier, dt: number): void {
  const br = s.brain;
  let mx = 0;
  let mz = 0;
  // 沿路径走：到了下一个格子就弹出
  while (br.path.length) {
    const c = br.path[0] as number;
    const wx = cellWX(c);
    const wz = cellWZ(c);
    if (Math.hypot(wx - s.x, wz - s.z) < 0.45) {
      br.path.shift();
      continue;
    }
    mx = wx - s.x;
    mz = wz - s.z;
    break;
  }
  const ml = Math.hypot(mx, mz);
  if (ml > 0) {
    mx /= ml;
    mz /= ml;
  }
  // 交火：在原来的移动上叠加横移
  if (br.mode === 'fight' && br.target !== null && br.strafe !== 0) {
    const sx = Math.cos(s.aimYaw) * br.strafe;
    const sz = -Math.sin(s.aimYaw) * br.strafe;
    mx = mx * 0.5 + sx * 0.8;
    mz = mz * 0.5 + sz * 0.8;
  }
  // 队友之间保持距离
  for (const o of g.tdm.soldiers) {
    if (o === s || !o.alive || o.team !== s.team) continue;
    const dx = s.x - o.x;
    const dz = s.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.6 && d > 1e-3) {
      mx += (dx / d) * (1.6 - d);
      mz += (dz / d) * (1.6 - d);
    }
  }
  const l = Math.hypot(mx, mz);
  // 重的枪走得慢；蹲着、交火时慢
  const wk = s.weapon === 'lmg' ? 0.82 : s.weapon === 'sniper' ? 0.88 : s.weapon === 'smg' || s.weapon === 'shotgun' ? 1.12 : 1;
  const sp = TDM.speed * wk * (s.crouch ? 0.45 : br.mode === 'fight' ? 0.7 : 1);
  const tvx = l > 0 ? (mx / Math.max(1, l)) * sp : 0;
  const tvz = l > 0 ? (mz / Math.max(1, l)) * sp : 0;
  const k = Math.min(1, dt * 10);
  s.vx += (tvx - s.vx) * k;
  s.vz += (tvz - s.vz) * k;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  resolveCircleVsGrid(g.grid, s, TDM.radius);
  s.walkPhase += Math.hypot(s.vx, s.vz) * dt * 2.4;
  // 身体朝向：交火时朝着目标，平时朝走路方向
  const want = br.target !== null ? s.aimYaw : Math.hypot(s.vx, s.vz) > 0.3 ? Math.atan2(s.vx, s.vz) : s.yaw;
  s.yaw += angDiff(want, s.yaw) * Math.min(1, dt * 8);
}

function shoot(g: Game, s: Soldier, dt: number): void {
  const br = s.brain;
  const st = statsAt(s.weapon, 2);
  s.fireT -= dt;
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0) s.mag = st.mag;
    return;
  }
  const all = targets(g);
  const tgt = br.target === null ? null : all.find((e) => e.id === br.target);
  if (!tgt) {
    // 没目标：视线跟着走路方向慢慢转，残弹换掉
    s.aimYaw += angDiff(s.yaw, s.aimYaw) * Math.min(1, dt * 4);
    s.aimPitch *= 0.9;
    if (s.mag < st.mag * 0.5) s.reloadT = st.reload;
    return;
  }
  // 瞄准：真实方向 + 误差，误差随时间收敛（技术越好收得越快）
  const dx = tgt.x - s.x;
  const dz = tgt.z - s.z;
  const d = Math.hypot(dx, dz);
  const eyeY = s.crouch ? 1.1 : TDM.headY;
  // 瞄胸口，技术好的偶尔瞄头
  const aimY = tgt.eye - (br.skill > 0.95 && g.rng.next() < 0.3 ? 0.05 : 0.45);
  const trueYaw = Math.atan2(dx, dz);
  const truePitch = Math.atan2(aimY - eyeY, d);
  // 远处收敛得慢：30 米外要多瞄一会儿才稳
  const conv = Math.exp((-dt * 3.2 * br.skill) / (1 + d / 25));
  br.aimErrYaw *= conv;
  br.aimErrPitch *= conv;
  // 转枪口有速度上限（人的手腕转不了那么快）
  const turn = 7 * br.skill * dt;
  s.aimYaw += clamp(angDiff(trueYaw + br.aimErrYaw, s.aimYaw), -turn, turn);
  // 压枪：连射时后坐力把枪口往上顶，前几发顶得多，之后压住
  const kick = WEAPONS[s.weapon].recoil.v * (Math.PI / 180) * Math.min(4, s.burst) * 0.35 * (1.3 - br.skill * 0.5);
  s.aimPitch += (truePitch + br.aimErrPitch + kick - s.aimPitch) * Math.min(1, dt * 12);

  br.reactT -= dt;
  if (br.reactT > 0 || s.fireT > 0 || s.spawnShield > 0) return;
  // 枪口还没对准就不开（人会等准星到了再打），远处要更准
  const off = Math.abs(angDiff(trueYaw, s.aimYaw));
  if (off > 0.05 + 2.5 / Math.max(4, d)) return;
  if (d > st.range * (FIRE_AT[s.weapon] ?? 1.05)) return;
  // 记着目标但这一刻看不见（在掩体后面）：瞄着那个方向等它出来，不对着墙放空枪
  if (g.run.time - br.lastSeenT > 0.15) return;
  // 长枪点射：打几发停一下；近战枪按住扫
  const tap = s.weapon === 'rifle' || s.weapon === 'lmg' ? 5 : s.weapon === 'smg' ? 10 : 1;
  if (s.burst >= tap && g.rng.next() < 0.5) {
    s.burst = 0;
    s.fireT = 0.25 + g.rng.next() * 0.3;
    return;
  }
  fireSoldier(g, s);
  s.fireT = 1 / st.rate;
  s.burst++;
  s.mag--;
  if (s.mag <= 0) s.reloadT = st.reload * (1.05 + g.rng.next() * 0.2);
}

/** 人机开一枪：和玩家用同一套子弹（有弹道、会被墙挡），子弹记下是谁开的 */
function fireSoldier(g: Game, s: Soldier): void {
  const kind = s.weapon;
  const def = WEAPONS[kind];
  const st = statsAt(kind, 2);
  s.sinceShot = 0;
  const eyeY = s.crouch ? 1.1 : TDM.headY;
  const ox = s.x + Math.sin(s.aimYaw) * 0.5;
  const oz = s.z + Math.cos(s.aimYaw) * 0.5;
  g.events.emit('soldierShot', { id: s.id, kind, x: ox, y: eyeY - 0.1, z: oz, yaw: s.aimYaw });
  // 散布：腰射散布，移动时更大，蹲下更小
  const moving = Math.hypot(s.vx, s.vz) / TDM.speed;
  const tgt = s.brain.target === null ? null : targets(g).find((e) => e.id === s.brain.target);
  const far = tgt ? Math.hypot(tgt.x - s.x, tgt.z - s.z) : 0;
  const shake = (0.006 + far * 0.0005) / s.brain.skill;
  const spread = st.spread * (Math.PI / 180) * (0.7 + 0.5 * moving) * (s.crouch ? 0.7 : 1) + shake;
  const lift = zeroPitch(kind);
  for (let i = 0; i < st.pellets; i++) {
    const yaw = s.aimYaw + (g.rng.next() + g.rng.next() - 1) * spread;
    const pit = s.aimPitch + lift + (g.rng.next() + g.rng.next() - 1) * spread;
    const c = Math.cos(pit);
    g.bullets.push({
      id: g.nextBulletId++,
      kind,
      x: ox,
      y: eyeY - 0.1,
      z: oz,
      vx: Math.sin(yaw) * c * def.muzzle,
      vy: Math.sin(pit) * def.muzzle,
      vz: Math.cos(yaw) * c * def.muzzle,
      damage: st.damage * TDM.botDamage * TDM_DMG[kind],
      pierceLeft: 0,
      traveled: 0,
      range: st.range,
      burn: 0,
      slowHit: 0,
      refund: 0,
      hit: [],
      owner: s.id,
      team: s.team,
    });
  }
  // 枪声：附近的敌人能听见，去声音的方向搜
  for (const o of g.tdm.soldiers) {
    if (o.team === s.team || !o.alive || o.brain.target !== null) continue;
    if (Math.hypot(o.x - s.x, o.z - s.z) > TDM.hear) continue;
    o.brain.lastSeenX = s.x + (g.rng.next() - 0.5) * 4;
    o.brain.lastSeenZ = s.z + (g.rng.next() - 0.5) * 4;
    o.brain.lastSeenT = g.run.time;
    o.brain.mode = 'advance';
  }
}

/** 玩家开枪时也会被听见 */
export function tdmPlayerShot(g: Game): void {
  if (!g.tdm.on) return;
  const p = g.player;
  for (const o of g.tdm.soldiers) {
    if (o.team === 0 || !o.alive || o.brain.target !== null) continue;
    if (Math.hypot(o.x - p.x, o.z - p.z) > TDM.hear) continue;
    o.brain.lastSeenX = p.x + (g.rng.next() - 0.5) * 4;
    o.brain.lastSeenZ = p.z + (g.rng.next() - 0.5) * 4;
    o.brain.lastSeenT = g.run.time;
    o.brain.mode = 'advance';
  }
}

// ---------------------------------------------------------------- 子弹命中士兵 / 玩家

export interface TdmHit {
  t: number;
  head: boolean;
  /** 士兵 id，或 -1 = 玩家 */
  id: number;
}

/** 子弹这一小段打中了哪个士兵（或玩家）：返回最近的一个 */
export function tdmSegHit(g: Game, team: 0 | 1 | -1, owner: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, stopT: number): TdmHit | null {
  let best: TdmHit | null = null;
  const test = (id: number, x: number, z: number, h: number) => {
    const hy = h - 0.13;
    const th = segSphere(ax, ay, az, dx, dy, dz, x, hy, z, TDM.headR);
    const tb = segCylinder(ax, ay, az, dx, dy, dz, x, z, TDM.radius, h - 0.2);
    let t = -1;
    let head = false;
    if (th >= 0 && (tb < 0 || th <= tb + 0.02)) {
      t = th;
      head = true;
    } else if (tb >= 0) t = tb;
    if (t >= 0 && t <= stopT && (!best || t < best.t)) best = { t, head, id };
  };
  for (const s of g.tdm.soldiers) {
    if (!s.alive || s.id === owner || s.team === team) continue;
    test(s.id, s.x, s.z, s.crouch ? 1.25 : TDM.height);
  }
  const p = g.player;
  if (p.alive && owner !== PLAYER && team !== 0) test(PLAYER, p.x, p.z, p.eye + 0.13);
  return best;
}

/** 结算一次命中：扣血、击杀、计分、击杀信息 */
export function tdmDamage(g: Game, hit: TdmHit, kind: WeaponKind, damage: number, traveled: number, range: number, owner: number): void {
  const t = g.tdm;
  // 玩家的子弹伤害还没乘过团队死斗的武器倍率（人机的子弹出膛时已经乘了）
  let dmg = damage * falloffAt(kind, traveled, range) * (owner === PLAYER ? TDM_DMG[kind] : 1);
  if (hit.head) dmg *= WEAPONS[kind].headMult;
  const killerName = owner === PLAYER ? '你' : (t.soldiers.find((s) => s.id === owner)?.name ?? '?');
  const killerTeam: 0 | 1 = owner === PLAYER ? 0 : (t.soldiers.find((s) => s.id === owner)?.team ?? 1);
  const credit = () => {
    t.score[killerTeam]++;
    if (owner === PLAYER) t.playerKills++;
    else {
      const k = t.soldiers.find((s) => s.id === owner);
      if (k) k.kills++;
    }
  };
  if (hit.id === PLAYER) {
    if (t.playerShield > 0) return;
    const p = g.player;
    g.damagePlayer(dmg);
    g.events.emit('tdmHurt', { fromId: owner });
    if (!p.alive) {
      t.playerDeaths++;
      t.playerRespawn = TDM.respawn;
      credit();
      t.feed.push({ killer: killerName, victim: '你', kt: killerTeam, vt: 0, weapon: kind, head: hit.head, t: 0 });
    }
    return;
  }
  const s = t.soldiers.find((x) => x.id === hit.id);
  if (!s || !s.alive || s.spawnShield > 0) return;
  s.hp -= dmg;
  s.sinceHurt = 0;
  // 被打了：转头找打自己的人（有反应时间）
  if (s.brain.target === null) {
    const src = owner === PLAYER ? g.player : t.soldiers.find((x) => x.id === owner);
    if (src) {
      s.brain.lastSeenX = src.x;
      s.brain.lastSeenZ = src.z;
      s.brain.lastSeenT = g.run.time;
    }
  }
  g.events.emit('soldierHit', { id: s.id, amount: dmg, head: hit.head, byPlayer: owner === PLAYER, x: s.x, y: hit.head ? TDM.headY : 1.1, z: s.z });
  if (s.hp <= 0) {
    s.alive = false;
    s.deaths++;
    s.respawnT = TDM.respawn + g.rng.next();
    credit();
    t.feed.push({ killer: killerName, victim: s.name, kt: killerTeam, vt: s.team, weapon: kind, head: hit.head, t: 0 });
    g.events.emit('soldierDied', { id: s.id, team: s.team, byPlayer: owner === PLAYER, head: hit.head });
  }
}

/** 子弹重力和 BULLET_GRAVITY 一致（这里只是为了导入不报未用） */
void BULLET_GRAVITY;
