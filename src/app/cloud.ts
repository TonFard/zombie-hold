import { RUN_KEY } from '../game/save/checkpoint';
import { EPOCH_KEY, SAVE_EPOCH, SAVE_KEY, parseSave, type SaveData } from '../game/save/schema';
import type { Storage } from '../game/save/storage';

/**
 * 线上存档：游戏的所有进度（跨局存档 + 打到一半的检查点）只存在服务器上，本机只记登录 token。
 * 服务端在 server/index.mjs。没登录不能玩；启动时先从服务器拉进度，之后每次变化立刻上传。
 */
export const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? 'http://47.94.82.70:8092';
const AUTH_KEY = 'dawn-cloud-auth';

export interface CloudAuth {
  name: string;
  token: string;
}

export class AuthError extends Error {}
export class ConflictError extends Error {}

export function loadAuth(): CloudAuth | null {
  try {
    const v = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as CloudAuth | null;
    return v && typeof v.name === 'string' && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}

async function call(method: string, path: string, body?: unknown, token?: string, keepalive = false): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(CLOUD_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      // keepalive：页面跳转（每局都会重新加载）时请求也能发完
      keepalive,
      signal: keepalive ? undefined : AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error('连不上服务器');
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const msg = typeof j.error === 'string' ? j.error : `服务器错误 ${res.status}`;
  if (res.status === 401) throw new AuthError(msg);
  if (res.status === 409) throw new ConflictError(msg);
  if (!res.ok) throw new Error(msg);
  return j;
}

/** 注册或登录，成功后在本机记住 token */
export async function signIn(name: string, password: string, register: boolean): Promise<CloudAuth> {
  const j = await call('POST', register ? '/api/register' : '/api/login', { name, password });
  const auth = { name: String(j.name ?? name), token: String(j.token) };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth;
}

export async function signOut(auth: CloudAuth): Promise<void> {
  await call('POST', '/api/logout', {}, auth.token).catch(() => undefined);
  clearAuth();
}

export interface Remote {
  /** 服务器上的跨局存档；还没有（新号）或者是旧版本的（游戏更新后要重置）时为 null */
  save: SaveData | null;
  /** 服务器上存档的版本号，上传时带上，防止两台电脑互相覆盖 */
  rev: number;
  /** 打到一半的检查点（原样的 JSON 串） */
  run: string | null;
}

/** 启动时拉取全部进度 */
export async function pull(auth: CloudAuth): Promise<Remote> {
  const [s, r] = await Promise.all([call('GET', '/api/save', undefined, auth.token), call('GET', '/api/run', undefined, auth.token)]);
  let save: SaveData | null = null;
  if (s.save && s.epoch === SAVE_EPOCH) {
    try {
      save = parseSave(s.save);
    } catch {
      save = null;
    }
  }
  return { save, rev: Number(s.rev ?? 0), run: typeof r.run === 'string' ? r.run : null };
}

export async function pushSave(auth: CloudAuth, save: SaveData, rev: number, keepalive = false): Promise<number> {
  const j = await call('PUT', '/api/save', { save, epoch: SAVE_EPOCH, rev }, auth.token, keepalive);
  return Number(j.rev);
}

export async function pushRun(auth: CloudAuth, run: string | null, keepalive = false): Promise<void> {
  await call('PUT', '/api/run', { run }, auth.token, keepalive);
}

async function remoteRev(auth: CloudAuth): Promise<number> {
  const j = await call('GET', '/api/save', undefined, auth.token);
  return Number(j.rev ?? 0);
}

/**
 * 游戏用的存储：内存里一份，写入时马上（合并 0.6 秒内的连续写）传到服务器。
 * 只认跨局存档和检查点两个键，其他键只在内存里（例如存档纪元）。
 */
export class CloudStore implements Storage {
  private readonly data = new Map<string, string>();
  private rev = 0;
  private timer = 0;
  private dirtySave = false;
  /** undefined = 检查点没变；null = 要删掉；字符串 = 要上传 */
  private dirtyRun: string | null | undefined = undefined;
  private chain: Promise<void> = Promise.resolve();
  /** 上传失败（连不上 / 登录过期）时回调 */
  onError: ((e: Error) => void) | null = null;
  /** 正在上传 / 有没传完的改动 */
  busy = false;

  constructor(private readonly auth: CloudAuth) {}

  hydrate(r: Remote): void {
    this.rev = r.rev;
    this.data.set(EPOCH_KEY, String(SAVE_EPOCH));
    if (r.save) this.data.set(SAVE_KEY, JSON.stringify(r.save));
    if (r.run) this.data.set(RUN_KEY, r.run);
  }

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
    if (key === SAVE_KEY) this.dirtySave = true;
    else if (key === RUN_KEY) this.dirtyRun = value;
    else return;
    this.schedule();
  }

  remove(key: string): void {
    this.data.delete(key);
    if (key !== RUN_KEY) return;
    this.dirtyRun = null;
    this.schedule();
  }

  private schedule(): void {
    this.busy = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 600);
  }

  /** 马上把没传完的改动传上去。keepalive：页面马上要跳转（每局开始 / 结束都会重新加载） */
  flush(keepalive = false): Promise<void> {
    window.clearTimeout(this.timer);
    const save = this.dirtySave ? this.data.get(SAVE_KEY) : undefined;
    const run = this.dirtyRun;
    this.dirtySave = false;
    this.dirtyRun = undefined;
    if (save === undefined && run === undefined) return this.chain;
    this.chain = this.chain.then(async () => {
      try {
        if (save !== undefined) {
          const parsed = JSON.parse(save) as SaveData;
          try {
            this.rev = await pushSave(this.auth, parsed, this.rev, keepalive);
          } catch (e) {
            // 别的地方（另一台电脑）在这之后写过：以这台为准，取最新版本号再写一次
            if (!(e instanceof ConflictError)) throw e;
            this.rev = await pushSave(this.auth, parsed, await remoteRev(this.auth), keepalive);
          }
        }
        if (run !== undefined) await pushRun(this.auth, run, keepalive);
      } catch (e) {
        // 没传上去：标回脏，等下一次写入或重试时再传
        if (save !== undefined) this.dirtySave = true;
        if (run !== undefined && this.dirtyRun === undefined) this.dirtyRun = run;
        this.onError?.(e as Error);
      } finally {
        this.busy = this.dirtySave || this.dirtyRun !== undefined;
      }
    });
    return this.chain;
  }
}
