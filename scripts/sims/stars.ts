// 升星特性：npm run sim:stars
// 每颗星一个断言：同一个场景，有星 / 没星各跑一次，比较效果是否和 STAR_FX 写的一样。
import { STAR_FX, STAR_MAX, starXp, starsOf } from '../../src/game/data/stars';
import { MASTERY_MAX, MASTERY_XP } from '../../src/game/data/mastery';
import { WEAPON_ORDER, WEAPONS, statsAt, type WeaponKind } from '../../src/game/data/weapons';
import { Game, STEP } from '../../src/game/sim';
import type { Zombie } from '../../src/game/entities/zombie';
import { configFor } from '../../src/game/meta/loadout';
import { baseBonuses } from '../../src/game/data/meta-catalog';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const PX = -8;
const PZ = 6;

/** 一局：拿着 kind（tier 级），这把枪 n 颗星；僵尸不动、玩家不死 */
function game(kind: WeaponKind, n: number, tier = 0): Game {
  const g = new Game(5);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  g.aggroScale = 0;
  g.player.x = PX;
  g.player.z = PZ;
  g.config.stars[kind] = n;
  const slot = g.loadout[kind];
  slot.owned = true;
  slot.carried = true;
  slot.tier = tier;
  slot.mag = statsAt(kind, tier).mag;
  g.player.weapon = kind;
  g.player.tier = tier;
  return g;
}
const pin = (z: Zombie, x: number, zz: number) => {
  z.x = x;
  z.z = zz;
  z.vx = z.vz = 0;
  z.kbx = z.kbz = 0;
};
/** 对着 dx 米外一只不动的巨像打 seconds 秒，返回打出的伤害；pitch 默认打胸口 */
function shoot(g: Game, dx: number, seconds: number, pitch = -0.1, setup?: (z: Zombie) => void): { dmg: number; z: Zombie } {
  const z = g.spawnZombie('colossus', PX + dx, PZ, 1e6) as Zombie;
  setup?.(z);
  let dmg = 0;
  g.events.on('zombieHit', (e) => {
    if (e.zombie === z) dmg += e.amount;
  });
  g.input.aimX = PX + 20;
  g.input.aimZ = PZ;
  g.input.aimPitch = pitch;
  g.input.fire = true;
  for (let t = 0; t < Math.round(seconds / STEP); t++) {
    g.update(STEP);
    pin(z, PX + dx, PZ);
  }
  return { dmg, z };
}
const ratio = (a: number, b: number) => a / Math.max(1e-9, b);
const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log('\n== 星级门槛 ==');
{
  const ok = WEAPON_ORDER.every((k) => {
    const m = MASTERY_XP[k][MASTERY_MAX - 1] as number;
    return starsOf(k, m) === 0 && starsOf(k, starXp(k, 1)) === 1 && starsOf(k, starXp(k, STAR_MAX)) === 3 && starXp(k, 1) > m && starXp(k, 2) > starXp(k, 1);
  });
  check(ok, `精通时 0 星，之后递增到 3 星（手枪：${[1, 2, 3].map((n) => starXp('pistol', n)).join(' / ')} 经验）`);
  const c = configFor(baseBonuses(), 'normal', 'outpost', {}, { pistol: starXp('pistol', 2), rifle: 10 });
  check(c.stars.pistol === 2 && c.stars.rifle === 0, '出征时按熟练度经验算出星级，冻结进 config.stars');
}

console.log('\n== 手枪 ==');
{
  const reloadOf = (n: number) => {
    const g = game('pistol', n);
    g.loadout.pistol.mag = 0;
    g.update(STEP);
    return g.player.reloadTotal;
  };
  check(near(ratio(reloadOf(2), reloadOf(0)), STAR_FX.pistolReload), `★2 换弹 ×${ratio(reloadOf(2), reloadOf(0)).toFixed(2)}（应 ×${STAR_FX.pistolReload}）`);
  const gd = (n: number) => {
    const g = game('pistol', n);
    g.config.dual = true;
    g.loadout.pistol.mag = 0;
    g.update(STEP);
    return g.player.reloadTotal;
  };
  check(near(ratio(gd(3), gd(2)), STAR_FX.pistolDualReload), `★3 双持换弹再 ×${ratio(gd(3), gd(2)).toFixed(2)}`);
  // ★1：爆头击杀返弹。头部伤害够秒杀行尸
  const refundOf = (n: number) => {
    const g = game('pistol', n);
    const z = g.spawnZombie('walker', PX + 3, PZ, 0.01) as Zombie;
    g.loadout.pistol.mag = 5;
    let refunded = 0;
    g.events.on('refund', (e) => (refunded += e.amount));
    g.input.aimX = PX + 20;
    g.input.aimZ = PZ;
    g.input.aimPitch = Math.atan2(z.def.head.y - g.player.eye, 3);
    g.input.fire = true;
    for (let t = 0; t < 30 && z.alive; t++) {
      g.update(STEP);
      pin(z, PX + 3, PZ);
    }
    return refunded;
  };
  check(refundOf(1) === refundOf(0) + STAR_FX.pistolRefund, `★1 爆头击杀返弹 ${refundOf(0)} → ${refundOf(1)}`);
}

