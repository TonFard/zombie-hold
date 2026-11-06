import type { MapId } from '../world/maps';
import type { WeaponKind } from './weapons';
import type { ZombieKind } from './zombies';

/**
 * 战役：从城外一路打进市区。每一章一张地图，撑过 10 夜算通关，通关解锁下一章。
 * 难度系数叠在「普通 / 困难 / 噩梦」之上；每章的僵尸构成和地形让不同的枪各有用武之地。
 */
export interface Chapter {
  id: MapId;
  index: number;
  name: string;
  /** 地点一句话 */
  place: string;
  /** 出征前的剧情（两三句） */
  intro: string;
  /** 通关后的剧情 */
  outro: string;
  /** 僵尸生命 / 数量 / 伤害倍率 */
  hp: number;
  count: number;
  damage: number;
  /** 勋章、补给倍率 */
  medals: number;
  /** 局内零件收入倍率 */
  scrap: number;
  /** 这一章最适合的枪（出征页提示） */
  weapons: WeaponKind[];
  /** 普通僵尸构成的额外权重（在原有按夜数的分布上加） */
  mix: Partial<Record<ZombieKind, number>>;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'outpost',
    index: 1,
    name: '第一章 · 外围据点',
    place: '城郊公路边的废弃检查站',
    intro: '疫情爆发第 41 天。电台说市中心还有一座能用的信号塔。你们在城郊的检查站修好了一台发电机——先在这里活下来。',
    outro: '检查站守住了。电台里断断续续传来坐标：穿过北边的农田，往湖区走。',
    hp: 1,
    count: 1,
    damage: 1,
    scrap: 1,
    medals: 1,
    weapons: ['pistol', 'smg'],
    mix: {},
  },
  {
    id: 'farmland',
    index: 2,
    name: '第二章 · 荒野农场',
    place: '空旷的麦田和一座谷仓',
    intro: '农场视野开阔，尸群从四面八方的田埂上涌过来。远处就能看见它们——趁它们还没靠近就打倒。',
    outro: '天亮时尸群退回了林子。往东，湖边有个度假营地，营地广播还亮着灯。',
    hp: 1.15,
    count: 1.1,
    damage: 1.1,
    scrap: 1.1,
    medals: 1.3,
    weapons: ['rifle', 'sniper'],
    // 奔跑者多：开阔地上它们冲得最快，要在远处解决；麦田里爬行者也多（M17）
    mix: { runner: 0.12, crawler: 0.05 },
  },
  {
    id: 'lakeside',
    index: 3,
    name: '第三章 · 湖畔营地',
    place: '湖边的木屋和码头',
    intro: '湖挡住了一面，尸群只能从岸边几条窄路挤过来。守住路口——但肿胀者和吐酸者也爱扎堆。',
    outro: '营地的广播终于接通了市区：信号塔在中央广场，最后一段路要穿过整个城区。',
    hp: 1.3,
    count: 1.2,
    damage: 1.2,
    scrap: 1.2,
    medals: 1.6,
    weapons: ['shotgun', 'lmg'],
    // 湖畔窄路：重装感染者堵在路口（M17），要绕后或者用爆炸
    mix: { bloater: 0.06, spitter: 0.05, armored: 0.05 },
  },
  {
    id: 'city',
    index: 4,
    name: '第四章 · 市区街道',
    place: '中央广场和信号塔',
    intro: '每一条街都通向广场，每一个拐角后面都可能是一群。把信号塔的发电机守到最后一夜。',
    outro: '信号发出去了。第十一天的清晨，天边传来直升机的声音——黎明到了。',
    hp: 1.5,
    count: 1.3,
    damage: 1.3,
    scrap: 1.3,
    medals: 2,
    weapons: ['launcher', 'shotgun', 'smg'],
    mix: { breaker: 0.06, screamer: 0.03, runner: 0.05 },
  },
];

const BY_ID = Object.fromEntries(CHAPTERS.map((c) => [c.id, c])) as Partial<Record<MapId, Chapter>>;
/** 章节表；不是战役的地图（团队死斗的竞技场）按第一章的系数算 */
export const CHAPTER_BY_ID = new Proxy(BY_ID, { get: (o, k) => (o as Record<string, Chapter>)[k as string] ?? CHAPTERS[0] }) as Record<MapId, Chapter>;

/** 第几章解锁：第一章一开始就能打，之后要通关上一章（任意难度） */
export function chapterUnlocked(cleared: readonly string[], id: MapId): boolean {
  const c = CHAPTER_BY_ID[id];
  if (!c || c.index === 1) return true;
  const prev = CHAPTERS[c.index - 2];
  return !!prev && cleared.includes(prev.id);
}
