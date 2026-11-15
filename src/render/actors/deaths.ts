import { Euler, Quaternion, Vector3, type BufferGeometry, type Matrix4 } from 'three';
import type { ZombieKind } from '../../game/data/zombies';
import { B, type RigActor } from './rig';

/**
 * 程序僵尸的死法。以前只有一种（整个人往后直挺挺倒下），现在按「怎么被打死的」挑一种：
 *
 *   back    仰面倒下：胸口挨了一下，双臂甩起来，往后摔在背上
 *   plank   爆头：头往后一甩，身子僵住半拍，像根木头一样直直往后倒
 *   front   往前扑倒：从背后挨的，伸手去撑没撑住，脸朝下趴在地上
 *   knees   跪倒：腿一软先跪下，跪着晃一下，再往前栽
 *   spin    拧着倒：被打得转了大半圈，背对着开枪的人趴下去
 *   crumple 瘫倒：两腿一折原地蹲下去，再歪到一边蜷着
 *   side    侧倒：像棵树一样往旁边倒
 *   blast   炸飞（仰面）：整个人离地飞出去，摔在背上再滑一截
 *   blastF  炸飞（趴着）：从背后炸的，往前飞出去趴在地上
 *   dive    往前栽：跑着 / 跳在半空的时候死的，惯性带着往前扑出去滑一截
 *   crawl   爬行者：胳膊一软趴下，歪过去半边
 *
 * 整个身体绕着髋转（骨盆骨），四肢各自有姿势；离地多高不用手调——每帧找身上最低的点，让它正好挨着地。
 * 动作都是按「往右倒 / 往左转」写的，另一半的僵尸左右镜像。
 */

export type DeathKind = 'back' | 'plank' | 'front' | 'knees' | 'spin' | 'crumple' | 'side' | 'blast' | 'blastF' | 'dive' | 'crawl';
export const DEATH_KINDS: DeathKind[] = ['back', 'plank', 'front', 'knees', 'spin', 'crumple', 'side', 'blast', 'blastF', 'dive', 'crawl'];

/**
 * 一帧姿势里的量（弧度 / 米）。
 * pitch / twist / roll / spin：整个身体绕髋——前俯（正 = 脸朝下）、原地转向（正 = 往左转）、侧倒（正 = 往右倒）、绕身体长轴翻（最先转）；
 * c* 胸、h* 头（x 正 = 低头，z 正 = 往右歪）；
 * al* / ar* 左右上臂：x 负 = 往前抬（-π = 举过头），z 左臂正 / 右臂负 = 往外张，y = 绕胳膊自己拧——
 *   拧了以后肘往哪边弯跟着变：左臂 y = +π/2 时，张开的胳膊小臂往头那边弯（举手投降），垂着的胳膊小臂往外摆；-π/2 反过来。右臂符号相反；
 * el / er 肘（负 = 弯）；
 * ll* / lr* 左右大腿：x 负 = 往前抬，z 同胳膊，y = 绕腿自己拧（左腿正 / 右腿负 = 脚尖朝外）；kl / kr 膝（正 = 弯）；
 * lift：离地多高（米）；lying：0 = 靠脚 / 膝 / 手撑着，1 = 躺平了（手脚不再把身体垫起来）
 */
const FIELDS = ['pitch', 'twist', 'roll', 'spin', 'cx', 'cy', 'cz', 'hx', 'hy', 'hz', 'alx', 'aly', 'alz', 'arx', 'ary', 'arz', 'el', 'er', 'llx', 'lly', 'llz', 'lrx', 'lry', 'lrz', 'kl', 'kr', 'lift', 'lying'] as const;
type Field = (typeof FIELDS)[number];
/** in = 越来越快（往下掉），out = 越来越慢（滑、收），io = 两头慢，lin = 匀速 */
type Ease = 'in' | 'out' | 'io' | 'lin';
type Key = readonly [number, Ease, Partial<Record<Field, number>>];

const HALF = Math.PI / 2;

/**
 * 每种死法的关键帧：[时间（秒，标准体型）, 这一段的快慢, 这一帧要到位的量]。
 * 一个量在哪一帧写了，就在「上一帧 → 这一帧」这段时间里动过去；没写的量停在上一次写的值
 */
