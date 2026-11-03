/** scripts/tools/tacz-import.mjs 输出的 gun.json 结构 */

export type V3 = [number, number, number];

/** 一条关键帧通道：每帧 pre / post 各 3 个数，c = 这一帧是不是 catmullrom 插值 */
export interface Channel {
  t: number[];
  pre: number[];
  post: number[];
  c: number[];
}

export interface BoneAnim {
  position?: Channel;
  rotation?: Channel;
  scale?: Channel;
}

export interface Clip {
  bones: Record<string, BoneAnim>;
  len?: number;
  loop?: boolean | string;
  /** [时间, 音效路径（相对 sfx/，不带扩展名）] */
  sfx?: Array<[number, string]>;
}

export interface FaceUv {
  uv: [number, number];
  uv_size: [number, number];
}

export type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export interface Cube {
  origin: V3;
  size: V3;
  /** 数组 = 整块贴图（box UV）；对象 = 每个面单独指定 */
  uv: [number, number] | Partial<Record<FaceName, FaceUv>>;
  rotation?: V3;
  pivot?: V3;
  inflate?: number;
  mirror?: boolean;
}

export interface Bone {
  name: string;
  pivot: V3;
  parent?: string;
  rotation?: V3;
  mirror?: boolean;
  cubes?: Cube[];
}

export interface GunJson {
  id: string;
  texture: { w: number; h: number };
  bones: Bone[];
  anims: Record<string, Clip>;
  display: {
    modelFov: number;
    zoomModelFov: number;
    ironZoom: number;
    sounds: Record<string, string>;
  };
  data: {
    rpm: number;
    ammo: number;
    drawTime: number;
    putAwayTime: number;
    bolt: string;
    reload: {
      type: string;
      feed?: { empty: number; tactical: number };
      cooldown?: { empty: number; tactical: number };
    } | null;
  };
}
