/**
 * 玩法开关：暂时下线、但代码保留的功能。
 *   riskEvents —— 工坊里的风险事件（幸存者、黑市、迁徙、广播、燃油……，M17）
 *   lootSpots  —— 搜刮点和危险区（按住 E 搜刮、检查站 / 避难所 / 污染区，M18）
 * 用户决定（2026-11-06）：特殊事件和搜刮点都先去掉。对应的 sim（sim:events、sim:loot）在脚本里把开关打开再测
 *   tdm        —— 8v8 对战（北港仓库）：出征页的入口和 ?tdm=1
 *   openWorld  —— 生存世界 / 生化模式（open.html）：主菜单的两个入口和页面本身
 * 用户决定（2026-11-16）：这两个模式先不开放，现在只做守城。关掉的是入口，代码和各自的测试都留着
 * （.logs/tdm 的无头测试直接调 startTdm，不走入口，不受影响）
 */
import type { WeaponKind } from './weapons';

export const FEATURES = { riskEvents: false, lootSpots: false, tdm: false, openWorld: false, sniperShotgun: false };

/**
 * 守城现在开放的武器种类。用户（2026-11-16）：狙击枪和霰弹枪暂时不要出现在守城里 —— 先关掉，
 * 数据和各自的代码都留着；FEATURES.sniperShotgun = true 就恢复六类
 */
export const HOLD_CLASSES: WeaponKind[] = FEATURES.sniperShotgun
  ? ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'lmg']
  : ['pistol', 'smg', 'rifle', 'lmg'];