const KEYS: Record<DeathKind, Key[]> = {
  back: [
    [0.1, 'out', { pitch: -0.22, cx: -0.3, hx: -0.45, alx: -0.7, alz: 0.45, el: -0.5, arx: -0.55, arz: -0.5, er: -0.4, llx: -0.15, kl: 0.3, kr: 0.12 }],
    [0.34, 'io', { pitch: -0.5, alx: -1.7, alz: 0.9, el: -0.3, arx: -1.5, arz: -0.8, er: -0.3, llx: -0.35, kl: 0.5, lrx: -0.1, kr: 0.3 }],
    [0.6, 'in', { pitch: -HALF, cx: -0.08, hx: -0.25, llx: -0.45, kl: 0.3, lrx: -0.5, kr: 0.45 }],
    [0.67, 'out', { lift: 0.05, lying: 1, llx: -0.6, lrx: -0.75, kr: 0.7, alx: -1.2, arx: -1.0 }],
    [0.78, 'in', { lift: 0 }],
    [1.02, 'io', { cx: 0, hx: -0.08, hy: 0.6, hz: 0.1, alx: 0.25, alz: 1.35, aly: 1.4, el: -1.1, arx: 0.3, arz: -0.5, ary: -1.3, er: -0.7, llx: -0.03, llz: 0.22, lly: 0.5, kl: 0.05, lrx: -0.15, lrz: -0.6, lry: -1.5, kr: 1.1 }],
  ],
  plank: [
    [0.07, 'out', { hx: -0.8, cx: -0.22, pitch: -0.07, alx: -0.9, alz: 0.4, el: -0.6, arx: -1.0, arz: -0.4, er: -0.5 }],
    [0.26, 'io', { pitch: -0.16, hx: -0.5, alx: -0.3, alz: 0.3, el: -0.15, arx: -0.35, arz: -0.3, er: -0.15 }],
    [0.72, 'in', { pitch: -HALF, cx: -0.05, hx: -0.3 }],
    [0.79, 'out', { lift: 0.06, lying: 1, llx: -0.3, lrx: -0.35, alx: -0.5, arx: -0.6, alz: 0.7, arz: -0.75 }],
    [0.9, 'in', { lift: 0 }],
    [1.08, 'io', { cx: 0, hx: -0.1, hz: -0.25, alx: 0.25, alz: 0.55, aly: 0.6, el: -0.3, arx: 0.25, arz: -0.7, ary: -0.9, er: -0.45, llx: -0.03, llz: 0.16, lly: 0.45, lrx: -0.05, lrz: -0.14, lry: -0.6 }],
  ],
  front: [
    [0.12, 'out', { pitch: 0.2, cx: 0.3, hx: -0.35, alx: -0.5, alz: 0.3, arx: -0.7, arz: -0.3, llx: -0.3, kl: 0.5 }],
    [0.34, 'io', { pitch: 0.5, cx: 0.4, alx: -1.5, el: -0.5, arx: -1.3, er: -0.6, llx: -0.5, kl: 0.9, lrx: 0.15, kr: 0.5 }],
    [0.6, 'in', { pitch: 1.5, cx: 0.05, hx: -0.3, alx: -2.6, alz: 0.5, el: -0.6, arx: -2.4, arz: -0.6, er: -0.8, llx: 0.1, kl: 0.5, lrx: 0.1, kr: 0.7 }],
    [0.68, 'out', { lift: 0.04, lying: 1, kl: 0.8, kr: 1.0, hx: -0.5, alx: -2.95, arx: -2.9 }],
    [0.78, 'in', { lift: 0 }],
    [1.02, 'io', { pitch: HALF, cx: 0, hx: -0.1, hy: 0.9, alx: -3.0, alz: 0.55, aly: -1.4, el: -0.9, arx: -3.0, arz: -0.9, ary: 1.4, er: -0.5, llx: 0, llz: 0.25, lly: 1.1, kl: 0.15, lrx: 0, lrz: -0.55, lry: -1.3, kr: 0.9 }],
  ],
  knees: [
    [0.1, 'out', { cx: 0.12, hx: 0.25, alx: 0.05, arx: 0.05, kl: 0.25, kr: 0.2 }],
    [0.3, 'in', { kl: 1.95, kr: 1.85, llx: -0.12, lrx: -0.05, cx: 0.3, hx: 0.45, pitch: 0.04, alz: 0.12, arz: -0.12, el: -0.1, er: -0.1 }],
    [0.37, 'out', { cx: 0.45, hx: 0.6 }],
    [0.66, 'io', { pitch: 0.1, cx: 0.5, roll: 0.06, alx: 0.1, arx: 0.12 }],
    [1.04, 'in', { pitch: 1.5, roll: 0, kl: 0.4, kr: 0.3, llx: 0, lrx: 0, cx: 0.1, hx: -0.2, alx: 0.4, arx: 0.35 }],
    [1.11, 'out', { lift: 0.035, lying: 1, kl: 0.7, kr: 0.55 }],
    [1.2, 'in', { lift: 0 }],
    [1.38, 'io', { pitch: HALF, cx: 0, hx: -0.1, hy: -0.95, alx: 0.05, alz: 0.22, aly: 0.4, el: -0.15, arx: 0.05, arz: -0.7, ary: -1.3, er: -0.9, llz: 0.15, lly: 1.0, kl: 0.15, lrz: -0.2, lry: -1.1, kr: 0.3 }],
  ],
  spin: [
    [0.09, 'out', { twist: 0.35, cy: 0.5, cx: -0.15, hx: -0.3, hy: 0.3, alx: 0.7, alz: 0.5, arx: -0.4, arz: -0.4 }],
    [0.38, 'io', { twist: 1.9, pitch: 0.12, roll: -0.12, cy: 0.25, cx: 0.1, llx: -0.3, kl: 0.5, lrx: 0.3, kr: 0.4, alx: 0.2, alz: 0.9, el: -0.3, arx: -0.7, arz: -1.0, er: -0.4 }],
    [0.7, 'in', { pitch: 1.5, twist: 2.7, roll: 0, cy: 0, cx: 0.05, hx: -0.3, hy: 0, arx: -2.7, arz: -0.6, er: -0.7, alx: 0.3, alz: 0.5, llx: 0.1, kl: 0.4, lrx: 0.15, kr: 0.8 }],
    [0.77, 'out', { lift: 0.04, lying: 1, kr: 1.1, kl: 0.6, arx: -2.95 }],
    [0.87, 'in', { lift: 0 }],
    [1.08, 'io', { pitch: HALF, hx: -0.1, hy: -0.8, arx: -3.0, arz: -0.8, ary: 1.4, er: -1.1, alx: 0.05, alz: 0.45, aly: 1.3, el: -0.4, llx: 0, llz: 0.2, lly: 1.0, kl: 0.12, lrx: 0, lrz: -0.6, lry: -1.3, kr: 1.0 }],
  ],
  crumple: [
    [0.12, 'out', { cx: 0.2, hx: 0.3, kl: 0.5, kr: 0.4, llx: -0.3, lrx: -0.25 }],
    [0.36, 'in', { llx: -1.25, kl: 2.3, lrx: -1.0, kr: 2.1, cx: 0.55, hx: 0.5, pitch: -0.12, alx: 0.1, arx: 0.1, alz: 0.15, arz: -0.15 }],
    [0.46, 'out', { cx: 0.7, hx: 0.6, roll: 0.12 }],
    [0.86, 'in', { roll: 1.5, llx: -1.0, kl: 1.5, lrx: -0.7, kr: 1.25, cx: 0.4, hx: 0.3, hz: 0.3, alx: -0.7, alz: 0.1, el: -0.7, arx: -0.9, arz: 0.12, er: -0.4 }],
    [0.93, 'out', { lift: 0.03, lying: 1 }],
    [1.02, 'in', { lift: 0 }],
    [1.16, 'io', { roll: HALF, llz: -0.2, hz: 0.4 }],
  ],
  side: [
    [0.1, 'out', { roll: 0.14, cz: -0.2, hz: -0.3, alz: 1.1, alx: -0.3, arz: -0.3, kr: 0.3 }],
    [0.36, 'io', { roll: 0.45, cz: 0.1, alz: 1.6, lrx: -0.3, kr: 0.6, llx: 0.15, kl: 0.2 }],
    [0.64, 'in', { roll: 1.5, pitch: 0.08, hz: 0.1, alz: 1.2, arx: -0.7, arz: 0.15, er: -0.4, lrx: -0.2, kr: 0.4 }],
    [0.71, 'out', { lift: 0.04, lying: 1, llz: 0.5, kl: 0.5, hz: 0.4 }],
    [0.82, 'in', { lift: 0 }],
    [1.04, 'io', { roll: HALF, pitch: 0.15, cz: 0, hz: 0.35, alx: -0.6, alz: 0.1, el: -0.6, arx: -0.9, arz: 0.1, er: -0.5, llx: -0.75, llz: -0.25, kl: 0.9, lrx: -0.1, kr: 0.3 }],
  ],
  blast: [
    [0.3, 'out', { lift: 0.55, pitch: -1.15, twist: 0.4, cx: -0.3, hx: -0.5, alx: -1.6, alz: 1.3, el: -0.3, arx: -1.4, arz: -1.2, er: -0.4, llx: -0.7, llz: 0.35, kl: 0.4, lrx: -0.45, lrz: -0.3, kr: 0.6 }],
    [0.55, 'in', { lift: 0, pitch: -HALF, twist: 0.7, cx: -0.1, hx: -0.3 }],
    [0.63, 'out', { lift: 0.1, lying: 1, llx: -0.95, kl: 0.6, lrx: -0.85, kr: 0.8, alx: -1.2, arx: -1.0 }],
    [0.78, 'in', { lift: 0 }],
    [1.1, 'io', { cx: 0, hx: -0.1, hy: 0.6, alx: 0.2, alz: 1.5, aly: 1.3, el: -0.9, arx: 0.25, arz: -1.2, ary: -1.5, er: -0.5, llx: -0.03, llz: 0.4, lly: 0.5, kl: 0.05, lrx: -0.15, lrz: -0.55, lry: -1.5, kr: 0.95 }],
  ],
  blastF: [
    [0.3, 'out', { lift: 0.5, pitch: 1.1, twist: -0.3, cx: 0.15, hx: -0.5, alx: -2.2, alz: 0.7, el: -0.3, arx: -2.4, arz: -0.8, er: -0.4, llx: 0.35, llz: 0.3, kl: 0.6, lrx: 0.5, lrz: -0.3, kr: 0.35 }],
    [0.55, 'in', { lift: 0, pitch: 1.52, twist: -0.5, cx: 0.05, alx: -2.7, arx: -2.8 }],
    [0.63, 'out', { lift: 0.07, lying: 1, kl: 0.9, kr: 0.6, hx: -0.6, alx: -2.95, arx: -2.95 }],
    [0.78, 'in', { lift: 0 }],
    [1.1, 'io', { pitch: HALF, cx: 0, hx: -0.15, hy: -0.8, alx: -3.0, alz: 0.9, aly: -1.4, el: -0.6, arx: -3.0, arz: -0.5, ary: 1.4, er: -1.1, llx: 0, llz: 0.45, lly: 1.0, kl: 0.12, lrx: 0, lrz: -0.3, lry: -1.3, kr: 0.75 }],
  ],
  dive: [
    [0.1, 'out', { pitch: 0.3, cx: 0.25, hx: -0.4, alx: -1.3, arx: -1.0, llx: -0.6, kl: 0.8, lrx: 0.4, kr: 0.3 }],
    [0.42, 'in', { pitch: 1.5, cx: 0.05, alx: -2.7, alz: 0.4, el: -0.4, arx: -2.5, arz: -0.5, er: -0.6, llx: 0.1, kl: 0.4, lrx: 0.2, kr: 0.9 }],
    [0.5, 'out', { lift: 0.06, lying: 1, kr: 1.2, kl: 0.7, alx: -2.95, arx: -2.9 }],
    [0.6, 'in', { lift: 0 }],
    [1.05, 'out', { pitch: HALF, hx: -0.15, hy: 0.85, alx: -3.1, alz: 0.4, aly: -1.4, el: -0.5, arx: -3.08, arz: -0.75, ary: 1.4, er: -0.9, llx: 0, llz: 0.2, lly: 1.0, kl: 0.1, lrx: 0, lrz: -0.35, lry: -1.2, kr: 0.45 }],
  ],
  crawl: [
    [0.14, 'out', { pitch: 1.0, cx: 0.45, hx: -0.6, alx: -2.6, alz: 0.4, el: -0.5, arx: -2.5, arz: -0.4, er: -0.6, llx: 0.4, kl: 0.7, lrx: 0.5, kr: 0.6 }],
    [0.4, 'in', { pitch: 1.5, cx: 0.05, hx: -0.2, alx: -2.9, alz: 0.6, arx: -2.9, arz: -0.5, llx: 0.05, kl: 0.3, lrx: 0.05, kr: 0.5 }],
    [0.47, 'out', { lift: 0.02, lying: 1 }],
    [0.55, 'in', { lift: 0 }],
    [0.95, 'io', { pitch: HALF, spin: 0.3, hx: -0.1, hy: 0.8, alx: -3.0, alz: 0.7, aly: -1.4, el: -0.9, arx: -3.0, arz: -0.4, ary: 1.4, er: -0.3, llx: 0, llz: 0.15, lly: 1.0, kl: 0.1, lrx: 0, lrz: -0.4, lry: -1.3, kr: 0.6 }],
  ],
};

