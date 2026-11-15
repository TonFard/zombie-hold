import { GUN_BY_ID } from '../../game/data/guns';
import { GUN_LIST, type GunClass, type GunInfo } from './api';

/**
 * 武器图鉴：生存世界、守城模式、生化模式共用的「哪些枪解锁了」。
 *
 *   生存世界   在世界里捡到过一把（拿到手上或者收进背包都算）= 解锁这个型号
 *   守城模式   主游戏里本来的解锁（熟练度 + 勋章，存在服务器上）
 *   生化模式   每局结算给军功，用军功换
 * 任何一边解锁的，另外两边都认：
 *   守城模式   生存世界 / 生化模式解锁的型号直接算「已拥有」（写进服务器存档的 meta.guns，主游戏不用改）
 *   生存世界   守城时据点的军械箱只借给你已经解锁的枪
 *   生化模式   开局只能挑已经解锁的枪
 *
 * 存在哪：这台电脑的 localStorage 里一份（没登录也能用）；这个浏览器登录过主游戏的话，启动时把服务器上
 * 守城模式的解锁读下来（只读）。往服务器写要玩家在图鉴里点一次「同步到守城模式」：那以后这边新解锁的型号
 * 追加进服务器存档的 meta.guns（别的字段原样不动）。没点过就一个字节也不往服务器写。
 * 主游戏解锁一个「类别」（冲锋枪、步枪……）要先把上一类练到精通——这条规矩不碰：这里只解锁型号，不解锁类别。
 * 每次往服务器写之前，原来那份存档先留一份在本机（localStorage 的 zh.open.cloudsave.bak）。
 */

const KEY = 'zh.open.unlocks.1';
/** 玩家点过「同步到守城模式」了（'1'） */
const SYNC_KEY = 'zh.open.unlocks.sync';
/** 往服务器存档里追加型号之前，原来那份存档留在这里（只留最近一次） */
const BACKUP_KEY = 'zh.open.cloudsave.bak';
/** 和 src/app/cloud.ts 一致：登录以后本机只记这个 */
const AUTH_KEY = 'dawn-cloud-auth';
const CLOUD_DEFAULT = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? 'http://47.94.82.70:8092';
/** 生化模式里用军功换一把枪要多少：按稀有度 */
const PRICE = [0, 3, 6, 10, 15];
/** 谁都有的 */
const FREE = 'glock_17';

export type UnlockSource = 'free' | 'found' | 'bought' | 'cloud';

export const SOURCE_TEXT: Record<UnlockSource, string> = {
  free: '一开始就有',
  found: '在生存世界里找到过',
  bought: '生化模式里用军功换的',
  cloud: '守城模式里解锁的',
};

interface Auth {
  name: string;
  token: string;
}

class Conflict extends Error {}

export class Unlocks {
  /** 生存世界里找到过的、生化模式里换的、服务器上守城模式已经有的 */
  readonly found = new Set<string>();
  readonly bought = new Set<string>();
  readonly cloud = new Set<string>();
  /** 生化模式的军功 */
  merits = 0;
  /** 连上的账号名（没登录是空串） */
  account = '';
  /** local = 只在这台电脑上；cloud = 和守城模式的进度连上了；offline = 登录过，但这次没连上服务器 */
  status: 'local' | 'cloud' | 'offline' = 'local';
  /** 玩家同意往服务器存档里写了（点过「同步到守城模式」）。没同意 = 只读不写 */
  consent = false;
  /** 这边解锁了、服务器存档里还没有的有几把 */
  pending = 0;
  onChange: () => void = () => {};
  private readonly persist: boolean;
  private readonly url: string;
  private readonly auth: Auth | null;
  private pushing = false;
  private again = false;

