// 武器平衡检查：npm run check:balance
// 把"手枪最弱，哪怕升满"变成可执行的约束，而不是口头承诺。
import { WEAPON_ORDER, WEAPONS, statsAt, sustainedDps, totalUpgradeCost, type WeaponKind } from '../src/game/data/weapons';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

console.log('\n== 持续单体 DPS（含换弹）==');
console.log('  武器          基础    1级     2级     3级     4级     5级(满)');
const dps = {} as Record<WeaponKind, number[]>;
for (const k of WEAPON_ORDER) {
  dps[k] = [0, 1, 2, 3, 4, 5].map((t) => sustainedDps(statsAt(k, t)));
  console.log(`  ${WEAPONS[k].name.padEnd(10, '　')} ${dps[k].map((v) => v.toFixed(1).padStart(6)).join('  ')}`);
}

const pistolMax = (dps.pistol as number[])[5] as number;
const others = WEAPON_ORDER.filter((k) => k !== 'pistol');

console.log('\n== 约束 ==');
for (const k of others) {
  const t1 = (dps[k] as number[])[1] as number;
  const margin = (t1 / pistolMax - 1) * 100;
  check(margin >= 5, `${WEAPONS[k].name} 只升 1 级（${t1.toFixed(1)}）就比满级手枪（${pistolMax.toFixed(1)}）高至少 5%（实际 +${margin.toFixed(1)}%）`);
}
for (const k of others) {
  const base = (dps[k] as number[])[0] as number;
  const pBase = (dps.pistol as number[])[0] as number;
  check(base >= pBase * 1.5, `${WEAPONS[k].name} 基础 DPS 至少是手枪基础的 1.5 倍（${base.toFixed(1)} vs ${pBase.toFixed(1)}）`);
}
for (const k of others) {
  const mx = (dps[k] as number[])[5] as number;
  check(mx >= pistolMax * 1.8, `${WEAPONS[k].name} 满级 DPS 至少是满级手枪的 1.8 倍（${mx.toFixed(1)}）`);
}

const p = statsAt('pistol', 5);
check(p.pierce === 0 && p.aoe === 0 && p.burn === 0 && p.ramp === 0 && p.split === 0 && p.pellets === 1, '满级手枪没有穿透 / 范围 / 灼烧 / 射速递增 / 分裂 / 多弹丸');
const pistolSpent = totalUpgradeCost('pistol');
for (const k of others) {
  const entry = WEAPONS[k].price + (WEAPONS[k].upgrades[0]?.cost ?? 0) + (WEAPONS[k].upgrades[1]?.cost ?? 0);
  check(pistolSpent < entry, `手枪升满总花费（${pistolSpent}）低于买 ${WEAPONS[k].name} 并升 2 级（${entry}）`);
}

// 升级必须单调不降：每一级都不能让 DPS 变低
for (const k of WEAPON_ORDER) {
  const arr = dps[k] as number[];
  let mono = true;
  for (let i = 1; i < arr.length; i++) if ((arr[i] as number) < (arr[i - 1] as number)) mono = false;
  check(mono, `${WEAPONS[k].name} 每一级升级都不会降低 DPS`);
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
