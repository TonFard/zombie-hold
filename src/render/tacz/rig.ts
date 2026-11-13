import { Euler, Group, Matrix3, Matrix4, Object3D, Quaternion, TextureLoader, Vector3 } from 'three';
import { compileClip, CONSTRAINT, Pose, Track, type CompiledClip, type PlayMode, type Runner, type SfxFn } from './anim';
import { TaczModel } from './model';
import type { GunJson, TaczManifest } from './types';

/**
 * TACZ 枪械的第一人称表现：模型 + 动画状态机 + 摄像机定位，规则照搬 TACZ 默认状态机
 * （default_state_machine_v2.lua）和 FirstPersonRenderGunEvent：
 *
 * 轨道（按这个顺序叠加）：
 *   base     static_idle 循环（持枪姿势、双手位置）
 *   bolt     static_bolt_caught（打空后套筒停在后方）
 *   ads      aim_start / aim / aim_end（有的枪才有）
 *   main     draw / reload_* / inspect*
 *   kick ×4  shoot（混合，连射时几发叠在一起）
 *   move     idle / walk_* / run_*（混合）
 *   slide    slide / slide_idle / slide_back（混合）
 *
 * 定位：腰射时把 idle_view 节点放到摄像机上，瞄准时换成 iron_view，中间插值；
 * 瞄准时再按 constraint 节点的系数把动画造成的晃动抵消掉一部分，准星才不会乱跳。
 */

/** TACZ 模型空间（1 = 一格）到视角模型场景（米）的缩放。以摄像机为中心等比缩放，画面不变，只是数值接近真实尺寸 */
export const TACZ_SCALE = 0.2;
const DEG = Math.PI / 180;
const KICK_TRACKS = 4;

export interface TaczFrame {
  /** 瞄准进度 0–1（已缓动） */
  ads: number;
  /** 换弹进度 0–1，-1 = 没在换弹 */
  reload: number;
  /** 弹匣里剩几发 / 弹匣容量（逐发装填按差值决定塞几发） */
  mag: number;
  magMax: number;
  /** 扩容弹匣等级 0–3 */
  xmag: number;
  speed: number;
  /** 前进 / 右移速度（米/秒，带符号） */
  fwd: number;
  side: number;
  sprinting: boolean;
  sliding: boolean;
  /** 近战、建造模式等：检视要被打断 */
  busy: boolean;
  /** 摄像机空间里额外的变换（视角滞后、放低、近战） */
  pre: Matrix4;
}

interface View {
  t: Vector3;
  q: Quaternion;
}

export class TaczRig {
  readonly root: Group;
  readonly model: TaczModel;
  readonly clips = new Map<string, CompiledClip>();
  /** 枪口火光挂点（局部 +Z 朝前，和程序模型的火光朝向一致） */
  readonly flashMount = new Group();
  /** 摄像机动画（camera 骨骼）：游戏层乘到世界相机上 */
  readonly cameraAnim = new Quaternion();
  readonly fov: { hip: number; ads: number };
  onSound: ((url: string, gain: number) => void) | null = null;

  private readonly pose: Pose;
  private readonly base = new Track(false);
  /** 快慢机（static_auto / static_semi）：TACZ 里是混合轨道，只转保险拨片 */
  private readonly fireModeTrack = new Track(true);
  private readonly bolt = new Track(false);
  private readonly adsTrack = new Track(false);
  private readonly main = new Track(false);
  private readonly kicks: Track[] = [];
  private readonly move = new Track(true);
  private readonly slideTrack = new Track(true);
  private readonly tracks: Track[];
  private readonly sfx: SfxFn;

  private readonly idle: View | null;
  private readonly iron: View | null;
  private readonly muzzle: Object3D | null;

