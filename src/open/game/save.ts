/**
 * 存档：整个开放世界的进度存在浏览器的 localStorage 里，一个种子一份。
 * 世界本身不用存（都是按种子算出来的），只存：人在哪、几点了、身上和车上有什么、哪些东西被捡走了、车在哪。
 * LAYOUT：地点 / 房子的生成方式一变（位置都不一样了），旧存档里的坐标和「捡走了哪些」就对不上了——改生成的时候把它加一。
 */
const LAYOUT = 4;
const key = (seed: number): string => `zh.open.save.${LAYOUT}.${seed}`;

export interface SaveData {
  /** 存的时候的时间戳 */
  t: number;
  player: { x: number; z: number; yaw: number; pitch: number };
  clock: { day: number; hours: number };
  survival: unknown;
  bag: unknown;
  trunk: unknown;
  pickups: unknown;
  arsenal: unknown;
  garage: unknown;
  /** 丧尸：哪些地方清过了（旧存档里没有） */
  horde?: unknown;
  /** 带枪的人：哪几伙打掉了；守城：哪些据点守住过、是第几天 */
  raiders?: unknown;
  siege?: unknown;
  weather: string;
  found: number[];
  kills: number;
  xp: number;
  level: number;
  goal: number;
  flags: string[];
  markers: Array<{ x: number; z: number; label: string; color: string }>;
}

export function readSave(seed: number): SaveData | null {
  try {
    const raw = window.localStorage.getItem(key(seed));
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (!d || typeof d !== 'object' || !d.player || !Number.isFinite(d.player.x) || !Number.isFinite(d.player.z)) return null;
    return d;
  } catch {
    return null;
  }
}

export function writeSave(seed: number, data: SaveData): boolean {
  try {
    window.localStorage.setItem(key(seed), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(seed: number): void {
  try {
    window.localStorage.removeItem(key(seed));
  } catch {
    // 存不了就算了
  }
}
