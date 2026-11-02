import { reactive } from 'vue';
import type { StructureKind } from '../game/data/structures';
import { WEAPONS, statsAt } from '../game/data/weapons';
import type { Game } from '../game/sim';
import { reasonText } from '../game/systems/building';

/** UI 读取的游戏状态快照。逻辑层不依赖 Vue，由应用层把状态抄进来 */
export const hud = reactive({
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  weaponName: '',
  tier: 0,
  mag: 0,
  magMax: 0,
  /** 换弹进度 0–1，-1 = 没在换弹 */
  reload: -1,
  scrap: 0,
  kills: 0,
  coreHp: 500,
  coreMaxHp: 500,
  /** 受伤红屏 0–1 */
  hurt: 0,
  cursorX: 0,
  cursorY: 0,
  cursorVisible: false,
  /** 准星张开程度（像素） */
  spread: 14,
  alive: true,
  buildMode: false,
  buildKind: 'barricade' as StructureKind,
  /** 光标处不能建的原因；空串 = 可以建 */
  buildMsg: '',
  buildOk: false,
});

let lastHp = 100;

export function syncHud(game: Game, dt: number, cursor: { x: number; y: number; visible: boolean }): void {
  const p = game.player;
  const st = statsAt(p.weapon, p.tier);
  const slot = game.loadout[p.weapon];
  hud.hp = Math.ceil(p.hp);
  hud.maxHp = p.maxHp;
  hud.stamina = p.stamina;
  hud.maxStamina = p.maxStamina;
  hud.weaponName = WEAPONS[p.weapon].name;
  hud.tier = p.tier;
  hud.mag = slot.mag;
  hud.magMax = st.mag;
  hud.reload = p.reloadTimer > 0 ? 1 - p.reloadTimer / st.reload : -1;
  hud.scrap = game.scrap;
  hud.kills = game.stats.kills;
  hud.coreHp = Math.ceil(game.core.hp);
  hud.coreMaxHp = game.core.maxHp;
  hud.alive = p.alive;
  if (p.hp < lastHp - 0.01) hud.hurt = Math.min(1, hud.hurt + (lastHp - p.hp) / 25);
  lastHp = p.hp;
  hud.hurt = Math.max(0, hud.hurt - dt * 1.8);
  hud.cursorX = cursor.x;
  hud.cursorY = cursor.y;
  hud.cursorVisible = cursor.visible;
  // 准星随散布和后坐力张开
  hud.spread = 10 + st.spread * 2.2 + p.recoil * 10 + (p.sprinting ? 8 : 0);
  hud.buildMode = game.buildMode;
  hud.buildKind = game.buildKind;
  hud.buildOk = game.buildCursor.valid;
  hud.buildMsg = reasonText(game.buildCursor.reason);
}