  private moveState: 'idle' | 'walk' | 'run' = 'idle';
  private walkMode = -1;
  private runMode = -1;
  private sliding = false;
  private aiming = false;
  /** 掏枪、换弹时允许同时播冲刺动画；检视不行 */
  private runOverlay = false;
  private reloadRunner: Runner | null = null;
  private reloadCool = 1;
  private wasReloading = false;
  private walkDist = 0;
  private shootCd = 0;
  private lastMag = 1;
  private xmag = 0;
  /** 逐发装填的时间线 */
  private tube: { segs: Array<{ clip: string; len: number }>; total: number; idx: number; runner: Runner | null } | null = null;
  /** 距离拉栓还有几秒（-1 = 不拉） */
  private boltIn = -1;
  private boltInterval = 0.5;
  private nextKick = 0;
  private readonly roles: GunJson['roles'];

  constructor(
    readonly json: GunJson,
    texture: import('three').Texture,
    private readonly baseUrl: string,
  ) {
    this.model = new TaczModel(json, texture);
    this.roles = json.roles;
    this.root = this.model.root;
    this.root.matrixAutoUpdate = false;
    for (const [name, c] of Object.entries(json.anims)) this.clips.set(name, compileClip(name, c));
    this.pose = new Pose(json.bones.map((b) => b.name));
    for (let i = 0; i < KICK_TRACKS; i++) this.kicks.push(new Track(true));
    this.tracks = [this.base, this.fireModeTrack, this.bolt, this.adsTrack, this.main, ...this.kicks, this.move, this.slideTrack];
    this.sfx = (p) => this.onSound?.(`${this.baseUrl}sfx/${p}.ogg`, 0.75);
    this.fov = { hip: json.display.modelFov, ads: json.display.zoomModelFov };

    this.idle = this.view('idle_view');
    this.iron = this.view('iron_view') ?? this.idle;
    this.muzzle = this.obj('muzzle_pos') ?? this.obj('muzzle_flash');
    const flashAt = this.obj('muzzle_flash') ?? this.muzzle;
    this.flashMount.rotation.y = Math.PI;
    flashAt?.add(this.flashMount);
  }

  private obj(name: string): Object3D | null {
    return this.model.nodes.get(name)?.objs[0] ?? null;
  }

  private view(name: string): View | null {
    const m = this.model.positioningInverse(name, new Matrix4());
    if (!m) return null;
    const t = new Vector3();
    const q = new Quaternion();
    m.decompose(t, q, new Vector3());
    return { t, q };
  }

  /** 预加载用：动画和显示配置里用到的所有音效 */
  soundUrls(): string[] {
    const set = new Set<string>();
    for (const c of this.clips.values()) for (const [, p] of c.sfx) set.add(p);
    for (const p of Object.values(this.json.display.sounds)) set.add(p);
    return [...set].map((p) => `${this.baseUrl}sfx/${p}.ogg`);
  }

  private play(track: Track, name: string | null | undefined, mode: PlayMode, transition = 0): Runner | null {
    const c = name ? this.clips.get(name) : undefined;
    return c ? track.play(c, mode, transition) : null;
  }

  private get inspecting(): boolean {
    return this.main.clipName?.startsWith('inspect') ?? false;
  }

  /**
   * 动画里没有逐个音效关键帧时（有的枪包只给一整段录音），就在动作开始时播显示配置里的整段音效，
   * 和 TACZ 的 SoundPlayManager 一样
   */
  private wholeSound(key: string, clip: Runner | null): void {
    if (clip && clip.clip.sfx.length) return;
    const s = this.json.display.sounds[key];
    if (s) this.onSound?.(`${this.baseUrl}sfx/${s}.ogg`, 0.75);
  }

  /** 拿出这把枪：所有动作从头开始 */
  draw(): void {
    for (const t of this.tracks) t.stop();
    this.reloadRunner = null;
    this.tube = null;
    this.boltIn = -1;
    this.wasReloading = false;
    this.moveState = 'idle';
    this.walkMode = this.runMode = -1;
    this.sliding = this.aiming = false;
    this.wholeSound('draw', this.play(this.main, this.roles.draw, 'once'));
    this.runOverlay = true;
  }

