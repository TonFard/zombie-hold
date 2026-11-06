// M12 玩法验证：npm run sim:extras
// 爆炸物、手雷、推搡、电击脉冲、手电筒、夜晚词缀、新僵尸、连杀、夜间挑战、无尽模式
import { CHALLENGES, COMBO_WINDOW, ELITE_HP, FLASHLIGHT, NIGHT_MODS, comboMult } from '../../src/game/data/modifiers';
import { ZOMBIES } from '../../src/game/data/zombies';
import { CARD_BY_ID, drawCards } from '../../src/game/data/cards';
import { FINAL_NIGHT, bossFor } from '../../src/game/data/waves';
import { baseBonuses } from '../../src/game/data/meta-catalog';
import { applyMeta } from '../../src/game/meta/loadout';
import { medalsFor } from '../../src/game/meta/progress';
import { loadCheckpoint, serialize } from '../../src/game/save/checkpoint';
import { Game, STEP } from '../../src/game/sim';
import { fireWeapon } from '../../src/game/systems/combat';
import { EXPLOSIVE, EXPLOSIVE_PLAYER_MULT, GRENADE, PULSE, SHOVE, blast, registerExplosives, throwGrenade } from '../../src/game/systems/hazards';
import { segmentVsZombie } from '../../src/game/systems/hitvolume';
import { RANKED_DENSITY, checkChallenge, continueEndless, skipDay, startRun } from '../../src/game/systems/run';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

/** 正式规则的一局（M12 玩法打开） */
function ranked(seed = 3): Game {
  const g = new Game(seed);
  applyMeta(g, baseBonuses(), { difficulty: 'normal', sidearm: null });
  return g;
}
const run = (g: Game, sec: number) => {
  for (let i = 0; i < sec / STEP; i++) g.update(STEP);
};

console.log('\n== 沙盒默认关闭 M12 玩法 ==');
{
  const g = new Game(1);
  startRun(g);
  check(!g.config.extras && g.hz.explosives.length === 0, '沙盒（旧 sim 用的规则）没有登记爆炸物');
  g.input.grenade = true;
  run(g, 0.1);
  check(g.hz.thrown.length === 0, '沙盒里按 G 不扔手雷');
}

console.log('\n== 可射击的爆炸物 ==');
{
  const g = ranked();
  startRun(g);
  const barrels = g.hz.explosives.filter((e) => e.kind === 'barrel').length;
  check(barrels >= 2 && g.hz.explosives.some((e) => e.kind === 'pump') && g.hz.explosives.some((e) => e.kind === 'car'), `登记了油桶 ${barrels} 个、加油机和车辆`);
  const e = g.hz.explosives.find((x) => x.kind === 'barrel')!;
  // 在油桶旁边放两只僵尸：一只 2 米内，一只 5 米外
  const near = g.spawnZombie('walker', e.x + 1.6, e.z)!;
  const far = g.spawnZombie('walker', e.x + 5.5, e.z)!;
  near.dummy = far.dummy = true;
  near.x = e.x + 1.6;
  far.x = e.x + 5.5;
  g.player.x = e.x - 1.5;
  g.player.z = e.z;
  g.invulnerableCore = true;
  const hp0 = g.player.hp;
  let boom = 0;
  g.events.on('propExploded', () => boom++);
  // 朝油桶开枪，直到它炸
  g.player.yaw = Math.PI / 2;
  g.input.aimPitch = -0.35;
  for (let i = 0; i < 40 && e.alive; i++) {
    g.loadout.pistol.mag = 16;
    g.player.fireTimer = 0;
    fireWeapon(g);
    run(g, 0.1);
  }
  check(!e.alive && boom >= 1, `开枪打油桶会引爆（连锁共炸了 ${boom} 个）`);
  check(!near.alive, '爆炸半径内的僵尸被炸死');
  check(far.alive, '半径外的僵尸没事');
  // 每个爆炸最多伤玩家 damage × 0.35（连锁的两个桶各算一次）
  check(g.player.hp < hp0 && g.player.hp >= hp0 - boom * EXPLOSIVE.barrel.damage * EXPLOSIVE_PLAYER_MULT - 1 && g.player.alive, `站得近的玩家也受伤但不至于秒死（${hp0} → ${Math.round(g.player.hp)}）`);
  check(g.hz.hazards.some((h) => h.kind === 'fire'), '爆炸留下火焰地面');
  // 连锁：另一个油桶如果在半径内也会炸
  const other = g.hz.explosives.find((x) => x !== e && x.kind === 'barrel' && Math.hypot(x.x - e.x, x.z - e.z) < EXPLOSIVE.barrel.radius);
  if (other) check(!other.alive, '相邻的油桶被连锁引爆');
  run(g, EXPLOSIVE.barrel.fire + 0.2);
  check(g.hz.hazards.length === 0, `火焰地面 ${EXPLOSIVE.barrel.fire} 秒后熄灭`);
}

