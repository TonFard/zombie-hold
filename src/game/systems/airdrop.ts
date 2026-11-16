import type { Game } from '../sim';
import { GUN_BY_ID, type GunDef } from '../data/guns';
import { HALF_H, HALF_W } from '../world/grid';
import { switchWeapon } from './player';

/**
 * 空投：白天开始后若干秒，地图外圈随机一处落下补给，周围有守卫；限时抢夺。
 * reach = 补给拿走以后，离箱子多近能按 E 把里面的试用枪换上
 */
export const AIRDROP = { delay: 8, time: 35, guards: 3, pick: 1.4, scrap: 90, grenades: 2, reach: 2.6 };

export interface AirdropState {
  /**
   * 0 = 没有，1 = 等待落下（倒计时），2 = 已落地可拾取，
   * 3 = 零件和手雷已经拿走，箱子里还有一把试用枪：要不要由玩家定（走近按 E 换上，不要就不管它），留到入夜
   */
  stage: number;
  t: number;
  x: number;
  z: number;
  /** stage 3：箱子里那把试用枪的型号（别的阶段是空串） */
  offer: string;
}

export const newAirdrop = (): AirdropState => ({ stage: 0, t: 0, x: 0, z: 0, offer: '' });

/** 白天开始时调用：从第 2 天起，安排一次空投 */
export function planAirdrop(g: Game): void {
  const a = g.airdrop;
  a.stage = 0;
  a.offer = '';
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
    // 入夜还没捡：补给作废；没要的试用枪也一起收走
    if (a.stage >= 2) g.events.emit('airdrop', { stage: 'gone', x: a.x, z: a.z });
    a.stage = 0;
    a.offer = '';
    return;
  }
  // 箱子里剩一把试用枪：不倒计时，等玩家按 E（takeAirdropGun）或者入夜
  if (a.stage === 3) return;
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
    const scrap = Math.round(AIRDROP.scrap * g.mods.scrap);
    g.scrap += scrap;
    g.scrapEarned += scrap;
    g.hz.frags += AIRDROP.grenades;
    g.hz.fires += 1;
    g.events.emit('scrap', { x: a.x, z: a.z, amount: scrap });
    // 试用枪不再直接塞到手里：留在箱子里，换不换玩家自己定
    const trial = pickTrial(g);
    a.stage = trial ? 3 : 0;
    a.offer = trial ? trial.id : '';
    g.events.emit('airdrop', { stage: trial ? 'open' : 'taken', x: a.x, z: a.z });
    g.events.emit('banner', { text: '拿到空投', sub: `+${scrap} 零件 · 手雷 +${AIRDROP.grenades} · 燃烧弹 +1${trial ? ` · 箱里还有一把试用枪「${trial.name}」，按 E 换上，不要就不用管` : ''}` });
    return;
  }
  if (a.t <= 0) {
    a.stage = 0;
    g.events.emit('airdrop', { stage: 'gone', x: a.x, z: a.z });
  }
}

/**
 * 空投的武器箱里放哪一把：从还没解锁的型号里抽（只抽玩家这一局已经有的枪类）。只是挑出来，不换。没有可试用的返回 null
 */
function pickTrial(g: Game): GunDef | null {
  if (!g.config.extras) return null;
  const pool = g.config.trialGuns.map((id) => GUN_BY_ID[id]).filter((d): d is GunDef => !!d && g.loadout[d.cls].owned && g.config.guns[d.cls] !== d.id);
  if (!pool.length) return null;
  // 优先拿在手上的那一类：换上就能立刻试
  const inHand = pool.filter((d) => d.cls === g.player.weapon);
  const list = inHand.length && g.rng.next() < 0.6 ? inHand : pool;
  return list[g.rng.int(0, list.length - 1)] as GunDef;
}

/** 玩家是不是站在开着的空投箱旁边（HUD 这时显示「按 E 换上」和新旧两把枪的对比） */
export const nearAirdropGun = (g: Game): boolean => g.airdrop.stage === 3 && g.player.alive && Math.hypot(g.player.x - g.airdrop.x, g.player.z - g.airdrop.z) <= AIRDROP.reach;

/**
 * 按 E：把空投箱里的试用枪换上——这一局里那一类就换成它（等级、强化照旧），弹匣按新型号装满，带在身上的话直接拿到手里。
 * 不在箱子旁边 / 箱子里没有枪返回 false（E 接着去修东西）
 */
export function takeAirdropGun(g: Game): boolean {
  const a = g.airdrop;
  if (!nearAirdropGun(g)) return false;
  const pick = GUN_BY_ID[a.offer];
  a.stage = 0;
  a.offer = '';
  g.events.emit('airdrop', { stage: 'taken', x: a.x, z: a.z });
  if (!pick || !g.loadout[pick.cls].owned) return true;
  g.config.guns[pick.cls] = pick.id;
  g.config.trialGuns = g.config.trialGuns.filter((id) => id !== pick.id);
  const slot = g.loadout[pick.cls];
  const max = g.statsOf(pick.cls).mag;
  slot.mag = Math.min(max, slot.mag + g.takeAmmo(pick.cls, Math.max(0, max - slot.mag)));
  g.events.emit('trialGun', { kind: pick.cls, id: pick.id });
  if (g.player.weapon === pick.cls) {
    // 手里就是这一类：模型和数值当场换掉，按重新举枪算（打断换弹、要重新举镜）
    g.player.reloadTimer = 0;
    g.player.ads = 0;
    g.player.fireTimer = Math.max(g.player.fireTimer, 0.25 * g.weightNow().handling);
    g.events.emit('weaponSwitch', { kind: pick.cls });
  } else switchWeapon(g, pick.cls);
  g.events.emit('banner', { text: '换上试用枪', sub: `${pick.name} · 这一局都用它，下一局换回原来的型号` });
  return true;
}
