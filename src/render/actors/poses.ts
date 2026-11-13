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
  spitter: { legSwing: 0.5, knee: 0.7, bob: 0.04, armRaise: -0.55, armSwing: 0.2, elbow: -0.9, spread: 0.22, lean: 0.35, loll: 0.25, sway: 0.12, pump: false },
  screamer: { legSwing: 0.7, knee: 0.9, bob: 0.05, armRaise: -0.2, armSwing: 0.6, elbow: -1.1, spread: 0.12, lean: 0.4, loll: 0.3, sway: 0.08, pump: true },
  // 爬行者的步态在 poseZombie 里单独处理（四肢着地），这里的数只给通用部分用
  crawler: { legSwing: 0.4, knee: 0.6, bob: 0.02, armRaise: -1.4, armSwing: 0.5, elbow: -0.3, spread: 0.2, lean: 0, loll: 0.15, sway: 0.1, pump: true },
  // 重装感染者：沉、慢，双臂护在胸前的钢板后面
  armored: { legSwing: 0.42, knee: 0.5, bob: 0.04, armRaise: -0.6, armSwing: 0.06, elbow: -1.3, spread: 0.08, lean: 0.12, loll: 0.06, sway: 0.14, pump: false },
  // 跳跃者：弓着腰、屈着膝小跑，双手垂在身前
  leaper: { legSwing: 0.85, knee: 1.3, bob: 0.06, armRaise: -0.5, armSwing: 0.7, elbow: -0.6, spread: 0.2, lean: 0.62, loll: 0.15, sway: 0.08, pump: true },
  // 裂殖者：背上的囊包压得它往前佝，拖着步子
  splitter: { legSwing: 0.4, knee: 0.5, bob: 0.05, armRaise: -0.7, armSwing: 0.1, elbow: -0.5, spread: 0.35, lean: 0.38, loll: 0.25, sway: 0.18, pump: false },
  // 毒雾者：歪着身子晃，一只手捏着面具
  gasser: { legSwing: 0.5, knee: 0.65, bob: 0.04, armRaise: -0.8, armSwing: 0.15, elbow: -0.9, spread: 0.18, lean: 0.22, loll: 0.3, sway: 0.16, pump: false },
  // 收割者：长胳膊垂着，骨镰拖在身侧，大步往前探
  reaper: { legSwing: 0.55, knee: 0.7, bob: 0.04, armRaise: -0.25, armSwing: 0.25, elbow: -0.35, spread: 0.18, lean: 0.28, loll: 0.25, sway: 0.12, pump: false },
  // 母巢：肚子坠着，一步一晃
  brood: { legSwing: 0.3, knee: 0.4, bob: 0.06, armRaise: -0.6, armSwing: 0.1, elbow: -0.3, spread: 0.6, lean: 0.15, loll: 0.12, sway: 0.25, pump: false },
  // 哀嚎女王：双臂软软垂着，头歪向一边，飘着走
  siren: { legSwing: 0.6, knee: 0.8, bob: 0.04, armRaise: -0.15, armSwing: 0.2, elbow: -0.2, spread: 0.22, lean: 0.18, loll: 0.35, sway: 0.1, pump: false },
};