/** 身体（髋）挪到总距离的几成：[时间, 几成, 这一段的快慢]。倒下的跟着倒的节奏走，飞出去的先匀速飞、落地以后滑着停 */
const TRAVEL: Record<DeathKind, ReadonlyArray<readonly [number, number, Ease]>> = {
  back: [[0.1, 0.12, 'out'], [0.6, 1, 'io']],
  plank: [[0.26, 0.08, 'io'], [0.72, 1, 'in']],
  front: [[0.12, 0.12, 'out'], [0.6, 1, 'io']],
  knees: [[0.3, 0.4, 'io'], [0.66, 0.42, 'io'], [1.04, 1, 'in']],
  spin: [[0.7, 1, 'io']],
  crumple: [[0.36, 0.25, 'io'], [0.46, 0.3, 'out'], [0.86, 1, 'io']],
  side: [[0.1, 0.1, 'out'], [0.64, 1, 'in']],
  blast: [[0.55, 0.8, 'lin'], [1.05, 1, 'out']],
  blastF: [[0.55, 0.8, 'lin'], [1.05, 1, 'out']],
  dive: [[0.42, 0.6, 'lin'], [1.05, 1, 'out']],
  crawl: [[0.4, 1, 'out']],
};

interface Track {
  t: number[];
  v: number[];
  e: Ease[];
}
interface Clip {
  tracks: Track[];
  travel: Track;
  /** 最后一段（摆成躺定的姿势）从什么时候开始 */
  settle: number;
  /** 最后一个关键帧的时间 */
  end: number;
}
const clips = new Map<DeathKind, Clip>();