console.log('\n== 手雷 ==');
{
  const g = ranked(4);
  startRun(g);
  check(g.hz.frags === GRENADE.max, `开局 ${GRENADE.max} 颗手雷`);
  g.player.x = 0.5;
  g.player.z = 4;
  g.player.yaw = 0;
  g.input.aimPitch = 0;
  // 落点大约在前方 ~10 米
  const zs = [0, 1, 2].map((i) => g.spawnZombie('walker', 0.5 + (i - 1) * 0.8, 13)!);
  for (const z of zs) z.dummy = true;
  check(throwGrenade(g) && g.hz.frags === GRENADE.max && g.hz.thrown.length === 0, '按 G 先抬手，还没出手');
  check(!throwGrenade(g), '抬手中再按 G 不会多扔');
  run(g, GRENADE.windup + 0.05);
  check(g.hz.frags === GRENADE.max - 1 && g.hz.thrown.length === 1 && g.hz.throwCd > 0, `抬手 ${GRENADE.windup} 秒后出手，数量减一，进入 ${GRENADE.cd} 秒冷却`);
  check(!throwGrenade(g), '冷却中扔不了');
  let land = { x: 0, z: 0 };
  g.events.on('explosion', (e) => (land = { x: e.x, z: e.z }));
  run(g, GRENADE.fuse + 0.1);
  check(g.hz.thrown.length === 0, `引信 ${GRENADE.fuse} 秒后爆炸`);
  console.log(`     落点 (${land.x.toFixed(1)}, ${land.z.toFixed(1)})，离投掷点 ${Math.hypot(land.x - 0.5, land.z - 4).toFixed(1)} 米`);
  const dead = zs.filter((z) => !z.alive).length;
  check(Math.hypot(land.x - 0.5, land.z - 4) > 4 && dead >= 1, `手雷平视扔出 5 米左右，炸死了附近的僵尸（${dead}/3）`);
  run(g, GRENADE.cd);
  throwGrenade(g);
  run(g, GRENADE.windup + GRENADE.cd + 0.1);
  check(g.hz.frags === 0 && !throwGrenade(g), '用完了扔不出去');
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  skipDay(g);
  for (const z of g.zombies) z.alive = false;
  for (let t = 0; t < 60 * 200 && g.run.phase === 'night'; t++) {
    g.update(STEP);
    for (const z of g.zombies) g.damageZombie(z, 1e6);
  }
  g.events.emit('cardsOffered', { ids: [] });
  // 白天补满
  const id = g.run.cardChoices[0];
  if (id) {
    const { chooseCard } = await import('../../src/game/systems/run');
    chooseCard(g, id);
  }
  check(g.run.phase === 'day' && g.hz.frags === GRENADE.max && g.hz.fires === GRENADE.fireMax, '每个白天手雷和燃烧弹补满');
  // 燃烧弹：B 切换后 G 扔出去，落地留下火焰地面，烧死站在里面的僵尸
  const f = ranked(4);
  startRun(f);
  check(f.hz.fires === GRENADE.fireMax, `开局就有 ${GRENADE.fireMax} 颗燃烧弹`);
  f.player.x = 0.5;
  f.player.z = 4;
  f.player.yaw = 0;
  f.input.aimPitch = 0;
  f.hz.useFire = true;
  const burnees = [0, 1].map((i) => f.spawnZombie('walker', 0.5 + (i - 0.5) * 0.6, 9.4)!);
  for (const z of burnees) z.dummy = true;
  const okThrow = throwGrenade(f);
  for (let i = 0; i < Math.ceil((GRENADE.windup + 0.02) / STEP); i++) f.update(STEP);
  check(okThrow && f.hz.fires === GRENADE.fireMax - 1 && f.hz.frags === GRENADE.max, '切到燃烧弹后扔出的是燃烧弹，手雷数不变');
  run(f, GRENADE.fuse + 0.1);
  check(f.hz.hazards.some((h) => h.kind === 'fire'), '燃烧弹落地留下火焰地面');
  run(f, GRENADE.fire.burn);
  check(burnees.every((z) => !z.alive), '站在火里的僵尸被烧死');
}

console.log('\n== 推搡（V） ==');
{
  const g = ranked(5);
  startRun(g);
  g.player.x = 0.5;
  g.player.z = 4;
  g.player.yaw = 0;
  const z = g.spawnZombie('walker', 0.5, 5.2)!;
  const z0 = z.z;
  g.input.melee = true;
  run(g, 0.2);
  check(z.stunT > 0.5 && z.z > z0 + 0.3, `前方的僵尸被推开 ${(z.z - z0).toFixed(2)} 米并硬直`);
  check(g.hz.shoveCd > SHOVE.cd - 0.3, `推搡冷却 ${SHOVE.cd} 秒`);
  const attacks = g.stats.attacksOnPlayer;
  z.x = 0.5;
  z.z = 4.6;
  run(g, 0.8);
  check(g.stats.attacksOnPlayer === attacks, '硬直期间不会攻击');
  // 冷却中再按 V：不出手，也不再推开 / 硬直
  z.stunT = 0;
  const swings = g.player.meleeTimer;
  g.input.melee = true;
  run(g, 0.05);
  check(g.hz.shoveCd > 0 && g.player.meleeTimer <= swings && z.stunT === 0, '推搡冷却中按 V 没有反应');
  run(g, SHOVE.cd);
  // 冷却好了：换一只血厚的胖子放在正前方（行尸吃第二下枪托会被打死）
  z.hp = 0;
  z.alive = false;
  const z2 = g.spawnZombie('bloater', 0.5, 5.3)!;
  g.player.yaw = 0;
  g.input.melee = true;
  run(g, 0.2);
  check(z2.alive && z2.stunT > 0.5, '冷却好了以后又能推');
}

