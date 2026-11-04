import { BUILD_RANGE, REPAIR_HP_PER_SCRAP, REPAIR_RANGE, SELL_REFUND, SPIKES, STRUCTURES, TURRETS, costOf, isTurret, type TurretKind } from '../data/structures';
import type { Structure } from '../entities/structure';
import { angleDiff } from '../core/math';
import { HALF_H, HALF_W } from '../world/grid';
import type { Game } from '../sim';

export type BuildReason = 'ok' | 'range' | 'scrap' | 'zone' | 'occupied' | 'blocked' | 'locked' | 'cap';

export interface BuildCursor {
  cx: number;
  cy: number;
  valid: boolean;
  reason: BuildReason;
}

const REASON_TEXT: Record<BuildReason, string> = {
  ok: '',
  range: '太远了',
  scrap: '零件不够',
  zone: '这里不能建造（只能建在内院和入口附近）',
  occupied: '这格已经有东西了',
  blocked: '有人站在这里',
  locked: '还没解锁（大厅 · 工程部）',
  cap: '炮塔数量已达上限',
};

export const reasonText = (r: BuildReason): string => REASON_TEXT[r];

/** 判断在 (cx,cy) 能不能建 kind。不会改动任何状态 */
export function checkPlace(g: Game, cx: number, cy: number): BuildReason {
  const def = STRUCTURES[g.buildKind];
  const { grid, player } = g;
  if (!g.config.structures.includes(g.buildKind)) return 'locked';
  if (isTurret(g.buildKind) && g.turretCount() >= g.config.turretCap) return 'cap';
  if (!grid.inBounds(cx, cy)) return 'zone';
  const i = grid.idx(cx, cy);
  const wx = cx - HALF_W + 0.5;
  const wz = cy - HALF_H + 0.5;
  if (Math.hypot(wx - player.x, wz - player.z) > BUILD_RANGE) return 'range';
  if (!grid.buildable[i]) return grid.solid[i] ? 'occupied' : 'zone';
  if (grid.solid[i] || grid.structure[i] >= 0 || grid.trap[i] >= 0) return 'occupied';
  if (def.blocks) {
    const x0 = cx - HALF_W;
    const z0 = cy - HALF_H;
    const hits = (px: number, pz: number, r: number) => {
      const qx = Math.min(Math.max(px, x0), x0 + 1);
      const qz = Math.min(Math.max(pz, z0), z0 + 1);
      return Math.hypot(px - qx, pz - qz) < r;
    };
    if (player.alive && hits(player.x, player.z, player.radius)) return 'blocked';
    for (const z of g.zombies) if (z.alive && hits(z.x, z.z, z.radius)) return 'blocked';
  }
  if (g.scrap < costOf(def.kind, g.config.extras)) return 'scrap';
  return 'ok';
}

/** 放置当前选中的建筑 */
export function tryPlace(g: Game, cx: number, cy: number): boolean {
  if (checkPlace(g, cx, cy) !== 'ok') return false;
  const def = STRUCTURES[g.buildKind];
  const s = g.addStructure(g.buildKind, cx, cy);
  if (!s) return false;
  const cost = costOf(def.kind, g.config.extras);
  g.scrap -= cost;
  return true;
}

export function sellStructure(g: Game, id: number): boolean {
  const s = g.structures.get(id);
  if (!s) return false;
  const refund = Math.floor(costOf(s.kind, g.config.extras) * SELL_REFUND);
  g.scrap += refund;
  g.removeStructure(id, false);
  g.events.emit('scrap', { x: s.cx - HALF_W + 0.5, z: s.cy - HALF_H + 0.5, amount: refund });
  return true;
}