function clipOf(kind: DeathKind): Clip {
  let c = clips.get(kind);
  if (!c) {
    const keys = KEYS[kind];
    const tracks = FIELDS.map((f) => {
      const tr: Track = { t: [0], v: [0], e: ['io'] };
      let prev = 0;
      for (const [t, e, vals] of keys) {
        const v = vals[f];
        if (v !== undefined) {
          // 上一次写它是更早的事：先原地停到上一帧，再在这一段里动过去
          const n = tr.t.length - 1;
          if ((tr.t[n] as number) < prev) {
            tr.t.push(prev);
            tr.v.push(tr.v[n] as number);
            tr.e.push('lin');
          }
          tr.t.push(t);
          tr.v.push(v);
          tr.e.push(e);
        }
        prev = t;
      }
      return tr;
    });
    const travel: Track = { t: [0], v: [0], e: ['io'] };
    for (const [t, v, e] of TRAVEL[kind]) {
      travel.t.push(t);
      travel.v.push(v);
      travel.e.push(e);
    }
    c = { tracks, travel, settle: (keys[keys.length - 2] as Key)[0], end: (keys[keys.length - 1] as Key)[0] };
    clips.set(kind, c);
  }
  return c;
}

function sample(tr: Track, t: number): number {
  const n = tr.t.length;
  if (n === 1 || t <= 0) return tr.v[0] as number;
  if (t >= (tr.t[n - 1] as number)) return tr.v[n - 1] as number;
  let i = 1;
  while ((tr.t[i] as number) < t) i++;
  const t0 = tr.t[i - 1] as number;
  const u = (t - t0) / ((tr.t[i] as number) - t0);
  const e = tr.e[i] as Ease;
  const k = e === 'in' ? u * u : e === 'out' ? 1 - (1 - u) * (1 - u) : e === 'lin' ? u : u * u * (3 - 2 * u);
  const a = tr.v[i - 1] as number;
  return a + ((tr.v[i] as number) - a) * k;
}

/** 身上的一个点（骨头自己的坐标）：贴地的时候拿它算身体离地多高 */
interface Sample {
  bone: number;
  p: Vector3;
  /** 躯干和头：躺平以后身体的高度只看这些（四肢另外一条一条搭到地上，不把身体垫起来） */
  core: boolean;
}

/** 26 个方向（轴、棱、角）：每根骨头在每个方向上最靠外的那个顶点就是它的「支撑点」 */
const DIRS: Vector3[] = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) DIRS.push(new Vector3(x, y, z).normalize());
const CORE = new Set<number>([B.pelvis, B.chest, B.head]);
/** 上臂 / 大腿紧挨着肩 / 髋的那一圈（肩头、胯）也跟着躯干算 */
const UPPER = new Set<number>([B.armUL, B.armUR, B.legUL, B.legUR]);
const supports = new WeakMap<BufferGeometry, Sample[]>();
const _v = new Vector3();

