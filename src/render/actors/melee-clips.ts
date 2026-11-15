import { Euler, Quaternion } from 'three';
import { B, type RigActor } from './rig';

/**
 * 第三人称的挥刀动作（对战里的士兵）：按时间取样关键帧，摆到 14 根骨头上。
 *
 * 关键帧有两个来源，格式一样：
 * - 自己写的三个简单动作（OWN）：横挥两个方向、捅。什么都不用装就有；
 * - 从 EMA / Better Combat 的 player_animation 转过来的片段（scripts/tools/melee-import.mjs → public/melee/clips.json）。
 *   这个文件只在本机有（授权说不清，不进 git、不进发行包）；有它就用它，动作细一些。
 *
 * 角度（弧度）有两套坐标，都是 playerAnimator 的约定：
 * - torso 不是"胸"，是整个人的变换（乘在渲染矩阵上：y 朝上、脸朝 −z、右手在 +x）。
 *   换到我们的骨架（+x 是左手边、+y 朝上、脸朝 +z）：yaw 不变，pitch、roll 反号；
 * - 头、胳膊是方块人模型空间里各自的转角（x 朝左、y 朝下、z 朝后），相对"整个人"：pitch 不变，yaw、roll 反号。
 *   头的 yaw 跟 torso 差不多大——那是把脸拧回去（人拧腰，脸还朝前）。
 * 所以：torso 给胸骨，头和两条上臂按胸骨的子骨头摆；腿不用（我们的腿在走路 / 蹲着 / 跳），
 * 位移（x / y / z，像素）也不用（四肢比例和方块人不一样，照搬会脱臼）
 */
type Key = [tick: number, value: number, ease: number];
interface Clip {
  begin: number;
  end: number;
  stop: number;
  parts: Record<string, Record<string, Key[]>>;
}

const NAMES = ['slashL', 'slashR', 'stab'] as const;

/** 两帧：蓄力（第 8 拍）→ 出刀（第 11 拍） */
const k2 = (a: number, b: number): Key[] => [
  [8, a, 0],
  [11, b, 0],
];
/** 三帧：蓄力 → 挥到一半 → 挥到头（第 15 拍） */
const k3 = (a: number, b: number, c: number): Key[] => [
  [8, a, 0],
  [11, b, 0],
  [15, c, 0],
];
const OWN: Record<string, Clip> = {
  // 从右往左：人先往右拧、手臂抬到右前方，再连腰带手扫到左边
  slashL: {
    begin: 8,
    end: 18,
    stop: 30,
    parts: {
      torso: { yaw: k2(-0.5, 0.7), pitch: k2(0.08, -0.18) },
      head: { yaw: k2(-0.5, 0.7) },
      rightArm: { pitch: k3(-1.15, -1.4, -1.35), yaw: k3(1.3, 0.55, -0.6) },
      leftArm: { pitch: k2(-0.45, 0.35), roll: k2(-0.15, -0.3) },
    },
  },
  // 从左往右（反手）：手臂先收到左胸前，再往右甩开
  slashR: {
    begin: 8,
    end: 18,
    stop: 30,
    parts: {
      torso: { yaw: k2(0.65, -0.45), pitch: k2(0.05, -0.15) },
      head: { yaw: k2(0.65, -0.45) },
      rightArm: { pitch: k3(-1.3, -1.45, -1.5), yaw: k3(-0.75, 0.2, 1.15) },
      leftArm: { pitch: k2(0.3, -0.2), roll: k2(-0.3, -0.5) },
    },
  },
  // 捅：右肩往后收、手收到腰边，再连肩带手往前送
  stab: {
    begin: 8,
    end: 18,
    stop: 30,
    parts: {
      torso: { yaw: k2(-0.6, 0.5), pitch: k2(0.12, -0.3) },
      head: { yaw: k2(-0.6, 0.5) },
      // 胳膊的 yaw 跟着腰走：腰往左拧了多少，胳膊就往右补多少，手一直指着正前方
      rightArm: { pitch: k2(-0.8, -1.62), yaw: k2(-0.5, 0.5) },
      leftArm: { pitch: k2(-0.7, 0.35), roll: k2(-0.6, -0.3) },
    },
  },
};

let clips: Record<string, Clip> | null = null;
let asked = false;

