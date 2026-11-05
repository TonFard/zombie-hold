import { Ground } from './grid';
import type { Blueprint } from './modules';

/**
 * 建筑蓝图库（字符含义见 modules.ts）。门洞至少 2 格宽：大体型僵尸（肿胀者、巨像）也要能挤进去；
 * 室内走道留 2 格。改完跑 npm run sim:nav，检查连通性和卡死。
 */
export const BLUEPRINTS = {
  /** 平房：客厅 + 卧室 + 厨房，前门 + 后门 */
  house_small: {
    name: '平房',
    wall: 'brick',
    h: 2.9,
    floor: Ground.Floor,
    roof: 'flat',
    rows: [
      '###WW####WW###',
      '#w...|.....bh#',
      '#....|.....b.#',
      'W....d.......W',
      '#....d....tt.#',
      '#s...|.......#',
      '#s...|||dd||||',
      '#............#',
      '#v.......k.of#',
      '###DD###WW####',
    ],
  },

  /** 两居室：走廊贯穿，两侧房间，侧门 */
  house_long: {
    name: '长屋',
    wall: 'plaster',
    h: 2.9,
    floor: Ground.Floor,
    roof: 'flat',
    rows: [
      '##WW####WW####WW###',
      '#b..|.......|ee...#',
      '#b..|.......|.....#',
      '#...|.......|....c#',
      '##dd####dd#####dd##',
      '#..................D',
      '#ss.......tt.......D',
      '#.....c..........hh#',
      '##WW###DD######WW###',
    ],
  },

  /** 便利店：大开间货架，后面库房 */
  shop: {
    name: '便利店',
    wall: 'plaster',
    h: 3.1,
    floor: Ground.Concrete,
    roof: 'flat',
    rows: [
      '#WWWW##DD##WWWW#',
      '#..............#',
      '#.rr..rr..rr...#',
      '#..............#',
      '#.rr..rr..rr..e#',
      '#.............e#',
      '######dd########',
      '#xx.......xxPP.#',
      '#xx............#',
      '########DD######',
    ],
  },

  /** 仓库：铁皮大开间，两个卷帘门 */
  warehouse: {
    name: '仓库',
    wall: 'metal',
    h: 4.2,
    floor: Ground.Floor,
    roof: 'flat',
    rows: [
      '######DDD#######',
      '#rr.........rr.#',
      '#..............#',
      '#xx..PP...xx...D',
      '#xx..PP...xx...D',
      '#..............#',
      '#rr..rr.....rr.#',
      '#########DDD####',
    ],
  },

  /** 废墟：塌了半边的砖房，没有屋顶 */
  ruin: {
    name: '废墟',
    wall: 'brick',
    h: 2.6,
    floor: Ground.Dirt,
    roof: 'none',
    rows: [
      '##W##,,##',
      '#...,,,.#',
      '#.x.,,,.W',
      ',,,,,,..#',
      '#..B.....',
      '##W##,,##',
    ],
  },
} satisfies Record<string, Blueprint>;

export type BlueprintId = keyof typeof BLUEPRINTS;