  /** 开一枪。interval = 两发之间的秒数；last = 打完这发弹匣空了 */
  fire(interval: number, last = false): void {
    this.shootCd = interval;
    if (this.inspecting) this.main.stop(0.2);
    // 优先用空闲的轨道；都在播就挤掉最早的那个
    let track = this.kicks.find((t) => t.isStopped());
    if (!track) {
      track = this.kicks[this.nextKick % KICK_TRACKS] as Track;
      this.nextKick++;
    }
    this.play(track, (last && this.roles.shootLast) || this.roles.shoot, 'once');
    // 打空了就不拉栓（空仓换弹的 intro 里自带上膛）
    if (this.roles.bolt && !last) {
      this.boltIn = Math.min(0.1, interval * 0.15);
      this.boltInterval = interval;
    }
    const s = this.json.display.sounds.shoot;
    if (s) this.onSound?.(`${this.baseUrl}sfx/${s}.ogg`, 1);
  }

  inspect(): void {
    if (this.reloadRunner || this.tube || this.wasReloading) return;
    if (!this.main.isStopped() && !this.inspecting) return;
    const empty = this.lastMag <= 0;
    const r = this.play(this.main, (empty ? this.roles.inspectEmpty : this.roles.inspect)[this.xmag], 'once', 0.2);
    if (!r) return;
    this.runOverlay = false;
    this.wholeSound(empty ? 'inspect_empty' : 'inspect', r);
  }

  /** 调试 / 截图用：直接在主轨道上播一个片段 */
  debugPlay(name: string): boolean {
    return this.play(this.main, name, 'once', 0.2) !== null;
  }

  /**
   * 逐发装填：把 intro + loop × 缺几发 排成一条时间线，整条按游戏的换弹进度推进；
   * 游戏里换弹结束（弹仓一次补满）时再按正常速度播 end。和弹匣枪"cooldown 之后的收尾"是一个意思。
   */
  private startTube(f: TaczFrame, t: NonNullable<GunJson['roles']['tube']>): void {
    const empty = f.mag <= 0;
    const intro = empty ? t.introEmpty : t.intro;
    // 空仓的 intro 自己会往膛里塞一发
    const need = Math.max(0, f.magMax - f.mag - (empty && t.introEmpty !== t.intro ? 1 : 0));
    const len = (n: string) => this.clips.get(n)?.end ?? 0;
    const segs = [{ clip: intro, len: len(intro) }];
    for (let i = 0; i < need; i++) segs.push({ clip: t.loop, len: len(t.loop) });
    this.tube = { segs, total: segs.reduce((n, s) => n + s.len, 0), idx: -1, runner: null };
    this.runOverlay = true;
  }

  private seekTube(p: number): void {
    const tb = this.tube;
    if (!tb) return;
    let t = Math.min(1, Math.max(0, p)) * tb.total;
    let i = 0;
    while (i < tb.segs.length - 1 && t >= (tb.segs[i] as { len: number }).len) {
      t -= (tb.segs[i] as { len: number }).len;
      i++;
    }
    const seg = tb.segs[i] as { clip: string; len: number };
    if (i !== tb.idx) {
      tb.idx = i;
      tb.runner = this.play(this.main, seg.clip, 'hold', i === 0 ? 0.2 : 0);
      if (tb.runner) tb.runner.speed = 0;
    }
    tb.runner?.seek(Math.min(t, seg.len), this.sfx);
  }