function load(): void {
  if (asked) return;
  asked = true;
  fetch(`${import.meta.env.BASE_URL}melee/clips.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, Clip>>) : null))
    .then((j) => {
      // 开发服务器对不存在的路径会回首页：不是这三个片段就当没有
      if (j && NAMES.every((n) => j[n]?.parts)) clips = j;
    })
    .catch(() => undefined);
}

/** 调试 / 截图用：own = 不用导入的片段，只用自己写的动作 */
export const meleeDebug = { own: false };
/** 导入的片段有没有加载好（没有就是在用自己写的动作） */
export const meleeReady = (): boolean => clips !== null;

function clipOf(kind: 0 | 1 | 2): Clip {
  load();
  const name = NAMES[kind] as string;
  return ((meleeDebug.own ? null : clips) ?? OWN)[name] as Clip;
}

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k));
const smooth = (k: number): number => k * k * (3 - 2 * k);
const ease = (k: number, mode: number): number => (mode === 1 ? k * k : mode === 2 ? 1 - (1 - k) * (1 - k) : k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));

/** 一个通道在 tick 处的值：第一帧之前就是第一帧，最后一帧之后就是最后一帧（进、出的过渡按权重混，见 weight） */
function sample(keys: Key[] | undefined, tick: number): number {
  if (!keys || !keys.length) return 0;
  const first = keys[0] as Key;
  const last = keys[keys.length - 1] as Key;
  if (tick <= first[0]) return first[1];
  if (tick >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i] as Key;
    if (tick > b[0]) continue;
    const a = keys[i - 1] as Key;
    return a[1] + (b[1] - a[1]) * ease((tick - a[0]) / Math.max(1e-6, b[0] - a[0]), b[2]);
  }
  return last[1];
}

/** 这一拍动作占多少（其余是平时的姿势）：抬手那一段 0 → 1，挥的时候 1，收回来 1 → 0 */
const weight = (c: Clip, tick: number): number => (tick < c.begin ? smooth(tick / Math.max(1, c.begin)) : tick <= c.end ? 1 : 1 - smooth(clamp01((tick - c.end) / Math.max(1, c.stop - c.end))));

const _e = new Euler(0, 0, 0, 'ZYX');
const _q = new Quaternion();
const _b = new Quaternion();
const _id = new Quaternion();

/** 一个部位在 tick 处的旋转，换到我们的骨架坐标里。方块人的旋转顺序是 ZYX（先绕 x，再 y，再 z） */
function partQuat(c: Clip, part: string, tick: number, out: Quaternion): Quaternion {
  const p = c.parts[part];
  if (!p) return out.identity();
  const pitch = sample(p.pitch, tick);
  const yaw = sample(p.yaw, tick);
  const roll = sample(p.roll, tick);
  if (part === 'torso') _e.set(-pitch, yaw, -roll, 'ZYX');
  else _e.set(pitch, -yaw, -roll, 'ZYX');
  return out.setFromEuler(_e);
}

/**
 * kind：0 = 从右往左横挥，1 = 从左往右横挥，2 = 捅；t = 开始挥到现在多久（秒），dur = 这一下总共多长（秒）。
 * 要在平时的姿势（腿、上身朝向、两条手臂）都摆好以后调：按权重从平时的姿势混到动作里的姿势。
 * 胸和头是在原来的朝向上再叠动作的转角，上臂直接换成动作的，小臂自己弯
 * （方块人的手臂是一根直棍：蓄力时肘弯着，挥出去伸直）。
 */
export function applyMelee(actor: RigActor, kind: 0 | 1 | 2, t: number, dur: number): void {
  const c = clipOf(kind);
  // 动作的 [0, stop] 拉到这一下的时长上：begin 之前是抬手，begin–end 是挥，之后收回来
  const tick = clamp01(t / dur) * c.stop;
  const w = weight(c, tick);
  const at = Math.max(c.begin, Math.min(c.end, tick));

  actor.bone(B.chest).quaternion.multiply(_q.copy(_id).slerp(partQuat(c, 'torso', at, _b), w));
  actor.bone(B.head).quaternion.multiply(_q.copy(_id).slerp(partQuat(c, 'head', at, _b), w));

  // 右臂：蓄力时肘弯得多（捅是把手收到腰边），出刀那三拍伸直。上臂往回补一半，手还在动作指的那条线上
  const out = smooth(clamp01((at - c.begin) / 3));
  const bend = kind === 2 ? 1.45 - 1.3 * out : 0.85 - 0.6 * out;
  partQuat(c, 'rightArm', at, _b).multiply(_q.setFromEuler(_e.set(bend * 0.47, 0, 0, 'ZYX')));
  actor.bone(B.armUR).quaternion.slerp(_b, w);
  actor.bone(B.armLR).quaternion.slerp(_q.setFromEuler(_e.set(-bend, 0, 0, 'ZYX')), w);
  // 左臂：跟着动作甩，肘一直弯着
  partQuat(c, 'leftArm', at, _b).multiply(_q.setFromEuler(_e.set(0.33, 0, 0, 'ZYX')));
  actor.bone(B.armUL).quaternion.slerp(_b, w);
  actor.bone(B.armLL).quaternion.slerp(_q.setFromEuler(_e.set(-0.7, 0, 0, 'ZYX')), w);
}

const _item = { along: 0, roll: 0 };
/**
 * 挥的时候刀在手里怎么转（方块人动作里的 rightItem）：along = 刀尖顺着小臂伸出去的程度 0–1
 * （平时刀和小臂垂直、攥在拳头里；挥和捅的时候手腕压下去，刀成了手臂的延长）；
 * roll = 绕刀身转多少（横挥时刀刃朝挥的方向）。返回的对象是共用的，马上读走
 */
export function meleeItem(kind: 0 | 1 | 2, t: number, dur: number): { along: number; roll: number } {
  const c = clipOf(kind);
  const tick = clamp01(t / dur) * c.stop;
  const w = weight(c, tick);
  const out = smooth(clamp01((tick - c.begin) / 3));
  _item.along = w * (kind === 2 ? 1 : kind === 0 ? 0.1 + 0.9 * out : 0.5 + 0.5 * out);
  _item.roll = w * (kind === 0 ? 1 : kind === 1 ? -1 : 0) * (Math.PI / 2);
  return _item;
}