  constructor(params: URLSearchParams) {
    this.persist = params.get('nosave') !== '1';
    const q = params.get('cloud');
    // ?cloud=地址 只在开发时认（不然一条做好的链接就能把登录 token 送到别人的服务器上）；?cloud=0 不连服务器
    this.url = q && q !== '0' && import.meta.env.DEV ? q : CLOUD_DEFAULT;
    const allow = q !== '0' && (this.persist || (!!q && import.meta.env.DEV));
    this.auth = allow ? readAuth() : null;
    if (this.persist) {
      this.read();
      try {
        this.consent = window.localStorage.getItem(SYNC_KEY) === '1';
      } catch {
        this.consent = false;
      }
    }
  }

  /** 登录了主游戏、但还没同意往服务器存档里写：图鉴上放一个「同步到守城模式」的按钮 */
  get canSync(): boolean {
    return !!this.auth && !this.consent;
  }

  /** 已经和守城模式连上、而且会自动写回去 */
  get linked(): boolean {
    return !!this.auth && this.consent;
  }

  /** 玩家点了「同步到守城模式」：记住，马上同步一次 */
  allowSync(): void {
    if (!this.auth || this.consent) return;
    this.consent = true;
    if (this.persist) {
      try {
        window.localStorage.setItem(SYNC_KEY, '1');
      } catch {
        // 记不住就只管这一次
      }
    }
    void this.push();
  }