console.log('\n== 流派牌 ==');
{
  const g = ranked(8);
  startRun(g);
  g.player.x = 0.5;
  g.player.z = 4;
  CARD_BY_ID.chain?.apply(g);
  const a = g.spawnZombie('walker', 6, 6)!;
  const b = g.spawnZombie('walker', 7, 6)!;
  a.dummy = b.dummy = true;
  g.damageZombie(a, 1e6);
  run(g, 0.05);
  check(b.hp < b.maxHp && b.alive, `连锁反应：击杀时旁边的僵尸受到爆炸伤害（${Math.round(b.maxHp - b.hp)}）`);
  const c = g.spawnZombie('walker', 7.5, 6)!;
  c.dummy = true;
  g.damageZombie(b, 1e6, { chain: true });
  run(g, 0.05);
  check(c.hp === c.maxHp, '连锁爆炸炸死的不会再连锁');
  CARD_BY_ID.shover?.apply(g);
  g.input.melee = true;
  run(g, 0.2);
  check(Math.abs(g.hz.shoveCd - SHOVE.cd * 0.6) < 0.25, `推搡专家：冷却 ${g.hz.shoveCd.toFixed(1)} 秒`);
  // 沙盒（旧 sim 的规则）里抽不到流派牌
  const sb = new Game(8);
  startRun(sb);
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) for (const card of drawCards(sb, 3)) seen.add(card.id);
  check(!['chain', 'momentum', 'scavmag', 'brawler', 'shover', 'demo'].some((id) => seen.has(id)), '沙盒里不会抽到流派牌');
}

console.log('\n== 发电机电击脉冲（Q） ==');
{
  const g = ranked(6);
  startRun(g);
  g.player.x = g.core.x + 3;
  g.player.z = g.core.z;
  const inR = g.spawnZombie('walker', g.core.x - 4, g.core.z + 3)!;
  const outR = g.spawnZombie('walker', g.core.x + 12, g.core.z)!;
  inR.dummy = outR.dummy = true;
  g.input.pulse = true;
  run(g, 0.1);
  check(g.hz.pulseCharge > 0 && inR.hp === inR.maxHp, '按 Q 先充能，不会立刻放电');
  run(g, PULSE.charge);
  check(inR.hp <= inR.maxHp - PULSE.damage + 0.01 && inR.stunT > 1, `${PULSE.charge} 秒后放电：范围内伤害 ${PULSE.damage} + 眩晕`);
  check(outR.hp === outR.maxHp, '范围外不受影响');
  g.input.pulse = true;
  run(g, 0.1);
  check(g.hz.pulseCharge === 0 && g.hz.pulseCd > PULSE.cd - 2, `冷却 ${PULSE.cd} 秒内不能再放`);
  const far = ranked(6);
  startRun(far);
  far.player.x = far.core.x + 10;
  far.input.pulse = true;
  run(far, 0.1);
  check(far.hz.pulseCharge === 0, `离发电机超过 ${PULSE.reach} 米按不出来`);
}

console.log('\n== 手电筒（T） ==');
{
  const g = ranked(7);
  startRun(g);
  g.input.flashlight = true;
  run(g, 1);
  check(g.flashOn && g.battery < FLASHLIGHT.battery, '打开后耗电');
  run(g, FLASHLIGHT.battery);
  check(!g.flashOn && !g.input.flashlight, `电量 ${FLASHLIGHT.battery} 秒耗尽自动关闭`);
  run(g, 5);
  check(g.battery > 2, '关掉后充电');
  // 索敌范围：在 10 米（行尸 9 米 × 1.3 = 11.7）放一只，开灯才会追过来
  const h = ranked(7);
  startRun(h);
  h.player.x = 0.5;
  h.player.z = 4;
  const z = h.spawnZombie('walker', 0.5, 14)!;
  run(h, 0.05);
  const before = z.goal;
  h.input.flashlight = true;
  h.battery = FLASHLIGHT.battery;
  run(h, 0.05);
  check(before === 'core' && z.goal === 'player', `10 米外的行尸，开灯后才发现玩家（索敌 ×${FLASHLIGHT.aggro}）`);
}