  private startReload(f: TaczFrame): void {
    if (this.roles.tube) {
      this.startTube(f, this.roles.tube);
      return;
    }
    const empty = f.mag <= 0;
    const list = empty ? this.roles.reloadEmpty : this.roles.reloadTactical;
    const runner = this.play(this.main, list[f.xmag], 'once', 0.2);
    if (!runner) return;
    // 游戏里的换弹时间对应动画里"可以开火"的时间点（TACZ 的 cooldown），动画按这个比例加速或放慢
    const cd = this.json.data.reload?.cooldown;
    const stdClip = list[0] ? this.clips.get(list[0]) : undefined;
    let cool = runner.clip.end * 0.85;
    if (cd && stdClip && stdClip.end > 0) cool = (empty ? cd.empty : cd.tactical) * (runner.clip.end / stdClip.end);
    this.reloadCool = Math.min(runner.clip.end, cool);
    runner.speed = 0;
    this.reloadRunner = runner;
    this.runOverlay = true;
    this.wholeSound(empty ? 'reload_empty' : 'reload_tactical', runner);
  }

  update(dt: number, f: TaczFrame): void {
    this.lastMag = f.mag;
    this.xmag = f.xmag;
    // ---- 主轨道：换弹由游戏进度驱动
    const reloading = f.reload >= 0;
    if (reloading && !this.wasReloading) this.startReload(f);
    if (!reloading && this.reloadRunner) {
      // 换完了：剩下的收尾动作按正常速度播完
      this.reloadRunner.speed = 1;
      this.reloadRunner = null;
    }
    if (!reloading && this.tube) {
      this.tube = null;
      this.play(this.main, this.roles.tube?.end, 'once', 0.1);
    }
    this.wasReloading = reloading;
    if (this.reloadRunner) this.reloadRunner.seek(f.reload * this.reloadCool, this.sfx);
    if (this.tube) this.seekTube(f.reload);

    // 栓动 / 泵动：开火后稍等一下拉栓，拉栓动作压缩到两发的间隔里
    if (this.boltIn >= 0) {
      this.boltIn -= dt;
      if (this.boltIn < 0 && !reloading && f.mag > 0) {
        const r = this.play(this.main, this.roles.bolt, 'once', 0.1);
        if (r) {
          r.speed = Math.max(1, r.clip.end / Math.max(0.2, this.boltInterval * 0.9 - 0.08));
          this.runOverlay = true;
        }
      }
    }
    if (this.inspecting && (reloading || f.ads > 0.05 || (f.sprinting && f.speed > 1.2) || f.busy)) this.main.stop(0.2);
    if (this.main.isStopped()) this.runOverlay = false;

    // ---- 持枪姿势、快慢机位置、空仓挂机
    if (this.base.isStopped()) this.play(this.base, this.roles.staticIdle, 'loop');
    if (this.fireModeTrack.isStopped()) this.play(this.fireModeTrack, this.roles.fireMode, 'hold');
    const caught = this.roles.boltCaught;
    if (f.mag <= 0 && !reloading) {
      if (caught && this.bolt.clipName !== caught) this.play(this.bolt, caught, 'loop');
    } else if (f.mag > 0 && !this.bolt.isStopped()) this.bolt.stop();

    // ---- 移动、滑铲、瞄准
    this.walkDist += f.speed * dt * 0.6;
    this.shootCd = Math.max(0, this.shootCd - dt);
    this.updateMove(f);
    this.updateSlide(f);
    this.updateAds(f);

    for (const t of this.tracks) t.advance(dt, this.sfx);
    // 走路 / 跑步动画的进度跟着走过的距离，脚步和枪的晃动对得上
    const mr = this.move.cur;
    const byDist = (this.moveState === 'walk' && this.walkMode >= 1) || (this.moveState === 'run' && this.runMode === 0);
    if (mr && byDist && mr.mode === 'loop') mr.time = ((this.walkDist % 2) / 2) * mr.clip.end;

    // ---- 叠加出最终姿势
    this.pose.reset();
    for (const t of this.tracks) t.apply(this.pose);
    this.applyPose(f);
    this.place(f);
    this.cameraFrom(f.ads);
  }