function nearestStructure(g: Game, x: number, z: number, range: number): Structure | null {
  let best: Structure | null = null;
  let bd = range;
  for (const s of g.structures.values()) {
    const d = Math.hypot(s.cx - HALF_W + 0.5 - x, s.cy - HALF_H + 0.5 - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 修理离玩家最近的建筑；靠近发电机时修发电机。返回花掉的零件 */
export function repairNearby(g: Game): number {
  const p = g.player;
  const core = g.core;
  const dCore = Math.hypot(core.x - p.x, core.z - p.z);
  const s = nearestStructure(g, p.x, p.z, REPAIR_RANGE);
  const dS = s ? Math.hypot(s.cx - HALF_W + 0.5 - p.x, s.cy - HALF_H + 0.5 - p.z) : Infinity;

  if (dCore < REPAIR_RANGE + 1.2 && dCore <= dS) {
    const missing = core.maxHp - core.hp;
    if (missing <= 0.5) return 0;
    const spend = Math.min(g.scrap, Math.ceil(missing / REPAIR_HP_PER_SCRAP), 20);
    if (spend <= 0) return 0;
    core.hp = Math.min(core.maxHp, core.hp + spend * REPAIR_HP_PER_SCRAP);
    g.scrap -= spend;
    g.events.emit('repaired', { x: core.x, z: core.z, core: true });
    return spend;
  }
  if (!s) return 0;
  const missing = s.maxHp - s.hp;
  if (missing <= 0.5) return 0;
  const spend = Math.min(g.scrap, Math.ceil(missing / REPAIR_HP_PER_SCRAP));
  if (spend <= 0) return 0;
  s.hp = Math.min(s.maxHp, s.hp + spend * REPAIR_HP_PER_SCRAP);
  g.scrap -= spend;
  g.events.emit('repaired', { x: s.cx - HALF_W + 0.5, z: s.cy - HALF_H + 0.5, core: false });
  return spend;
}

/** 建造模式下的光标、放置和拆除 */
export function updateBuildMode(g: Game, dt: number): void {
  const inp = g.input;
  if (inp.toggleBuild) {
    g.buildMode = !g.buildMode;
    inp.toggleBuild = false;
    g.events.emit('buildMode', { on: g.buildMode });
  }
  if (inp.use) {
    inp.use = false;
    if (g.player.alive) repairNearby(g);
  }
  g.placeCd = Math.max(0, g.placeCd - dt);
  if (!g.buildMode) return;

  const cx = Math.floor(inp.aimX + HALF_W);
  const cy = Math.floor(inp.aimZ + HALF_H);
  const reason = checkPlace(g, cx, cy);
  g.buildCursor = { cx, cy, valid: reason === 'ok', reason };

  if (inp.select > 0) {
    const k = g.config.structures[inp.select - 1];
    if (k) g.buildKind = k;
    inp.select = 0;
  }
  if (inp.cycle !== 0) {
    const list = g.config.structures;
    const i = list.indexOf(g.buildKind);
    const k = list[(i + inp.cycle + list.length) % list.length];
    if (k) g.buildKind = k;
    inp.cycle = 0;
  }
  if (g.placeCd > 0) return;
  if (inp.fire) {
    if (tryPlace(g, cx, cy)) g.placeCd = 0.1;
    else g.placeCd = 0.06;
  } else if (inp.sell) {
    const id = g.grid.structure[g.grid.idx(cx, cy)] ?? -1;
    const tid = id >= 0 ? id : (g.grid.trap[g.grid.idx(cx, cy)] ?? -1);
    if (tid >= 0 && sellStructure(g, tid)) g.placeCd = 0.15;
  }
}

// ---------------------------------------------------------------- 炮塔与地刺

function updateTurret(g: Game, s: Structure, kind: TurretKind, dt: number): void {
  const t = TURRETS[kind];
  s.sinceShot += dt;
  s.cd -= dt;
  const sx = s.cx - HALF_W + 0.5;
  const sz = s.cy - HALF_H + 0.5;
  const range = t.range;
  // 迫击炮是曲射，不需要视线
  const indirect = kind === 'mortar';

  // 炮塔自己占着的格子本身就是"阻挡"，视线要从格子边缘开始查，否则永远看不到任何东西
  const sees = (tx: number, tz: number): boolean => {
    if (indirect) return true;
    const dx = tx - sx;
    const dz = tz - sz;
    const len = Math.hypot(dx, dz);
    if (len < 0.7) return true;
    return g.grid.segmentClear(sx + (dx / len) * 0.75, sz + (dz / len) * 0.75, tx, tz, false);
  };
  const inRange = (d: number, slack: number) => d <= range + slack && d >= t.minRange - slack;

  // 目标：射程内、看得见的僵尸里，离发电机最近的那个
  let target = g.zombies.find((z) => z.id === s.target && z.alive) ?? null;
  if (target && (!inRange(Math.hypot(target.x - sx, target.z - sz), 0.5) || !sees(target.x, target.z))) target = null;
  if (!target) {
    let bestD = Infinity;
    for (const z of g.zombies) {
      if (!z.alive) continue;
      if (!inRange(Math.hypot(z.x - sx, z.z - sz), 0)) continue;
      if (!sees(z.x, z.z)) continue;
      const d = Math.hypot(z.x - g.core.x, z.z - g.core.z);
      if (d < bestD) {
        bestD = d;
        target = z;
      }
    }
  }
  s.target = target ? target.id : -1;
  if (!target) return;

  const want = Math.atan2(target.x - sx, target.z - sz);
  const diff = angleDiff(s.aim, want);
  const step = t.turn * dt;
  s.aim += Math.abs(diff) < step ? diff : Math.sign(diff) * step;

  if (s.cd <= 0 && Math.abs(angleDiff(s.aim, want)) < (kind === 'flamer' ? t.cone : 0.18)) {
    s.cd += 1 / (t.rate * g.mods.turretRate * (g.run.phase === 'night' && g.run.mod === 'blackout' ? 0.6 : 1));
    s.sinceShot = 0;
    const dx = target.x - sx;
    const dz = target.z - sz;
    const len = Math.hypot(dx, dz) || 1;
    const dmg = t.damage * g.mods.turret;
    g.events.emit('turretShot', { id: s.id, x0: sx + (dx / len) * 0.55, z0: sz + (dz / len) * 0.55, x1: target.x, z1: target.z });
    if (kind === 'flamer') {
      // 扇形内所有看得见的僵尸都挨烧
      for (const z of g.zombies) {
        if (!z.alive) continue;
        const d = Math.hypot(z.x - sx, z.z - sz);
        if (d > range + z.radius) continue;
        if (Math.abs(angleDiff(s.aim, Math.atan2(z.x - sx, z.z - sz))) > t.cone || !sees(z.x, z.z)) continue;
        g.damageZombie(z, dmg, { burn: t.burn * g.mods.turret, silent: true });
      }
    } else if (kind === 'mortar') {
      // 炮弹固定飞 1.6 秒，落点是开火时目标所在的位置
      const T = 1.6;
      // 从炮塔自己格子的阻挡高度（1.4 米）之上发射，否则一出膛就撞上自己
      const y0 = 1.6;
      g.projectiles.push({ x: sx, y: y0, z: sz, vx: dx / T, vy: (-y0 + 0.5 * 9.8 * T * T) / T, vz: dz / T, life: T + 0.3, damage: dmg, aoe: t.aoe, split: 0, bomblet: false });
    } else {
      g.damageZombie(target, dmg, { kx: (dx / len) * 0.4, kz: (dz / len) * 0.4 });
    }
  }
  if (s.cd < -0.1) s.cd = -0.1;
}

function updateSpikes(g: Game, s: Structure, dt: number): void {
  s.cd -= dt;
  if (s.cd > 0) return;
  const x0 = s.cx - HALF_W;
  const z0 = s.cy - HALF_H;
  let hit = false;
  for (const z of g.zombies) {
    if (!z.alive) continue;
    const qx = Math.min(Math.max(z.x, x0), x0 + 1);
    const qz = Math.min(Math.max(z.z, z0), z0 + 1);
    // 脚踩在这一格里才算（用圆心 + 半径的一部分判断）
    if (Math.hypot(z.x - qx, z.z - qz) > Math.min(0.2, z.radius * 0.5)) continue;
    g.damageZombie(z, SPIKES.damage * g.mods.turret, {});
    hit = true;
    s.hp -= 1;
    if (s.hp <= 0) break;
  }
  if (hit) {
    s.cd = SPIKES.interval;
    s.sinceShot = 0;
    g.events.emit('spikesHit', { id: s.id });
    if (s.hp <= 0) g.removeStructure(s.id, true);
  } else {
    s.cd = 0.1;
  }
}

export function updateStructures(g: Game, dt: number): void {
  // 先拷贝：地刺耐久耗尽会在遍历中删除自己
  for (const s of [...g.structures.values()]) {
    if (!g.structures.has(s.id)) continue;
    if (isTurret(s.kind)) updateTurret(g, s, s.kind, dt);
    else if (s.kind === 'spikes') updateSpikes(g, s, dt);
  }
}