console.log('\n== 夜晚词缀 ==');
{
  for (const id of Object.keys(NIGHT_MODS)) {
    const g = ranked(8);
    g.invulnerableCore = true;
    g.invulnerablePlayer = true;
    startRun(g);
    g.run.night = 4;
    g.run.mod = id;
    skipDay(g);
    const m = NIGHT_MODS[id as keyof typeof NIGHT_MODS];
    run(g, 12);
    const z = g.zombies.find((q) => q.kind === 'walker');
    const elites = g.zombies.filter((q) => q.elite).length;
    let ok = g.run.modSpeed === m.speed && g.run.modScrap === m.scrap;
    if (m.count !== 1) ok &&= g.run.total === Math.round(Math.round(12 + 5.5 * 4 + 0.35 * 16) * m.count * RANKED_DENSITY.count);
    if (m.hp !== 1 && z) ok &&= Math.abs(z.maxHp - Math.round(60 * 1.3 * m.hp)) <= 1;
    if (m.elite) ok &&= elites >= 1 && g.zombies.some((q) => q.elite && q.maxHp >= 60 * 1.3 * ELITE_HP - 1);
    check(ok, `${m.name}：${m.desc}`);
  }
  const g = ranked(9);
  startRun(g);
  check(g.run.mod === '' && g.run.challenge !== '', '第 1 夜没有词缀，但有挑战');
}

console.log('\n== 新僵尸 ==');
{
  // 命中体积：头球在身体上方、半径合理
  for (const k of ['spitter', 'screamer'] as const) {
    const d = ZOMBIES[k];
    const g = ranked(10);
    const z = g.spawnZombie(k, 0.5, 10)!;
    z.yaw = Math.PI;
    const head = segmentVsZombie(z, 0.5, d.head.y, 4, 0, 0, 10);
    const body = segmentVsZombie(z, 0.5, 1.0, 4, 0, 0, 10);
    check(!!head?.head && !!body && !body.head, `${d.name}：平射头部高度打中头，1 米高打中身体`);
  }
  // 吐酸者：远程吐酸，落点留酸池；爆头一枪死
  {
    const g = ranked(11);
    startRun(g);
    g.player.x = 0.5;
    g.player.z = 4;
    const s = g.spawnZombie('spitter', 0.5, 12)!;
    s.spitCd = 0;
    let spat = 0;
    g.events.on('spit', () => spat++);
    run(g, 0.2);
    check(spat === 1 && g.hz.spits.length === 1, '吐酸者在 8 米外就吐酸');
    const hp0 = g.player.hp;
    run(g, 2);
    check(g.hz.hazards.some((h) => h.kind === 'acid') && g.player.hp < hp0, `酸团落地留下酸池，玩家受伤（${hp0} → ${Math.round(g.player.hp)}）`);
    const t = ranked(11);
    startRun(t);
    t.player.x = 0.5;
    t.player.z = 4;
    t.player.yaw = 0;
    const sp = t.spawnZombie('spitter', 0.5, 9)!;
    sp.dummy = true;
    sp.yaw = Math.PI;
    t.input.aimPitch = Math.atan2(ZOMBIES.spitter.head.y - t.player.eye, 5);
    t.loadout.pistol.mag = 16;
    fireWeapon(t);
    run(t, 0.2);
    check(!sp.alive && t.stats.headshotKills === 1, '手枪爆头一枪打死吐酸者（酸囊）');
  }
  // 尖啸者：尖叫让周围僵尸加速
  {
    const g = ranked(12);
    startRun(g);
    g.player.x = 0.5;
    g.player.z = 4;
    const sc = g.spawnZombie('screamer', 0.5, 12)!;
    sc.screamCd = 0;
    const w = g.spawnZombie('walker', 3, 13)!;
    const far = g.spawnZombie('walker', 0.5, 30)!;
    let screams = 0;
    g.events.on('scream', () => screams++);
    run(g, 0.1);
    check(screams === 1 && w.hasteT > 4 && w.hasteK === 0.4 && far.hasteT === 0, '尖叫让 8 米内的僵尸 +40% 速度 5 秒，远处的不受影响');
  }
  // 出场：第 3 夜起吐酸者、第 6 夜起尖啸者
  {
    const count = (night: number) => {
      const g = ranked(13);
      g.invulnerableCore = true;
      g.invulnerablePlayer = true;
      startRun(g);
      g.run.night = night;
      g.run.mod = '';
      skipDay(g);
      const seen: Record<string, number> = {};
      g.events.on('zombieSpawned', (z) => (seen[z.kind] = (seen[z.kind] ?? 0) + 1));
      for (let t = 0; t < 60 * 90 && g.run.phase === 'night'; t++) {
        g.update(STEP);
        for (const z of g.zombies) g.damageZombie(z, 1e6);
      }
      return seen;
    };
    const n2 = count(2);
    const n7 = count(7);
    check(!n2.spitter && !n2.screamer, '第 2 夜没有新僵尸');
    check((n7.spitter ?? 0) > 0 && (n7.screamer ?? 0) > 0, `第 7 夜出现吐酸者 ${n7.spitter ?? 0} 只、尖啸者 ${n7.screamer ?? 0} 只`);
  }
}

