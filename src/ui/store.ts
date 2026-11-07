import type { Replay } from '../game/stats/replay';
import { reactive } from 'vue';
import type { Difficulty } from '../game/data/difficulty';
import type { Quality } from '../game/data/quality';
import type { MedalBreakdown } from '../game/meta/progress';
import type { MetaSection } from '../game/data/meta-catalog';
import { defaultSave, type SaveData } from '../game/save/schema';

export type Screen = 'menu' | 'lobby' | 'play' | 'training' | 'pause' | 'bench' | 'cards' | 'result';

/** 顶栏 6 个页面；工程部 / 补给站 / 体能训练并进军械库，作为军械库里的子分类（shopTab） */
export type LobbyTab = 'deploy' | 'bench' | 'armory' | 'records' | 'codex' | 'settings';

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
  /** 战斗复盘（结算页第二页） */
  replay: Replay | null;
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
  /** 军械库里选中的子分类 */
  shopTab: 'armory' as MetaSection,
  banner: { text: '', sub: '', id: 0 } as Banner,
  result: null as ResultInfo | null,
  save: defaultSave() as SaveData,
  checkpoint: null as CheckpointInfo | null,
  cards: [] as string[],
  /** 渲染层给界面的小工具（boot 里填）：武器图标、武器台的 3D 预览 */
  gfx: {
    icon: (_kind: string, _tier?: number): string => '',
    preview: (_w: number, _h: number): { canvas: HTMLCanvasElement; setWeapon(kind: string, tier: number, dual?: boolean): void; resize(w: number, h: number): void; dispose(): void } | null => null,
  },
  /** 这一局每把枪涨的熟练度击杀（结算页显示） */
  masteryGain: {} as Partial<Record<string, number>>,
  /** 这一局新达成的成就（结算页显示） */
  achievements: [] as string[],
  /** 结算页显示"继续：无尽模式" */
  canEndless: false,
  /** 当前在训练场（暂停菜单换成"离开训练场"） */
  inTraining: false,
  /** 当前在团队死斗 */
  inTdm: false,
  /** 团队死斗结算 */
  tdmResult: null as { winner: -1 | 0 | 1; score: [number, number]; kills: number; deaths: number } | null,
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
    deploy: (_d: Difficulty, _chapter: string) => {},
    buyAmmo: (_k: string, _packs: number) => {},
    buyBench: (_k: string, _line: string) => {},
    continueRun: () => {},
    training: () => {},
    daily: () => {},
    tdm: () => {},
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
    /** 接下今天的风险事件（工坊里） */
    acceptRisk: () => {},
    setVolume: (_v: number) => {},
    /** 分类音量：weapons / zombies / world / ui */
    setMix: (_ch: string, _v: number) => {},
    /** 设置页「测试声音」：返回声音系统现在的状态 */
    testSound: (): string => 'none',
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
