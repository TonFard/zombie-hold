import { reactive } from 'vue';
import type { Difficulty } from '../game/data/difficulty';
import type { Quality } from '../game/data/quality';
import type { MedalBreakdown } from '../game/meta/progress';
import { defaultSave, type SaveData } from '../game/save/schema';

export type Screen = 'menu' | 'lobby' | 'play' | 'training' | 'pause' | 'bench' | 'cards' | 'result';

export type LobbyTab = 'deploy' | 'bench' | 'armory' | 'engineering' | 'supply' | 'fitness' | 'records' | 'codex' | 'settings';

export interface Banner {
  text: string;
  sub: string;
  /** 每次新横幅自增，让组件能重新播放动画 */
  id: number;
}

export interface ResultInfo {
  won: boolean;
  reason: string;
  night: number;
  kills: number;
  headshotKills: number;
  scrap: number;
  time: number;
  newBest: boolean;
  difficulty: Difficulty;
  medals: MedalBreakdown;
  /** 这一局结算的补给点 */
  supplies: number;
}

/** 检查点的摘要：大厅里显示"继续第 n 天" */
export interface CheckpointInfo {
  night: number;
  difficulty: Difficulty;
  savedAt: number;
  scrap: number;
  hp: number;
  maxHp: number;
}

/** 界面层状态：当前在哪个界面、横幅、结算信息、存档统计 */
export const ui = reactive({
  screen: 'menu' as Screen,
  lobbyTab: 'deploy' as LobbyTab,
  banner: { text: '', sub: '', id: 0 } as Banner,
  result: null as ResultInfo | null,
  save: defaultSave() as SaveData,
  checkpoint: null as CheckpointInfo | null,
  cards: [] as string[],
  /** 这一局新达成的成就（结算页显示） */
  achievements: [] as string[],
  /** 结算页显示"继续：无尽模式" */
  canEndless: false,
  /** 当前在训练场（暂停菜单换成"离开训练场"） */
  inTraining: false,
  /** 训练场：显示弹道偏离表（H 切换） */
  dropHint: true,
  /** 这个黎明还能重抽几次 */
  rerolls: 0,
  /** 写实地图资源加载好了没有：加载期间盖一层加载画面，不让玩家先看到旧的程序地图再"跳"成新的 */
  worldReady: false,
  /** 云存档：登录的用户名（空串 = 没登录）、最近一次同步时间、正在请求、最近的错误 */
  cloud: { name: '', syncedAt: 0, busy: false, error: '' },
  /** 屏幕角落的短提示（自动保存、坏档……）；id 自增让组件重播动画 */
  toast: { text: '', warn: false, id: 0 },
  /** 游戏通过它把"开始 / 重新开始 / 回主菜单 / 继续"等动作交给应用层 */
  actions: {
    enterLobby: () => {},
    deploy: (_d: Difficulty, _sidearm: string | null, _chapter: string) => {},
    buyAmmo: (_k: string, _packs: number) => {},
    buyBench: (_k: string, _line: string) => {},
    continueRun: () => {},
    training: () => {},
    daily: () => {},
    buyMeta: (_id: string) => {},
    resume: () => {},
    restart: () => {},
    /** 放弃本局：按已经撑过的夜数结算勋章，回大厅 */
    abandon: () => {},
    toLobby: () => {},
    endless: () => {},
    closeBench: () => {},
    pickCard: (_id: string) => {},
    reroll: () => {},
    buy: (_k: string) => {},
    upgrade: (_k: string) => {},
    equip: (_k: string) => {},
    setVolume: (_v: number) => {},
    setQuality: (_q: Quality) => {},
    setSensitivity: (_s: number) => {},
    /** 退出登录（回到登录界面） */
    cloudSignOut: () => {},
  },
});

export function toast(text: string, warn = false): void {
  ui.toast = { text, warn, id: ui.toast.id + 1 };
}

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