console.log('\n== 连杀 ==');
{
  check(comboMult(1) === 1 && Math.abs(comboMult(3) - 1.1) < 1e-9 && comboMult(50) === 1.5, '倍率：1 杀 ×1，3 连杀 ×1.1，最多 ×1.5');
  const g = ranked(14);
  startRun(g);
  const s0 = g.scrap;
  for (let i = 0; i < 5; i++) {
    const z = g.spawnZombie('walker', 5 + i, 10)!;
    g.damageZombie(z, 1e6);
    run(g, 0.5);
  }
  const got = g.scrap - s0;
  check(g.combo === 5 && got === [1, 1.05, 1.1, 1.15, 1.2].reduce((a, k) => a + Math.round(3 * k), 0), `5 连杀：零件 ${got}（逐只递增）`);
  run(g, COMBO_WINDOW + 0.1);
  const z = g.spawnZombie('walker', 5, 10)!;
  g.damageZombie(z, 1e6);
  check(g.combo === 1, `间隔超过 ${COMBO_WINDOW} 秒连杀清零`);
}

console.log('\n== 夜间挑战 ==');
{
  const night = (id: string) => {
    const g = ranked(15);
    g.invulnerableCore = true;
    g.invulnerablePlayer = true;
    startRun(g);
    g.run.challenge = id;
    skipDay(g);
    return g;
  };
  {
    const g = night('pistol');
    for (let i = 0; i < CHALLENGES.pistol.goal; i++) g.damageZombie(g.spawnZombie('walker', 5, 10 + i * 0.1)!, 1e6);
    check(g.run.chDone && g.stats.challenges === 1, '老伙计：手枪击杀 15 只即完成');
  }
  {
    const g = night('pistol');
    g.loadout.smg.owned = true;
    g.player.weapon = 'smg';
    for (let i = 0; i < 20; i++) g.damageZombie(g.spawnZombie('walker', 5, 10 + i * 0.1)!, 1e6);
    check(!g.run.chDone, '老伙计：用别的枪杀的不算');
  }
  {
    const g = night('blitz');
    for (let i = 0; i < 20; i++) {
      g.damageZombie(g.spawnZombie('walker', 5, 10 + i * 0.1)!, 1e6);
      run(g, 1);
    }
    check(g.run.chDone, '闪电战：30 秒内 20 杀');
    const h = night('blitz');
    for (let i = 0; i < 20; i++) {
      h.damageZombie(h.spawnZombie('walker', 5, 10 + i * 0.1)!, 1e6);
      run(h, 2);
    }
    check(!h.run.chDone, '闪电战：40 秒才杀 20 只不算');
  }
  {
    const g = night('headshot');
    for (let i = 0; i < 20; i++) g.damageZombie(g.spawnZombie('walker', 5, 10 + i * 0.1)!, 1e6, { head: i % 2 === 0 });
    check(!g.run.chDone && checkChallenge(g, true), '神枪手：一夜结束时爆头率 50% ≥ 40% 完成（夜里不提前判定）');
  }
  {
    const g = night('nobreach');
    g.scrap += 100;
    g.addStructure('barricade', 40, 45, true);
    const sid = [...g.structures.keys()][0]!;
    g.damageStructure(sid, 1e6);
    check(!checkChallenge(g, true), '固若金汤：有路障被拆就失败');
  }
  const m0 = medalsFor({ difficulty: 'normal', nights: 3, won: false, kills: 0, headshotKills: 0 }).total;
  const m1 = medalsFor({ difficulty: 'normal', nights: 3, won: false, kills: 0, headshotKills: 0, challenges: 2 }).total;
  check(m1 - m0 === 10, '完成的挑战结算时每个 +5 勋章');
}

console.log('\n== 无尽模式 ==');
{
  check(bossFor(15)?.kind === 'colossus' && bossFor(20)!.hpScale > bossFor(15)!.hpScale && !bossFor(12), '第 15 / 20 夜有首领且越来越硬，第 12 夜没有');
  const g = ranked(16);
  g.invulnerableCore = true;
  g.invulnerablePlayer = true;
  startRun(g);
  g.run.night = FINAL_NIGHT;
  skipDay(g);
  for (let t = 0; t < 60 * 400 && g.run.phase === 'night'; t++) {
    g.update(STEP);
    for (const z of g.zombies) g.damageZombie(z, 1e6);
  }
  check(g.run.phase === 'won', '第 10 夜结束通关');
  check(continueEndless(g) && g.run.phase === 'cards' && g.run.endless, '通关后可以继续：进入无尽模式');
  const { chooseCard } = await import('../../src/game/systems/run');
  chooseCard(g, g.run.cardChoices[0] as string);
  check(g.run.phase === 'day' && g.run.night === FINAL_NIGHT + 1, `进入第 ${FINAL_NIGHT + 1} 天`);
  const win = medalsFor({ difficulty: 'normal', nights: 10, won: true, kills: 0, headshotKills: 0 }).total;
  const e15 = medalsFor({ difficulty: 'normal', nights: 15, won: true, kills: 0, headshotKills: 0 }).total;
  check(e15 - win === 5 * 24 + 30, `无尽撑到第 15 夜比通关多 ${e15 - win} 勋章（每夜 24 + 首领 30）`);
  // 无尽模式下的检查点
  const raw = JSON.stringify(serialize(g));
  const h = ranked(16);
  check(loadCheckpoint(h, raw) === null && h.run.night === 11 && h.run.endless, '无尽模式的检查点能读回');
}

