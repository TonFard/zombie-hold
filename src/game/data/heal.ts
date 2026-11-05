/**
 * 回血节奏：所有持续回血都按固定节拍一小口一小口地回，不会一下跳满。
 *   - 嗜血（卡牌）：击杀攒进回血池，每拍最多回 POOL_PER_TICK，池子有上限（连杀一大片也只是慢慢回）
 *   - 急救训练（局外）：脱战 REGEN_DELAY 秒后，每拍回 regen × HEAL_TICK
 */
export const HEAL_TICK = 0.25;
export const HEAL_POOL_MAX = 12;
/** 回血池每拍最多回多少（= 每秒 4 点） */
export const POOL_PER_TICK = 1;
/** 脱战多久开始自动回血 */
export const REGEN_DELAY = 5;
/** 急救训练每级每秒回复（0.4 / 0.8 / 1.2） */
export const REGEN_PER_LEVEL = 0.4;