/** 攻击动画时长（秒），渲染层据此把攻击事件展开成 0–1 的进度 */
export const ATTACK_TIME: Record<ZombieKind, number> = { walker: 0.6, runner: 0.4, bloater: 0.8, breaker: 0.75, colossus: 1.1, spitter: 0.7, screamer: 0.5, crawler: 0.35, armored: 0.9, leaper: 0.4, splitter: 0.8, gasser: 0.6, reaper: 0.8, brood: 1.0, siren: 0.55 };

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
  /** 跳跃者：蹲下蓄力的进度 0–1（没在蓄力 = 0）；滞空进度 0–1（<0 = 在地上） */
  crouch?: number;
  air?: number;
  /** 首领技能：哪一招、蓄力进度 0–1（1 = 已经放出去） */
  skill?: 'hook' | 'cleave' | 'shriek' | 'howl' | '';
  skillK?: number;
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

  // 爬行者：四肢着地。骨盆压低、上身前倾到几乎水平，手臂向下撑地前后交替爬
  if (p.kind === 'crawler') {
    pelvis.position.y = a.pelvisBaseY * 0.42 - 0.02 * move * (0.5 - 0.5 * Math.cos(2 * ph));
    pelvis.rotation.x = 0.35;
    chest.rotation.x = 1.15 + 0.03 * idle;
    head.rotation.x = -1.25 + 0.1 * Math.sin(p.t * 2.3 + p.seed);
    const reach = 0.45 * move;
    bone(B.armUL).rotation.set(-2.5 + s * reach, 0, 0.18);
    bone(B.armUR).rotation.set(-2.5 - s * reach, 0, -0.18);
    bone(B.armLL).rotation.x = -0.25 - Math.max(0, c) * 0.5 * move;
    bone(B.armLR).rotation.x = -0.25 - Math.max(0, -c) * 0.5 * move;
    // 腿向后拖、膝盖着地
    bone(B.legUL).rotation.x = 1.0 - s * 0.3 * move;
    bone(B.legUR).rotation.x = 1.0 + s * 0.3 * move;
    bone(B.legLL).rotation.x = 1.2;
    bone(B.legLR).rotation.x = 1.2;
    if (p.attack >= 0) {
      // 扑咬：上身往前一窜
      const st = strike(p.attack);
      chest.rotation.x -= st.lean * 0.6;
      head.rotation.x += st.arm * 0.4;
    }
  }

  // 跳跃者：蓄力时蹲低（脚还踩在地上：大腿前摆 1 弧度、小腿往回折 1.8 弧度时髋下沉约 0.33 米）、手往后抡、抬头盯人；
  // 在空中收腿、双手往前伸去抓，快落地时把腿放下来
  const crouch = p.crouch ?? 0;
  if (crouch > 0) {
    const k = ease(clamp(crouch * 1.6, 0, 1));
    pelvis.position.y = a.pelvisBaseY - 0.33 * k;
    bone(B.legUL).rotation.x = -1.0 * k;
    bone(B.legUR).rotation.x = -1.0 * k;
    bone(B.legLL).rotation.x = 1.8 * k;
    bone(B.legLR).rotation.x = 1.8 * k;
    chest.rotation.x = g.lean + 0.35 * k + 0.04 * Math.sin(p.t * 30) * k;
    head.rotation.x = -g.lean * 0.7 - 0.55 * k;
    bone(B.armUL).rotation.set(lerp(aUL, 0.9, k), 0, spreadL + 0.25 * k);
    bone(B.armUR).rotation.set(lerp(aUR, 0.9, k), 0, -spreadR - 0.25 * k);
  }
  const air = p.air ?? -1;
  if (air >= 0) {
    const tuck = Math.sin(Math.PI * clamp(air, 0, 1));
    const reach = ease(clamp(air * 3, 0, 1));
    pelvis.position.y = a.pelvisBaseY;
    bone(B.legUL).rotation.x = -0.4 - 0.9 * tuck;
    bone(B.legUR).rotation.x = -0.2 - 0.9 * tuck;
    bone(B.legLL).rotation.x = 0.4 + 1.3 * tuck;
    bone(B.legLR).rotation.x = 0.5 + 1.3 * tuck;
    chest.rotation.x = 0.35 + 0.25 * tuck;
    head.rotation.x = -0.6;
    bone(B.armUL).rotation.set(lerp(0.6, -2.3, reach), 0, 0.3);
    bone(B.armUR).rotation.set(lerp(0.6, -2.2, reach), 0, -0.3);
    bone(B.armLL).rotation.x = -0.3;
    bone(B.armLR).rotation.x = -0.35;
  }

  // 首领技能的动作：蓄力时把动作做大（玩家靠这个和地上的预警读招），放出去以后停在出招的姿势
  const sk = p.skill ?? '';
  if (sk) {
    const k = ease(clamp(p.skillK ?? 0, 0, 1));
    const out = (p.skillK ?? 0) >= 1;
    if (sk === 'hook') {
      // 左手的钩子：蓄力时抡到身后，甩出去时直直伸向前
      bone(B.armUL).rotation.set(out ? -1.7 : lerp(aUL, 1.2, k), 0, out ? 0.1 : 0.2 + 0.4 * k);
      bone(B.armLL).rotation.x = out ? -0.1 : -1.2 * k;
      chest.rotation.y = out ? -0.35 : 0.5 * k;
    } else if (sk === 'cleave') {
      // 右臂的骨镰：蓄力时举过头顶、拧腰，放出去时一刀横抡到另一边
      bone(B.armUR).rotation.set(out ? -1.3 : lerp(aUR, -2.6, k), 0, out ? 0.5 : -spreadR - 0.9 * k);
      bone(B.armLR).rotation.x = out ? -0.2 : -0.6 * k;
      chest.rotation.y = out ? 0.7 : -0.6 * k;
      chest.rotation.x = g.lean + (out ? 0.3 : -0.15 * k);
    } else {
      // 尖啸 / 咆哮：蓄力时仰头挺胸、双臂张开，叫出来时上身猛地前探
      chest.rotation.x = out ? g.lean + 0.35 : g.lean - 0.4 * k;
      head.rotation.x = out ? -0.2 : -0.9 * k;
      bone(B.armUL).rotation.set(lerp(aUL, -0.6, k), 0, spreadL + 1.1 * k);
      bone(B.armUR).rotation.set(lerp(aUR, -0.6, k), 0, -spreadR - 1.1 * k);
      bone(B.armLL).rotation.x = -0.3 * k;
      bone(B.armLR).rotation.x = -0.3 * k;
      if (!out) chest.rotation.z += 0.03 * Math.sin(p.t * 40) * k;
    }
  }

  // 受击后仰
  if (p.flinch > 0) {
    bone(B.chest).rotation.x -= 0.4 * p.flinch;
    head.rotation.x -= 0.5 * p.flinch;
    pelvis.rotation.x = -0.1 * p.flinch;
  }
}
