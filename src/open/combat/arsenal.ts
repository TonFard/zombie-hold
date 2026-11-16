import {
  AdditiveBlending,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import type { TaczRig } from '../../render/tacz/rig';
import { ViewModel, type ViewModelState } from '../../render/weapons/viewmodel';
import { AMMO_NAME, GUN_LIST, MELEE_LIST, type ArsenalApi, type ArsenalInput, type GameCtx, type HeldGun, type MeleeId } from '../game/api';
import { precompile } from '../render/sitesView';
import { FxPool } from './fx-pool';
import { GunAudio } from './gun-audio';
import { GUN_SPECS, falloff, farShotUrl, specOf, type GunSpec } from './gun-data';
import { GunHud } from './gun-hud';
import { ItemView } from './gun-items';
import { Grenades } from './gun-nades';
import { MELEE, MeleeView, type MeleeFrame, type MeleeKind, type MeleeSpec } from './melee-view';

/**
 * 武器：两个枪位 + 一个近战位，空手 = 拳头。开局什么都没有，枪和子弹都要自己找（子弹就是背包里的物品）。
 *
 * 分工：
 *   arsenal.ts    槽位、切换、开火（即时命中）、后坐、换弹、近战的时机和判定、存档
 *   gun-data.ts   每把枪的数值（来自主游戏的 weapons.ts × guns.ts）
 *   gun-audio.ts  枪包里的采样音效
 *   gun-hud.ts    准星、命中提示、右下角武器栏
 *   melee-view.ts 近战武器 / 拳头的第一人称模型和动作
 *   fx-pool.ts    弹着点、血雾、曳光、爆炸
 *   gun-items.ts  拿在手上用的东西（打针、抽烟、抹药、吃奶酪、手雷）的第一人称模型和动作
 *   gun-nades.ts  飞着的手雷
 * 打谁（丧尸还是带枪的人）不归这里管：子弹、近战、手雷都走 ctx.combat。
 * 枪的第一人称模型用主游戏的 ViewModel（TACZ 枪包），它的场景作为叠加层画在世界之上；近战的手和武器也挂在那个场景里。
 *
 * 每帧两步（main.ts 调）：update() 在摆相机之前——开火、换弹、切枪，后坐力直接改玩家的 yaw / pitch；
 * view() 在相机摆好以后——摆视角模型、瞄准时改视野、镜头晃动、特效、界面。
 */

const DEG = Math.PI / 180;
/** 把手上的东西放下去要多久（秒），之后才掏出下一把 */
const LOWER_T = 0.16;
/** 冲刺停下以后多久才能开火（把枪端回来） */
const SPRINT_OUT = 0.16;
/** 弹匣里还有子弹时换弹快一点（不用拉机柄） */
const TACTICAL_RELOAD = 0.85;
/** 提前这么久按下的开火也算数：换弹 / 掏枪 / 两发之间按早了，到时候照样打出去 */
const FIRE_BUFFER = 0.18;
/** 后坐力最多把视线抬高 / 带偏多少（弧度），超过就不再往上跳 */
const KICK_CAP = 0.2;
const YAW_CAP = 0.06;

/** 叠加层（视角模型）的太阳、天光最亮到多少：再亮浅色的枪就过曝泛光了 */
const VIEW_SUN_MAX = 1.8;
const VIEW_HEMI_MAX = 1.4;

/** 用东西：先花这么久把手上的武器放下去，再出现拿着东西的手；扔手雷放得快一些 */
const ACT_LOWER = 0.2;
const TOSS_LOWER = 0.12;
/** 拿着东西的手用多大的视野画（消耗品包和枪包一样按 70° 做的） */
const ITEM_FOV = 70;
/** 手雷：背包里的物品 id、从按键到收手多久（秒）、出手多快（米/秒）、引信、杀伤半径、炸点的伤害 */
const NADE_ITEM = 'grenade';
const TOSS_TIME = 0.66;
const TOSS_SPEED = 17;
const NADE_FUSE = 3.2;
const NADE_RADIUS = 7.5;
const NADE_DAMAGE = 240;
/** 手雷炸的动静引来多远的丧尸 / 人 */
const NADE_NOISE = 140;
/** 爪子（生化模式里变成丧尸以后的空手）：伤害几倍、多够多远、一下的时间乘多少 */
const CLAW_DAMAGE = 6;
const CLAW_REACH = 0.5;
const CLAW_TIME = 0.75;

/** -1 = 空手，0 / 1 = 两个枪位，2 = 近战位 */
type Slot = -1 | 0 | 1 | 2;
type Phase = 'idle' | 'lower' | 'draw';

const ease = (x: number): number => x * x * (3 - 2 * x);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

const _muzzle = new Vector3();
const _e = new Euler();
const _q = new Quaternion();
const _hitIds: number[] = [];

/** 一帧里最多攒多少条曳光（霰弹一枪 13 颗，再多的不画） */
const MAX_PENDING = 20;

export class Arsenal implements ArsenalApi {
  lookScale = 1;
  /** 换弹不用背包里的子弹（守城时据点的弹药箱、生化模式） */
  freeAmmo = false;
  /** 曳光、弹着点、血雾、爆炸：带枪的人开枪也画在这里 */
  readonly fx = new FxPool();

  private readonly vm = new ViewModel();
  private readonly meleeView = new MeleeView();
  private readonly itemView = new ItemView();
  private readonly nades: Grenades;
  private readonly hud = new GunHud();
  private readonly audio = new GunAudio();

  // ---- 身上带的
  private readonly guns: [HeldGun | null, HeldGun | null] = [null, null];
  private melee: MeleeId | null = null;
  /** 现在手上的 / 正要换到的 */
  private cur: Slot = -1;
  private want: Slot = -1;
  private phase: Phase = 'idle';
  private phaseT = 0;
  /** 等模型加载等了多久（太久就不等了：枪用程序模型，近战只显示手） */
  private loadWait = 0;
  private lastGiven: 0 | 1 = 0;

  // ---- 输入
  private active = false;
  private prevFire = false;
  private fireBuf = 0;

  // ---- 枪
  private fireT = 0;
  private fireLock = 0;
  private sinceShot = 9;
  private shotInterval = 0.2;
  private ads = 0;
  private scoped = false;
  private sprintOut = 0;
  /** 连续开火越打越散 0–1 */
  private bloom = 0;
  private bloomHold = 0;
  /** 换弹：经过的秒数（-1 = 没在换）、总时长、是不是一发发塞、动画按多大的弹匣播 */
  private reloadT = -1;
  private reloadDur = 1;
  private tube = false;
  private reloadMag = 0;
  private readonly tubeAt: number[] = [];
  private tubeNext = 0;
  private autoReload = 0;
  /** 后坐力：还没加到视线上的、已经加上去还能回落的 */
  private pendPitch = 0;
  private pendYaw = 0;
  private recPitch = 0;
  private recYaw = 0;
  private lastPitch = NaN;
  /** 这一帧开了几枪（view() 里交给视角模型）、最后一发是不是打空了弹匣 */
  private shots = 0;
  private shotLast = false;
  private readonly pending = new Float32Array(MAX_PENDING * 4);
  private pendingN = 0;

  // ---- 近战
  private swingT = -1;
  private swingDur = 0.5;
  private swingHit = false;
  private whooshed = false;
  private weak = false;
  private combo = 0;
  private hitStop = 0;
  private sinceSwing = 99;
  /** 生化模式里变成了丧尸：只能空手，拳头换成爪子 */
  private clawed = false;

  // ---- 用东西（打针、吃、包扎）：经过的秒数（-1 = 没在用）、一共多久、用完叫谁、有没有专门的手部模型
  private useT = -1;
  private useDur = 1;
  private useDone: (() => void) | null = null;
  private useRig = false;
  // ---- 扔手雷：经过的秒数（-1 = 没在扔）、有没有手部模型、出手了没有
  private throwT = -1;
  private throwRig = false;
  private thrown = false;
  private blastErr = false;

  // ---- 镜头晃动（近战打中时的一下）：俯仰、侧倾各一根弹簧
  private shx = 0;
  private shz = 0;
  private shvx = 0;
  private shvz = 0;

  // ---- 视角模型
  private readonly vmState: ViewModelState = { kind: 'pistol', scope: false, tier: 0, alive: true, lowered: false, reload: -1, reloadTime: 1, recoil: 0, speed: 0, sprinting: false, yaw: 0, pitch: 0, ads: 0, melee: -1, crouch: 0, sliding: false, sprintOut: 0, mag: 0, magMax: 1, fwd: 0, side: 0, gun: '' };
  private readonly meleeFrame: MeleeFrame = { kind: null, up: false, swing: -1, combo: 0, speed: 0, sprinting: false, yaw: 0, pitch: 0 };
  /** 视角模型自己的东西（枪、它的手臂）现在显示着没有；拿近战武器时藏起来 */
  private gunLayer = true;
  private readonly hiddenByMelee: Object3D[] = [];
  private readonly baseFov: number;
  private viewH = window.innerHeight;
  /** 新加载好的模型：下一帧先往 1×1 的缓冲里画一遍，把着色器、网格、贴图都传上去，第一次真正出现时不卡 */
  private readonly warmQueue: Object3D[] = [];
  private readonly warmTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  /** 预编译用的替身材质：留着不释放，对应的着色器程序就一直在缓存里 */
  private keep: Material[] = [];
  /** 叠加层里 ViewModel 自己的两盏灯（它每帧按世界的光照设，这里在它之后压一下上限） */
  private viewSun: { intensity: number } | null = null;
  private viewHemi: { intensity: number } | null = null;
  private startGive: string[] = [];
  private debugRow: Group | null = null;

  private constructor(private readonly ctx: GameCtx) {
    this.baseFov = ctx.camera.fov;
    this.nades = new Grenades(ctx.world);
  }

  static async create(ctx: GameCtx): Promise<Arsenal> {
    const a = new Arsenal(ctx);
    await a.init();
    return a;
  }

  private async init(): Promise<void> {
    const { ctx, vm } = this;
    ctx.post.setOverlay(vm.scene, vm.camera);
    ctx.post.setOverlayVisible(false);
    vm.scene.add(this.meleeView.root);
    vm.scene.add(this.itemView.root);
    ctx.scene.add(this.fx.group);
    ctx.scene.add(this.nades.group);
    vm.onSound = (url, gain, speed, until) => {
      // 开火的采样音量是 1，动作音效是 0.75；开火的音高略微随机。动作音效跟着动画的快慢压短 / 拉长
      if (gain >= 1) this.audio.play(url, 0.85, 0.96 + Math.random() * 0.08);
      else this.audio.play(url, 0.6, 1, speed, until);
    };
    vm.onTaczReady = (id, urls) => {
      this.audio.preload(urls);
      const rig = this.rigOf(id);
      if (rig) this.warmQueue.push(rig.root);
    };
    this.meleeView.onModel = (obj, textures) => {
      for (const t of textures) ctx.renderer.initTexture(t);
      this.warmQueue.push(obj);
    };
    this.itemView.onModel = (obj, tex) => {
      if (tex) ctx.renderer.initTexture(tex);
      this.warmQueue.push(obj);
    };
    this.itemView.onCue = (kind) => this.audio.cue(kind);
    this.nades.onBlast = (x, y, z, mine) => this.blast(x, y, z, mine);
    this.nades.onTrail = (x, y, z) => this.fx.puff(x, y, z);
    this.nades.onBounce = (x, y, z, speed) => {
      const p = ctx.player;
      const d = Math.hypot(x - p.x, y - p.feet - p.eye, z - p.z);
      if (d < 30) this.audio.tink(Math.min(0.3, 0.05 * speed) * (1 - d / 30), this.panOf(x - p.x, z - p.z));
    };
    window.addEventListener('resize', () => (this.viewH = window.innerHeight));
    // 消耗品包（只在本机有）：清单读不到就是没导入过，用东西时只把手放下去、手雷用程序做的模型。?stims=0 = 装作没导入过
    await this.itemView.init(ctx.params.get('stims') === '0');
    await this.nades.load(this.itemView.worldUrl(NADE_ITEM));

    // 叠加层的着色器现在就编译好：TACZ 枪的两种材质、枪口火光、手臂（都还没有真的模型，用同样参数的替身）。
    // 等捡到第一把枪才编译的话，掏枪那一下会卡一两百毫秒
    for (const o of vm.scene.children) {
      const l = o as unknown as { isDirectionalLight?: boolean; isHemisphereLight?: boolean; intensity: number };
      if (l.isDirectionalLight) this.viewSun = l;
      else if (l.isHemisphereLight) this.viewHemi = l;
    }
    this.syncView(ctx.camera);
    const tex = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.needsUpdate = true;
    const tri = new BufferGeometry();
    tri.setAttribute('position', new Float32BufferAttribute([0, 0, -1, 0.01, 0, -1, 0, 0.01, -1], 3));
    tri.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    tri.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    this.keep = [
      new MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.15, alphaTest: 0.5, side: DoubleSide }),
      new MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: DoubleSide, toneMapped: false }),
      new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide }),
    ];
    const warm = new Group();
    warm.add(new Mesh(tri, this.keep[0]), new Mesh(tri, this.keep[1]), new Mesh(new PlaneGeometry(0.01, 0.01), this.keep[2]));
    vm.scene.add(warm);
    await precompile(ctx.renderer, vm.scene, vm.camera);
    vm.scene.remove(warm);
    await precompile(ctx.renderer, this.fx.group, ctx.camera, ctx.scene);
    await precompile(ctx.renderer, this.nades.group, ctx.camera, ctx.scene);
    // 手臂（ViewModel 的两条、近战的两条、拿东西的两条）和枪口火光的网格、贴图：头几帧往 1×1 的缓冲里各画一遍，传上显卡。
    // 火光是 ViewModel 私有的、换枪时才挂到枪上，这里借出来画一下（只读，不改它）
    const flash = (vm as unknown as { flash?: Object3D }).flash;
    if (flash) this.warmQueue.push(flash);
    this.warmQueue.push(this.meleeView.root);
    this.warmQueue.push(this.itemView.root);
    // 别人开枪用的采样（十八把枪各一个，几十 KB）：现在就下载，等有人开枪时已经解码好了
    this.audio.preload(
      GUN_LIST.map((g) => farShotUrl(g.id)),
      true,
    );

    // 调试：?give=ak47,bat 开局就带着（第一帧给，那时背包才能用）
    this.startGive = (ctx.params.get('give') ?? '').split(',').filter((x) => x);
  }

  /** 世界的环境贴图、光照同步到叠加层，再把两盏灯压到不过曝的亮度 */
  private syncView(camera: PerspectiveCamera): void {
    this.vm.sync(camera, this.ctx.scene, this.ctx.lighting);
    const sun = this.viewSun;
    const hemi = this.viewHemi;
    if (sun && sun.intensity > VIEW_SUN_MAX) sun.intensity = VIEW_SUN_MAX;
    if (hemi && hemi.intensity > VIEW_HEMI_MAX) hemi.intensity = VIEW_HEMI_MAX;
  }

  /** 手上是不是拿着东西（枪或近战武器） */
  get armed(): boolean {
    return this.cur >= 0;
  }

  /**
   * ViewModel 把加载好的 TACZ 模型放在私有的表里，没有公开的读法。这里只读：要它的换弹方式（弹匣 / 一发发塞）、
   * 各段动画多长、掏枪时间，还有模型的根节点（预热用）。主游戏的文件不能改，所以绕过类型拿一下
   */
  private rigOf(id: string): TaczRig | null {
    return (this.vm as unknown as { tacz?: Map<string, TaczRig> }).tacz?.get(id) ?? null;
  }

  private gunInHand(): HeldGun | null {
    return this.cur === 0 || this.cur === 1 ? this.guns[this.cur] : null;
  }

  private meleeKind(): MeleeKind {
    return this.cur === 2 && this.melee ? this.melee : 'fists';
  }

  /** 手上那件东西的模型好了没有 */
  private handReady(): boolean {
    const g = this.gunInHand();
    if (g) return this.vm.hasTacz(g.id) || this.loadWait > 4;
    return this.meleeView.ready(this.meleeKind()) || this.loadWait > 3;
  }

  // ---------------------------------------------------------------- 槽位、切换

  private select(slot: Slot): void {
    // 爪子：枪和近战武器拿不出来
    if (this.clawed && slot !== -1) return;
    if (slot === 2 && !this.melee) slot = -1;
    if ((slot === 0 || slot === 1) && !this.guns[slot]) return;
    if (slot === this.want) return;
    this.want = slot;
    this.reloadT = -1;
    this.swingT = -1;
    this.fireBuf = 0;
    if (this.phase !== 'lower') {
      this.phase = 'lower';
      // 空手：拳头举着的话收一下，没举着直接换
      this.phaseT = this.cur === -1 ? (this.sinceSwing < 1.1 ? 0.1 : 0) : LOWER_T;
    }
    if (this.phaseT <= 0) this.arrive();
  }

  /** 旧的放下去了：换成新的，开始掏 */
  private arrive(): void {
    this.cur = this.want;
    this.reloadT = -1;
    this.swingT = -1;
    this.ads = 0;
    this.bloom = 0;
    this.autoReload = 0;
    this.fireT = 0;
    this.loadWait = 0;
    this.sinceSwing = 99;
    const g = this.gunInHand();
    if (g) {
      this.vm.ensureTacz(g.id);
      const rig = this.rigOf(g.id);
      this.phase = 'draw';
      this.phaseT = clamp(rig?.json.data.drawTime ?? 0.4, 0.25, 0.65);
      // 同一把枪收起来又掏出来：视角模型不会重播掏枪动画（它只在换型号时播），声音自己补上
      if (rig && this.vm.taczId === g.id) {
        const s = rig.json.display.sounds.draw;
        if (s) this.audio.play(`${import.meta.env.BASE_URL}tacz/${g.id}/sfx/${s}.ogg`, 0.6);
      }
    } else if (this.cur === 2 && this.melee) {
      this.meleeView.ensure(this.melee);
      this.phase = 'draw';
      this.phaseT = 0.22;
    } else {
      this.cur = this.want = -1;
      this.phase = 'idle';
    }
  }

  /** 把视角模型里的枪一下子放到画面下面（枪要凭空消失 / 换成另一把的时候：再出现时是从下面举上来的） */
  private snapGunLow(): void {
    if (!this.vm.taczId) return;
    const st = this.vmState;
    st.lowered = true;
    st.reload = -1;
    st.ads = 0;
    this.vm.update(0.5, st);
  }

  giveGun(gun: HeldGun): HeldGun | null {
    const s = specOf(gun.id);
    if (!s) {
      console.warn(`武器：没有这把枪 ${gun.id}`);
      return null;
    }
    const g: HeldGun = { id: gun.id, loaded: clamp(Math.round(gun.loaded) || 0, 0, s.st.mag) };
    if (gun.loan) g.loan = true;
    this.vm.ensureTacz(g.id);
    // 正在用东西 / 扔手雷 / 是爪子：枪先收进枪位，不自己掏出来
    const bare = this.want === -1 && !this.clawed && this.useT < 0 && this.throwT < 0;
    let old: HeldGun | null = null;
    let slot: 0 | 1 = 0;
    if (!this.guns[0]) slot = 0;
    else if (!this.guns[1]) slot = 1;
    else {
      // 两个枪位都满了：换掉手上那把（手上是近战 / 空手就换 1 号位）
      slot = this.want === 1 ? 1 : 0;
      old = this.guns[slot];
      // 被换下来的是借来的：直接还回去，不交给调用方丢在地上（不然借的枪就变成能捡的了）
      if (old?.loan) old = null;
    }
    const inHand = this.cur === slot && this.gunInHand() !== null;
    if (inHand) this.snapGunLow();
    this.guns[slot] = g;
    this.lastGiven = slot;
    if (inHand) {
      this.want = slot;
      this.arrive();
    } else if (bare) this.select(slot);
    return old;
  }

  giveMelee(id: MeleeId): MeleeId | null {
    if (!MELEE_LIST.some((m) => m.id === id)) {
      console.warn(`武器：没有这种近战武器 ${id}`);
      return null;
    }
    const old = this.melee;
    const bare = this.want === -1 && !this.clawed && this.useT < 0 && this.throwT < 0;
    this.melee = id;
    this.meleeView.ensure(id);
    if (this.cur === 2) {
      this.want = 2;
      this.arrive();
    } else if (bare) this.select(2);
    return old;
  }

  private dropInHand(): boolean {
    const g = this.gunInHand();
    if (g?.loan) {
      this.ctx.toast('借来的枪丢不掉，用完会收回去', 1.8);
      return true;
    }
    this.stopUse();
    if (g) {
      this.ctx.drop(`gun_${g.id}`, 1, g.loaded);
      this.guns[this.cur as 0 | 1] = null;
      this.ctx.toast(`丢下了${specOf(g.id)?.name ?? g.id}`, 1.6);
      this.snapGunLow();
    } else if (this.cur === 2 && this.melee) {
      this.ctx.drop(`melee_${this.melee}`);
      this.ctx.toast(`丢下了${MELEE[this.melee].name}`, 1.6);
      this.melee = null;
      this.meleeView.snapDown();
    } else return false;
    this.bare();
    return true;
  }

  /** 立刻回到空手（不播放下的过程） */
  private bare(): void {
    this.cur = this.want = -1;
    this.phase = 'idle';
    this.reloadT = -1;
    this.swingT = -1;
    this.ads = 0;
    this.fireBuf = 0;
    this.autoReload = 0;
    this.sinceSwing = 99;
  }

  key(code: string): boolean {
    // 爪子：武器的键一个都不管（枪拿不出来、手雷扔不了）
    if (!this.active || this.clawed) return false;
    const tossing = this.throwT >= 0;
    switch (code) {
      case 'Digit1':
      case 'Digit2': {
        const i = code === 'Digit1' ? 0 : 1;
        if (!this.guns[i]) return false;
        if (tossing) return true;
        if (this.useT >= 0) {
          // 正在用东西：不用了，把这把枪拿（回）到手上
          this.stopUse();
          this.select(i);
          return true;
        }
        // 再按一次手上那个槽位 = 收起来
        this.select(this.want === i ? -1 : i);
        return true;
      }
      case 'Digit3':
        if (!this.melee && this.want === -1) return false;
        if (tossing) return true;
        if (this.useT >= 0) {
          this.stopUse();
          this.select(this.melee ? 2 : -1);
          return true;
        }
        this.select(this.melee && this.want !== 2 ? 2 : -1);
        return true;
      case 'KeyX':
        if (this.want === -1) return false;
        if (tossing) return true;
        this.stopUse();
        this.select(-1);
        return true;
      case 'KeyR': {
        const g = this.gunInHand();
        if (!g) return false;
        // 用东西、扔手雷的时候不能换弹
        if (tossing || this.useT >= 0) return true;
        const s = GUN_SPECS[g.id] as GunSpec;
        if (this.phase === 'idle' && this.reloadT < 0 && g.loaded < s.st.mag && !this.startReload(g, s)) this.ctx.toast(`${AMMO_NAME[s.ammo]}打光了`, 1.6);
        return true;
      }
      case 'KeyG':
        if (tossing) return true;
        return this.phase !== 'lower' && this.dropInHand();
      case 'KeyQ':
        this.startToss();
        return true;
      default:
        return false;
    }
  }

  wheel(dir: number): void {
    if (!this.active || !dir || this.clawed || this.throwT >= 0) return;
    // 有东西的槽位里转圈；空手时往下滚 = 第一个，往上滚 = 最后一个
    let first: Slot = -1;
    let last: Slot = -1;
    let prev: Slot = -1;
    let next: Slot = -1;
    let seen = false;
    for (let i = 0; i < 3; i++) {
      const has = i === 2 ? !!this.melee : !!this.guns[i as 0 | 1];
      if (!has) continue;
      const s = i as Slot;
      if (first === -1) first = s;
      if (s === this.want) seen = true;
      else if (!seen) prev = s;
      else if (next === -1) next = s;
      last = s;
    }
    if (first === -1) return;
    const to: Slot = dir > 0 ? (seen && next !== -1 ? next : first) : seen && prev !== -1 ? prev : last;
    if (to === this.want) return;
    // 换武器 = 手上正在用的东西不用了
    this.stopUse();
    this.select(to);
  }

  strip(): void {
    this.stopAct();
    for (let i = 0; i < 2; i++) {
      const g = this.guns[i as 0 | 1];
      // 借来的枪不掉在地上：留在枪位里，returnLoans 的时候收走
      if (!g || g.loan) continue;
      this.ctx.drop(`gun_${g.id}`, 1, g.loaded);
      this.guns[i as 0 | 1] = null;
    }
    if (this.melee) this.ctx.drop(`melee_${this.melee}`);
    this.melee = null;
    this.snapGunLow();
    this.meleeView.snapDown();
    this.bare();
  }

  /** 借来的枪全收走；手上正拿着的话换成另一个枪位里的，没有就空手 */
  returnLoans(): void {
    let hand = false;
    for (let i = 0; i < 2; i++) {
      const g = this.guns[i as 0 | 1];
      if (!g?.loan) continue;
      if (this.want === i || this.cur === i) hand = true;
      this.guns[i as 0 | 1] = null;
    }
    if (!hand) return;
    this.snapGunLow();
    this.bare();
    const other: Slot = this.guns[0] ? 0 : this.guns[1] ? 1 : -1;
    if (other !== -1) this.select(other);
  }

  held(): ReadonlyArray<HeldGun | null> {
    return this.guns;
  }

  /** 这把枪换弹用不用背包里的子弹 */
  private free(g: HeldGun): boolean {
    return this.freeAmmo || !!g.loan;
  }

  get claws(): boolean {
    return this.clawed;
  }

  set claws(v: boolean) {
    if (v === this.clawed) return;
    this.clawed = v;
    this.meleeView.setClaws(v);
    if (!v) return;
    // 变成丧尸的那一下：手上的东西全放下（枪和近战武器还在枪位里，只是拿不出来）
    this.stopAct();
    this.snapGunLow();
    this.meleeView.snapDown();
    this.bare();
  }

  /** (dx, dz) = 从玩家指向声音的水平方向：返回左右声道的偏移（-1 左，1 右）；贴得很近的不偏 */
  private panOf(dx: number, dz: number): number {
    const h = Math.hypot(dx, dz);
    if (h < 0.5) return 0;
    const p = this.ctx.player;
    // 玩家的右手边 = (-cos yaw, sin yaw)（yaw 0 = 朝 +z）
    return ((-Math.cos(p.yaw) * dx + Math.sin(p.yaw) * dz) / h) * Math.min(1, h / 4) * 0.85;
  }

  shotAt(gunId: string, x: number, y: number, z: number): void {
    const p = this.ctx.player;
    const dx = x - p.x;
    const dz = z - p.z;
    this.audio.far(farShotUrl(gunId), Math.hypot(dx, y - p.feet - p.eye, dz), this.panOf(dx, dz));
  }

  // ---------------------------------------------------------------- 用东西、扔手雷

  get using(): boolean {
    return this.useT >= 0;
  }

  use(item: string, seconds: number, done: () => void): boolean {
    const { ctx } = this;
    if (this.useT >= 0 || this.throwT >= 0 || this.reloadT >= 0 || this.clawed || ctx.survival.dead || ctx.garage.driving) return false;
    const dur = Math.max(0.3, Number.isFinite(seconds) ? seconds : 1);
    this.swingT = -1;
    this.fireBuf = 0;
    this.autoReload = 0;
    this.useT = 0;
    this.useDur = dur;
    this.useDone = done;
    // 太短的动作（不到半秒）来不及掏东西：只把手放下去
    this.useRig = dur >= ACT_LOWER + 0.3 && this.itemView.begin(item, 'use', dur - ACT_LOWER);
    if (!this.useRig) this.audio.cue('cloth');
    return true;
  }

  throwGrenade(x: number, y: number, z: number, vx: number, vy: number, vz: number, fuse: number, byPlayer: boolean): void {
    this.nades.launch(x, y, z, vx, vy, vz, fuse, byPlayer);
  }

  /** 中途不用了（切武器、死了、上车）：done 不会被调 */
  private stopUse(): void {
    if (this.useT < 0) return;
    this.useT = -1;
    this.useDone = null;
    this.endAct();
  }

  /** 手雷还没出手就不扔了（没出手的不扣背包里的）；已经出手的照飞 */
  private stopToss(): void {
    if (this.throwT < 0) return;
    this.throwT = -1;
    this.endAct();
  }

  private stopAct(): void {
    this.stopUse();
    this.stopToss();
  }

  /** 用完 / 扔完 / 被打断：拿着东西的手收起来，原来的武器从下面重新举上来 */
  private endAct(): void {
    this.itemView.end();
    if (this.cur === 0 || this.cur === 1) this.snapGunLow();
    else this.meleeView.snapDown();
    if (this.cur >= 0 && this.phase === 'idle') {
      this.phase = 'draw';
      this.phaseT = 0.25;
    }
    this.fireBuf = 0;
  }

  /** 按了 Q：背包里有手雷就拔销、扔 */
  private startToss(): void {
    const { ctx } = this;
    if (this.throwT >= 0 || this.useT >= 0) return;
    if (ctx.bag.count(NADE_ITEM) <= 0) {
      ctx.toast('没有手雷', 1.4);
      return;
    }
    if (this.nades.full) return;
    // 正在换弹的话不换了：弹匣枪这一次白换，一发发塞的已经塞进去的还在
    this.reloadT = -1;
    this.swingT = -1;
    this.autoReload = 0;
    this.fireBuf = 0;
    this.throwT = 0;
    this.thrown = false;
    this.throwRig = this.itemView.begin(NADE_ITEM, 'toss', TOSS_TIME - TOSS_LOWER);
    if (!this.throwRig) this.audio.cue('pin');
  }

  private updateToss(dt: number): void {
    this.throwT += dt;
    const at = this.throwRig ? TOSS_LOWER + (TOSS_TIME - TOSS_LOWER) * this.itemView.release : TOSS_TIME * 0.6;
    if (!this.thrown && this.throwT >= at) {
      this.thrown = true;
      this.tossNow();
    }
    if (this.throwT >= TOSS_TIME) {
      this.throwT = -1;
      this.endAct();
    }
  }

  /** 出手：从右手的位置顺着视线扔出去，带一点往上的劲和人自己的速度 */
  private tossNow(): void {
    const { ctx } = this;
    const p = ctx.player;
    // 这半秒里别人把六颗的位子占满了：这一颗不扔，背包里的也不扣
    if (this.nades.full || ctx.bag.take(NADE_ITEM, 1) <= 0) return;
    const cp = Math.cos(p.pitch);
    const fx = Math.sin(p.yaw) * cp;
    const fy = Math.sin(p.pitch);
    const fz = Math.cos(p.yaw) * cp;
    const rx = -Math.cos(p.yaw);
    const rz = Math.sin(p.yaw);
    const ey = p.feet + p.eye;
    let ox = p.x + fx * 0.3 + rx * 0.16;
    let oy = ey - 0.06 + fy * 0.3;
    let oz = p.z + fz * 0.3 + rz * 0.16;
    // 贴着墙扔：手伸出去的地方已经在墙那边了，就从眼睛前面一点出手
    const dx = ox - p.x;
    const dy = oy - ey;
    const dz = oz - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (ctx.world.raycast(p.x, ey, p.z, dx / d, dy / d, dz / d, d + 0.1, false) !== Infinity) {
      ox = p.x;
      oy = ey - 0.05;
      oz = p.z;
    }
    this.nades.launch(ox, oy, oz, fx * TOSS_SPEED + p.vx * 0.7, fy * TOSS_SPEED + 3.2, fz * TOSS_SPEED + p.vz * 0.7, NADE_FUSE, true);
    this.audio.cue('throw');
  }

  /** 一颗手雷炸了。mine = 玩家扔的（经验、仇恨算玩家的；伤害走 ctx.combat，它连玩家自己一起算） */
  private blast(x: number, y: number, z: number, mine: boolean): void {
    const { ctx } = this;
    const p = ctx.player;
    // 火光、声音、震动先做：就算下面算伤害的模块出了错，这一下也炸出来了
    this.fx.blast(x, y, z, NADE_RADIUS);
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, y - p.feet - 0.9, dz);
    this.audio.boom(d, this.panOf(dx, dz));
    if (d < 40) this.shake(3.2 * (1 - d / 40) * (1 - d / 40));
    // 炸点抬高一点：手雷躺在地上，从地面那一层往外看全是地
    const by = y + 0.15;
    let n = 0;
    try {
      if (mine) {
        n = ctx.combat.blast(x, by, z, NADE_RADIUS, NADE_DAMAGE);
        ctx.combat.noise(x, z, NADE_NOISE);
      } else {
        ctx.horde.blast(x, by, z, NADE_RADIUS, NADE_DAMAGE, false);
        ctx.raiders.blast(x, by, z, NADE_RADIUS, NADE_DAMAGE, false);
        this.blastPlayer(x, by, z);
        // 别人扔的：丧尸照样被引过来；带枪的人不当成玩家的动静（combat.noise 是「玩家弄出来的」）
        ctx.horde.noise(x, z, NADE_NOISE);
      }
    } catch (e) {
      if (!this.blastErr) {
        this.blastErr = true;
        console.error('[open] 手雷：算伤害时出错（丧尸 / 带枪的人那边）', e);
      }
    }
    if (mine && n > 0) this.hud.hitMark(false, false);
  }

  /** 别人扔的手雷伤到玩家：和 game/combat.ts 里玩家自己的手雷同一个算法（按距离平方衰减，隔着墙不算，坐在车里减半） */
  private blastPlayer(x: number, y: number, z: number): void {
    const { ctx } = this;
    const p = ctx.player;
    const py = p.feet + 0.9;
    const d = Math.hypot(p.x - x, py - y, p.z - z);
    if (d >= NADE_RADIUS || ctx.survival.dead) return;
    const L = Math.max(d, 1e-3);
    const clear = d < 0.6 || ctx.world.raycast(x, y + 0.2, z, (p.x - x) / L, (py - y - 0.2) / L, (p.z - z) / L, L - 0.4, false) === Infinity;
    if (!clear) return;
    const k = 1 - d / NADE_RADIUS;
    ctx.survival.hurt(NADE_DAMAGE * k * k * (ctx.garage.driving ? 0.5 : 1), x, z, '被炸死');
  }

  save(): unknown {
    // 借来的枪不进存档
    const slot = (this.want === 0 || this.want === 1) && this.guns[this.want]?.loan ? -1 : this.want;
    return { v: 1, guns: this.guns.map((g) => (g && !g.loan ? { id: g.id, loaded: g.loaded } : null)), melee: this.melee, slot };
  }

  load(data: unknown): void {
    this.stopAct();
    this.snapGunLow();
    this.meleeView.snapDown();
    this.guns[0] = this.guns[1] = null;
    this.melee = null;
    this.bare();
    const d = data as { guns?: unknown; melee?: unknown; slot?: unknown } | null;
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.guns)) {
      for (let i = 0; i < 2; i++) {
        const g = d.guns[i] as Partial<HeldGun> | null | undefined;
        const s = g && typeof g.id === 'string' ? specOf(g.id) : undefined;
        if (!g || !s) continue;
        this.guns[i as 0 | 1] = { id: s.id, loaded: clamp(Math.round(Number(g.loaded)) || 0, 0, s.st.mag) };
        this.vm.ensureTacz(s.id);
      }
    }
    if (typeof d.melee === 'string' && MELEE_LIST.some((m) => m.id === d.melee)) {
      this.melee = d.melee as MeleeId;
      this.meleeView.ensure(this.melee);
    }
    const slot = Number(d.slot);
    if (slot === 0 || slot === 1 || slot === 2) this.select(slot);
  }

  // ---------------------------------------------------------------- 每帧：逻辑

  update(dt: number, inp: ArsenalInput): void {
    const { ctx } = this;
    this.audio.pump();
    if (this.startGive.length) {
      for (const id of this.startGive.splice(0)) this.debugGive(id);
    }
    // 扔出去的手雷：不管现在能不能用武器（上了车、开着背包）都接着飞、接着炸
    this.nades.update(dt);
    const active = inp.active && !ctx.survival.dead;
    if (active !== this.active) this.setActive(active);
    // 用东西：开着背包也接着走（从背包里点「用」的时候背包是开着的）；死了、上了车就不用了
    if (this.useT >= 0) {
      if (ctx.survival.dead || ctx.garage.driving) this.stopUse();
      else {
        this.useT += dt;
        if (this.useT >= this.useDur) {
          const done = this.useDone;
          this.useT = -1;
          this.useDone = null;
          this.endAct();
          done?.();
        }
      }
    }
    if (!active) {
      this.prevFire = false;
      return;
    }
    if (inp.fire && !this.prevFire) this.fireBuf = FIRE_BUFFER;
    else this.fireBuf = Math.max(0, this.fireBuf - dt);
    this.prevFire = inp.fire;
    this.fireT = Math.max(-dt, this.fireT - dt);
    this.fireLock = Math.max(0, this.fireLock - dt);
    this.sinceShot += dt;

    if (this.phase === 'lower') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.arrive();
    } else if (this.phase === 'draw') {
      if (this.handReady()) {
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.phase = 'idle';
      } else this.loadWait += dt;
    }

    if (this.throwT >= 0) this.updateToss(dt);
    const g = this.gunInHand();
    if (this.useT >= 0 || this.throwT >= 0) {
      // 手上拿着别的东西：不开枪、不换弹、不瞄准（走路、跑步照常）
      this.fireBuf = 0;
      this.autoReload = 0;
      this.ads = Math.max(0, this.ads - dt * 8);
    } else if (g) this.updateGun(dt, inp, g, GUN_SPECS[g.id] as GunSpec);
    else {
      this.ads = 0;
      this.updateMelee(dt, inp);
    }
    this.updateRecoil(dt);
  }

  /** 能用 ↔ 不能用（上车、开背包、死了） */
  private setActive(on: boolean): void {
    this.active = on;
    if (!on) this.stopToss();
    if (this.phase === 'lower') this.arrive();
    this.reloadT = -1;
    this.swingT = -1;
    this.fireBuf = 0;
    this.ads = 0;
    this.autoReload = 0;
    this.sinceSwing = 99;
    // 这期间视角可能被别人改过（下车时车会重设朝向）：后坐力的账清掉，不往回拉
    this.pendPitch = this.pendYaw = this.recPitch = this.recYaw = 0;
    this.lastPitch = NaN;
    if (!on) {
      this.snapGunLow();
      this.meleeView.snapDown();
    } else if (this.cur >= 0) {
      // 回来以后重新把武器举起来
      this.phase = 'draw';
      this.phaseT = Math.max(this.phaseT, 0.25);
    }
  }

  private updateGun(dt: number, inp: ArsenalInput, g: HeldGun, s: GunSpec): void {
    const p = this.ctx.player;
    const idle = this.phase === 'idle';
    const sprinting = p.sprinting && p.speed > 1.5;
    if (sprinting) this.sprintOut = SPRINT_OUT;
    else this.sprintOut = Math.max(0, this.sprintOut - dt);

    // 瞄准：冲刺、换弹、掏枪时举不起来
    const wantAds = inp.ads && idle && !sprinting && this.reloadT < 0;
    const step = dt / Math.max(0.05, s.st.adsTime);
    this.ads = clamp(this.ads + (wantAds ? step : -step * 1.3), 0, 1);

    if (this.bloomHold > 0) this.bloomHold -= dt;
    else this.bloom = Math.max(0, this.bloom - dt * 2.8);

    // ---- 换弹
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const prog = Math.min(1, this.reloadT / this.reloadDur);
      if (this.tube) {
        // 一发发塞：动画里每塞进去一发，背包里少一发
        while (this.tubeNext < this.tubeAt.length && prog >= (this.tubeAt[this.tubeNext] as number)) {
          this.tubeNext++;
          if (this.free(g) || this.ctx.bag.take(s.ammoItem, 1) > 0) g.loaded++;
        }
        // 塞到一半要开枪：停下来，有几发打几发。这一下扳机留到收尾动作做完再打出去
        if (this.fireBuf > 0 && g.loaded > 0) {
          this.endReload(g, s, false);
          this.fireBuf = this.fireLock + 0.1;
        }
      }
      if (this.reloadT >= 0 && prog >= 1) this.endReload(g, s, true);
    }

    // 打空了：过一小会儿自己换弹（中途切枪就不换了）
    if (this.autoReload > 0) {
      this.autoReload -= dt;
      if (this.autoReload <= 0 && idle && g.loaded <= 0 && this.reloadT < 0) this.startReload(g, s);
    }

    // ---- 开火
    if (!idle || this.reloadT >= 0) return;
    const trigger = this.fireBuf > 0 || (s.auto && inp.fire);
    if (!trigger || this.fireT > 0 || this.fireLock > 0 || sprinting || this.sprintOut > 0) return;
    if (g.loaded > 0) {
      this.fireBuf = 0;
      this.shoot(g, s);
      this.fireT += 1 / s.st.rate;
    } else if (this.fireBuf > 0) {
      // 空仓：咔一声，有备弹就换
      this.fireBuf = 0;
      this.audio.dry();
      this.startReload(g, s);
    }
  }

  private startReload(g: HeldGun, s: GunSpec): boolean {
    const need = s.st.mag - g.loaded;
    const have = this.free(g) ? need : this.ctx.bag.count(s.ammoItem);
    if (need <= 0 || have <= 0) return false;
    const n = Math.min(need, have);
    const rig = this.rigOf(g.id);
    const t = rig?.json.roles.tube ?? null;
    this.tubeAt.length = 0;
    this.tubeNext = 0;
    this.autoReload = 0;
    if (rig && t) {
      // 管状弹仓（M870、M1014、Kar98）：前奏 + 每发一段。时间线和 TaczRig.startTube 排的一样，
      // 动画按「这次要塞 n 发」播（告诉它弹匣容量 = 现在的 + n）
      const len = (name: string): number => rig.clips.get(name)?.end ?? 0.5;
      const empty = g.loaded <= 0;
      const intro = len(empty ? t.introEmpty : t.intro);
      const loop = len(t.loop);
      // 空仓的前奏自己会往膛里塞一发
      const chamber = empty && t.introEmpty !== t.intro ? 1 : 0;
      const loops = n - chamber;
      const total = intro + loops * loop;
      // 塞一发在这一段动画的哪个时刻：那一段第一个音效（子弹推进去的声音）
      const at = rig.clips.get(t.loop)?.sfx[0]?.[0] ?? loop * 0.5;
      if (chamber) this.tubeAt.push((intro * 0.9) / total);
      for (let i = 0; i < loops; i++) this.tubeAt.push((intro + i * loop + at) / total);
      // 速度：原动画塞满要五六秒，按主游戏的换弹时间压一压，但不比原动画慢
      const full = len(t.intro) + s.st.mag * loop;
      this.reloadDur = total * clamp((s.st.reload * 1.4) / full, 0.5, 1);
      this.tube = true;
      this.reloadMag = g.loaded + n;
    } else {
      this.reloadDur = s.st.reload * (g.loaded > 0 ? TACTICAL_RELOAD : 1);
      this.tube = false;
      this.reloadMag = s.st.mag;
    }
    this.reloadT = 0;
    this.ads = Math.min(this.ads, 0.5);
    return true;
  }

  private endReload(g: HeldGun, s: GunSpec, done: boolean): void {
    if (this.tube) {
      // 收尾动作（推弹、合上）要一点时间
      this.fireLock = Math.max(this.fireLock, done ? 0.3 : 0.25);
    } else if (done) g.loaded += this.free(g) ? s.st.mag - g.loaded : this.ctx.bag.take(s.ammoItem, s.st.mag - g.loaded);
    this.reloadT = -1;
  }

  /** 现在的散布（弧度，半角）：腰射 / 瞄准、走动、蹲、腾空、连射 */
  private spreadNow(s: GunSpec): number {
    const p = this.ctx.player;
    const k = ease(this.ads);
    const moveK = Math.min(1, p.speed / 4.3);
    const hip = 1 + 0.35 * s.moveSpread * moveK * (1 - k) + (p.onGround ? 0 : 0.6);
    // 第一发最准，连着打越来越散；霰弹的弹丸本来就是散的，不算这个
    const bloom = s.st.pellets > 1 ? 1 : 0.45 + 0.55 * this.bloom;
    return s.st.spread * DEG * hip * (1 + (s.adsSpread - 1) * k) * (1 - 0.2 * p.crouch) * bloom;
  }

  private shoot(g: HeldGun, s: GunSpec): void {
    const { ctx } = this;
    const p = ctx.player;
    const w = ctx.world;
    // 打到的是丧尸还是带枪的人由 combat 分：这里只管射线和伤害的数
    const combat = ctx.combat;
    g.loaded--;
    // 视线：前 / 右 / 上（yaw 0 = 朝 +z，pitch 正 = 抬头）
    const cp = Math.cos(p.pitch);
    const sp = Math.sin(p.pitch);
    const sy = Math.sin(p.yaw);
    const cy = Math.cos(p.yaw);
    const fx = sy * cp;
    const fy = sp;
    const fz = cy * cp;
    const rx = -cy;
    const rz = sy;
    const ux = -sy * sp;
    const uy = cp;
    const uz = -cy * sp;
    const ox = p.x;
    const oy = p.feet + p.eye;
    const oz = p.z;
    const spread = this.spreadNow(s);
    const pellets = s.st.pellets;
    const k = pellets > 1 ? 0.5 : 1;
    /** 这一枪最好的结果：1 打中身体 · 2 爆头 · 3 打死 */
    let best = 0;
    for (let i = 0; i < pellets; i++) {
      // 两个均匀随机数相加：偏向中心
      const a = Math.tan((Math.random() + Math.random() - 1) * spread);
      const b = Math.tan((Math.random() + Math.random() - 1) * spread);
      let dx = fx + rx * a + ux * b;
      let dy = fy + uy * b;
      let dz = fz + rz * a + uz * b;
      const il = 1 / Math.hypot(dx, dy, dz);
      dx *= il;
      dy *= il;
      dz *= il;
      const wall = w.raycast(ox, oy, oz, dx, dy, dz, s.maxDist);
      const kind = w.hitKind;
      const limit = Math.min(wall, s.maxDist);
      const hl = Math.hypot(dx, dz) || 1;
      let from = 0;
      let left = s.st.pierce;
      let end = wall === Infinity ? Math.min(s.maxDist, 160) : wall;
      let stopped = false;
      _hitIds.length = 0;
      // 穿透：打中一只以后从它身后接着查，直到穿透次数用完或者碰到墙
      for (let n = 0; n < 8 && from < limit; n++) {
        const h = combat.raycast(ox + dx * from, oy + dy * from, oz + dz * from, dx, dy, dz, limit - from);
        if (!h) break;
        const dist = from + h.dist;
        from = dist + 0.3;
        // 丧尸和人的编号各排各的，可能撞上：分开记
        const key = h.id * 2 + (h.who === 'human' ? 1 : 0);
        if (_hitIds.includes(key)) continue;
        _hitIds.push(key);
        const dmg = s.st.damage * falloff(s, dist) * (dist < 3 ? s.close : 1);
        // h 是 combat 里复用的那一个对象：先把要用的抄下来
        const head = h.head;
        const hx = h.x;
        const hy = h.y;
        const hz = h.z;
        const killed = combat.damage(h, dmg, dx / hl, dz / hl);
        // 人和丧尸一样溅血
        this.fx.blood(hx, hy, hz, dx, dy, dz, k);
        best = Math.max(best, killed ? 3 : head ? 2 : 1);
        if (left <= 0) {
          end = dist;
          stopped = true;
          break;
        }
        left--;
      }
      if (!stopped && wall !== Infinity) this.fx.impact(kind, ox + dx * wall, oy + dy * wall, oz + dz * wall, dx, dy, dz, k);
      if (this.pendingN < MAX_PENDING) {
        const o = this.pendingN++ * 4;
        this.pending[o] = ox + dx * end;
        this.pending[o + 1] = oy + dy * end;
        this.pending[o + 2] = oz + dz * end;
        this.pending[o + 3] = pellets > 1 ? 0.4 : 1;
      }
    }
    if (best) {
      this.hud.hitMark(best >= 2, best === 3);
      this.audio.hit(best === 2, best === 3);
    }
    // 后坐：瞄准、蹲着时小一些
    const rk = (1 - 0.5 * this.ads) * (1 - 0.25 * p.crouch);
    this.pendPitch = Math.min(Math.max(0, KICK_CAP - this.recPitch), this.pendPitch + s.recoilV * rk);
    this.pendYaw = clamp(this.pendYaw + (Math.random() * 2 - 1) * s.recoilH * rk, -YAW_CAP - this.recYaw, YAW_CAP - this.recYaw);
    this.bloom = Math.min(1, this.bloom + (s.auto ? 0.17 : 0.34));
    this.bloomHold = 0.09;
    this.sinceShot = 0;
    this.shotInterval = 1 / s.st.rate;
    this.shots++;
    this.shotLast = g.loaded <= 0;
    if (g.loaded <= 0) this.autoReload = 0.4;
    combat.noise(p.x, p.z, s.noise);
    ctx.emit({ type: 'shot', x: p.x, z: p.z, loud: s.noise });
  }

  /**
   * 后坐力直接加在玩家的视线上：每发的量在几十毫秒里加完（不是一帧跳上去），停火后慢慢落回原位。
   * 玩家自己往下压枪压掉的那部分不再往回落（不然松开扳机视线会掉到原来的下面）
   */
  private updateRecoil(dt: number): void {
    const p = this.ctx.player;
    if (!Number.isNaN(this.lastPitch)) {
      const du = p.pitch - this.lastPitch;
      if (du < 0 && this.recPitch > 0) this.recPitch = Math.max(0, this.recPitch + du);
    }
    if (this.pendPitch !== 0 || this.pendYaw !== 0) {
      const k = 1 - Math.exp(-dt * 38);
      const ap = this.pendPitch * k;
      const ay = this.pendYaw * k;
      this.pendPitch = Math.abs(this.pendPitch) < 1e-5 ? 0 : this.pendPitch - ap;
      this.pendYaw = Math.abs(this.pendYaw) < 1e-5 ? 0 : this.pendYaw - ay;
      const before = p.pitch;
      p.pitch = Math.min(1.45, p.pitch + ap);
      this.recPitch += p.pitch - before;
      p.yaw += ay;
      this.recYaw += ay;
    }
    if (this.recPitch !== 0 || this.recYaw !== 0) {
      // 连射当中落得慢（枪口一路往上爬），停火以后落得快
      const back = 1 - Math.exp(-(this.sinceShot < this.shotInterval * 1.3 ? 3.5 : 9) * dt);
      const rp = this.recPitch * back;
      const ry = this.recYaw * back;
      this.recPitch = Math.abs(this.recPitch) < 1e-5 ? 0 : this.recPitch - rp;
      this.recYaw = Math.abs(this.recYaw) < 1e-5 ? 0 : this.recYaw - ry;
      p.pitch -= rp;
      p.yaw -= ry;
    }
    this.lastPitch = p.pitch;
  }

  // ---------------------------------------------------------------- 近战

  private updateMelee(dt: number, inp: ArsenalInput): void {
    const sp = MELEE[this.meleeKind()];
    this.sinceSwing += dt;
    if (this.swingT >= 0) {
      // 打中的那一下顿一顿（动作停几十毫秒），有分量
      if (this.hitStop > 0) this.hitStop -= dt;
      else this.swingT += dt / this.swingDur;
      if (!this.whooshed && this.swingT >= sp.hitAt - 0.2) {
        this.whooshed = true;
        this.audio.whoosh(sp.heavy);
      }
      if (!this.swingHit && this.swingT >= sp.hitAt) {
        this.swingHit = true;
        this.meleeHit(sp);
      }
      if (this.swingT >= 1) {
        this.swingT = -1;
        this.sinceSwing = 0;
      }
    }
    if (this.swingT < 0 && this.phase === 'idle' && (inp.fire || this.fireBuf > 0)) {
      this.fireBuf = 0;
      // 没体力了也能挥，但是慢、没劲。爪子不耗体力，收得也快
      this.weak = this.clawed ? false : !this.ctx.survival.spend(sp.stamina);
      this.swingDur = sp.time * (this.clawed ? CLAW_TIME : this.weak ? 1.35 : 1);
      this.swingT = 0;
      this.swingHit = false;
      this.whooshed = false;
      this.hitStop = 0;
      this.combo++;
    }
  }

  private meleeHit(sp: MeleeSpec): void {
    const { ctx } = this;
    const p = ctx.player;
    const reach = sp.reach + (this.clawed ? CLAW_REACH : 0);
    const n = ctx.combat.melee(p.x, p.z, p.yaw, reach, sp.arc, sp.damage * (this.clawed ? CLAW_DAMAGE : this.weak ? 0.6 : 1));
    const cp = Math.cos(p.pitch);
    const fx = Math.sin(p.yaw) * cp;
    const fy = Math.sin(p.pitch);
    const fz = Math.cos(p.yaw) * cp;
    const ox = p.x;
    const oy = p.feet + p.eye;
    const oz = p.z;
    if (n > 0) {
      this.hud.hitMark(false, false);
      this.audio.thud(sp.heavy, true);
      this.fx.blood(ox + fx * 1.1, oy - 0.2 + fy * 1.1, oz + fz * 1.1, fx, 0.1, fz, 1 + sp.heavy);
      this.hitStop = 0.04 + 0.06 * sp.heavy;
      this.shake(0.5 + sp.heavy);
      ctx.combat.noise(p.x, p.z, 8);
      return;
    }
    // 没打到丧尸：看看是不是砸在墙 / 车 / 树上了
    const d = ctx.world.raycast(ox, oy, oz, fx, fy, fz, reach - 0.35);
    if (d === Infinity) return;
    const kind = ctx.world.hitKind;
    this.fx.impact(kind, ox + fx * d, oy + fy * d, oz + fz * d, fx, fy, fz, 0.7 + sp.heavy);
    this.audio.thud(sp.heavy, false);
    this.hitStop = 0.03 + 0.04 * sp.heavy;
    this.shake(0.35 + 0.6 * sp.heavy);
    ctx.combat.noise(p.x, p.z, 8);
  }

  /** 镜头震一下（k ≈ 0.3–1.5） */
  private shake(k: number): void {
    this.shvx -= 0.9 * k;
    this.shvz += (this.combo & 1 ? 1 : -1) * 0.7 * k;
  }

  // ---------------------------------------------------------------- 每帧：画面

  view(camera: PerspectiveCamera, dt: number, inCar: boolean): void {
    const { ctx } = this;
    const show = this.active && !inCar;
    // 用东西 / 扔手雷：开头一小段是手上的武器往下放，之后换成拿着东西的手
    const acting = this.useT >= 0 ? this.useT >= ACT_LOWER : this.throwT >= TOSS_LOWER;
    const g = show ? this.gunInHand() : null;
    const s = g ? (GUN_SPECS[g.id] as GunSpec) : null;

    // 瞄准时世界相机的视野按倍率缩小（在 tan 空间里缩，倍率才是真的倍率）；不瞄准 / 上车 / 死了一定回到原来的视野
    const adsK = s ? ease(this.ads) : 0;
    const zoom = s ? 1 + (s.zoom - 1) * adsK : 1;
    const fov = (2 * Math.atan(Math.tan((this.baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    this.lookScale = 1 / zoom;

    if (this.warmQueue.length) this.warmOne();
    if (!show) {
      ctx.post.setOverlayVisible(false);
      this.shots = 0;
      this.pendingN = 0;
      this.scoped = false;
      if (this.itemView.root.visible) this.itemView.end();
    } else {
      this.syncView(camera);
      if (acting) this.viewAct(camera, dt);
      else if (g && s) this.viewGun(camera, dt, g, s, adsK);
      else this.viewMelee(camera, dt);
      this.stepShake(dt);
      if (this.shx !== 0 || this.shz !== 0) {
        camera.quaternion.multiply(_q.setFromEuler(_e.set(this.shx, 0, this.shz)));
        camera.updateMatrixWorld();
      }
    }

    // 粒子不受光：按现在的天光压暗（正午 1，深夜 0.14）
    const clock = ctx.clock;
    this.fx.light = 0.14 + 0.86 * (1 - clock.night) * (0.45 + 0.55 * clock.dayK);
    this.fx.update(dt, camera, ctx.renderer.domElement.height);
    this.fillHud(show, g, s, adsK, camera);
    this.hud.flush(dt);
  }

  private viewGun(camera: PerspectiveCamera, dt: number, g: HeldGun, s: GunSpec, adsK: number): void {
    const { ctx, vm } = this;
    const p = ctx.player;
    this.setGunLayer(true);
    this.meleeView.snapDown();
    // 模型还在加载：先什么都不画（等太久就让 ViewModel 用它的程序模型顶上）
    if (!vm.hasTacz(g.id) && this.loadWait <= 4) {
      ctx.post.setOverlayVisible(false);
      this.shots = 0;
      this.pendingN = 0;
      this.scoped = false;
      return;
    }
    const st = this.vmState;
    const reloading = this.reloadT >= 0;
    st.kind = s.kind;
    st.scope = s.scope;
    st.gun = g.id;
    st.lowered = this.phase === 'lower' || this.useT >= 0 || this.throwT >= 0;
    st.reload = reloading ? Math.min(1, this.reloadT / this.reloadDur) : -1;
    st.reloadTime = this.reloadDur;
    st.speed = p.speed;
    st.sprinting = p.sprinting && p.speed > 1.5;
    st.yaw = p.yaw;
    st.pitch = p.pitch;
    st.ads = this.ads;
    st.crouch = p.crouch;
    st.sprintOut = this.sprintOut;
    st.mag = g.loaded;
    st.magMax = reloading ? this.reloadMag : s.st.mag;
    const sy = Math.sin(p.yaw);
    const cy = Math.cos(p.yaw);
    st.fwd = p.vx * sy + p.vz * cy;
    st.side = -p.vx * cy + p.vz * sy;
    for (; this.shots > 0; this.shots--) vm.fire(s.kind, this.shotInterval, this.shotLast);
    vm.update(dt, st);
    // TACZ 的摄像机动画：开枪、换弹时镜头跟着轻轻晃
    camera.quaternion.multiply(vm.cameraAnim);
    camera.updateMatrixWorld();
    if (this.pendingN) {
      vm.muzzleWorld(_muzzle, camera);
      const q = this.pending;
      for (let i = 0; i < this.pendingN; i++) this.fx.tracer(_muzzle.x, _muzzle.y, _muzzle.z, q[i * 4] as number, q[i * 4 + 1] as number, q[i * 4 + 2] as number, q[i * 4 + 3] as number);
      this.pendingN = 0;
    }
    // 瞄准镜举到位：枪模藏起来，换成界面上的镜框
    this.scoped = s.scope && adsK > 0.85;
    ctx.post.setOverlayVisible(vm.visible && !this.scoped);
  }

  private viewMelee(camera: PerspectiveCamera, dt: number): void {
    const { ctx, vm } = this;
    const p = ctx.player;
    this.setGunLayer(false);
    // 视角模型的相机平时由 ViewModel 管（它不更新的时候视野、宽高比可能停在瞄准到一半的值）
    if (vm.camera.fov !== 60 || vm.camera.aspect !== camera.aspect) {
      vm.camera.fov = 60;
      vm.camera.aspect = camera.aspect;
      vm.camera.updateProjectionMatrix();
    }
    const f = this.meleeFrame;
    const kind = this.meleeKind();
    f.kind = kind;
    // 近战武器一直举着；拳头只在出拳时和之后一小会儿举着；爪子一直举着。要用东西 / 扔手雷了就先放下去
    f.up = this.phase !== 'lower' && this.useT < 0 && this.throwT < 0 && this.handReady() && (this.clawed || kind !== 'fists' || this.swingT >= 0 || this.sinceSwing < 1.1);
    f.swing = this.swingT;
    f.combo = this.combo;
    f.speed = p.speed;
    f.sprinting = p.sprinting && p.speed > 1.5;
    f.yaw = p.yaw;
    f.pitch = p.pitch;
    this.meleeView.update(dt, f);
    ctx.post.setOverlayVisible(!this.meleeView.hidden);
    this.shots = 0;
    this.pendingN = 0;
    this.scoped = false;
  }

  /** 用东西 / 扔手雷：原来的武器已经放下去了，画拿着东西的手（没有专门的模型就什么都不画，等时间到） */
  private viewAct(camera: PerspectiveCamera, dt: number): void {
    const { ctx, vm } = this;
    this.setGunLayer(false);
    this.meleeView.snapDown();
    this.shots = 0;
    this.pendingN = 0;
    this.scoped = false;
    const use = this.useT >= 0;
    if (!(use ? this.useRig : this.throwRig)) {
      ctx.post.setOverlayVisible(false);
      return;
    }
    if (vm.camera.fov !== ITEM_FOV || vm.camera.aspect !== camera.aspect) {
      vm.camera.fov = ITEM_FOV;
      vm.camera.aspect = camera.aspect;
      vm.camera.updateProjectionMatrix();
    }
    const k = use ? (this.useT - ACT_LOWER) / (this.useDur - ACT_LOWER) : (this.throwT - TOSS_LOWER) / (TOSS_TIME - TOSS_LOWER);
    this.itemView.aspect = camera.aspect;
    this.itemView.update(dt, clamp(k, 0, 1));
    // 动作里自带的镜头晃动（扎针的那一下、咬一口）
    camera.quaternion.multiply(this.itemView.cameraAnim);
    camera.updateMatrixWorld();
    ctx.post.setOverlayVisible(true);
  }

  /** 视角模型自己的东西（枪、它的两条手臂）显示 / 藏起来。灯和相机不动 */
  private setGunLayer(on: boolean): void {
    if (on === this.gunLayer) return;
    this.gunLayer = on;
    if (on) {
      for (const o of this.hiddenByMelee) o.visible = true;
      this.hiddenByMelee.length = 0;
      return;
    }
    for (const o of this.vm.scene.children) {
      const t = o as unknown as { isLight?: boolean; isCamera?: boolean };
      if (o === this.meleeView.root || o === this.itemView.root || t.isLight || t.isCamera || !o.visible) continue;
      o.visible = false;
      this.hiddenByMelee.push(o);
    }
  }

  /** 弹簧：近战打中时镜头的那一下。按 8 毫秒细分，卡一帧也不会发散 */
  private stepShake(dt: number): void {
    if (this.shx === 0 && this.shz === 0 && this.shvx === 0 && this.shvz === 0) return;
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.shvx += (-300 * this.shx - 26 * this.shvx) * h;
      this.shx += this.shvx * h;
      this.shvz += (-300 * this.shz - 26 * this.shvz) * h;
      this.shz += this.shvz * h;
    }
    if (Math.abs(this.shx) + Math.abs(this.shz) < 1e-5 && Math.abs(this.shvx) + Math.abs(this.shvz) < 1e-3) this.shx = this.shz = this.shvx = this.shvz = 0;
    if (!Number.isFinite(this.shx + this.shz + this.shvx + this.shvz)) this.shx = this.shz = this.shvx = this.shvz = 0;
  }

  /** 新模型往 1×1 的缓冲里画一遍：着色器、网格、贴图一次传完（平时藏着的零件——瞄准镜、备用弹匣——也一起） */
  private warmOne(): void {
    const obj = this.warmQueue.shift();
    if (!obj) return;
    const r = this.ctx.renderer;
    const scene = this.vm.scene;
    const flipped: Object3D[] = [];
    for (let o: Object3D | null = obj.parent; o; o = o.parent) {
      if (!o.visible) {
        o.visible = true;
        flipped.push(o);
      }
    }
    obj.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        flipped.push(o);
      }
    });
    let root: Object3D = obj;
    while (root.parent) root = root.parent;
    const loose = root !== scene;
    if (loose) scene.add(root);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.warmTarget);
    try {
      r.render(scene, this.vm.camera);
    } finally {
      r.setRenderTarget(prev);
      if (loose) scene.remove(root);
      for (const o of flipped) o.visible = false;
    }
  }

  private fillHud(show: boolean, g: HeldGun | null, s: GunSpec | null, adsK: number, camera: PerspectiveCamera): void {
    const m = this.hud.model;
    m.show = show;
    if (!show) return;
    m.cur = this.want;
    m.slots[0] = this.guns[0] ? (specOf(this.guns[0].id)?.name ?? '') : '';
    m.slots[1] = this.guns[1] ? (specOf(this.guns[1].id)?.name ?? '') : '';
    m.slots[2] = this.melee ? MELEE[this.melee].name : '';
    m.scope = this.scoped;
    const busy = this.useT >= 0 || this.throwT >= 0;
    m.use = this.useT >= 0 ? this.useT / this.useDur : -1;
    m.nades = this.clawed ? 0 : this.ctx.bag.count(NADE_ITEM);
    if (g && s) {
      m.gun = true;
      m.name = s.name;
      m.loaded = g.loaded;
      m.mag = s.st.mag;
      m.reserve = this.free(g) ? -1 : this.ctx.bag.count(s.ammoItem);
      m.ammoName = AMMO_NAME[s.ammo];
      m.reload = this.reloadT >= 0 ? this.reloadT / this.reloadDur : -1;
      m.cross = this.phase === 'idle' && !busy ? 'gun' : 'dot';
      m.ads = adsK;
      m.gap = 4 + (Math.tan(this.spreadNow(s)) / Math.tan((camera.fov * Math.PI) / 360)) * (this.viewH / 2);
      m.tip = g.loaded <= 0 && this.reloadT < 0 && this.phase === 'idle' && !busy ? (m.reserve !== 0 ? '按 R 换弹' : `${m.ammoName}打光了`) : '';
    } else {
      m.gun = false;
      m.name = this.clawed ? '爪子' : MELEE[this.meleeKind()].name;
      m.cross = 'dot';
      m.ads = 0;
      m.tip = '';
    }
  }

  // ---------------------------------------------------------------- 调试（window.__open.arsenal）

  /** 给一把枪（带 3 个弹匣的子弹）或者一把近战武器，并且拿在手上 */
  debugGive(id: string): string {
    const s = specOf(id);
    if (s) {
      const old = this.giveGun({ id, loaded: s.st.mag });
      if (old) this.ctx.drop(`gun_${old.id}`, 1, old.loaded);
      const got = this.ctx.bag.add(s.ammoItem, s.st.mag * 3);
      this.select(this.lastGiven);
      return `${s.name}：弹匣 ${s.st.mag}，${AMMO_NAME[s.ammo]} +${got}`;
    }
    if (MELEE_LIST.some((m) => m.id === id)) {
      const old = this.giveMelee(id as MeleeId);
      if (old) this.ctx.drop(`melee_${old}`);
      this.select(2);
      return MELEE[id as MeleeId].name;
    }
    return `没有这个武器：${id}（枪：${GUN_LIST.map((g) => g.id).join(' ')}；近战：${MELEE_LIST.map((m) => m.id).join(' ')}）`;
  }

  /**
   * 截图用：把消耗品包里六样东西掉在地上的模型在玩家面前排成一排。dist = 离玩家多远，height = 离脚底多高（0 = 放在地上）。
   * 再调一次先把上一排撤掉；dist <= 0 = 只撤掉
   */
  async debugWorldRow(dist = 0.7, height = 0): Promise<string[]> {
    const { ctx } = this;
    const p = ctx.player;
    if (this.debugRow) ctx.scene.remove(this.debugRow);
    this.debugRow = null;
    if (dist <= 0) return [];
    const row = new Group();
    row.name = 'arsenal-debug-row';
    const x = p.x + Math.sin(p.yaw) * dist;
    const z = p.z + Math.cos(p.yaw) * dist;
    row.position.set(x, (height > 0 ? p.feet : ctx.world.groundAt(x, z)) + height, z);
    // 这一排的 +X 朝玩家的右手边
    row.rotation.y = Math.PI + p.yaw;
    const names = await this.itemView.debugRow(row);
    ctx.scene.add(row);
    this.debugRow = row;
    return names;
  }

  /** 现在的状态。slot：0 = 空手，1 / 2 = 枪位，3 = 近战位 */
  state(): Record<string, unknown> {
    const g = this.gunInHand();
    const s = g ? specOf(g.id) : undefined;
    return {
      slot: this.want + 1,
      guns: this.guns.map((x) => (x ? (x.loan ? { id: x.id, loaded: x.loaded, loan: true } : { id: x.id, loaded: x.loaded }) : null)),
      melee: this.melee,
      loaded: g?.loaded ?? 0,
      reserve: g && s ? (this.free(g) ? -1 : this.ctx.bag.count(s.ammoItem)) : 0,
      using: this.useT >= 0,
      use: this.useT >= 0 ? this.useT / this.useDur : -1,
      useRig: this.useRig,
      tossing: this.throwT >= 0,
      nades: this.nades.count,
      grenades: this.ctx.bag.count(NADE_ITEM),
      claws: this.clawed,
      freeAmmo: this.freeAmmo,
      items: this.itemView.loaded(),
      sound: this.audio.stats(),
      reloading: this.reloadT >= 0,
      ads: this.ads,
      phase: this.phase,
      ready: this.handReady(),
      swing: this.swingT,
      fov: this.ctx.camera.fov,
      lookScale: this.lookScale,
      models: this.vm.taczLoaded(),
      fx: this.fx.stats(),
    };
  }
}