/**
 * 一个蒙皮网格的支撑点：每个顶点算到权重最大的那根骨头上，换到骨头自己的坐标，每根骨头每个方向留最靠外的一个。
 * 盾、锤子、大肚子、背上的瘤都在网格里，自动算进去；同一个模型只算一次
 */
function buildSupports(geo: BufferGeometry, inv: Matrix4[]): Sample[] {
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const nd = DIRS.length;
  const best = new Float32Array(inv.length * nd).fill(-Infinity);
  const pts = new Float32Array(inv.length * nd * 3);
  for (let i = 0; i < pos.count; i++) {
    let b = 0;
    let w = -1;
    for (let k = 0; k < 4; k++) {
      const wk = sw.getComponent(i, k);
      if (wk > w) {
        w = wk;
        b = si.getComponent(i, k);
      }
    }
    _v.fromBufferAttribute(pos, i).applyMatrix4(inv[b] as Matrix4);
    for (let k = 0; k < nd; k++) {
      const dot = _v.dot(DIRS[k] as Vector3);
      const j = b * nd + k;
      if (dot > (best[j] as number)) {
        best[j] = dot;
        pts[j * 3] = _v.x;
        pts[j * 3 + 1] = _v.y;
        pts[j * 3 + 2] = _v.z;
      }
    }
  }
  const out: Sample[] = [];
  for (let b = 0; b < inv.length; b++) {
    const first = out.length;
    for (let k = 0; k < nd; k++) {
      const j = b * nd + k;
      if ((best[j] as number) === -Infinity) continue;
      const x = pts[j * 3] as number;
      const y = pts[j * 3 + 1] as number;
      const z = pts[j * 3 + 2] as number;
      let dup = false;
      for (let q = first; q < out.length && !dup; q++) {
        const o = (out[q] as Sample).p;
        dup = o.x === x && o.y === y && o.z === z;
      }
      if (!dup) out.push({ bone: b, p: new Vector3(x, y, z), core: CORE.has(b) || (UPPER.has(b) && Math.hypot(x, y, z) < 0.17) });
    }
  }
  return out;
}

/** 一条胳膊 / 一条腿：最上面那根骨头，和整条肢体上的支撑点（手里拿的东西也算） */
interface Limb {
  upper: number;
  samples: Sample[];
}
const LIMBS: ReadonlyArray<readonly number[]> = [
  [B.armUL, B.armLL, B.propL],
  [B.armUR, B.armLR, B.propR],
  [B.legUL, B.legLL],
  [B.legUR, B.legLR],
];

function samplesOf(a: RigActor): Sample[] {
  const out: Sample[] = [];
  for (const m of a.meshes) {
    let list = supports.get(m.geometry);
    if (!list) {
      list = buildSupports(m.geometry, a.skeleton.boneInverses);
      supports.set(m.geometry, list);
    }
    for (const sm of list) out.push(sm);
  }
  return out;
}

export interface DeathState {
  kind: DeathKind;
  /** 1 = 按写的来（往右倒），-1 = 左右镜像 */
  sd: 1 | -1;
  /** 动作放慢多少倍（越大越慢） */
  stretch: number;
  x: number;
  z: number;
  yaw: number;
  /** 身体往哪挪（世界方向）、一共挪多远（米） */
  dx: number;
  dz: number;
  dist: number;
  /** 倒的过程里顺带转过去的角度：同一种死法的尸体不会全朝一个方向躺 */
  turn: number;
  /** 死的时候离地多高、落到地上要多久 */
  air: number;
  airT: number;
  /** 死的那一刻每根骨头的朝向：开头一小段从它过渡过去，不会「啪」地跳一下 */
  from: Quaternion[];
  fromPelvisY: number;
  /** 死的那一刻实际高度和「贴地算出来的高度」差多少（同样是为了不跳） */
  bias: number;
  samples: Sample[];
  limbs: Limb[];
  /** 模型放大了多少倍（离地高度跟着放大） */
  scale: number;
  done: boolean;
  restY: number;
}

export interface DeathInput {
  kind: ZombieKind;
  seed: number;
  head: boolean;
  x: number;
  z: number;
  yaw: number;
  /** 离地多高（跳在半空的跳跃者） */
  air: number;
  /** 打死它的那一下的击退（世界坐标，米 / 秒）和它当时的速度 */
  kbx: number;
  kbz: number;
  vx: number;
  vz: number;
  /** 从 (x, z) 沿 (dx, dz) 最多能挪多远不撞墙（不给 = 不管墙） */
  room?: (dx: number, dz: number, want: number) => number;
  /** 指定死法（检查图用） */
  force?: DeathKind;
}

interface Plan {
  kind: DeathKind;
  sd: 1 | -1;
  /** 髋往哪挪（世界方向）、挪多远（米） */
  dx: number;
  dz: number;
  dist: number;
  /** 上半身最后倒向哪边（世界方向）、从髋伸出去多长（米） */
  hx: number;
  hz: number;
  reach: number;
}

/** 块头大的倒得慢 */
const HEAVY: Partial<Record<ZombieKind, number>> = { bloater: 1.25, breaker: 1.2, armored: 1.2, splitter: 1.1, colossus: 1.3, brood: 1.35, reaper: 1.15, siren: 1.1 };
const frac = (x: number): number => x - Math.floor(x);
const rnd = (seed: number, k: number): number => frac(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453);

function choose(r: number, list: ReadonlyArray<readonly [DeathKind, number]>): DeathKind {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let x = r * sum;
  for (const [k, w] of list) {
    x -= w;
    if (x < 0) return k;
  }
  return (list[0] as readonly [DeathKind, number])[0];
}