console.log('\n== 冲锋枪 ==');
{
  const g = game('smg', 1);
  g.loadout.smg.mag = 0;
  for (let t = 0; t < 200 && g.player.burstT <= 0; t++) g.update(STEP);
  check(near(g.player.burstT, STAR_FX.smgBurst.time, 0.05), `★1 换完弹进入 ${STAR_FX.smgBurst.time} 秒射速加成（剩 ${g.player.burstT.toFixed(2)} 秒）`);
  const g0 = game('smg', 0);
  g0.loadout.smg.mag = 0;
  for (let t = 0; t < 200; t++) g0.update(STEP);
  check(g0.player.burstT === 0, '没有星：换弹后没有加成');
  // 加成期间的射速：数一秒内打出几发
  const shots = (n: number) => {
    const x = game('smg', n);
    x.player.burstT = n ? 99 : 0;
    let c = 0;
    x.events.on('shot', () => c++);
    shoot(x, 6, 1.5);
    return c;
  };
  check(ratio(shots(1), shots(0)) > 1.08, `★1 加成期间 1.5 秒打出 ${shots(0)} → ${shots(1)} 发`);
  // ★3：连杀 ≥ 5 时伤害 +10%
  const comboDmg = (n: number) => {
    const x = game('smg', n);
    x.combo = 6;
    x.comboT = 99;
    return shoot(x, 3, 0.5).dmg;
  };
  check(near(ratio(comboDmg(3), comboDmg(2)), STAR_FX.smgCombo.damage), `★3 连杀时伤害 ×${ratio(comboDmg(3), comboDmg(2)).toFixed(3)}`);
}

console.log('\n== 霰弹枪 ==');
{
  const d = (n: number, dx: number) => shoot(game('shotgun', n), dx, 1).dmg;
  check(near(ratio(d(1, 2.2), d(0, 2.2)), STAR_FX.shotgunClose, 0.05), `★1 3 米内伤害 ×${ratio(d(1, 2.2), d(0, 2.2)).toFixed(3)}（应 ×${STAR_FX.shotgunClose}）`);
  check(near(ratio(d(1, 7), d(0, 7)), 1, 0.05), `★1 7 米外不变（×${ratio(d(1, 7), d(0, 7)).toFixed(3)}）`);
  // ★3：击杀让 2 米内的僵尸硬直
  const stunOf = (n: number) => {
    const g = game('shotgun', n);
    const a = g.spawnZombie('walker', PX + 3, PZ, 0.01) as Zombie;
    const b = g.spawnZombie('walker', PX + 4, PZ + 1, 50) as Zombie;
    g.input.aimX = PX + 20;
    g.input.aimZ = PZ;
    g.input.aimPitch = -0.1;
    g.input.fire = true;
    for (let t = 0; t < 30 && a.alive; t++) {
      g.update(STEP);
      pin(a, PX + 3, PZ);
      pin(b, PX + 4, PZ + 1.4);
    }
    return b.stunT;
  };
  check(stunOf(3) > 0.3 && stunOf(0) === 0, `★3 击杀后旁边的僵尸硬直 ${stunOf(3).toFixed(2)} 秒（没星 ${stunOf(0)}）`);
}

