import type { Replay } from '../game/stats/replay';
import { reactive } from 'vue';
import type { Difficulty } from '../game/data/difficulty';
import type { Quality } from '../game/data/quality';
import type { MedalBreakdown } from '../game/meta/progress';
import type { MetaSection } from '../game/data/meta-catalog';
import { defaultSave, type SaveData } from '../game/save/schema';

/** buy = 对战里的购买菜单：鼠标放出来点东西，但游戏不停（冻结时间照样在走） */
export type Screen = 'menu' | 'lobby' | 'play' | 'training' | 'pause' | 'bench' | 'cards' | 'result' | 'buy';

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

/** 8v8 人机难度：0 = 普通，1 = 困难，2 = 专家（game/systems/tdm.ts 的 LEVELS） */
export type TdmLevel = 0 | 1 | 2;
const TDM_LEVEL_KEY = 'zombie-hold-tdm-level';

/** 三档人机各是什么样（大厅、暂停菜单里的说明；数值在 LEVELS） */
export const TDM_LEVEL_NOTES = [
  '反应慢、很少瞄头，一半的时候想不起来找掩体；人机的子弹伤害打七五折',
  '反应比人快一点，三成的枪瞄头，换弹、挨打多半会躲，会扔雷、会翻掩体',
  '反应很快，一半的枪瞄头，几乎每次都躲着换弹，雷扔得勤；子弹伤害不打折',
] as const;

/** 对战的按键（大厅的说明、暂停菜单） */
export const TDM_KEYS: ReadonlyArray<readonly [keys: string, what: string]> = [
  ['空格', '跳（能跳上箱子、沙袋）'],
  ['C', '蹲'],
  ['1 / 2 / 3', '主武器 / 手枪 / 匕首'],
  ['Q', '换回上一把'],
  ['V', '抽刀挥一下'],
  ['左键 / 右键', '拿着刀：横挥 / 捅'],
  ['G', '扔手雷'],
  ['E', '捡脚边的枪'],
  ['B', '购买'],
  ['Tab', '计分板'],
];

/** 网址参数 / 本机存的字符串 → 难度；不是 0、1、2 就是 null */
export const asTdmLevel = (v: unknown): TdmLevel | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return n === 0 || n === 1 || n === 2 ? n : null;
};

/** 上次选的人机难度（记在这台机器上，和账号的进度无关）；没选过就是困难 */
function savedTdmLevel(): TdmLevel {
  try {
    return (typeof localStorage === 'undefined' ? null : asTdmLevel(localStorage.getItem(TDM_LEVEL_KEY))) ?? 1;
  } catch {
    return 1;
  }
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
    /** 某个型号的侧视图标（对战的购买菜单）：模型还在加载时是空串 */
    gunIcon: (_id: string): string => '',
    preview: (_w: number, _h: number): { canvas: HTMLCanvasElement; setWeapon(kind: string, tier: number): void; setGun(id: string, kind: string): void; readonly loading: boolean; resize(w: number, h: number): void; dispose(): void } | null => null,
  },
  /** 这一局每把枪涨的熟练度击杀（结算页显示） */
  masteryGain: {} as Partial<Record<string, number>>,
  /** 这一局新达成的成就（结算页显示） */
  achievements: [] as string[],
  /** 结算页显示"继续：无尽模式" */
  canEndless: false,
  /** 当前在训练场（暂停菜单换成"离开训练场"） */
  inTraining: false,
  /** 当前在 8v8 对战 */
  inTdm: false,
  /** 8v8 的人机难度：大厅里选的那一档；进了对战就是这一场用的那一档 */
  tdmLevel: savedTdmLevel(),
  /** 对战结算 */
  tdmResult: null as { winner: -1 | 0 | 1; score: [number, number]; kills: number; deaths: number; level: TdmLevel } | null,
  /** 对战的局间提示（第几局、谁赢了、换边）：id 自增让组件重播动画 */
  tdmNote: { title: '', sub: '', tone: '' as '' | 'win' | 'lose', id: 0 },
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
    /** 解锁一个枪械型号（勋章）；给一类枪选出征用的型号 */
    unlockGun: (_id: string) => {},
    pickGun: (_k: string, _id: string) => {},
    continueRun: () => {},
    training: () => {},
    daily: () => {},
    /** 开一场 8v8：level = 人机难度（0 普通 / 1 困难 / 2 专家），不给就用 ui.tdmLevel */
    tdm: (_level?: number) => {},
    /** 对战里的购买菜单：买枪、买护甲 / 手雷、关掉菜单 */
    buyGun: (_id: string) => {},
    buyGear: (_id: string) => {},
    closeBuy: () => {},
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

/** 换一档人机难度，并记在本机（下次进对战还是这一档） */
export function setTdmLevel(level: TdmLevel): void {
  ui.tdmLevel = level;
  try {
    localStorage.setItem(TDM_LEVEL_KEY, String(level));
  } catch {
    // 隐私模式 / 存储被禁用：这一次照样生效，只是下次不记得
  }
}

export function toast(text: string, warn = false): void {
  ui.toast = { text, warn, id: ui.toast.id + 1 };
}

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