/**
 * 挑死法。pushF / pushS：打死它的那一下在它自己的坐标里是往哪推的（F 正 = 从背后打的、往前推；S 正 = 往它左边推），
 * knock = 推得多猛，speed = 它当时跑多快
 */
function pick(o: DeathInput, pushF: number, pushS: number, knock: number, speed: number, big: boolean): DeathKind {
  const k = o.kind;
  const r = rnd(o.seed, 1);
  if (k === 'crawler') return 'crawl';
  if (o.air > 0.12) return 'dive';
  // 挺着大肚子的趴不下去；举盾的往前倒会把盾压进地里
  if (k === 'bloater' || k === 'brood') return choose(r, [['back', 3], ['side', 2]]);
  if (k === 'breaker') return choose(r, [['back', 3], ['side', 2]]);
  if (k === 'colossus') return choose(r, [['knees', 3], ['back', 2]]);
  // 挨了一下狠的（爆炸、霰弹贴脸、大口径）：整个人飞出去
  if (!big && knock >= 2.6) return pushF > 0.3 ? 'blastF' : 'blast';
  // 跑得正快：惯性带着往前栽
  if (speed >= 2.0 && rnd(o.seed, 2) < 0.55) return 'dive';
  if (o.head) return choose(r, [['plank', 3], ['knees', 2], ['crumple', 2], ['spin', 1], ['back', 1]]);
  if (pushF > 0.45) return choose(r, [['front', 4], ['knees', 2], ['crumple', 1]]);
  if (Math.abs(pushS) > 0.75) return choose(r, [['side', 3], ['spin', 2], ['crumple', 1]]);
  // 没有冲击（烧死、地刺）：腿一软
  if (knock < 0.3) return choose(r, [['crumple', 3], ['knees', 3], ['back', 1], ['side', 1], ['front', 1]]);
  return choose(r, [['back', 3], ['spin', 2], ['knees', 2], ['crumple', 2], ['side', 1], ['front', 1]]);
}

const _e = new Euler();
const _q = new Quaternion();
const _spin = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** 把身上最低的点放到地面上，群组该在多高。lying：0 = 所有的点都算，1 = 只算躯干和头 */
function groundY(a: RigActor, d: DeathState, lying: number): number {
  const g = a.group;
  g.position.y = 0;
  g.updateMatrixWorld(true);
  let all = Infinity;
  let core = Infinity;
  for (const s of d.samples) {
    const y = _v.copy(s.p).applyMatrix4(a.bone(s.bone).matrixWorld).y;
    if (y < all) all = y;
    if (s.core && y < core) core = y;
  }
  return -(all + (core - all) * lying);
}

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

const _j = new Vector3();
const _ax = new Vector3();
const _pq = new Quaternion();
const _rq = new Quaternion();

/**
 * 躺下以后把四肢一条一条搭到地上：整条肢体绕肩 / 髋转一点，让它最低的那个点正好挨着地。
 * up = 插进地里的往上抬多少（0–1），down = 悬着的往下放多少（0–1）。
 * 身子厚薄、肚子大小、手里拿没拿东西（锤子、镰刀、长爪子）各种僵尸都不一样，靠这一步不用一种一种调
 */
function settle(a: RigActor, d: DeathState, up: number, down: number): void {
  if (up <= 0 && down <= 0) return;
  const near = (0.15 * d.scale) ** 2;
  for (const lb of d.limbs) {
    const bone = a.bone(lb.upper);
    let total = 0;
    for (let it = 0; it < 3; it++) {
      bone.updateWorldMatrix(false, true);
      _j.setFromMatrixPosition(bone.matrixWorld);
      // 整条肢体上最低的点（紧挨着肩 / 髋的不算：那是躯干着地的地方）
      let low = Infinity;
      let lx = 0;
      let lz = 0;
      for (const sm of lb.samples) {
        _v.copy(sm.p).applyMatrix4(a.bone(sm.bone).matrixWorld);
        const rx = _v.x - _j.x;
        const rz = _v.z - _j.z;
        if (rx * rx + rz * rz < near) continue;
        if (_v.y < low) {
          low = _v.y;
          lx = rx;
          lz = rz;
        }
      }
      if (low === Infinity) break;
      const dy = -low * (low < 0 ? up : down);
      if (Math.abs(dy) < 0.003 * d.scale) break;
      const len = Math.hypot(lx, lz);
      // 绕水平轴（肢体方向 × 上）转 ang：最低点升 ang × len。往上抬最多 0.9 弧度，往下放最多 0.6
      const ang = Math.min(0.9 - total, Math.max(-0.6 - total, dy / len));
      if (ang === 0) break;
      total += ang;
      _ax.set(lx / len, 0, lz / len).cross(UP);
      (bone.parent as typeof bone).getWorldQuaternion(_pq);
      _rq.setFromAxisAngle(_ax, ang);
      // 世界里转 → 换到父骨头的坐标里
      bone.quaternion.premultiply(_q.copy(_pq).invert().multiply(_rq).multiply(_pq));
    }
  }
}

/** 蒙皮骨头里参与姿势的那些（手上的挂点不动） */
const POSED = [B.pelvis, B.chest, B.head, B.armUL, B.armLL, B.armUR, B.armLR, B.legUL, B.legLL, B.legUR, B.legLR];
/** 上臂、大腿 */
const TWISTED = [B.armUL, B.armUR, B.legUL, B.legUR];

