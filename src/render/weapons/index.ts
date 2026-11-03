import type { Group, Vector3 } from 'three';
import { MAX_TIER, type WeaponKind } from '../../game/data/weapons';
import { GunKit, type Action, type GunInfo, type PartName } from './kit-ext';
import { launcher } from './launcher';
import { lmg } from './lmg';
import { pistol } from './pistol';
import { rifle } from './rifle';
import { shotgun } from './shotgun';
import { smg } from './smg';
import { sniper } from './sniper';

export type { Action, PartName };

/**
 * 武器模型。局部坐标：原点在后握把（右手位置），枪口朝 +Z，上方为 +Y，单位为米。
 * 每升一级会多出可见的配件（弹鼓、瞄具、枪口装置、发光件……），所以武器等级一眼能看出来。
 * 可动零件（套筒、弹匣、泵动护木、枪栓、转轮、弹链）是单独的子组，视角模型按动作驱动它们。
 */
export interface WeaponModel extends GunInfo {
  group: Group;
  parts: Partial<Record<PartName, Group>>;
  /** 可动零件的初始位置 / 角度（动画以它为基准） */
  rest: Partial<Record<PartName, { p: Vector3; rz: number }>>;
}

const BUILDERS: Record<WeaponKind, (k: GunKit) => GunInfo> = { pistol, smg, shotgun, rifle, sniper, lmg, launcher };

export function buildWeapon(kind: WeaponKind, tier: number): WeaponModel {
  const k = new GunKit(Math.max(0, Math.min(MAX_TIER, tier)));
  const info = BUILDERS[kind](k);
  const { group, parts } = k.finish();
  const rest: WeaponModel['rest'] = {};
  for (const [name, g] of Object.entries(parts) as Array<[PartName, Group]>) rest[name] = { p: g.position.clone(), rz: g.rotation.z };
  return { group, parts, rest, ...info };
}
