import type { StructureDef, StructureKind } from '../data/structures';

export interface Structure {
  id: number;
  kind: StructureKind;
  def: StructureDef;
  cx: number;
  cy: number;
  hp: number;
  maxHp: number;
  /** 炮塔朝向（绕 Y） */
  aim: number;
  /** 炮塔射击冷却 / 地刺结算计时 */
  cd: number;
  /** 炮塔最近一次开火至今的时间，渲染后坐力用 */
  sinceShot: number;
  /** 炮塔当前目标 */
  target: number;
}
