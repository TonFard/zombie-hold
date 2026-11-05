import { SAVE_EPOCH, parseSave, type SaveData } from '../game/save/schema';

/**
 * 云存档：注册 / 登录后把跨局存档（勋章、解锁、统计、设置）传到服务器，换台电脑登录就能拉下来。
 * 服务端在 server/index.mjs。只同步跨局存档，不同步打到一半的检查点。
 */
export const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined) ?? 'http://47.94.82.70:8092';
const AUTH_KEY = 'dawn-cloud-auth';

export interface CloudAuth {
  name: string;
  token: string;
}

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

async function call(method: string, path: string, body?: unknown, token?: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(CLOUD_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('连不上存档服务器');
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : `服务器错误 ${res.status}`);
  return j;
}

/** 注册或登录，成功后记住登录状态 */
export async function signIn(name: string, password: string, register: boolean): Promise<CloudAuth> {
  const j = await call('POST', register ? '/api/register' : '/api/login', { name, password });
  const auth = { name: String(j.name ?? name), token: String(j.token) };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth;
}

export async function upload(auth: CloudAuth, save: SaveData): Promise<number> {
  const j = await call('PUT', '/api/save', { save, epoch: SAVE_EPOCH }, auth.token);
  return Number(j.updatedAt);
}

/**
 * 拉云端存档；云端还没有存档、或者是旧版本的存档（游戏更新后进度要重置）时返回 null。
 * 云端的存档按本地同样的规则校验
 */
export async function download(auth: CloudAuth): Promise<{ save: SaveData; updatedAt: number } | null> {
  const j = await call('GET', '/api/save', undefined, auth.token);
  if (!j.save || j.epoch !== SAVE_EPOCH) return null;
  return { save: parseSave(j.save), updatedAt: Number(j.updatedAt) };
}
