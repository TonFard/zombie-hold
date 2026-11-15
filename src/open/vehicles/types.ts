/**
 * public/vehicles/<id>/vehicle.json 的结构（scripts/tools/vehicles-import.py 生成）。
 * 模型空间：米，+Y 上，车头朝 -Z，+X 是车的右边；原点在地面、两轴中间附近。
 */

export type LampKind = 'head' | 'park' | 'tail' | 'reverse';

export interface GeomEntry {
  role: 'near' | 'inner' | 'far' | 'wheel' | 'wheelFar';
  bone: string;
  atlas: string;
  mat: { cls: 'base' | 'paint' | 'paint2'; glass: boolean; lamp: LampKind | null; opacity?: number };
  count: number;
  index: number;
  big: boolean;
  pos: number;
  nrm: number;
  uv: number;
  idx: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface VehiclePhys {
  mass: number;
  ix: number;
  iy: number;
  iz: number;
  comY: number;
  comZ: number;
  frontZ: number;
  rearZ: number;
  halfTrack: number;
  radius: number;
  bump: number;
  droop: number;
  springFront: number;
  springRear: number;
  dampFront: number;
  dampRear: number;
  maxSteer: number;
  antiRollFront?: number;
  antiRollRear?: number;
  topSpeed: number;
  torqueRpm: number[];
  torqueNm: number[];
  idleRpm: number;
  cutRpm: number;
  gears: number[];
  reverseGear: number;
  finalDrive: number;
  efficiency?: number;
  rolling: number;
  drag: number;
  downforce?: number;
  downforceFront?: number;
  brakeForce?: number;
  brakeFront?: number;
  tyreGrip?: number;
  steerGrip?: number;
  slideGrip?: number;
  slipPeak?: number;
  allWheel?: boolean;
  maxLean?: number;
  shiftTime?: number;
  /** 车包里原车的油箱（升）。游戏里不用它：油箱和油耗看 VehicleDef.fuel（不给就用 vehicle.ts 里的默认值） */
  tank?: number;
}

/** 油箱和油耗。都可以不给：默认 45 升、全功率每秒 0.1 升（约 3 升 / 公里）、怠速每秒 0.004 升 */
export interface VehicleFuel {
  /** 油箱容量（升） */
  tank?: number;
  /** 发动机全功率时每秒烧多少升 */
  full?: number;
  /** 怠速每秒烧多少升 */
  idle?: number;
}

export interface Seat {
  forward: number;
  right: number;
  cushion?: number;
  scale?: number;
  eyeLift?: number;
  eyeForward?: number;
}

export interface VehicleDef {
  id: string;
  name: string;
  kind: 'car' | 'bike';
  phys: VehiclePhys;
  fuel?: VehicleFuel;
  layout: {
    seats: Seat[];
    cabCushion: number;
    steer: { x: number; y: number; z: number; ay: number; az: number; ratio: number };
    exitF: number;
    exitR: number;
    lampLow: [number, number, number] | null;
    lampTail: [number, number, number] | null;
    hingeX: number | null;
    hingeY: number | null;
    hingeZ: number | null;
    doorAxis: [number, number, number] | null;
    doorAngle: number | null;
    barGrip: [number, number, number] | null;
    engineRear: boolean;
  };
  bones: Record<string, [number, number, number]>;
  wheels: Array<{ x: number; z: number; steer: boolean; drive: boolean; geo: string; side: number }>;
  geoms: GeomEntry[];
  near: number[];
  inner: number[];
  far: number[];
  wheel: number[];
  wheelFar: number[];
  atlases: Record<string, { base: string; normal?: string; orm?: string; emissive?: boolean }>;
  paint: { main: string; second: string };
  hull: { min: [number, number, number]; max: [number, number, number] };
  sounds: {
    on: Array<[number, string]>;
    off: Array<[number, string]>;
    crank: string | null;
    start: string | null;
    stop: string | null;
    horn: string | null;
  };
}

export interface VehicleIndex {
  vehicles: Array<{ id: string; name: string; kind: 'car' | 'bike' }>;
  common: string[];
}
