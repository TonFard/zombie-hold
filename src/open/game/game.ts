import { Object3D, SpotLight, Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import type { Lighting } from '../../render/core/lighting';
import type { PostFX } from '../../render/core/postfx';
import type { Sky } from '../../render/core/sky';
import type { DayCycle } from '../daycycle';
import type { Hud } from '../hud';
import type { Player } from '../player';
import type { QualityControl } from '../quality';
import type { Garage } from '../vehicles/garage';
import type { Site } from '../world/sites';
import type { World } from '../world/world';
import { CAR, CAR_PARTS, GUN_LIST, type ArsenalApi, type GameCtx, type GameEvent, type GameMode, type HeldGun, type HordeApi, type HumanRef, type Interaction, type RaidersApi, type WeatherApi, type WeatherKind } from './api';
import { BIO_CSS, Bio } from './bio';
import { Combat } from './combat';
import { BOOK_CSS, gunBook } from './gunbook';
import { ITEMS, ammoOf, type ItemDef, type ItemKind } from './items';
import { Pickups, type Pickup } from './pickups';
import { clearSave, readSave, writeSave, type SaveData } from './save';
import { SIEGE_CSS, Siege } from './siege';
import { blip } from './sound';
import { Bag, Survival } from './survival';
import { Unlocks } from './unlocks';

/**
 * 玩法层的总管：背包、车厢、生存状态、拾取、目标和等级、死亡和重来、存档、界面，以及给各模块用的环境（GameCtx）。
 * main.ts 建好渲染的东西以后建它，再用 game.ctx 去建天气 / 丧尸 / 武器，attach() 把它们挂回来，最后 start() 读存档。
 *
 * 一局怎么玩：空着手在路边醒来 → 进屋搜吃的喝的、找件防身的家伙 → 找汽油把皮卡开起来 → 加油站、小镇、军事基地，
 * 越远越危险东西越好。饿、渴、冷都会要命；天黑丧尸翻倍，得在天黑前找好落脚的地方。死了东西掉在原地，回到起点重新来。
 *
 * 另外三样挂在这上面：
 *   siege.ts    守城：据点的发电机发动起来，守住一波波丧尸（只在生存世界里）
 *   bio.ts      生化模式：open.html?mode=bio，单独的一局
 *   unlocks.ts  武器图鉴：生存世界、守城模式、生化模式共用的「哪些枪解锁了」
 */

export interface GameDeps {
  world: World;
  player: Player;
  camera: PerspectiveCamera;
  scene: Scene;
  renderer: WebGLRenderer;
  lighting: Lighting;
  post: PostFX;
  sky: Sky;
  clock: DayCycle;
  quality: QualityControl;
  garage: Garage;
  hud: Hud;
  keys: ReadonlySet<string>;
  params: URLSearchParams;
  /** survival = 生存世界，bio = 生化模式（单独一局） */
  mode: GameMode;
  /** 写实道具的清单（地上的东西用这些模型） */
  assets: Record<string, { file: string }>;
  /** 传送（main.ts 负责把那里的地形、地点先加载好） */
  teleport(x: number, z: number, yaw: number): void;
}

/** 车辆模块这几个方法是后加的：有就用，没有就退回到最基本的做法 */
interface GarageExtras {
  car?: { rig?: { root: Object3D } } | null;
  cargoPoint?(out: Vector3): boolean;
  setTailgate?(open: boolean): void;
  setCargoFill?(k: number): void;
  forceExit?(player: Player): void;
  save?(): unknown;
  load?(data: unknown): void;
}
interface CarLike {
  rig?: { root: Object3D };
  hull?: { cz: number; hz: number };
  local?(x: number, y: number, z: number, out: Vector3): Vector3;
}

const KIND_ORDER: ItemKind[] = ['gun', 'melee', 'ammo', 'throw', 'med', 'food', 'drink', 'warm', 'fuel', 'part', 'gear'];
const KIND_NAME: Record<ItemKind, string> = { gun: '枪', melee: '近战', ammo: '弹药', throw: '投掷', med: '药品', food: '食物', drink: '饮料', warm: '取暖', fuel: '燃料', part: '改装件', gear: '装备' };
const USE_LABEL: Partial<Record<ItemKind, string>> = { food: '吃', drink: '喝', med: '用', warm: '用', gun: '装备', melee: '装备' };
/** 快捷键：4 吃 · 5 喝 · 6 治疗 · 7 取暖 · 8 打针（按顺序挑第一样有的、现在用得着的：先用便宜的） */
const QUICK: Array<{ code: string; key: string; label: string; items: string[] }> = [
  { code: 'Digit4', key: '4', label: '吃', items: ['canned_fruit', 'biscuits', 'canned_meat', 'cheese', 'mre'] },
  { code: 'Digit5', key: '5', label: '喝', items: ['soda', 'water', 'energy', 'water_jug'] },
  { code: 'Digit6', key: '6', label: '治疗', items: ['painkiller', 'balm', 'bandage', 'medkit'] },
  { code: 'Digit7', key: '7', label: '取暖', items: ['cigarettes', 'warmer', 'liquor'] },
  { code: 'Digit8', key: '8', label: '打针', items: ['stim', 'injector'] },
];
/** 生化模式里没有饿渴冷：只留这两个 */
const QUICK_BIO = QUICK.filter((q) => q.code === 'Digit6' || q.code === 'Digit8');

interface Goal {
  text: string;
  done(g: Game): boolean;
}

const GOALS: Goal[] = [
  { text: '进屋找点吃的和喝的', done: (g) => g.flags.has('food') && g.flags.has('drink') },
  { text: '找一件能防身的家伙（球棒、撬棍、斧头……）', done: (g) => g.flags.has('weapon') },
  { text: '皮卡快没油了：找一桶汽油（路边的车旁、修车铺、加油站）', done: (g) => g.flags.has('fuel') },
  { text: '沿公路去加油站', done: (g) => g.visitedKinds.has('gas') },
  { text: '找一把枪。枪和子弹都很少，省着用', done: (g) => g.flags.has('gun') },
  { text: '天黑以后丧尸会多一倍：找个屋子熬过第一夜', done: (g) => g.d.clock.day >= 2 && g.d.clock.hours >= 6 },
  { text: '去镇上搜刮', done: (g) => g.visitedKinds.has('town') },
  { text: '军事基地里有成箱的武器弹药', done: (g) => g.visitedKinds.has('base') },
  { text: '带上枪去加油站、货场或者检查站，按住 F 把发电机发动起来：守住一波波丧尸，换一大堆补给', done: (g) => g.flags.has('held') },
];
const GOAL_END = '活下去。越往远处走越危险，东西也越好';

const xpNeed = (level: number): number => 120 + 90 * (level - 1);

const _dir = new Vector3();
const _v = new Vector3();

export class Game {
  readonly bag = new Bag();
  /** 皮卡车厢里的东西 */
  readonly trunk = new Bag();
  readonly survival = new Survival();
  readonly pickups: Pickups;
  readonly ctx: GameCtx;
  /** 武器图鉴：生存世界、守城模式、生化模式共用的解锁 */
  readonly unlocks: Unlocks;
  /** 守城（只在生存世界里有）、生化模式（只在 ?mode=bio 里有） */
  readonly siege: Siege | null;
  readonly bio: Bio | null;
  /** 做过的事（目标用）、得到的装备：food drink weapon fuel gun coat backpack flashlight held */
  readonly flags = new Set<string>();
  readonly visited = new Set<number>();
  readonly visitedKinds = new Set<string>();
  kills = 0;
  xp = 0;
  level = 1;
  goal = 0;
  /** 背包 / 车厢开着 */
  invOpen = false;
  /** 弹出来的一块板（军械箱、图鉴、生化模式的开局和结算）开着 */
  modalOpen = false;
  flashOn = false;
  private readonly modalEl: HTMLElement;
  private modalClick: ((t: HTMLElement) => void) | null = null;
  /** 这块板不能用 Esc 关掉（生化模式的开局和结算：得选一个） */
  private modalSticky = false;
  private readonly quick: typeof QUICK;
  private readonly gx: GarageExtras;
  private readonly canvas: HTMLCanvasElement;
  private readonly flash: SpotLight;
  private readonly flashTarget = new Object3D();
  private deathMark: { x: number; z: number } | null = null;
  private readonly toastEl: HTMLElement;
  private toastT = 0;
  private indoorsT = 0;
  private indoorsV = false;
  private roofedV = false;
  private winded = false;
  /** 现在能做的交互（每帧重新收集），每个键只留优先级最高的一个 */
  private readonly acts: Interaction[] = [];
  private readonly best = new Map<string, Interaction>();
  private readonly promptEl: HTMLElement;
  private promptHtml = '';
  /** 捡东西的两个交互：准星指的东西没变就不重建 */
  private pickFor: Pickup | null = null;
  private pickN = 0;
  private pickE: Interaction | null = null;
  private pickF: Interaction | null = null;
  private readonly trunkAct: Interaction = { key: 'Tab', label: '打开车厢', act: () => {} };
  /** 正在按住的交互：哪个键、是哪一个（按文字认）、按了多久 */
  private holdKey = '';
  private holdLabel = '';
  private holdT = 0;
  // 界面
  private readonly bars: Record<string, HTMLElement> = {};
  private readonly tagsEl: HTMLElement;
  private readonly quickEl: HTMLElement;
  private readonly lvEl: HTMLElement;
  private readonly goalEl: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly frost: HTMLElement;
  private readonly hitEl: HTMLElement;
  private readonly invEl: HTMLElement;
  private readonly deadEl: HTMLElement;
  private uiT = 0;
  private uiKey = '';
  private invDirty = true;
  private nearTrunk = false;
  private siteT = 0;
  private saveT = 20;
  private goalShown = -1;
  private lastDay = 1;
  private newGameArmed = 0;
  private wiped = false;
  private readonly saving: boolean;
  private readonly here: Site[] = [];
  private readonly humans: HumanRef[] = [];

  constructor(readonly d: GameDeps) {
    this.gx = d.garage as unknown as GarageExtras;
    this.canvas = d.renderer.domElement;
    // 生化模式是单独的一局：不读也不写生存世界的存档
    this.saving = d.params.get('nosave') !== '1' && d.mode === 'survival';
    this.quick = d.mode === 'bio' ? QUICK_BIO : QUICK;
    this.unlocks = new Unlocks(d.params);
    this.pickups = new Pickups(d.world, d.assets);
    d.scene.add(this.pickups.group);
    // 手电：开局就建好（中途加灯会让所有材质重新编译），没开的时候亮度是 0
    // 衰减用 1（不是物理的平方反比）：不然照得到二十米外的亮度，会把一米外的墙照成一片白
    this.flash = new SpotLight(0xfff4e0, 0, 42, 0.44, 0.75, 1);
    this.flash.castShadow = false;
    this.flash.target = this.flashTarget;
    d.scene.add(this.flash, this.flashTarget);

    const style = document.createElement('style');
    style.textContent = CSS + BOOK_CSS + SIEGE_CSS + BIO_CSS;
    document.head.append(style);
    const el = (cls: string, html = ''): HTMLElement => {
      const e = document.createElement('div');
      e.className = cls;
      e.innerHTML = html;
      document.body.append(e);
      return e;
    };
    this.vignette = el('g-vignette');
    this.frost = el('g-frost');
    this.hitEl = el('g-hit', '<i></i>');
    this.toastEl = el('g-toast');
    this.promptEl = el('act-prompt');
    this.goalEl = el('g-goal');
    const names: Array<[string, string]> = [
      ['hp', '生命'],
      ['hunger', '饱食'],
      ['thirst', '水分'],
      ['warmth', '体温'],
    ];
    const status = el(
      'g-status',
      `<div class="lv"></div>${names.map(([k, n]) => `<div class="bar ${k}"><span>${n}</span><div><i></i></div><em></em></div>`).join('')}<div class="bar stamina"><span></span><div><i></i></div><em></em></div><div class="tags"></div><div class="quick"></div>`,
    );
    for (const k of ['hp', 'hunger', 'thirst', 'warmth', 'stamina']) this.bars[k] = status.querySelector(`.${k}`) as HTMLElement;
    this.tagsEl = status.querySelector('.tags') as HTMLElement;
    this.quickEl = status.querySelector('.quick') as HTMLElement;
    this.lvEl = status.querySelector('.lv') as HTMLElement;
    this.invEl = el('g-inv');
    this.invEl.addEventListener('mousedown', (e) => this.onInvClick(e));
    this.invEl.addEventListener('contextmenu', (e) => e.preventDefault());
    this.invEl.addEventListener('mouseover', (e) => {
      const row = (e.target as HTMLElement).closest('.row') as HTMLElement | null;
      const tip = this.invEl.querySelector('.tip');
      const def = row?.dataset.id ? ITEMS[row.dataset.id] : undefined;
      if (tip && def) tip.textContent = `${def.name}（${KIND_NAME[def.kind]} · 每个 ${def.weight} 千克）：${def.desc}`;
    });
    this.deadEl = el('g-dead');
    this.deadEl.addEventListener('click', () => this.respawn());
    this.modalEl = el('g-modal');
    this.modalEl.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName !== 'BUTTON' && !t.closest('[data-gun]')) return;
      e.preventDefault();
      if ((t as HTMLButtonElement).disabled) return;
      if (t.dataset.sync) {
        // 图鉴上的「同步到守城模式」：从这以后才往服务器存档里写
        this.unlocks.allowSync();
        t.textContent = '已开启：以后自动同步';
        (t as HTMLButtonElement).disabled = true;
        blip(0.25, 0.2, 2000, 780);
        return;
      }
      this.modalClick?.(t);
    });
    this.modalEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bag.onChange = () => {
      this.invDirty = true;
      this.uiKey = '';
    };
    this.trunk.onChange = () => {
      this.invDirty = true;
      this.gx.setCargoFill?.(Math.min(1, this.trunk.weight / Math.max(1, this.trunk.capacity)));
    };
    this.survival.onDeath = () => this.onDeath();

    this.ctx = {
      ...d,
      bag: this.bag,
      survival: this.survival,
      drop: (item: string, n = 1, loaded?: number, x?: number, z?: number) => this.drop(item, n, loaded, x, z),
      toast: (text: string, seconds = 2.5) => this.toast(text, seconds),
      emit: (ev: GameEvent) => this.onEvent(ev),
      indoors: () => this.indoors(),
      // weather / horde / arsenal / raiders / combat 由 attach() 填
    } as unknown as GameCtx;
    this.siege = d.mode === 'survival' ? new Siege(this) : null;
    this.bio = d.mode === 'bio' ? new Bio(this) : null;
    this.unlocks.onChange = () => {
      this.invDirty = true;
    };

    if (this.saving) {
      window.addEventListener('pagehide', () => this.save());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.save();
      });
    }
  }

  /** 天气 / 丧尸 / 武器 / 带枪的人建好以后挂进环境里 */
  attach(weather: WeatherApi, horde: HordeApi, arsenal: ArsenalApi, raiders: RaidersApi): void {
    this.ctx.weather = weather;
    this.ctx.horde = horde;
    this.ctx.arsenal = arsenal;
    this.ctx.raiders = raiders;
    this.ctx.combat = new Combat(this.ctx);
  }

  /** 全部建好以后：有存档就接着玩 */
  start(): void {
    const seed = this.d.world.seed;
    // 守城模式的解锁在服务器上：这个浏览器登录过主游戏就读下来（连不上也不耽误玩）
    void this.unlocks.sync();
    void this.loadStims();
    if (this.bio) {
      this.bio.start();
      this.recalc();
      return;
    }
    if (this.d.params.get('new') === '1' && this.saving) clearSave(seed);
    const s = this.saving ? readSave(seed) : null;
    if (s) this.load(s);
    else {
      // 醒来的地方不算「第一次来到」
      this.visit(false);
      this.toast('你在路边醒了过来，身上什么都没有', 6);
    }
    this.recalc();
    this.lastDay = this.d.clock.day;
  }

  /**
   * 消耗品包（public/stims，只在本机有，见 scripts/tools/stims-import.mjs）：有的话，针剂、香烟、奶酪、手雷在地上用包里的模型。
   * 没有这个包也照常玩：这几样东西用现成的道具模型染个色
   */
  private async loadStims(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}stims/manifest.json`);
      if (!res.ok) return;
      const m = (await res.json()) as { items?: Record<string, { world?: string; size?: [number, number, number] }> };
      for (const def of Object.values(ITEMS)) {
        const it = def.alt ? m.items?.[def.alt] : undefined;
        if (!it?.world || !Array.isArray(it.size) || it.size.length !== 3 || !it.size.every((v) => Number.isFinite(v) && v > 0)) continue;
        const id = `stims:${def.alt}`;
        this.pickups.addModel(id, `../stims/${it.world}`, it.size);
        def.model = id;
        def.scale = 1;
        def.flat = false;
        delete def.tint;
      }
    } catch {
      // 没有这个包
    }
  }

  // ---------------------------------------------------------------- 小工具

  toast(text: string, seconds = 2.5): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastT = seconds;
  }

  /** 背包能背多重：基础 20，背包 +15，每升一级 +2 */
  private recalc(): void {
    this.bag.capacity = 20 + (this.flags.has('backpack') ? 15 : 0) + 2 * (this.level - 1);
    this.trunk.capacity = CAR.cargoCapacity;
    this.survival.fitness = 1 + 0.06 * (this.level - 1);
    this.survival.thrift = 1 + 0.04 * (this.level - 1);
    this.invDirty = true;
    this.uiKey = '';
  }

  gain(xp: number, why = ''): void {
    this.xp += xp;
    let up = false;
    while (this.xp >= xpNeed(this.level)) {
      this.xp -= xpNeed(this.level);
      this.level++;
      up = true;
    }
    if (up) {
      this.recalc();
      this.survival.hp = Math.min(100, this.survival.hp + 30);
      this.toast(`升到 ${this.level} 级：多背 2 千克，更耐跑，更耐饿`, 5);
      blip(0.3, 0.25, 1800, 660);
      setTimeout(() => blip(0.3, 0.35, 2400, 990), 160);
    } else if (why) this.toast(why, 3);
    this.uiKey = '';
  }

  private onEvent(ev: GameEvent): void {
    if (this.bio) {
      // 生化模式不算经验，自己记账
      if (ev.type === 'kill' && ev.byPlayer !== false) this.kills++;
      this.bio.onEvent(ev);
      return;
    }
    // 别人（带枪的人、同伴）打死的不算玩家的
    if (ev.type === 'kill' && ev.byPlayer !== false) {
      this.kills++;
      if (ev.human) this.gain(ev.head ? 60 : 45, '干掉了一个带枪的人');
      else this.gain(ev.kind === 'mother' ? 80 : ev.head ? 14 : 10);
    }
  }

  /** 玩家是不是在屋里（一秒查四次） */
  indoors(): boolean {
    return this.indoorsV;
  }

  /** 开着背包 / 弹出来的板 / 死了：不能走、不能开枪、鼠标不转视角 */
  get busy(): boolean {
    return this.survival.dead || this.invOpen || this.modalOpen;
  }

  /** 体力用光以后要缓到 15% 才能再跑 */
  get canSprint(): boolean {
    if (this.survival.stamina <= 0.01) this.winded = true;
    else if (this.survival.stamina > 0.15) this.winded = false;
    return !this.winded;
  }

  /** 把东西丢在地上（不给位置 = 玩家面前半米多） */
  drop(item: string, n = 1, loaded?: number, x?: number, z?: number): void {
    const p = this.d.player;
    if (x === undefined || z === undefined) {
      const a = p.yaw + (Math.random() - 0.5) * 1.6;
      const r = 0.55 + Math.random() * 0.35;
      x = p.x + Math.sin(a) * r;
      z = p.z + Math.cos(a) * r;
    }
    // 落在哪个高度：地面，或者和玩家差不多高的地板（屋里）
    const w = this.d.world;
    const g = w.groundAt(x, z);
    const near = Math.hypot(x - p.x, z - p.z) < 40;
    const y = near ? Math.max(g, w.topAt(x, z, 0.15, p.feet + 0.5, 0.6)) : g;
    this.pickups.dropAt(item, n, loaded ?? 0, x, y + 0.01, z);
  }

  /** 车尾的位置（开车厢要站在这附近） */
  private trunkPoint(out: Vector3): boolean {
    if (this.gx.cargoPoint) return this.gx.cargoPoint(out);
    const v = this.d.garage.vehicles[0] as unknown as CarLike | undefined;
    if (!v?.hull || !v.local) return false;
    v.local(0, 0, v.hull.cz + v.hull.hz + 0.3, out);
    return true;
  }

  // ---------------------------------------------------------------- 拾取、使用

  /** 捡起准星指着的东西。stow = 枪 / 近战武器不拿在手上，收进背包 */
  private take(p: Pickup, stow: boolean): void {
    if (p.gone) return;
    const def = ITEMS[p.item] as ItemDef;
    const ars = this.ctx.arsenal;
    if (def.kind === 'gun' && def.gun && !stow) {
      const old = ars.giveGun({ id: def.gun, loaded: p.loaded });
      this.pickups.remove(p);
      if (old && !old.loan) this.pickups.dropAt(`gun_${old.id}`, 1, old.loaded, p.x, p.y, p.z);
      this.flags.add('gun');
      this.flags.add('weapon');
      this.toast(`拿起了 ${def.name}（弹匣里 ${p.loaded} 发）`);
      blip(0.3, 0.12, 1500, 300);
      this.found(def.gun, def.name);
      return;
    }
    if (def.kind === 'melee' && def.melee && !stow) {
      const old = ars.giveMelee(def.melee);
      this.pickups.remove(p);
      if (old) this.pickups.dropAt(`melee_${old}`, 1, 0, p.x, p.y, p.z);
      this.flags.add('weapon');
      this.toast(`拿起了 ${def.name}`);
      blip(0.3, 0.12, 900, 220);
      return;
    }
    if (def.kind === 'gear') {
      if (this.flags.has(p.item)) {
        this.toast(`已经有${def.name}了`);
        return;
      }
      this.flags.add(p.item);
      if (p.item === 'coat') this.survival.coat = true;
      this.pickups.remove(p);
      this.recalc();
      this.toast(p.item === 'coat' ? '穿上了厚外套：不容易冷了' : p.item === 'backpack' ? '背上了背包：能多背 15 千克' : p.item === 'flashlight' ? '捡到手电筒：按 T 开关' : `得到了 ${def.name}`, 4);
      blip(0.3, 0.12, 2000, 700);
      return;
    }
    // 其余的进背包（枪收起来时子弹退出来）
    const got = this.bag.add(p.item, p.n);
    if (got <= 0) {
      this.toast(`背不动了（${this.bag.weight.toFixed(1)} / ${this.bag.capacity} 千克）`);
      blip(0.2, 0.12, 300, 110);
      return;
    }
    if (def.kind === 'gun' && def.gun && p.loaded > 0) {
      const ammo = ammoOf(def.gun);
      if (ammo) this.bag.add(`ammo_${ammo}`, p.loaded);
    }
    const left = p.n - got;
    if (left <= 0) this.pickups.remove(p);
    else p.n = left;
    if (def.kind === 'food') this.flags.add('food');
    if (def.kind === 'drink') this.flags.add('drink');
    if (def.kind === 'fuel') this.flags.add('fuel');
    if (def.kind === 'gun') this.flags.add('gun');
    this.toast(`+ ${def.name}${got > 1 ? ` ×${got}` : ''}${left > 0 ? '（背不下更多了）' : ''}`, 1.8);
    blip(0.25, 0.09, 2400, 880);
    if (def.kind === 'gun' && def.gun) this.found(def.gun, def.name);
    else if (p.item === 'grenade' && !this.flags.has('tip:grenade')) {
      this.flags.add('tip:grenade');
      this.toast('捡到手雷：按 Q 拔销扔出去，别扔在自己脚边', 5);
    }
  }

  /** 生存世界里第一次拿到这个型号：记进武器图鉴（守城模式、生化模式里也算解锁了） */
  private found(gun: string, name: string): void {
    if (!this.unlocks.find(gun)) return;
    const u = this.unlocks;
    this.toast(
      u.linked
        ? `图鉴解锁：${name}。守城模式、生化模式里也能用了（按 B 看图鉴）`
        : u.canSync
          ? `图鉴解锁：${name}。生化模式里能用了；按 B 打开图鉴点「同步到守城模式」，守城那边也认`
          : `图鉴解锁：${name}。生化模式和据点的军械箱里能用了（按 B 看图鉴）`,
      6,
    );
    blip(0.3, 0.3, 2200, 880);
  }

  /** 用掉背包里的一样东西（吃、喝、包扎、打针都要一点时间，手上的武器先放下）。返回开始用了没有 */
  private consume(id: string): boolean {
    const def = ITEMS[id];
    if (!def || !def.use || this.bag.count(id) <= 0) return false;
    const sv = this.survival;
    const ars = this.ctx.arsenal;
    if (ars.claws) {
      this.toast('感染者用不了这些');
      return false;
    }
    if (!sv.wants(def)) {
      this.toast(def.kind === 'food' ? '现在不饿' : def.kind === 'drink' ? '现在不渴' : def.kind === 'med' ? '现在用不着' : '现在用不着');
      return false;
    }
    const done = (): void => {
      if (sv.dead || this.bag.count(id) <= 0 || !sv.use(def)) return;
      this.bag.take(id, 1);
      this.toast(`${USE_LABEL[def.kind] ?? '用'}了 ${def.name}`, 1.6);
      if (def.kind === 'drink') blip(0.25, 0.3, 1100, 300);
      else if (def.kind === 'food') blip(0.3, 0.2, 650);
      else blip(0.25, 0.25, 1800, 500);
    };
    const t = def.time ?? 0;
    // 坐在车里腾得出手：不用等
    if (t <= 0 || this.d.garage.driving) {
      done();
      return true;
    }
    if (ars.using) {
      this.toast('手上正忙着');
      return false;
    }
    // 背包开着的话先合上：用东西的这几秒人是能走、能看的
    this.setInv(false);
    if (!ars.use(id, t, done)) {
      this.toast('手上正忙着');
      return false;
    }
    blip(0.15, 0.1, 1400);
    return true;
  }

  /** 换下来的枪：收进背包（子弹退出来），背不下就丢在脚边 */
  stowGun(old: HeldGun): void {
    const oid = `gun_${old.id}`;
    const ammo = ammoOf(old.id);
    if (this.bag.add(oid, 1) <= 0) this.drop(oid, 1, old.loaded);
    else if (ammo && old.loaded > 0) this.bag.add(`ammo_${ammo}`, old.loaded);
  }

  /** 把背包里的枪 / 近战武器拿到手上（换下来的收回背包，背不下就丢在脚边） */
  private equip(id: string): void {
    const def = ITEMS[id];
    if (!def || this.bag.count(id) <= 0) return;
    const ars = this.ctx.arsenal;
    if (def.gun) {
      this.bag.take(id, 1);
      const old = ars.giveGun({ id: def.gun, loaded: 0 });
      // 借来的枪换下来就是还回去了，不进背包
      if (old && !old.loan) this.stowGun(old);
      this.flags.add('weapon');
      this.toast(`装备了 ${def.name}（空弹匣，按 R 装弹）`, 3);
    } else if (def.melee) {
      this.bag.take(id, 1);
      const old = ars.giveMelee(def.melee);
      if (old && this.bag.add(`melee_${old}`, 1) <= 0) this.drop(`melee_${old}`, 1);
      this.flags.add('weapon');
    }
    blip(0.3, 0.12, 1200, 260);
  }

  // ---------------------------------------------------------------- 弹出来的板（军械箱、图鉴、生化模式的开局和结算）

  /** 把鼠标重新锁回画面里（关掉背包 / 板以后） */
  private relock(): void {
    if (this.d.params.get('nolock') === '1') return;
    try {
      void (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      // 浏览器不让锁就算了：点一下画面还能再锁
    }
  }

  /** 弹一块板：html 是里面的内容，点了按钮 / 带 data-gun 的行就调 onClick。sticky = 不能用 Esc 关 */
  openModal(html: string, onClick: (t: HTMLElement) => void, sticky = false): void {
    this.setInv(false);
    this.modalEl.innerHTML = `<div class="box">${html}</div>`;
    this.modalEl.classList.add('open');
    this.modalClick = onClick;
    this.modalSticky = sticky;
    this.modalOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeModal(): void {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.modalClick = null;
    this.modalEl.classList.remove('open');
    this.relock();
  }

  /** 武器图鉴（按 B） */
  private openBook(): void {
    this.openModal(`${gunBook(this.unlocks, 'view', '武器图鉴')}<div class="btns"><button data-x="close">关上（Esc / B）</button></div>`, (t) => {
      if (t.dataset.x === 'close') this.closeModal();
    });
  }

  // ---------------------------------------------------------------- 背包 / 车厢界面

  private setInv(open: boolean): void {
    if (this.invOpen === open || (open && this.survival.dead)) return;
    this.invOpen = open;
    this.invEl.classList.toggle('open', open);
    this.invDirty = true;
    this.uiT = 0;
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else this.relock();
    this.gx.setTailgate?.(open && this.nearTrunk);
  }

  private renderInv(): void {
    this.invDirty = false;
    const col = (bag: Bag, where: 'bag' | 'trunk', title: string): string => {
      const rows: string[] = [];
      const ids = [...bag.items.keys()].filter((id) => ITEMS[id]).sort((a, b) => KIND_ORDER.indexOf((ITEMS[a] as ItemDef).kind) - KIND_ORDER.indexOf((ITEMS[b] as ItemDef).kind) || a.localeCompare(b));
      for (const id of ids) {
        const def = ITEMS[id] as ItemDef;
        const n = bag.count(id);
        const btn: string[] = [];
        if (where === 'bag') {
          const u = USE_LABEL[def.kind];
          if (u) btn.push(`<button data-a="use">${u}</button>`);
          if (this.nearTrunk) btn.push('<button data-a="move">放车上</button>');
          btn.push('<button data-a="drop">丢</button>');
        } else btn.push('<button data-a="move">拿</button>');
        rows.push(`<div class="row rare${def.rare}" data-w="${where}" data-id="${id}"><u>${KIND_NAME[def.kind]}</u><b>${def.name}</b><span>${n > 1 ? `×${n}` : ''}</span><em>${(def.weight * n).toFixed(1)}</em>${btn.join('')}</div>`);
      }
      const over = bag.weight > bag.capacity + 1e-6;
      return `<div class="col"><h3>${title}<span class="${over ? 'over' : ''}">${bag.weight.toFixed(1)} / ${bag.capacity} 千克</span></h3><div class="list">${rows.join('') || '<div class="empty">空的</div>'}</div></div>`;
    };
    const partName = (id: string): string => CAR_PARTS.find((q) => q.id === id)?.name ?? id;
    const gear = [this.survival.coat ? '厚外套' : '', this.flags.has('backpack') ? '背包' : '', this.flags.has('flashlight') ? '手电筒' : ''].filter(Boolean);
    const parts = [...CAR.parts].map(partName);
    this.invEl.innerHTML = `<div class="box">
      <div class="cols">${col(this.bag, 'bag', '背包')}${this.bio ? '<div class="col"><h3>生化模式</h3><div class="empty">子弹管够，不会饿、不会渴、不会冷。<br>6 包扎 · 8 打针 · Q 手雷<br>被咬倒就会变成感染者。</div></div>' : this.nearTrunk ? col(this.trunk, 'trunk', '皮卡车厢') : '<div class="col"><h3>皮卡车厢</h3><div class="empty">站到车尾才能存取。<br>车上的东西不会丢：人死了也还在车上。</div></div>'}</div>
      <div class="tip">${gear.length ? `身上：${gear.join(' · ')}` : '身上没有装备'}${parts.length ? `　皮卡：${parts.join(' · ')}` : ''}</div>
      <div class="foot"><span>子弹整堆挪 · 别的一次一个，按住 Shift 整堆 · Tab 关闭</span><i></i><button data-a="book">武器图鉴 ${this.unlocks.count} / ${GUN_LIST.length}</button>${this.bio ? '' : '<button data-a="bio">生化模式</button><button data-a="newgame">新开一局</button>'}<button data-a="menu">主菜单</button></div>
    </div>`;
  }

  private onInvClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const a = t.dataset.a;
    if (!a) return;
    e.preventDefault();
    if (a === 'book') {
      this.openBook();
      return;
    }
    if (a === 'menu') {
      // 回游戏主菜单（桌面版没有地址栏，只能从这里回去）；生化模式下 save() 什么也不写
      this.save();
      window.location.href = `${import.meta.env.BASE_URL}index.html`;
      return;
    }
    if (a === 'bio') {
      // 生化模式是单独的一局：先把这边存好再过去
      this.save();
      const u = new URL(window.location.href);
      u.searchParams.set('mode', 'bio');
      window.location.href = u.toString();
      return;
    }
    if (a === 'newgame') {
      // 点两下才算：第一下只是确认
      if (performance.now() - this.newGameArmed < 4000) {
        this.wiped = true;
        clearSave(this.d.world.seed);
        window.location.reload();
      } else {
        this.newGameArmed = performance.now();
        t.textContent = '再点一下：清掉存档重来';
      }
      return;
    }
    const row = t.closest('.row') as HTMLElement | null;
    const id = row?.dataset.id;
    if (!row || !id || !ITEMS[id]) return;
    const def = ITEMS[id] as ItemDef;
    const where = row.dataset.w as 'bag' | 'trunk';
    const from = where === 'bag' ? this.bag : this.trunk;
    const n = e.shiftKey || def.kind === 'ammo' ? from.count(id) : 1;
    if (a === 'use') {
      if (def.kind === 'gun' || def.kind === 'melee') this.equip(id);
      else this.consume(id);
    } else if (a === 'drop') {
      const k = from.take(id, n);
      if (k > 0) this.drop(id, k, 0);
    } else if (a === 'move') {
      const to = where === 'bag' ? this.trunk : this.bag;
      const k = to.add(id, Math.min(n, from.count(id)));
      if (k > 0) {
        from.take(id, k);
        blip(0.2, 0.08, 700);
      } else this.toast(where === 'bag' ? '车上放不下了' : '背不动了');
    }
    this.invDirty = true;
    this.uiT = 0;
  }

  // ---------------------------------------------------------------- 按键、交互

  /** 按键：返回 true = 这个键归玩法层 */
  key(code: string): boolean {
    const fkey = /^F\d/.test(code);
    if (this.modalOpen) {
      if ((code === 'Escape' || code === 'KeyB') && !this.modalSticky) this.closeModal();
      return !fkey;
    }
    if (this.survival.dead) {
      if (code === 'Enter' || code === 'Space') this.respawn();
      return !fkey;
    }
    if (code === 'Tab') {
      this.setInv(!this.invOpen);
      return true;
    }
    if (this.invOpen) {
      if (code === 'Escape') this.setInv(false);
      // 开着背包时别的键都不往下传（不然按 R 会换弹、按 E 会上车）
      return !fkey;
    }
    for (const q of this.quick) {
      if (code !== q.code) continue;
      const have = q.items.filter((i) => this.bag.count(i) > 0);
      const id = have.find((i) => this.survival.wants(ITEMS[i] as ItemDef)) ?? have[0];
      if (id) this.consume(id);
      else this.toast(q.code === 'Digit8' ? '没有针剂' : `没有能${q.label}的东西`);
      return true;
    }
    if (code === 'KeyB') {
      this.openBook();
      return true;
    }
    if (code === 'KeyT') {
      if (!this.flags.has('flashlight')) this.toast('还没有手电筒');
      else {
        this.flashOn = !this.flashOn;
        blip(0.2, 0.04, 3000);
      }
      return true;
    }
    if (code === 'KeyE' || code === 'KeyF') {
      const a = this.best.get(code);
      if (!a) return code === 'KeyE';
      if (a.hold) {
        this.holdKey = code;
        this.holdLabel = a.label;
        this.holdT = 0;
      } else a.act();
      return true;
    }
    return false;
  }

  /** 收集现在能做的交互，更新屏幕上的提示；按住的那个攒够时间就执行 */
  private interact(dt: number): void {
    const acts = this.acts;
    acts.length = 0;
    this.best.clear();
    const driving = !!this.d.garage.driving;
    if (!this.survival.dead && !this.invOpen) {
      this.d.garage.interactions(this.d.player, this.d.camera, this.bag, acts);
      const t = driving ? null : this.pickups.target;
      if (t) {
        if (t !== this.pickFor || t.n !== this.pickN) {
          const def = ITEMS[t.item] as ItemDef;
          const hand = def.kind === 'gun' || def.kind === 'melee';
          this.pickFor = t;
          this.pickN = t.n;
          this.pickE = { key: 'KeyE', label: `${hand ? '拿起' : '拾取'} ${def.name}${t.n > 1 ? ` ×${t.n}` : ''}`, prio: 10, tone: def.rare, act: () => this.take(t, false) };
          this.pickF = hand ? { key: 'KeyF', label: '收进背包', prio: 10, act: () => this.take(t, true) } : null;
        }
        if (this.pickE) acts.push(this.pickE);
        if (this.pickF) acts.push(this.pickF);
      } else this.pickFor = null;
      if (this.nearTrunk && !driving) acts.push(this.trunkAct);
      if (!driving) this.siege?.interactions(acts);
    }
    for (const a of acts) {
      const b = this.best.get(a.key);
      if (!b || (a.prio ?? 0) > (b.prio ?? 0)) this.best.set(a.key, a);
    }
    let hold = 0;
    if (this.holdKey) {
      const a = this.best.get(this.holdKey);
      if (!a || a.label !== this.holdLabel || !a.hold || !this.d.keys.has(this.holdKey)) this.holdKey = '';
      else {
        this.holdT += dt;
        hold = Math.min(1, this.holdT / a.hold);
        if (hold >= 1) {
          this.holdKey = '';
          hold = 0;
          a.act();
        }
      }
    }
    let html = '';
    if (this.best.size) {
      for (const key of ['KeyE', 'KeyF', 'Tab']) {
        const a = this.best.get(key);
        if (!a) continue;
        const bar = key === this.holdKey && hold > 0 ? `<i style="width:${(hold * 100).toFixed(0)}%"></i>` : '';
        html += `<div class="row rare${a.tone ?? 0}"><b>${key.startsWith('Key') ? key.slice(3) : key}</b>${a.hold ? '按住 ' : ''}${a.label}${bar}</div>`;
      }
    }
    if (html !== this.promptHtml) {
      this.promptHtml = html;
      this.promptEl.innerHTML = html;
    }
  }

  // ---------------------------------------------------------------- 死亡、重来

  private onDeath(): void {
    const p = this.d.player;
    this.setInv(false);
    if (this.bio) {
      // 生化模式里倒下 = 被感染（或者感染者被打倒），不走下面这一套
      this.bio.playerDown();
      return;
    }
    this.closeModal();
    // 正在守城：算没守住，借的枪先收回去（不会掉在地上）
    this.siege?.playerDied();
    if (this.gx.forceExit) this.gx.forceExit(p);
    else if (this.d.garage.driving) this.d.garage.toggle(p, this.d.camera);
    // 手上的武器、背包里的东西都掉在原地（车上的还在车上），地图上标出来
    try {
      this.ctx.arsenal.strip();
    } catch (e) {
      console.error('[open] arsenal.strip 出错', e);
    }
    for (const [id, n] of [...this.bag.items]) {
      this.bag.take(id, n);
      const a = Math.random() * 6.28;
      const r = 0.3 + Math.random() * 0.9;
      this.drop(id, n, 0, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r);
    }
    this.deathMark = { x: p.x, z: p.z };
    this.flashOn = false;
    this.deadEl.innerHTML = `<div><h1>你${this.survival.cause || '死了'}</h1><p>活到第 ${this.d.clock.day} 天 · 打死 ${this.kills} 只丧尸 · ${this.level} 级</p><p class="s">身上的东西掉在了原地（地图上标着「遗物」），车上的还在车上</p><p class="k">按 回车 回到起点重新醒来</p></div>`;
    this.deadEl.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock();
    blip(0.5, 0.6, 200, 110);
    // 马上存一次：这时候关掉页面，再打开也是「已经死了」，不会回到死之前
    this.save();
  }

  /** 在起点重新醒来：不是满状态，时间过去了小半天 */
  private wake(): void {
    this.survival.revive();
    this.deadEl.classList.remove('open');
    const sp = this.d.world.sites.spawn();
    this.d.teleport(sp.x, sp.z, sp.yaw);
    const c = this.d.clock;
    if (c.hours + 6 >= 24) c.day++;
    c.set(c.hours + 6);
    this.lastDay = c.day;
    this.toast('你又在路边醒了过来。东西还在你倒下的地方', 6);
    this.uiKey = '';
  }

  respawn(): void {
    if (!this.survival.dead || this.bio) return;
    this.wake();
    this.save();
  }

  // ---------------------------------------------------------------- 存档

  save(): void {
    if (!this.saving || this.wiped) return;
    const p = this.d.player;
    const safe = <T>(f: () => T, fallback: T): T => {
      try {
        return f();
      } catch {
        return fallback;
      }
    };
    const data: SaveData = {
      t: Date.now(),
      player: { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch },
      clock: { day: this.d.clock.day, hours: this.d.clock.hours },
      survival: this.survival.save(),
      bag: this.bag.save(),
      trunk: this.trunk.save(),
      pickups: this.pickups.save(),
      arsenal: safe<unknown>(() => this.ctx.arsenal.save(), null),
      garage: safe<unknown>(() => this.gx.save?.() ?? null, null),
      horde: safe<unknown>(() => this.ctx.horde.save(), null),
      raiders: safe<unknown>(() => this.ctx.raiders.save(), null),
      siege: this.siege?.save() ?? null,
      weather: this.ctx.weather.kind,
      found: [...this.d.hud.found],
      kills: this.kills,
      xp: this.xp,
      level: this.level,
      goal: this.goal,
      flags: [...this.flags, ...[...this.visited].map((k) => `v:${k}`), ...[...this.visitedKinds].map((k) => `k:${k}`), ...(this.flashOn ? ['on:flash'] : []), ...(this.survival.dead ? ['st:dead'] : [])],
      markers: this.deathMark ? [{ ...this.deathMark, label: '遗物', color: '#ff8a6a' }] : [],
    };
    writeSave(this.d.world.seed, data);
  }

  private load(s: SaveData): void {
    const safe = (name: string, f: () => void): void => {
      try {
        f();
      } catch (e) {
        console.error(`[open] 读存档：${name} 出错`, e);
      }
    };
    this.d.clock.day = Math.max(1, Math.floor(s.clock?.day ?? 1));
    this.d.clock.set(s.clock?.hours ?? 9);
    this.survival.load(s.survival);
    this.bag.load(s.bag);
    this.trunk.load(s.trunk);
    this.pickups.load(s.pickups);
    this.kills = s.kills ?? 0;
    this.xp = s.xp ?? 0;
    this.level = Math.max(1, s.level ?? 1);
    this.goal = s.goal ?? 0;
    let died = false;
    for (const f of s.flags ?? []) {
      if (f === 'st:dead') died = true;
      else if (f.startsWith('v:')) this.visited.add(Number(f.slice(2)));
      else if (f.startsWith('k:')) this.visitedKinds.add(f.slice(2));
      else if (f === 'on:flash') this.flashOn = true;
      else this.flags.add(f);
    }
    for (const k of s.found ?? []) this.d.hud.found.add(k);
    const m = s.markers?.[0];
    this.deathMark = m ? { x: m.x, z: m.z } : null;
    safe('武器', () => this.ctx.arsenal.load(s.arsenal));
    safe('车', () => this.gx.load?.(s.garage));
    safe('丧尸', () => this.ctx.horde.load(s.horde ?? null));
    safe('带枪的人', () => this.ctx.raiders.load(s.raiders ?? null));
    this.siege?.load(s.siege ?? null);
    safe('天气', () => this.ctx.weather.set((s.weather || 'clear') as WeatherKind, true));
    if (died) {
      // 上次是死了以后关掉的：直接在起点醒来
      this.wake();
      return;
    }
    this.d.teleport(s.player.x, s.player.z, s.player.yaw);
    this.d.player.pitch = s.player.pitch ?? 0;
    this.toast(`接着上次的进度：第 ${this.d.clock.day} 天`, 4);
  }

  // ---------------------------------------------------------------- 每帧

  /** 走到了哪个地点里：第一次到有经验（award = false 只记不给） */
  private visit(award: boolean): void {
    const p = this.d.player;
    this.here.length = 0;
    this.d.world.sites.near(p.x, p.z, 0, this.here);
    for (const s of this.here) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > s.r - 8) continue;
      this.visitedKinds.add(s.kind);
      if (this.visited.has(s.key)) continue;
      this.visited.add(s.key);
      if (award) this.gain(40, `第一次来到 ${s.name}`);
    }
  }

  update(dt: number): void {
    const d = this.d;
    const p = d.player;
    const sv = this.survival;
    const driving = !!d.garage.driving;
    // 在不在屋里、头顶有没有东西、是不是站在车尾
    this.indoorsT -= dt;
    if (this.indoorsT <= 0) {
      this.indoorsT = 0.25;
      let inside = false;
      for (const r of d.world.sites.housesNear(p.x, p.z, 4)) if (p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1) inside = true;
      let roofed = false;
      for (const c of d.world.sites.coversNear(p.x, p.z, 6)) if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1 && c.y > p.feet + 1) roofed = true;
      this.indoorsV = inside && roofed;
      this.roofedV = roofed;
      const near = !driving && this.trunkPoint(_v) && Math.hypot(_v.x - p.x, _v.z - p.z) < 2.6;
      if (near !== this.nearTrunk) {
        this.nearTrunk = near;
        this.invDirty = true;
        if (this.invOpen) this.gx.setTailgate?.(near);
      }
      if (this.trunk.capacity !== CAR.cargoCapacity) this.recalc();
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }
    // 地上的东西、准星指着哪一件（眼睛 = 相机）
    const cam = d.camera;
    cam.getWorldDirection(_dir);
    this.pickups.update(dt, p.x, p.z, cam.position.x, cam.position.y, cam.position.z, _dir.x, _dir.y, _dir.z, !driving && !sv.dead && !this.invOpen);
    this.interact(dt);
    // 生存状态
    const w = this.ctx.weather;
    const wasCold = sv.warmth < 35;
    sv.update(dt, {
      temp: w.temp,
      rain: w.rain,
      snow: w.snow,
      wind: w.wind,
      indoors: this.indoorsV,
      roofed: this.roofedV,
      inCar: driving,
      engine: !!d.garage.driving?.body.engineOn,
      sprinting: p.sprinting && !driving,
      moving: p.speed > 0.5 && !driving,
      wade: driving ? 0 : p.wade,
    });
    // 背得太重走不快
    const over = this.bag.weight - this.bag.capacity;
    // 开镜瞄准时走得慢（lookScale < 1 = 正在瞄准）
    const aiming = !driving && this.ctx.arsenal.lookScale < 0.99;
    // 被丧尸贴身围住：一只慢 15%，三只以上慢 45%（走路还是比行尸快一点，慢慢能挤出去，但不能直接跑穿）
    const grip = driving ? 0 : this.ctx.horde.grip;
    p.speedMul = sv.speedMul * (over > 0 ? Math.max(0.5, 1 - over * 0.05) : 1) * (aiming ? 0.6 : 1) * (1 - 0.45 * grip) * (this.bio?.speedMul ?? 1);
    // 守城、生化模式
    this.siege?.update(dt);
    this.bio?.update(dt);
    if (!wasCold && sv.warmth < 35) this.toast('太冷了：进屋、上车开着发动机，或者找件厚外套', 5);
    // 手电
    const on = this.flashOn && !driving && !sv.dead;
    // 白天几乎看不出来（也不该把近处照白），夜里才是全亮
    this.flash.intensity = on ? 3 + 15 * d.clock.night : 0;
    if (on) {
      // 灯在眼睛后面半米多：贴脸的东西不会过曝
      this.flash.position.copy(cam.position).addScaledVector(_dir, -0.6);
      this.flash.position.y -= 0.12;
      this.flashTarget.position.copy(cam.position).addScaledVector(_dir, 10);
      this.flashTarget.updateMatrixWorld();
    }
    // 到了哪、过了几天、目标、地图标记：不用每帧
    this.siteT -= dt;
    if (this.siteT <= 0) {
      this.siteT = 0.7;
      if (!sv.dead && !this.bio) {
        this.visit(true);
        if (!this.flags.has('tip:raider')) {
          const n = this.ctx.raiders.list(this.humans);
          for (let i = 0; i < n; i++) {
            const h = this.humans[i] as HumanRef;
            if (h.side !== 'raider' || Math.hypot(h.x - p.x, h.z - p.z) > 70) continue;
            this.flags.add('tip:raider');
            this.toast('前面有人，带着枪。这年头活人不一定是朋友：他们看见你就会开枪', 7);
            blip(0.3, 0.3, 500, 220);
            break;
          }
        }
        if (d.clock.day > this.lastDay) {
          this.lastDay = d.clock.day;
          this.gain(100, `活到了第 ${d.clock.day} 天`);
        }
        const g = GOALS[this.goal];
        if (g && g.done(this)) {
          this.goal++;
          this.gain(60);
          this.toast(`目标完成：${g.text}`, 4);
          blip(0.3, 0.3, 2000, 780);
        }
      }
      const marks = d.hud.markers;
      marks.length = 0;
      const car = (this.gx.car ?? d.garage.vehicles[0]) as CarLike | null | undefined;
      const cp = car?.rig?.root.position;
      if (cp && !driving && !this.bio) marks.push({ x: cp.x, z: cp.z, label: '皮卡', color: '#6ad1ff' });
      if (this.deathMark) {
        if (!sv.dead && Math.hypot(this.deathMark.x - p.x, this.deathMark.z - p.z) < 4) this.deathMark = null;
        else marks.push({ x: this.deathMark.x, z: this.deathMark.z, label: '遗物', color: '#ff8a6a' });
      }
      this.siege?.markers(marks);
      this.bio?.markers(marks);
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 20;
      if (!sv.dead) this.save();
    }
    this.ui(dt);
  }

  private ui(dt: number): void {
    const sv = this.survival;
    const p = this.d.player;
    // 受伤闪红、快死了一直红；冷的时候四周发白；伤害从哪边来
    const flash = Math.max(0, 1 - sv.hurtT / 0.6) * Math.min(1, 0.35 + sv.hurtAmount / 25);
    const low = sv.hp < 35 ? (1 - sv.hp / 35) * 0.55 : 0;
    this.vignette.style.opacity = sv.dead ? '0.9' : Math.max(flash, low).toFixed(2);
    this.frost.style.opacity = sv.warmth < 45 && !sv.dead ? ((1 - sv.warmth / 45) * 0.8).toFixed(2) : '0';
    if (sv.hurtT < 1.2 && sv.hurtAmount >= 1 && !sv.dead) {
      const rel = Math.atan2(sv.hurtX - p.x, sv.hurtZ - p.z) - p.yaw;
      this.hitEl.style.opacity = (1 - sv.hurtT / 1.2).toFixed(2);
      this.hitEl.style.transform = `translate(-50%, -50%) rotate(${(-rel).toFixed(3)}rad)`;
    } else if (this.hitEl.style.opacity !== '0') this.hitEl.style.opacity = '0';
    this.uiT -= dt;
    if (this.uiT > 0) return;
    this.uiT = 0.2;
    if (this.invOpen && this.invDirty) this.renderInv();
    if (this.goalShown !== this.goal) {
      this.goalShown = this.goal;
      const g = GOALS[this.goal];
      this.goalEl.innerHTML = `<b>目标</b>${g ? g.text : GOAL_END}`;
    }
    const tags: string[] = [];
    if (sv.hunger < 25) tags.push('饥饿');
    if (sv.thirst < 25) tags.push('口渴');
    if (sv.warmth < 45) tags.push('寒冷');
    if (sv.wet > 0.35) tags.push('淋湿');
    if (sv.heat > 0) tags.push(`暖宝宝 ${Math.ceil(sv.heat)}s`);
    if (sv.boostT > 0 && sv.boostT < 1e4) tags.push(`肾上腺素 ${Math.ceil(sv.boostT)}s`);
    if (sv.numbT > 0) tags.push(`镇痛 ${Math.ceil(sv.numbT)}s`);
    if (this.bag.weight > this.bag.capacity) tags.push('超重');
    if (this.flashOn) tags.push('手电开着');
    const quick = this.quick.map((q) => `${q.key} ${q.label}×${q.items.reduce((n, i) => n + this.bag.count(i), 0)}`).join('　');
    const key = [Math.round(sv.hp), Math.round(sv.hunger), Math.round(sv.thirst), Math.round(sv.warmth), Math.round(sv.stamina * 50), Math.round(sv.felt), tags.join(), quick, this.level, Math.round(this.xp), this.bag.weight.toFixed(1), this.bag.capacity, this.flashOn].join('|');
    if (key === this.uiKey) return;
    this.uiKey = key;
    const set = (k: string, v: number, text: string): void => {
      const b = this.bars[k] as HTMLElement;
      (b.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, v)).toFixed(0)}%`;
      (b.querySelector('em') as HTMLElement).textContent = text;
      b.classList.toggle('warn', v < 25);
    };
    set('hp', sv.hp, String(Math.ceil(sv.hp)));
    set('hunger', sv.hunger, '');
    set('thirst', sv.thirst, '');
    set('warmth', sv.warmth, `体感 ${Math.round(sv.felt)}℃`);
    set('stamina', sv.stamina * 100, '');
    this.tagsEl.textContent = tags.join(' · ');
    this.quickEl.textContent = quick + (this.flags.has('flashlight') ? '　T 手电' : '');
    this.lvEl.innerHTML = `<b>${this.level} 级</b><span><i style="width:${((this.xp / xpNeed(this.level)) * 100).toFixed(0)}%"></i></span><em>负重 ${this.bag.weight.toFixed(1)} / ${this.bag.capacity}</em>`;
  }
}