  private updateMove(f: TaczFrame): void {
    const mainFree = this.main.isStopped() || this.runOverlay;
    const wantRun = f.sprinting && f.speed > 1.2 && !f.sliding;
    const want: 'idle' | 'walk' | 'run' = wantRun && mainFree ? 'run' : f.speed > 0.4 ? 'walk' : 'idle';
    if (want !== this.moveState) {
      if (this.moveState === 'run') this.play(this.move, 'run_end', 'hold', 0.3);
      else if (this.moveState === 'walk') this.play(this.move, 'idle', 'hold', 0.4);
      if (want === 'run') {
        this.runMode = -1;
        this.play(this.move, 'run_start', 'hold', 0.2);
      } else if (want === 'walk') this.walkMode = -1;
      this.moveState = want;
    }
    const m = this.move;
    if (this.moveState === 'idle') {
      if (m.isStopped() || m.isHolding()) this.play(m, 'idle', 'loop');
    } else if (this.moveState === 'run') {
      if (m.isHolding() && m.clipName === 'run_start') {
        this.play(m, 'run', 'loop', 0.2);
        this.runMode = 0;
      }
    } else {
      let mode = this.walkMode;
      let name = '';
      if (this.shootCd > 0) {
        mode = 0;
        name = 'idle';
      } else if (f.ads > 0.5) {
        mode = 1;
        name = 'walk_aiming';
      } else if (f.fwd > 0.3) {
        mode = 2;
        name = 'walk_forward';
      } else if (f.fwd < -0.3) {
        mode = 3;
        name = 'walk_backward';
      } else if (Math.abs(f.side) > 0.3) {
        mode = 4;
        name = 'walk_sideway';
      }
      if (name && mode !== this.walkMode) {
        this.walkMode = mode;
        this.play(m, name, 'loop', mode === 0 ? 0.3 : mode === 1 ? 0.3 : 0.4);
      }
    }
  }

  private updateSlide(f: TaczFrame): void {
    const want = f.sliding && this.main.isStopped() && f.ads < 0.5;
    const t = this.slideTrack;
    if (want && !this.sliding) {
      this.sliding = true;
      this.play(t, 'slide', 'hold', 0.5);
    } else if (!want && this.sliding) {
      this.sliding = false;
      this.play(t, 'slide_back', 'hold', 0.2);
    } else if (this.sliding && t.isHolding() && t.clipName === 'slide') this.play(t, 'slide_idle', 'loop', 0.4);
    else if (!this.sliding && t.isHolding()) t.stop(0.2);
  }

  private updateAds(f: TaczFrame): void {
    if (!this.clips.has('aim_start')) return;
    const want = f.ads > 0.5 && this.main.isStopped();
    const t = this.adsTrack;
    if (want && !this.aiming) {
      this.aiming = true;
      this.play(t, 'aim_start', 'hold', 0.2);
    } else if (!want && this.aiming) {
      this.aiming = false;
      this.play(t, 'aim_end', 'once', 0.2);
    } else if (this.aiming && t.isHolding() && t.clipName === 'aim_start') this.play(t, 'aim', 'hold', 0.2);
  }

  private readonly m4 = new Matrix4();

  private applyPose(f: TaczFrame): void {
    const model = this.model;
    for (const [name, n] of model.nodes) {
      // constraint、camera 的通道不驱动模型（分别给瞄准约束和摄像机用）
      if (name === CONSTRAINT || name === 'camera') continue;
      model.localMatrix(n, this.pose.v.get(name) ?? null, this.m4);
      for (const o of n.objs) o.matrix.copy(this.m4);
    }
    // 备用弹匣只在动画驱动它的时候出现（换弹时左手拿着的新弹匣）
    model.setVisible('additional_magazine', this.pose.touched.has('additional_magazine'));
    model.setVisible('bullet_in_barrel', f.mag > 0);
    model.setVisible('bullet_in_mag', f.mag > 1);
    model.setVisible('mag_standard', f.xmag === 0);
    for (let i = 1; i <= 3; i++) model.setVisible(`mag_extended_${i}`, f.xmag === i);
  }

  // ---------------------------------------------------------------- 定位