console.log('\n== 突击步枪 ==');
{
  // ★3：连续命中同一目标逐发 +3%，满 10 层
  const focus = (n: number) => shoot(game('rifle', n), 6, 3).dmg;
  const r = ratio(focus(3), focus(2));
  check(r > 1.15 && r < 1 + STAR_FX.rifleFocus.max + 0.01, `★3 3 秒连射同一目标伤害 ×${r.toFixed(3)}（逐发 +3%，上限 +30%）`);
  // ★1：爆头加成 ×1.2
  const head = (n: number) => {
    // 靶子是巨像：头在 3.45 米高（不是行尸的头），按它的头和头前伸量瞄
    // 只统计打中头的那几发（散布会让一部分打到身上，混进去会把比值稀释）
    const g = game('rifle', n);
    let heads = 0;
    let headDmg = 0;
    g.events.on('zombieHit', (e) => {
      if (e.head) {
        heads++;
        headDmg += e.amount;
      }
    });
    const dx = 6;
    shoot(g, dx, 0.3, Math.atan2(3.45 - g.player.eye, dx - 0.95 + 0.2));
    return heads > 0 ? headDmg / heads : 0;
  };
  const hr = ratio(head(1), head(0));
  const expect = (1 + (WEAPONS.rifle.headMult - 1) * STAR_FX.rifleHead * 0.6) / (1 + (WEAPONS.rifle.headMult - 1) * 0.6);
  check(near(hr, expect, 0.01), `★1 打头伤害 ×${hr.toFixed(3)}（巨像头部脆弱系数 0.6，理论 ×${expect.toFixed(3)}）`);
  // ★2：举镜更快
  const adsAfter = (n: number) => {
    const g = game('rifle', n);
    g.input.ads = true;
    g.update(STEP * 6);
    return g.player.ads;
  };
  check(adsAfter(2) > adsAfter(0) * 1.3, `★2 0.1 秒后举镜进度 ${adsAfter(0).toFixed(2)} → ${adsAfter(2).toFixed(2)}`);
}

console.log('\n== 狙击步枪 ==');
{
  const pierce = (n: number) => {
    const g = game('sniper', n);
    const zs = [3, 4.5, 6, 7.5, 9].map((dx) => g.spawnZombie('walker', PX + dx, PZ, 100) as Zombie);
    g.loadout.sniper.mag = 1;
    g.input.aimX = PX + 20;
    g.input.aimZ = PZ;
    g.input.aimPitch = -0.08;
    g.input.fire = true;
    for (let t = 0; t < 40; t++) {
      g.update(STEP);
      zs.forEach((z, i) => pin(z, PX + [3, 4.5, 6, 7.5, 9][i]!, PZ));
    }
    return zs.filter((z) => z.hp < z.maxHp).length;
  };
  check(pierce(3) === pierce(0) + STAR_FX.sniperPierce, `★3 一发打中 ${pierce(0)} → ${pierce(3)} 只`);
}

console.log('\n== 轻机枪 ==');
{
  const tail = (n: number) => {
    const g = game('lmg', n);
    g.loadout.lmg.mag = 10; // 已经是最后 20 发
    return shoot(g, 5, 0.5).dmg;
  };
  check(near(ratio(tail(3), tail(2)), STAR_FX.lmgTail.damage), `★3 弹链最后 20 发伤害 ×${ratio(tail(3), tail(2)).toFixed(3)}`);
  const g = game('lmg', 1);
  shoot(g, 6, 2.5);
  check(g.player.sustainT >= 2, `★1 持续开火计时 ${g.player.sustainT.toFixed(1)} 秒（≥ 2 秒散布 −40%）`);
}

console.log('\n== 榴弹发射器 ==');
{
  const g1 = game('launcher', 1);
  const g0 = game('launcher', 0);
  for (const x of [g0, g1]) {
    x.input.aimX = PX + 20;
    x.input.aimZ = PZ;
    x.input.fire = true;
    x.update(STEP);
  }
  const a0 = g0.projectiles[0]?.aoe ?? 0;
  const a1 = g1.projectiles[0]?.aoe ?? 0;
  check(near(ratio(a1, a0), STAR_FX.launcherAoe), `★1 爆炸半径 ${a0.toFixed(2)} → ${a1.toFixed(2)}`);
  const g2 = game('launcher', 2);
  g2.input.aimX = PX + 20;
  g2.input.aimZ = PZ;
  g2.input.fire = true;
  g2.update(STEP);
  const v0 = Math.hypot(g0.projectiles[0]?.vx ?? 0, g0.projectiles[0]?.vz ?? 0);
  const v2 = Math.hypot(g2.projectiles[0]?.vx ?? 0, g2.projectiles[0]?.vz ?? 0);
  check(near(ratio(v2, v0), STAR_FX.launcherReach), `★2 弹速 ×${ratio(v2, v0).toFixed(2)}`);
}

console.log('\n== 不影响别的枪、不影响炮塔 ==');
{
  const a = shoot(game('smg', 0), 5, 1).dmg;
  const gb = game('smg', 0);
  for (const k of WEAPON_ORDER) if (k !== 'smg') gb.config.stars[k] = 3;
  const b = shoot(gb, 5, 1).dmg;
  check(near(a, b, 0.001), `冲锋枪 0 星：别的枪全 3 星时伤害不变（${a.toFixed(0)} / ${b.toFixed(0)}）`);
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
