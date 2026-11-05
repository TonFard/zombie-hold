export type Difficulty = 'normal' | 'hard' | 'nightmare';

export const DIFFICULTY_ORDER: Difficulty[] = ['normal', 'hard', 'nightmare'];

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  /** 僵尸生命 / 数量 / 伤害倍率 */
  hp: number;
  count: number;
  damage: number;
  /** 勋章倍率 */
  medals: number;
  /** 局内零件收入倍率（击杀、零件箱、空投、夜晚奖励）：僵尸更硬更多，零件也要给够 */
  scrap: number;
  /** 解锁条件：通关过哪个难度；null = 一开始就能选 */
  requires: Difficulty | null;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  normal: { id: 'normal', name: '普通', hp: 1, count: 1, damage: 1, medals: 1, scrap: 1, requires: null },
  hard: { id: 'hard', name: '困难', hp: 1.3, count: 1.15, damage: 1.2, medals: 1.5, scrap: 1.25, requires: 'normal' },
  nightmare: { id: 'nightmare', name: '噩梦', hp: 1.7, count: 1.3, damage: 1.4, medals: 2, scrap: 1.5, requires: 'hard' },
};

export const isDifficulty = (v: unknown): v is Difficulty => v === 'normal' || v === 'hard' || v === 'nightmare';
