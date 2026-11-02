import type { ZombieKind } from '../../game/data/zombies';
import { clamp, lerp } from '../../game/core/math';
import { B, type RigActor } from './rig';

/** 旋转约定：骨头指向 -Y，rotation.x 为负 = 向前摆；左臂（+X）向外 = rotation.z 为正 */

interface Gait {
  legSwing: number;
  knee: number;
  bob: number;
  /** 手臂抬起角（负 = 向前） */
  armRaise: number;
  armSwing: number;
  elbow: number;
  spread: number;
  lean: number;
  loll: number;
  sway: number;
  /** 手臂是否与腿反向摆动（跑动姿势） */
  pump: boolean;
}

const GAIT: Record<ZombieKind, Gait> = {
  walker: { legSwing: 0.55, knee: 0.75, bob: 0.03, armRaise: -1.05, armSwing: 0.12, elbow: -0.85, spread: 0.16, lean: 0.26, loll: 0.2, sway: 0.1, pump: false },
  runner: { legSwing: 0.95, knee: 1.25, bob: 0.07, armRaise: -0.35, armSwing: 0.95, elbow: -1.45, spread: 0.05, lean: 0.5, loll: 0.1, sway: 0.06, pump: true },
  bloater: { legSwing: 0.36, knee: 0.45, bob: 0.05, armRaise: -0.75, armSwing: 0.08, elbow: -0.25, spread: 0.55, lean: 0.12, loll: 0.1, sway: 0.2, pump: false },
  breaker: { legSwing: 0.5, knee: 0.6, bob: 0.03, armRaise: -0.3, armSwing: 0.1, elbow: -0.2, spread: 0.1, lean: 0.2, loll: 0.1, sway: 0.08, pump: false },
  colossus: { legSwing: 0.4, knee: 0.5, bob: 0.06, armRaise: -0.4, armSwing: 0.3, elbow: -0.3, spread: 0.3, lean: 0.22, loll: 0.08, sway: 0.12, pump: false },
};

/** 攻击动画时长（秒），渲染层据此把攻击事件展开成 0–1 的进度 */
export const ATTACK_TIME: Record<ZombieKind, number> = { walker: 0.6, runner: 0.4, bloater: 0.8, breaker: 0.75, colossus: 1.1 };

