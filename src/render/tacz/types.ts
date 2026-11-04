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

/** 动作 → 片段名（导入时按命名规则挑好；数组下标 = 扩容弹匣等级 0–3） */
export interface Roles {
  draw: string | null;
  shoot: string | null;
  shootLast: string | null;
  reloadTactical: Array<string | null>;
  reloadEmpty: Array<string | null>;
  inspect: Array<string | null>;
  inspectEmpty: Array<string | null>;
  staticIdle: string | null;
  boltCaught: string | null;
  /** 快慢机位置（static_auto / static_semi），保持在最后一帧 */
  fireMode: string | null;
  /** 栓动 / 泵动：每发之后的拉栓 */
  bolt: string | null;
  /** 逐发装填（管状弹仓）：intro → loop × 缺几发 → end */
  tube: { intro: string; introEmpty: string; loop: string; end: string } | null;
}

/** public/tacz/manifest.json */
export interface TaczManifest {
  enabled: boolean;
  weapons: Record<string, { dir: string; warnings: string[]; errors: string[] }>;
}

export interface GunJson {
  id: string;
  texture: { w: number; h: number };
  bones: Bone[];
  anims: Record<string, Clip>;
  roles: Roles;
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