  private readonly G = new Matrix4();
  private readonly M = new Matrix4();
  private readonly tmpM = new Matrix4();
  private readonly vt = new Vector3();
  private readonly vq = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);

  private place(f: TaczFrame): void {
    const G = this.G.copy(f.pre);
    const T = this.tmpM;
    G.multiply(T.makeScale(TACZ_SCALE, TACZ_SCALE, TACZ_SCALE));
    G.multiply(T.makeTranslation(0, 1.5, 0));
    // 基岩版模型是上下颠倒的，绕 Z 转 180° 翻回来
    G.multiply(T.makeRotationZ(Math.PI));
    if (this.idle && this.iron) {
      this.vt.lerpVectors(this.idle.t, this.iron.t, f.ads);
      this.vq.slerpQuaternions(this.idle.q, this.iron.q, f.ads);
      this.M.compose(this.vt, this.vq, this.one);
      G.multiply(T.makeTranslation(0, 1.5, 0));
      G.multiply(this.M);
      G.multiply(T.makeTranslation(0, -1.5, 0));
    }
    this.constrain(G, f.ads);
    this.root.matrix.copy(G);
    this.root.matrixWorldNeedsUpdate = true;
  }

  private readonly anime = new Matrix4();
  private readonly origin = new Matrix4();
  private readonly ea = new Euler(0, 0, 0, 'ZYX');
  private readonly eo = new Euler(0, 0, 0, 'ZYX');
  private readonly ek = new Euler(0, 0, 0, 'ZYX');
  private readonly qk = new Quaternion();
  private readonly at = new Vector3();
  private readonly ot = new Vector3();
  private readonly m3 = new Matrix3();

  /** 瞄准时的动画约束，照搬 TACZ 的 applyAnimationConstraintTransform（包括 z 轴那个符号） */
  private constrain(G: Matrix4, w: number): void {
    if (w <= 0) return;
    const path = this.model.path(CONSTRAINT);
    if (!path) return;
    const last = path[path.length - 1];
    const A = this.anime.identity();
    const O = this.origin.identity();
    const T = this.tmpM;
    for (const n of path) {
      const v = this.pose.v.get(n.bone.name) as Float32Array;
      const y = n.bone.parent ? n.pos.y : n.pos.y - 1.5;
      if (n !== last) A.multiply(T.makeTranslation((v[0] as number) / 16, -(v[1] as number) / 16, (v[2] as number) / 16));
      A.multiply(T.makeTranslation(n.pos.x, y, n.pos.z));
      if (n !== last) {
        this.ek.set((v[3] as number) * DEG, (v[4] as number) * DEG, (v[5] as number) * DEG, 'ZYX');
        A.multiply(T.makeRotationFromQuaternion(this.qk.setFromEuler(this.ek)));
      }
      A.multiply(T.makeRotationFromEuler(n.rot));
      O.multiply(T.makeTranslation(n.pos.x, y, n.pos.z));
      O.multiply(T.makeRotationFromEuler(n.rot));
    }
    this.at.setFromMatrixPosition(A);
    this.ot.setFromMatrixPosition(O);
    this.ea.setFromRotationMatrix(A, 'ZYX');
    this.eo.setFromRotationMatrix(O, 'ZYX');
    const c = this.pose.v.get(CONSTRAINT) as Float32Array;
    const inv = this.ot.sub(this.at).applyMatrix3(this.m3.setFromMatrix4(G));
    inv.x *= (c[0] as number) - 1;
    inv.y *= (c[1] as number) - 1;
    inv.z *= 1 - (c[2] as number);
    const rx = (this.ea.x - this.eo.x) * ((c[3] as number) - 1) * w;
    const ry = (this.ea.y - this.eo.y) * ((c[4] as number) - 1) * w;
    const rz = (this.ea.z - this.eo.z) * ((c[5] as number) - 1) * w;
    const at = this.at;
    G.multiply(T.makeTranslation(at.x, at.y + 1.5, at.z));
    G.multiply(T.makeRotationX(rx));
    G.multiply(T.makeRotationY(ry));
    G.multiply(T.makeRotationZ(rz));
    G.multiply(T.makeTranslation(-at.x, -at.y - 1.5, -at.z));
    const e = G.elements;
    e[12] = (e[12] as number) - inv.x * w;
    e[13] = (e[13] as number) - inv.y * w;
    e[14] = (e[14] as number) - inv.z * w;
  }

  private cameraFrom(ads: number): void {
    const v = this.pose.v.get('camera');
    if (!v) {
      this.cameraAnim.identity();
      return;
    }
    // TACZ 的 CameraRotateListener：z 取反；瞄准时按放大倍率减弱
    this.ek.set((v[3] as number) * DEG, (v[4] as number) * DEG, -(v[5] as number) * DEG, 'ZYX');
    this.qk.setFromEuler(this.ek);
    const zoom = Math.max(1, this.json.display.ironZoom);
    const k = 1 - ads + ads / Math.sqrt(zoom);
    this.cameraAnim.identity().slerp(this.qk, k);
  }

  /** 枪口在视角模型场景里的位置 */
  /**
   * 手臂占位方块（lefthand_pos / righthand_pos，4×12×4 像素）两端在视角相机空间的位置：
   * hand = 手掌那头（方块 y 最小的一端），elbow = 另一头。视角模型用它们驱动程序手臂的 IK，
   * 方块本身不画（原版是 MC 的方块手臂，和写实场景不搭）。
   * palm（可选）：方块贴着枪的那一面的朝向（方块自己的 -Z）。TACZ 的动画都把枪放在 MC 手臂的正面上，
   * 程序手套的掌心朝这边，手指才会包住握把 / 护木，而不是手背对着枪
   */
  handEnds(left: boolean, hand: Vector3, elbow: Vector3, palm?: Vector3): boolean {
    const o = this.obj(left ? 'lefthand_pos' : 'righthand_pos');
    const mesh = o?.children[0] as import('three').Mesh | undefined;
    if (!o || !mesh) return false;
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox as import('three').Box3;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    // 手掌那头往里收 2 像素：握点在手掌中间，不在方块顶端
    hand.set(cx, b.min.y + 2 / 16, cz).applyMatrix4(mesh.matrixWorld);
    elbow.set(cx, b.max.y, cz).applyMatrix4(mesh.matrixWorld);
    palm?.set(0, 0, -1).transformDirection(mesh.matrixWorld);
    return true;
  }

  muzzleLocal(out: Vector3): Vector3 {
    this.root.updateMatrixWorld(true);
    if (this.muzzle) return this.muzzle.getWorldPosition(out);
    return out.set(0, 0, -0.5);
  }

  dispose(): void {
    this.model.dispose();
  }
}

/**
 * 读 public/tacz/manifest.json（npm run tacz:import 生成），返回「型号 id → 目录」。
 * 配置里 enabled=false 时不启用；URL 加 ?tacz=1 强制启用、?tacz=0 强制关闭，方便预览。
 * 没导入过（文件不存在）就当作没有 TACZ 枪。
 */
export async function loadTaczManifest(): Promise<Record<string, string>> {
  const q = new URLSearchParams(window.location.search).get('tacz');
  if (q === '0') return {};
  let m: TaczManifest;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}tacz/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return {};
    m = (await res.json()) as TaczManifest;
  } catch {
    return {};
  }
  if (!m.enabled && q !== '1') return {};
  const out: Record<string, string> = {};
  for (const [id, w] of Object.entries(m.weapons)) out[id] = w.dir;
  return out;
}

export async function loadTacz(id: string): Promise<TaczRig> {
  const base = `${import.meta.env.BASE_URL}tacz/${id}/`;
  const res = await fetch(`${base}gun.json`);
  if (!res.ok) throw new Error(`${base}gun.json: HTTP ${res.status}`);
  const json = (await res.json()) as GunJson;
  const tex = await new TextureLoader().loadAsync(`${base}gun.png`);
  return new TaczRig(json, tex, base);
}