console.log('\n== 检查点：M12 状态 ==');
{
  const g = ranked(17);
  g.invulnerableCore = true;
  startRun(g);
  registerExplosives(g);
  blast(g, g.hz.explosives[0]!.x, g.hz.explosives[0]!.z, 0.5, 1, false);
  g.hz.explosives[0]!.hp = 0.4;
  run(g, 0.1);
  g.hz.frags = 1;
  g.input.flashlight = true;
  run(g, 2);
  const raw = JSON.stringify(serialize(g));
  const h = ranked(17);
  h.invulnerableCore = true; // 测试开关不进存档
  check(loadCheckpoint(h, raw) === null, '带爆炸物 / 火焰地面 / 手电的检查点能读回');
  check(!h.hz.explosives[0]!.alive && h.hz.frags === 1 && h.hz.hazards.length === g.hz.hazards.length && Math.abs(h.battery - g.battery) < 1e-9, '炸掉的爆炸物、手雷数、火焰地面、电量都恢复了');
  skipDay(g);
  skipDay(h);
  for (let i = 0; i < 60 * 40; i++) {
    g.update(STEP);
    h.update(STEP);
  }
  check(JSON.stringify(serialize(g)) === JSON.stringify(serialize(h)), `读档后继续 40 秒两边完全一致（场上 ${g.zombies.length} 只）`);
}

console.log('\n== M13：诅咒卡牌 ==');
{
  const { drawCards, CARDS } = await import('../../src/game/data/cards');
  const g = ranked(20);
  let curses = 0;
  for (let i = 0; i < 200; i++) curses += drawCards(g, 3).filter((c) => c.rarity === 'curse').length;
  check(curses > 40 && curses < 110, `200 个黎明里大约 35% 混进 1 张诅咒牌（${curses}）`);
  const sand = new Game(20);
  let sc = 0;
  for (let i = 0; i < 200; i++) sc += drawCards(sand, 3).filter((c) => c.rarity === 'curse').length;
  check(sc === 0, '沙盒规则下不出诅咒牌');
  const glass = CARDS.find((c) => c.id === 'c-glass')!;
  const h = ranked(20);
  glass.apply(h);
  check(Math.abs(h.mods.damage - 1.3) < 1e-9 && Math.abs(h.mods.armor - 1.25) < 1e-9, '玻璃大炮：伤害 +30%，受伤 +25%');
}

console.log('\n== M13：首领冲锋与弱点 ==');
{
  const g = ranked(21);
  g.invulnerableCore = true;
  startRun(g);
  // 地图南边那条贯穿东西的空地（第 76 行），中间没有墙
  const lz = 76 - 40 + 0.5;
  g.player.x = -30;
  g.player.z = lz;
  const boss = g.spawnZombie('colossus', -20, lz)!;
  boss.chargeCd = 0;
  let stages: string[] = [];
  g.events.on('bossCharge', (c) => stages.push(c.stage));
  run(g, 0.1);
  check(boss.chargeState === 1 && stages[0] === 'windup', '玩家在 14 米内：首领停下蓄力（地上出现预警线）');
  const x0 = boss.x;
  run(g, 1.0);
  check(Math.abs(boss.x - x0) < 0.5, `蓄力期间基本不动（位移 ${Math.abs(boss.x - x0).toFixed(2)} 米，只有分离力）`);
  // 玩家闪开，让它扑空
  g.player.z = lz - 1.5;
  run(g, 0.4);
  check(boss.chargeState === 2 && boss.x < x0 - 1, '蓄力结束后沿直线冲锋');
  run(g, 1.5);
  check(boss.chargeState === 3, '冲完进入硬直');
  // 硬直时打胸口：弱点倍率
  const hp0 = boss.hp;
  const { segmentVsZombie } = await import('../../src/game/systems/hitvolume');
  const ch = boss.def.charge!;
  const cx = boss.x + Math.sin(boss.yaw) * boss.radius * 0.7;
  const cz = boss.z + Math.cos(boss.yaw) * boss.radius * 0.7;
  const hit = segmentVsZombie(boss, cx + Math.sin(boss.yaw) * 6, ch.core.y, cz + Math.cos(boss.yaw) * 6, -Math.sin(boss.yaw) * 7, 0, -Math.cos(boss.yaw) * 7);
  check(!!hit?.core, '硬直时正面打胸口算打中弱点');
  boss.chargeState = 0;
  const miss = segmentVsZombie(boss, cx + Math.sin(boss.yaw) * 6, ch.core.y, cz + Math.cos(boss.yaw) * 6, -Math.sin(boss.yaw) * 7, 0, -Math.cos(boss.yaw) * 7);
  check(!!miss && !miss.core, '平时打同一个位置只是身体');
  void hp0;
  stages = [];
}

