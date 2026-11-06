/**
 * 玩法开关：暂时下线、但代码保留的功能。
 *   riskEvents —— 工坊里的风险事件（幸存者、黑市、迁徙、广播、燃油……，M17）
 *   lootSpots  —— 搜刮点和危险区（按住 E 搜刮、检查站 / 避难所 / 污染区，M18）
 * 用户决定（2026-11-06）：特殊事件和搜刮点都先去掉。对应的 sim（sim:events、sim:loot）在脚本里把开关打开再测
 */
export const FEATURES = { riskEvents: false, lootSpots: false };