/** 僵尸刚死：定下死法、往哪倒、挪多远，记下这一刻的姿势 */
export function startDeath(a: RigActor, o: DeathInput): DeathState {
  const sin = Math.sin(o.yaw);
  const cos = Math.cos(o.yaw);
  const knock = Math.hypot(o.kbx, o.kbz);
  // 它自己的坐标：前 = (sin, cos)，左 = (cos, -sin)
  let pushF = -1;
  let pushS = 0;
  if (knock > 0.05) {
    pushF = (o.kbx * sin + o.kbz * cos) / knock;
    pushS = (o.kbx * cos - o.kbz * sin) / knock;
  }
  const speed = Math.hypot(o.vx, o.vz);
  const scale = a.group.scale.x;
  let kind = o.force ?? pick(o, pushF, pushS, knock, speed, scale > 1.5);

  // 往哪边倒：侧倒 / 瘫倒顺着推的方向；看不出左右的时候随机
  let sd: 1 | -1 = rnd(o.seed, 3) < 0.5 ? 1 : -1;
  if (Math.abs(pushS) > 0.3 && knock > 0.3 && (kind === 'side' || kind === 'crumple')) sd = pushS > 0 ? -1 : 1;

  const heavy = HEAVY[o.kind] ?? 1;
  const pushed = knock > 0.3;
  /**
   * 这种死法身体（髋）往哪挪、挪多远，上半身最后倒向哪边、伸出去多长——
   * 都先在它自己的坐标里想（F = 前，S = 左），再换成世界方向
   */
  const plan = (k: DeathKind, side: 1 | -1): Plan => {
    let mF = -1;
    let mS = 0;
    let dist = 0.4;
    let hF = -1;
    let hS = 0;
    let reach = 0.95;
    switch (k) {
      case 'back':
      case 'plank':
        if (pushed && pushF < 0) {
          mF = pushF;
          mS = pushS;
        }
        dist = k === 'plank' ? 0.55 : 0.4 + Math.min(0.5, knock * 0.15);
        break;
      case 'spin':
        if (pushed && pushF < 0) {
          mF = pushF;
          mS = pushS;
        }
        dist = 0.4 + Math.min(0.5, knock * 0.15);
        // 转了 2.7 弧度再往前趴：头朝的是原来的斜后方
        hF = Math.cos(2.7);
        hS = side * Math.sin(2.7);
        break;
      case 'front':
        mF = hF = 1;
        dist = 0.6;
        break;
      case 'knees':
        mF = hF = 1;
        dist = 0.75;
        break;
      case 'side':
        mF = hF = 0;
        mS = hS = -side;
        dist = 0.5;
        break;
      case 'crumple':
        mF = -0.32;
        mS = -side * 0.95;
        dist = 0.32;
        hF = 0;
        hS = -side;
        reach = 0.6;
        break;
      case 'blast':
        mF = pushF;
        mS = pushS;
        dist = Math.min(2.6, Math.max(1.0, knock * 0.4));
        break;
      case 'blastF':
        mF = pushF;
        mS = pushS;
        dist = Math.min(2.6, Math.max(1.0, knock * 0.4));
        hF = 1;
        break;
      case 'dive':
        mF = hF = 1;
        if (speed > 0.5) {
          mF = (o.vx * sin + o.vz * cos) / speed;
          mS = (o.vx * cos - o.vz * sin) / speed;
        }
        dist = Math.min(2.4, Math.max(0.7, 0.5 + speed * 0.4)) + (o.air > 0.12 ? 0.5 : 0);
        break;
      case 'crawl':
        mF = hF = 1;
        dist = 0.15;
        break;
    }
    const ml = Math.hypot(mF, mS) || 1;
    return {
      kind: k,
      sd: side,
      dx: (mF * sin + mS * cos) / ml,
      dz: (mF * cos - mS * sin) / ml,
      dist: (dist * scale) / heavy,
      hx: hF * sin + hS * cos,
      hz: hF * cos - hS * sin,
      reach: reach * scale,
    };
  };
  /** 倒下去的地方够不够：髋挪过去不穿墙，上半身伸出去也不穿墙（实在差一点就少挪一点）。够 = true */
  const fit = (pl: Plan): boolean => {
    const room = o.room;
    if (!room) return true;
    pl.dist = Math.min(pl.dist, room(pl.dx, pl.dz, pl.dist));
    for (let pass = 0; pass < 2; pass++) {
      const ex = pl.dx * pl.dist + pl.hx * pl.reach;
      const ez = pl.dz * pl.dist + pl.hz * pl.reach;
      const el = Math.hypot(ex, ez) || 1;
      const free = room(ex / el, ez / el, el);
      // 头伸进墙里一拃以内不算
      if (free >= el - 0.2 * scale) return true;
      if (pl.dist <= 0) return false;
      pl.dist = Math.max(0, pl.dist - (el - free));
    }
    return false;
  };
  let pl = plan(kind, sd);
  // 巨像不换：它侧躺 / 瘫倒会把那条大胳膊压进地里，宁可少挪一点
  if (!fit(pl) && !o.force && kind !== 'crawl' && o.kind !== 'colossus') {
    // 这么倒要穿墙：换成顺着墙侧倒 / 原地瘫倒，哪个躺得下用哪个；都躺不下就原地瘫着不挪
    const other = (sd === 1 ? -1 : 1) as 1 | -1;
    const lie: Array<[DeathKind, 1 | -1]> = [['side', sd], ['side', other]];
    const heap: Array<[DeathKind, 1 | -1]> = [['crumple', sd], ['crumple', other]];
    const tries = rnd(o.seed, 6) < 0.5 ? [...lie, ...heap] : [...heap, ...lie];
    let found = false;
    for (const [k, side] of tries) {
      if (k === kind && side === sd) continue;
      const alt = plan(k, side);
      if (fit(alt)) {
        pl = alt;
        found = true;
        break;
      }
    }
    if (!found) {
      pl = plan('crumple', sd);
      pl.dist = 0;
    }
    kind = pl.kind;
    sd = pl.sd;
  }
  const { dx, dz, dist } = pl;

  const from: Quaternion[] = [];
  for (const i of POSED) from[i] = a.bone(i).quaternion.clone();
  // 上臂 / 大腿的转动顺序换成「先绕自己拧、再张开、再前后摆」：y 就是拧（活着的时候 y 一直是 0，两种顺序没区别）
  for (const i of TWISTED) a.bone(i).rotation.order = 'XZY';

  const d: DeathState = {
    kind,
    sd,
    stretch: Math.sqrt(scale) * heavy * (0.92 + 0.2 * rnd(o.seed, 4)),
    x: o.x,
    z: o.z,
    yaw: o.yaw,
    dx,
    dz,
    dist,
    turn: (rnd(o.seed, 5) - 0.5) * 0.8,
    air: Math.max(0, o.air),
    airT: Math.max(0.18, Math.sqrt((2 * Math.max(0, o.air)) / 9.8)),
    from,
    fromPelvisY: a.bone(B.pelvis).position.y,
    bias: 0,
    samples: [],
    limbs: [],
    scale,
    done: false,
    restY: 0,
  };
  d.samples = samplesOf(a);
  d.limbs = LIMBS.map((chain) => ({ upper: chain[0] as number, samples: d.samples.filter((sm) => chain.includes(sm.bone)) }));
  // 这一刻（还是活着时的姿势）贴地算出来的高度和实际高度差多少
  d.bias = -groundY(a, d, 0);
  a.group.position.y = o.air;
  return d;
}