console.log('\n== 武器属性：重量、弹药、双持、章节 ==');
{
  const { bonusesOf, newMeta, suppliesFor, buyAmmo, buyBench } = await import('../../src/game/meta/progress');
  const { CHAPTER_BY_ID } = await import('../../src/game/data/chapters');
  const { switchWeapon } = await import('../../src/game/systems/player');
  const all = { 'unlock-smg': 1, 'unlock-shotgun': 1, 'unlock-rifle': 1, 'unlock-lmg': 1, dual: 1, 'cap-pistol': 1 };
  const b = bonusesOf({ ...newMeta(), levels: all });

  // 重量：拿轻机枪走得比手枪慢
  const speedWith = (k: 'pistol' | 'lmg'): number => {
    const g = new Game(41);
    applyMeta(g, b, { difficulty: 'normal', sidearm: null, ammo: { lmg: 300 } });
    startRun(g);
    g.zombies.length = 0;
    g.scrap = 9999;
    if (k !== 'pistol') g.buyWeapon(k);
    switchWeapon(g, k);
    const x0 = g.player.x;
    g.input.moveX = 1;
    for (let i = 0; i < 60; i++) g.update(STEP);
    return Math.abs(g.player.x - x0);
  };
  const sp = speedWith('pistol');
  const sl = speedWith('lmg');
  check(sl < sp * 0.9, `扛轻机枪 1 秒走 ${sl.toFixed(2)} 米，拿手枪 ${sp.toFixed(2)} 米（重量真的减速）`);

  // 弹药：带进去多少就有多少，打光了换不了弹
  const g = new Game(42);
  applyMeta(g, b, { difficulty: 'normal', sidearm: null, ammo: { smg: 40 } });
  // 弹药有限目前关着（AMMO_LIMITED），这里打开测逻辑本身
  g.config.ammo = true;
  g.ammo.smg = 40;
  startRun(g);
  g.zombies.length = 0;
  g.scrap = 9999;
  g.buyWeapon('smg');
  switchWeapon(g, 'smg');
  check(g.loadout.smg.mag === 36 && g.reserveOf('smg') === 4, `买冲锋枪：弹匣装 36，备弹剩 ${g.reserveOf('smg')}`);
  g.loadout.smg.mag = 0;
  for (let i = 0; i < 200; i++) g.update(STEP);
  check(g.loadout.smg.mag === 4 && g.reserveOf('smg') === 0, `打空换弹只能补上剩下的 4 发（弹匣 ${g.loadout.smg.mag}）`);
  g.loadout.smg.mag = 0;
  for (let i = 0; i < 200; i++) g.update(STEP);
  check(g.loadout.smg.mag === 0 && g.player.reloadTimer === 0, '备弹打光：不会再换弹');
  check(g.reserveOf('pistol') === Infinity, '手枪子弹无限');

  // 双持：弹匣翻倍、射速更高
  const gd = new Game(43);
  applyMeta(gd, b, { difficulty: 'normal', sidearm: null });
  check(gd.config.dual && gd.statsOf('pistol').mag === 24 && gd.statsOf('pistol').rate > 5, `双持手枪：弹匣 ${gd.statsOf('pistol').mag}、射速 ${gd.statsOf('pistol').rate.toFixed(1)}`);

  // 工作台强化：伤害、扩容带进局内
  let m: ReturnType<typeof newMeta> = { ...newMeta(), levels: all, supplies: 9999, mastery: { smg: 9999 } };
  m = buyBench(m, 'smg', 'damage')!;
  m = buyBench(m, 'smg', 'mag')!;
  const gb = new Game(44);
  applyMeta(gb, bonusesOf(m), { difficulty: 'normal', sidearm: null, bench: m.bench });
  check(Math.abs(gb.statsOf('smg', 0).damage - 10.6) < 1e-6 && gb.statsOf('smg', 0).mag === 40, `工作台：冲锋枪伤害 10 → ${gb.statsOf('smg', 0).damage.toFixed(1)}，弹匣 36 → ${gb.statsOf('smg', 0).mag}`);
  const m2 = buyAmmo({ ...newMeta(), supplies: 10 }, 'smg');
  check(!!m2 && m2.ammo.smg === 120 && m2.supplies === 4 && !buyAmmo(newMeta(), 'pistol'), '补给买子弹：6 补给 = 120 发；手枪不用买');

  const gn = new Game(46);
  applyMeta(gn, b, { difficulty: 'normal', sidearm: null });
  check(!gn.config.ammo && gn.reserveOf('smg') === Infinity, '目前正式局所有武器子弹无限');

  // 章节：越往后越难，补给越多
  const gc = new Game(45, 'city');
  applyMeta(gc, b, { difficulty: 'normal', sidearm: null, chapter: 'city' });
  check(gc.config.zombieHp === CHAPTER_BY_ID.city.hp && gc.mapId === 'city', `第四章：僵尸生命 ×${gc.config.zombieHp}`);
  check(suppliesFor({ difficulty: 'normal', nights: 5, won: false, kills: 100, headshotKills: 0, chapter: 'city' }) > suppliesFor({ difficulty: 'normal', nights: 5, won: false, kills: 100, headshotKills: 0 }), '后面的章节补给更多');
  const scrapK = (d: 'normal' | 'hard' | 'nightmare', c: 'outpost' | 'city') => {
    const gs = new Game(47, c);
    applyMeta(gs, b, { difficulty: d, sidearm: null, chapter: c });
    return gs.mods.scrap;
  };
  check(scrapK('hard', 'outpost') > scrapK('normal', 'outpost') && scrapK('nightmare', 'outpost') > scrapK('hard', 'outpost') && scrapK('normal', 'city') > scrapK('normal', 'outpost'), `零件收入：普通 ×${scrapK('normal', 'outpost')}、困难 ×${scrapK('hard', 'outpost')}、噩梦 ×${scrapK('nightmare', 'outpost')}、第四章普通 ×${scrapK('normal', 'city').toFixed(2)}`);
}