const CSS = `
  .g-toast { position: fixed; left: 50%; bottom: 128px; transform: translateX(-50%); padding: 7px 16px; border-radius: 4px; background: #000000a8; font-size: 15px; letter-spacing: .06em; color: #f2ead8; opacity: 0; transition: opacity .25s; pointer-events: none; z-index: 5; white-space: nowrap; }
  .act-prompt { position: fixed; left: 50%; top: 62%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 5px; align-items: center; pointer-events: none; user-select: none; z-index: 4; }
  .act-prompt .row { position: relative; padding: 6px 14px 6px 10px; border-radius: 4px; background: #000000a8; font-size: 15px; letter-spacing: .06em; color: #f2ead8; white-space: nowrap; overflow: hidden; }
  .act-prompt .row b { display: inline-block; min-width: 20px; margin-right: 8px; padding: 0 5px; border-radius: 3px; background: #ffd36a; color: #1a1408; text-align: center; font: bold 13px/20px Consolas, monospace; }
  .act-prompt .row i { position: absolute; left: 0; bottom: 0; height: 3px; background: #ffd36a; }
  .act-prompt .row.rare1 { color: #9fd0ff; }
  .act-prompt .row.rare2 { color: #ffc46a; }
  .g-goal { position: fixed; left: 18px; top: 16px; max-width: 340px; padding: 7px 12px; border-left: 3px solid #ffd36a; background: #00000080; font-size: 13px; line-height: 1.5; color: #f2ead8; pointer-events: none; user-select: none; text-shadow: 0 1px 2px #000; z-index: 2; }
  .g-goal b { display: block; font-size: 11px; letter-spacing: .3em; color: #ffd36a; }
  #hud .stats { top: 84px; }
  #hud .hint { white-space: nowrap; font-size: 12px; }
  #hud .coords, #hud .clock { left: 50%; right: auto; transform: translateX(-50%); padding: 1px 10px; border-radius: 10px; background: #00000078; white-space: nowrap; }
  #hud .coords { bottom: -24px; }
  #hud .clock { bottom: -48px; }
  .g-status { position: fixed; left: 20px; bottom: 22px; width: 280px; pointer-events: none; user-select: none; font-size: 12px; color: #e8e0cc; text-shadow: 0 1px 2px #000; z-index: 2; }
  .g-status .lv { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .g-status .lv b { color: #ffd36a; font-size: 13px; }
  .g-status .lv span { flex: 1; height: 3px; background: #ffffff20; border-radius: 2px; overflow: hidden; }
  .g-status .lv span i { display: block; height: 100%; background: #ffd36a; }
  .g-status .lv em { font-style: normal; color: #ffffff90; font-size: 11px; }
  .g-status .bar { display: flex; align-items: center; gap: 8px; height: 17px; }
  .g-status .bar span { width: 28px; color: #ffffffb0; }
  .g-status .bar div { flex: 1; height: 8px; background: #00000090; border: 1px solid #ffffff22; border-radius: 2px; overflow: hidden; }
  .g-status .bar i { display: block; height: 100%; transition: width .2s; }
  .g-status .bar em { width: 62px; font-style: normal; color: #ffffffa0; font-size: 11px; white-space: nowrap; }
  .g-status .hp i { background: #d9534a; }
  .g-status .hunger i { background: #d9a441; }
  .g-status .thirst i { background: #4aa3d9; }
  .g-status .warmth i { background: #e07a3c; }
  .g-status .stamina { height: 9px; }
  .g-status .stamina div { height: 3px; border: none; }
  .g-status .stamina i { background: #cfd8c0; }
  .g-status .bar.warn span { color: #ff8a6a; }
  .g-status .bar.warn div { border-color: #ff8a6a; animation: g-warn 1s infinite; }
  @keyframes g-warn { 50% { border-color: #ffffff22; } }
  .g-status .tags { min-height: 16px; margin-top: 4px; color: #ff9a7a; }
  .g-status .quick { margin-top: 2px; color: #ffffff80; font-size: 11px; white-space: nowrap; }
  .g-vignette, .g-frost { position: fixed; inset: 0; pointer-events: none; opacity: 0; z-index: 3; }
  .g-vignette { background: radial-gradient(ellipse at center, transparent 45%, #7a0a06cc 100%); transition: opacity .12s; }
  .g-frost { background: radial-gradient(ellipse at center, transparent 52%, #cfe6f5b8 100%); transition: opacity 1s; }
  .g-hit { position: fixed; left: 50%; top: 50%; width: 260px; height: 260px; transform: translate(-50%, -50%); pointer-events: none; opacity: 0; z-index: 3; }
  .g-hit i { position: absolute; inset: 0; border: 7px solid transparent; border-top-color: #e2362ce0; border-radius: 50%; mask-image: linear-gradient(90deg, transparent 22%, #000 40%, #000 60%, transparent 78%); }
  .g-inv { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: #05070a99; z-index: 20; user-select: none; }
  .g-inv.open { display: flex; }
  .g-inv .box { width: min(900px, 94vw); padding: 18px 20px 12px; border: 1px solid #ffffff22; border-radius: 8px; background: #0e1216f2; box-shadow: 0 16px 60px #000c; }
  .g-inv .cols { display: flex; gap: 18px; }
  .g-inv .col { flex: 1; min-width: 0; }
  .g-inv h3 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 15px; letter-spacing: .2em; color: #ffd36a; }
  .g-inv h3 span { font-size: 12px; letter-spacing: 0; color: #ffffff90; }
  .g-inv h3 span.over { color: #ff8a6a; }
  .g-inv .list { height: min(52vh, 440px); overflow-y: auto; padding-right: 4px; }
  .g-inv .row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; margin-bottom: 3px; border-radius: 3px; background: #ffffff0a; font-size: 13px; color: #e8e0cc; }
  .g-inv .row:hover { background: #ffffff16; }
  .g-inv .row u { width: 42px; text-decoration: none; font-size: 11px; color: #ffffff60; }
  .g-inv .row b { flex: 1; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .g-inv .row.rare1 b { color: #9fd0ff; }
  .g-inv .row.rare2 b { color: #ffc46a; }
  .g-inv .row span { width: 38px; text-align: right; color: #ffffffc0; }
  .g-inv .row em { width: 34px; text-align: right; font-style: normal; font-size: 11px; color: #ffffff70; }
  .g-inv button { padding: 2px 8px; border: 1px solid #ffffff30; border-radius: 3px; background: #ffffff10; color: #f2ead8; font: 12px "Microsoft YaHei", sans-serif; cursor: pointer; }
  .g-inv button:hover { background: #ffd36a; color: #1a1408; }
  .g-inv .empty { padding: 30px 10px; text-align: center; line-height: 1.9; color: #ffffff60; font-size: 13px; }
  .g-inv .tip { min-height: 18px; margin-top: 10px; font-size: 12px; color: #d8d0bc; }
  .g-inv .foot { display: flex; align-items: center; gap: 10px; margin-top: 8px; padding-top: 9px; border-top: 1px solid #ffffff18; font-size: 12px; color: #ffffff80; }
  .g-inv .foot i { flex: 1; }
  .g-dead { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: #140404cc; z-index: 25; text-align: center; color: #f2ead8; cursor: pointer; }
  .g-dead.open { display: flex; }
  .g-dead h1 { margin: 0 0 14px; font-size: 44px; letter-spacing: .3em; color: #e0563c; }
  .g-dead p { margin: 6px 0; font-size: 16px; letter-spacing: .08em; }
  .g-dead p.s { font-size: 13px; color: #ffffff90; }
  .g-dead p.k { margin-top: 26px; color: #ffd36a; }
`;