const P = {} as Record<Field, number>;

/** 死了 age 秒时的样子。sink = 尸体往地里沉了多少（米） */
export function updateDeath(a: RigActor, d: DeathState, age: number, sink: number): void {
  const g = a.group;
  if (d.done) {
    g.position.y = d.restY - sink;
    return;
  }
  const clip = clipOf(d.kind);
  const t = age / d.stretch;
  for (let i = 0; i < FIELDS.length; i++) P[FIELDS[i] as Field] = sample(clip.tracks[i] as Track, t);
  const m = d.sd;
  // 镜像：左右对调，绕竖轴 / 前后轴的转动反号
  const L = m === 1;
  const alx = L ? P.alx : P.arx;
  const aly = L ? P.aly : -P.ary;
  const alz = L ? P.alz : -P.arz;
  const arx = L ? P.arx : P.alx;
  const ary = L ? P.ary : -P.aly;
  const arz = L ? P.arz : -P.alz;
  const el = L ? P.el : P.er;
  const er = L ? P.er : P.el;
  const llx = L ? P.llx : P.lrx;
  const lly = L ? P.lly : -P.lry;
  const llz = L ? P.llz : -P.lrz;
  const lrx = L ? P.lrx : P.llx;
  const lry = L ? P.lry : -P.lly;
  const lrz = L ? P.lrz : -P.llz;
  const kl = L ? P.kl : P.kr;
  const kr = L ? P.kr : P.kl;

  const pelvis = a.bone(B.pelvis);
  pelvis.quaternion.setFromEuler(_e.set(P.pitch, P.twist * m + d.turn * smooth01(t / clip.end), P.roll * m, 'YXZ'));
  if (P.spin !== 0) pelvis.quaternion.multiply(_spin.setFromAxisAngle(UP, P.spin * m));
  a.bone(B.chest).rotation.set(P.cx, P.cy * m, P.cz * m);
  a.bone(B.head).rotation.set(P.hx, P.hy * m, P.hz * m);
  a.bone(B.armUL).rotation.set(alx, aly, alz);
  a.bone(B.armUR).rotation.set(arx, ary, arz);
  a.bone(B.armLL).rotation.set(el, 0, 0);
  a.bone(B.armLR).rotation.set(er, 0, 0);
  a.bone(B.legUL).rotation.set(llx, lly, llz);
  a.bone(B.legUR).rotation.set(lrx, lry, lrz);
  a.bone(B.legLL).rotation.set(kl, 0, 0);
  a.bone(B.legLR).rotation.set(kr, 0, 0);
  pelvis.position.y = a.pelvisBaseY;

  // 开头一小段：从死的那一刻的姿势过渡过来
  const w = smooth01(age / (0.14 * d.stretch));
  if (w < 1) {
    for (const i of POSED) {
      const b = a.bone(i);
      _q.copy(b.quaternion);
      b.quaternion.slerpQuaternions(d.from[i] as Quaternion, _q, w);
    }
    pelvis.position.y = d.fromPelvisY + (a.pelvisBaseY - d.fromPelvisY) * w;
  }

  g.rotation.set(0, d.yaw, 0);
  const tr = sample(clip.travel, t) * d.dist;
  g.position.x = d.x + d.dx * tr;
  g.position.z = d.z + d.dz * tr;
  // 半空死的：按重力掉下来
  const fall = d.air > 0 ? d.air * Math.max(0, 1 - (age / d.airT) ** 2) : 0;
  const y = groundY(a, d, P.lying) + P.lift * d.scale + fall + d.bias * (1 - smooth01(age / 0.25));
  if (P.lying > 0) {
    g.position.y = y;
    g.updateMatrixWorld(true);
    settle(a, d, P.lying, P.lying * smooth01((t - clip.settle) / (clip.end - clip.settle)));
  }
  g.position.y = y - sink;
  if (t >= clip.end) {
    d.done = true;
    d.restY = y;
  }
}

/** 这种死法从开始到躺定要多久（秒，已经算上放慢的倍数） */
export function deathLength(d: DeathState): number {
  return clipOf(d.kind).end * d.stretch;
}