console.log('\n== M13：空投 ==');
{
  const { AIRDROP } = await import('../../src/game/systems/airdrop');
  const g = ranked(22);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  startRun(g);
  check(g.airdrop.stage === 0, '第 1 天没有空投');
  g.run.night = 2;
  const { planAirdrop } = await import('../../src/game/systems/airdrop');
  planAirdrop(g);
  check(g.airdrop.stage === 1 && Math.hypot(g.airdrop.x - g.core.x, g.airdrop.z - g.core.z) >= 18, '第 2 天起安排空投，落在据点外');
  const n0 = g.zombies.length;
  run(g, AIRDROP.delay + 0.1);
  check(g.airdrop.stage === 2 && g.zombies.length === n0 + AIRDROP.guards, `${AIRDROP.delay} 秒后落地，带 ${AIRDROP.guards} 个守卫`);
  const s0 = g.scrap;
  const f0 = g.hz.frags;
  g.player.x = g.airdrop.x;
  g.player.z = g.airdrop.z;
  run(g, 0.1);
  check(g.airdrop.stage === 0 && g.scrap - s0 >= AIRDROP.scrap && g.hz.frags === f0 + AIRDROP.grenades, '走过去拿到：零件 + 手雷');
  const h = ranked(22);
  startRun(h);
  h.run.night = 2;
  planAirdrop(h);
  run(h, AIRDROP.delay + AIRDROP.time + 0.5);
  check(h.airdrop.stage === 0, '限时内没拿就消失');
}

console.log('\n== M13：每日挑战 / 成就 / 图鉴存档 ==');
{
  const { dailyFor, newlyDone, newCodex } = await import('../../src/game/meta/achievements');
  const { applyDaily } = await import('../../src/game/meta/loadout');
  const a = dailyFor('2026-05-01');
  const b = dailyFor('2026-05-01');
  const c = dailyFor('2026-05-02');
  check(JSON.stringify(a) === JSON.stringify(b) && (a.seed !== c.seed || a.mod !== c.mod), '同一天的每日挑战完全相同，不同天不同');
  const g = new Game(a.seed);
  applyDaily(g, a);
  startRun(g);
  check(g.config.weapons.length === 1 && g.config.weapons[0] === a.weapon && g.loadout[a.weapon].owned, `每日挑战只能用 ${a.weapon}`);
  g.run.night = 3;
  for (let i = 0; i < 3; i++) {
    g.run.phase = 'cards';
    const { chooseCard } = await import('../../src/game/systems/run');
    g.run.cardChoices = ['medkit'];
    chooseCard(g, 'medkit');
  }
  check(g.run.mod === a.mod, `每夜词缀固定为 ${a.mod}`);
  const { serialize, loadCheckpoint } = await import('../../src/game/save/checkpoint');
  check(loadCheckpoint(new Game(a.seed), JSON.stringify(serialize(g))) !== null, '每日挑战不存检查点（读档被拒绝）');
  const codex = newCodex();
  const got = newlyDone({ totalKills: 1200, totalHeadshots: 50, wins: 1, bestNight: 10, clearedHard: false, clearedNightmare: false, bestCombo: 3, challenges: 0, codex });
  check(got.map((x) => x.id).sort().join() === ['kills-100', 'kills-1000', 'night-5', 'win'].sort().join(), `成就判定：${got.map((x) => x.name).join('、')}`);
  codex.done = got.map((x) => x.id);
  check(newlyDone({ totalKills: 1200, totalHeadshots: 50, wins: 1, bestNight: 10, clearedHard: false, clearedNightmare: false, bestCombo: 3, challenges: 0, codex }).length === 0, '达成过的成就不会重复给');
  const { defaultSave, parseSave } = await import('../../src/game/save/schema');
  const s = defaultSave();
  s.codex.kills.walker = 10;
  s.codex.daily['2026-05-01'] = 4;
  s.codex.challenges = 3;
  const back = parseSave(JSON.parse(JSON.stringify(s)));
  check(JSON.stringify(back.codex) === JSON.stringify(s.codex), '图鉴 / 成就 / 每日成绩写入存档后读回一致');
  const old = JSON.parse(JSON.stringify(defaultSave()));
  delete old.codex;
  check(parseSave(old).codex.challenges === 0, '没有 codex 字段的旧 v2 存档照样能读');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