export interface ZombiePose {
  kind: ZombieKind;
  /** 世界时间（秒） */
  t: number;
  /** 步伐相位（来自逻辑层，随移动距离增长） */
  phase: number;
  speed: number;
  maxSpeed: number;
  /** 攻击进度 0–1，<0 表示没在攻击 */
  attack: number;
  flinch: number;
  seed: number;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** 攻击曲线：举起 → 猛砸 → 收回。返回 [手臂角度偏移系数, 躯干前倾偏移] */
function strike(p: number): { arm: number; lean: number } {
  if (p < 0.4) {
    const u = ease(p / 0.4);
    return { arm: u, lean: -0.35 * u };
  }
  if (p < 0.55) {
    const u = ease((p - 0.4) / 0.15);
    return { arm: lerp(1, 0.25, u), lean: lerp(-0.35, 0.55, u) };
  }
  const u = ease((p - 0.55) / 0.45);
  return { arm: lerp(0.25, 0, u), lean: lerp(0.55, 0, u) };
}

export function poseZombie(a: RigActor, p: ZombiePose): void {
  const g = GAIT[p.kind];
  const bone = (i: number) => a.bone(i);
  const sp = clamp(p.speed / p.maxSpeed, 0, 1.3);
  const move = Math.min(1, sp * 1.5);
  const ph = p.phase + p.seed * 0.37;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const idle = Math.sin(p.t * 1.7 + p.seed);

  a.resetPose();

  // 腿
  bone(B.legUL).rotation.x = s * g.legSwing * move;
  bone(B.legLL).rotation.x = Math.max(0, -c) * g.knee * move;
  bone(B.legUR).rotation.x = -s * g.legSwing * move;
  bone(B.legLR).rotation.x = Math.max(0, c) * g.knee * move;
  const pelvis = bone(B.pelvis);
  pelvis.position.y = a.pelvisBaseY - g.bob * move * (0.5 - 0.5 * Math.cos(2 * ph));
  pelvis.rotation.y = c * 0.12 * move;
  pelvis.rotation.z = s * g.sway * 0.1 * move;

  // 躯干与头
  const chest = bone(B.chest);
  chest.rotation.x = g.lean + 0.03 * idle;
  chest.rotation.y = -c * 0.18 * move;
  chest.rotation.z = s * g.sway * 0.3 * move;
  const head = bone(B.head);
  head.rotation.z = g.loll * Math.sin(p.t * 0.9 + p.seed * 1.7) * (1 - 0.4 * move);
  head.rotation.x = -g.lean * 0.7 + 0.08 * Math.sin(p.t * 2.3 + p.seed);
  head.rotation.y = 0.2 * Math.sin(p.t * 0.6 + p.seed * 0.5);

  // 手臂
  const swing = g.armSwing * (g.pump ? move : 0.4 + 0.6 * move);
  let aUL = g.armRaise - (g.pump ? s : -s * 0.5) * swing;
  let aUR = g.armRaise + (g.pump ? s : -s * 0.5) * swing;
  let eL = g.elbow;
  let eR = g.elbow;
  if (!g.pump) {
    aUL += 0.08 * idle;
    aUR -= 0.08 * idle;
  }
  let spreadL = g.spread;
  let spreadR = g.spread;

  if (p.kind === 'breaker') {
    // 左臂举盾挡在身前，右臂拖着大锤
    aUL = -1.0 + 0.04 * idle;
    eL = -0.9;
    aUR = -0.3 - s * 0.12 * move;
    eR = -0.25;
    spreadL = 0.05;
    spreadR = 0.15;
  }

  let lean = 0;
  if (p.attack >= 0) {
    const st = strike(p.attack);
    lean = st.lean;
    if (p.kind === 'breaker') {
      // 大锤过头顶猛砸
      aUR = lerp(aUR, -3.1, st.arm);
      eR = lerp(eR, -0.3, st.arm);
    } else {
      aUL = lerp(aUL, -2.8, st.arm);
      aUR = lerp(aUR, -2.8, st.arm);
      eL = lerp(eL, -0.2, st.arm);
      eR = lerp(eR, -0.2, st.arm);
    }
  }
  bone(B.chest).rotation.x += lean;
  head.rotation.x += lean * -0.5;

  bone(B.armUL).rotation.set(aUL, 0, spreadL);
  bone(B.armUR).rotation.set(aUR, 0, -spreadR);
  bone(B.armLL).rotation.x = eL;
  bone(B.armLR).rotation.x = eR;

  // 受击后仰
  if (p.flinch > 0) {
    bone(B.chest).rotation.x -= 0.4 * p.flinch;
    head.rotation.x -= 0.5 * p.flinch;
    pelvis.rotation.x = -0.1 * p.flinch;
  }
}

export interface SurvivorPose {
  t: number;
  phase: number;
  speed: number;
  /** 往后退（移动方向与瞄准方向相反）时腿反向摆 */
  backward: boolean;
  sprinting: boolean;
  /** 本帧射击后坐力 0–1 */
  recoil: number;
}

/** 幸存者：腿和躯干的姿势。手臂由 IK 单独处理 */
export function poseSurvivor(a: RigActor, p: SurvivorPose): void {
  const bone = (i: number) => a.bone(i);
  const move = clamp(p.speed / 3.2, 0, 1.4);
  const ph = p.phase * (p.backward ? -1 : 1);
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const run = p.sprinting ? 1.25 : 1;
  a.resetPose();
  bone(B.legUL).rotation.x = s * 0.62 * move * run;
  bone(B.legLL).rotation.x = Math.max(0, -c) * 0.8 * move * run;
  bone(B.legUR).rotation.x = -s * 0.62 * move * run;
  bone(B.legLR).rotation.x = Math.max(0, c) * 0.8 * move * run;
  const pelvis = bone(B.pelvis);
  pelvis.position.y = a.pelvisBaseY - 0.045 * Math.min(1, move) * (0.5 - 0.5 * Math.cos(2 * ph)) - (p.sprinting ? 0.03 : 0);
  pelvis.rotation.y = c * 0.1 * Math.min(1, move);
  const chest = bone(B.chest);
  chest.rotation.x = 0.06 + (p.sprinting ? 0.14 : 0) + 0.02 * Math.sin(p.t * 1.9) - p.recoil * 0.06;
  chest.rotation.y = -c * 0.08 * Math.min(1, move);
  bone(B.head).rotation.x = -0.05 + p.recoil * 0.04;
}
