import { reactive } from 'vue';
import type { SaveData } from '../app/save';
import { defaultSave } from '../app/save';
import type { Quality } from '../render/view';

export type Screen = 'menu' | 'play' | 'pause' | 'bench' | 'cards' | 'result';

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
  scrap: number;
  time: number;
  newBest: boolean;
}

/** 界面层状态：当前在哪个界面、横幅、结算信息、存档统计 */
export const ui = reactive({
  screen: 'menu' as Screen,
  banner: { text: '', sub: '', id: 0 } as Banner,
  result: null as ResultInfo | null,
  save: defaultSave() as SaveData,
  cards: [] as string[],
  /** 游戏通过它把"开始 / 重新开始 / 回主菜单 / 继续"等动作交给应用层 */
  actions: {
    start: () => {},
    resume: () => {},
    restart: () => {},
    toMenu: () => {},
    closeBench: () => {},
    pickCard: (_id: string) => {},
    buy: (_k: string) => {},
    upgrade: (_k: string) => {},
    equip: (_k: string) => {},
    setVolume: (_v: number) => {},
    setQuality: (_q: Quality) => {},
    setSensitivity: (_s: number) => {},
  },
});

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
