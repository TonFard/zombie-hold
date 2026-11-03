import { LatheGeometry, Vector2 } from 'three';
import { HALF_H, HALF_W } from '../../../game/world/grid';
import type { Prop } from '../../../game/world/types';
import type { Style } from '../../kit';

/** 道具建模共用的小工具 */

export interface Rect {
  cx: number;
  cz: number;
  /** 长边 / 短边（世界单位） */
  L: number;
  T: number;
  horiz: boolean;
}

export function rectOf(p: Prop): Rect {
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  return {
    cx: (p.x0 + p.x1) / 2 - HALF_W,
    cz: (p.y0 + p.y1) / 2 - HALF_H,
    L: Math.max(w, d),
    T: Math.min(w, d),
    horiz: w >= d,
  };
}

export const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, ...o });
export const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', ...o });
export const glow = (color: number, k = 1.5): Style => ({ color, mat: 'glow', glow: k });

/** 绕 Y 轴旋转的车削体，profile 是 [半径, 高度] */
export function latheY(profile: Array<[number, number]>, seg: number): LatheGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
}