  private read(): void {
    try {
      const d = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { found?: unknown; bought?: unknown; merits?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      const ok = (v: unknown): v is string => typeof v === 'string' && GUN_LIST.some((g) => g.id === v);
      if (Array.isArray(d.found)) for (const id of d.found) if (ok(id)) this.found.add(id);
      if (Array.isArray(d.bought)) for (const id of d.bought) if (ok(id)) this.bought.add(id);
      if (typeof d.merits === 'number' && Number.isFinite(d.merits)) this.merits = Math.max(0, Math.floor(d.merits));
    } catch {
      // 读不出来就当没有
    }
  }

  private write(): void {
    if (!this.persist) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ found: [...this.found], bought: [...this.bought], merits: this.merits }));
    } catch {
      // 存不了就算了
    }
  }

  /** 这把枪是怎么解锁的（null = 还没解锁） */
  source(id: string): UnlockSource | null {
    if (id === FREE) return 'free';
    if (this.found.has(id)) return 'found';
    if (this.cloud.has(id)) return 'cloud';
    if (this.bought.has(id)) return 'bought';
    return null;
  }

  owned(id: string): boolean {
    return this.source(id) !== null;
  }

  /** 解锁了几把 / 一共几把 */
  get count(): number {
    let n = 0;
    for (const g of GUN_LIST) if (this.owned(g.id)) n++;
    return n;
  }

  /** 生存世界里捡到了一把。返回 true = 这是第一次（刚解锁） */
  find(id: string): boolean {
    if (!GUN_LIST.some((g) => g.id === id) || this.found.has(id)) return false;
    const fresh = !this.owned(id);
    this.found.add(id);
    this.write();
    this.onChange();
    void this.push();
    return fresh;
  }

  price(g: GunInfo): number {
    return PRICE[g.tier] as number;
  }

  /** 生化模式里用军功换。不够 / 已经有了返回 false */
  buy(id: string): boolean {
    const g = GUN_LIST.find((q) => q.id === id);
    if (!g || this.owned(id) || this.merits < this.price(g)) return false;
    this.merits -= this.price(g);
    this.bought.add(id);
    this.write();
    this.onChange();
    void this.push();
    return true;
  }

  addMerits(n: number): void {
    if (n <= 0) return;
    this.merits += Math.floor(n);
    this.write();
    this.onChange();
  }

  /** 这句话放在界面上：解锁存在哪 */
  where(): string {
    if (this.status === 'cloud') {
      if (this.consent) return `已和账号「${this.account}」的守城进度连上：这边解锁的型号会自动同步过去`;
      return `已读到账号「${this.account}」的守城进度。这边解锁的${this.pending ? ` ${this.pending} 把` : ''}还没有写过去：点「同步到守城模式」才会写（只往存档里追加型号，别的不动；写之前在本机留一份备份）`;
    }
    if (this.status === 'offline') return `这次没连上服务器：先记在这台电脑上，下次连上再说（账号「${this.account}」）`;
    return '没有登录主游戏：解锁只记在这台电脑上。在这个浏览器里登录主游戏以后，这里会出现「同步到守城模式」';
  }

  // ---------------------------------------------------------------- 服务器

  private async call(method: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.url}/api/save`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(this.auth as Auth).token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 409) throw new Conflict();
    if (!res.ok) throw new Error(`服务器 ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  /** 从服务器存档里读出守城模式已经有哪些型号。返回存档里的 meta（没有存档 / 格式不认识返回 null） */
  private readRemote(save: unknown): Record<string, unknown> | null {
    if (!save || typeof save !== 'object' || (save as { version?: unknown }).version !== 2) return null;
    const meta = (save as { meta?: unknown }).meta;
    if (!meta || typeof meta !== 'object') return null;
    const m = meta as { guns?: unknown; levels?: unknown };
    const guns = Array.isArray(m.guns) ? m.guns.filter((x): x is string => typeof x === 'string') : [];
    const levels = (m.levels && typeof m.levels === 'object' ? m.levels : {}) as Record<string, unknown>;
    const classOpen = (c: GunClass): boolean => c === 'pistol' || Number(levels[`unlock-${c}`] ?? 0) > 0;
    this.cloud.clear();
    for (const g of GUN_LIST) {
      const def = GUN_BY_ID[g.id];
      if (!def) continue;
      // 花勋章解锁的型号看 guns；每一类自带的那把（不要勋章）看这一类解锁了没有
      if (def.medals > 0 ? guns.includes(g.id) : classOpen(def.cls as GunClass)) this.cloud.add(g.id);
    }
    return meta as Record<string, unknown>;
  }

  /** 启动时调一次：读服务器上的守城进度；玩家同意过的话把这边攒着没传的解锁传上去。没登录什么都不做 */
  async sync(): Promise<void> {
    if (!this.auth) return;
    this.account = this.auth.name;
    await this.push(true);
  }

  /**
   * 把这边解锁的型号追加进服务器存档的 meta.guns。整份存档原样读回来、只动这一个数组再写回去；
   * 版本号对不上（别的地方刚写过）就重新读一遍再来，最多两次。新号还没有存档时不写（等主游戏建了存档再说）
   */
  private async push(first = false): Promise<void> {
    if (!this.auth) return;
    if (this.pushing) {
      this.again = true;
      return;
    }
    this.pushing = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const cur = await this.call('GET');
        const meta = this.readRemote(cur.save);
        this.status = 'cloud';
        if (!meta) break;
        const guns = Array.isArray(meta.guns) ? (meta.guns as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        // 只有要花勋章的型号才记在 guns 里（主游戏读存档时也只认这些）
        const add = [...this.found, ...this.bought].filter((id) => (GUN_BY_ID[id]?.medals ?? 0) > 0 && !guns.includes(id));
        this.pending = add.length;
        // 没同意写：到这里为止（只读）
        if (!add.length || !this.consent) break;
        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ t: Date.now(), account: this.auth.name, rev: cur.rev, epoch: cur.epoch, save: cur.save }));
        } catch {
          // 留不下备份就不写服务器：宁可这次不同步
          break;
        }
        meta.guns = [...guns, ...add];
        try {
          await this.call('PUT', { save: cur.save, epoch: Number.isInteger(cur.epoch) ? cur.epoch : 0, rev: cur.rev });
          for (const id of add) this.cloud.add(id);
          this.pending = 0;
          break;
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
        }
      }
    } catch (e) {
      this.status = 'offline';
      if (first) console.warn('[open] 武器图鉴：没连上服务器，解锁先记在本机', e);
    } finally {
      this.pushing = false;
      this.onChange();
      if (this.again) {
        this.again = false;
        void this.push();
      }
    }
  }
}

function readAuth(): Auth | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(AUTH_KEY) ?? 'null') as Auth | null;
    return v && typeof v.name === 'string' && typeof v.token === 'string' && v.token ? v : null;
  } catch {
    return null;
  }
}
