import type { Game } from '../sim';
import { HALF_H, HALF_W } from '../world/grid';

/** 空投：白天开始后若干秒，地图外圈随机一处落下补给，周围有守卫；限时抢夺 */
export const AIRDROP = { delay: 8, time: 35, guards: 3, pick: 1.4, scrap: 90, grenades: 2 };

export interface AirdropState {
  /** 0 = 没有，1 = 等待落下（倒计时），2 = 已落地可拾取 */
  stage: number;
  t: number;
  x: number;
  z: number;
}

export const newAirdrop = (): AirdropState => ({ stage: 0, t: 0, x: 0, z: 0 });

/** 白天开始时调用：从第 2 天起，安排一次空投 */
export function planAirdrop(g: Game): void {
  const a = g.airdrop;
  a.stage = 0;
  if (g.run.night < 2) return;
  // 在可走、不可建造（据点外）的格子里挑一个离发电机 18–32 米的位置
  for (let i = 0; i < 60; i++) {
    const cx = g.rng.int(4, 75);
    const cy = g.rng.int(4, 75);
    const idx = g.grid.idx(cx, cy);
    if (g.grid.solid[idx] || g.grid.buildable[idx]) continue;
    const x = cx - HALF_W + 0.5;
    const z = cy - HALF_H + 0.5;
    const d = Math.hypot(x - g.core.x, z - g.core.z);
    if (d < 18 || d > 32) continue;
    a.stage = 1;
    a.t = AIRDROP.delay;
    a.x = x;
    a.z = z;
    return;
  }
}

export function updateAirdrop(g: Game, dt: number): void {
  const a = g.airdrop;
  if (a.stage === 0) return;
  if (g.run.phase !== 'day') {
    // 入夜还没捡：补给作废
    if (a.stage === 2) g.events.emit('airdrop', { stage: 'gone', x: a.x, z: a.z });
    a.stage = 0;
    return;
  }
  a.t -= dt;
  if (a.stage === 1) {
    if (a.t > 0) return;
    a.stage = 2;
    a.t = AIRDROP.time;
    g.events.emit('airdrop', { stage: 'land', x: a.x, z: a.z });
    g.events.emit('banner', { text: '空投', sub: `补给落在据点外，${AIRDROP.time} 秒内去抢（有守卫）` });
    for (let i = 0; i < AIRDROP.guards; i++) {
      const ang = (i / AIRDROP.guards) * Math.PI * 2;
      const kind = i === 0 && g.run.night >= 4 ? 'breaker' : i === 1 && g.run.night >= 3 ? 'spitter' : 'walker';
      const z = g.spawnZombie(kind, a.x + Math.cos(ang) * 2.2, a.z + Math.sin(ang) * 2.2);
      if (z) z.goal = 'player';
    }
    return;
  }
  const p = g.player;
  if (p.alive && Math.hypot(p.x - a.x, p.z - a.z) < AIRDROP.pick) {
    a.stage = 0;
    const scrap = Math.round(AIRDROP.scrap * g.mods.scrap);
    g.scrap += scrap;
    g.scrapEarned += scrap;
    g.hz.frags += AIRDROP.grenades;
    g.hz.fires += 1;
    g.events.emit('scrap', { x: a.x, z: a.z, amount: scrap });
    g.events.emit('airdrop', { stage: 'taken', x: a.x, z: a.z });
    g.events.emit('banner', { text: '拿到空投', sub: `+${scrap} 零件 · 手雷 +${AIRDROP.grenades} · 燃烧弹 +1` });
    return;
  }
  if (a.t <= 0) {
    a.stage = 0;
    g.events.emit('airdrop', { stage: 'gone', x: a.x, z: a.z });
  }
}
