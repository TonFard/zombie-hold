import { Group, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WeaponKind } from '../../game/data/weapons';
import type { Action, GunInfo, PartName } from './kit-ext';

/**
 * Blender 建的枪模（npm run guns:build → public/guns/<kind>.glb + manifest.json）。
 * 一个 GLB 里是所有等级的零件：节点名 `<部件>__<最低级>_<最高级>`，部件是 body 或可动零件
 * （slide / mag / pump / bolt / drum / belt，节点原点 = 支点）。按等级挑出该显示的节点拼成一把枪。
 * 坐标系和程序枪模一样（原点在后握把，枪口 +Z，上 +Y），握点 / 枪口 / 瞄准点在 manifest 里。
 * 异步加载；没加载好、加载失败、manifest 里没有这把枪时，buildWeapon 继续用程序枪模。?guns=0 强制关闭。
 */
type V3 = [number, number, number];
interface TierInfo {
  gripR: V3;
  gripL: V3;
  muzzle: V3;
  eject: V3;
  sight: V3;
  eyeRelief: number;
  slideTravel: number;
  action: Action;
}
interface Manifest {
  guns: Partial<Record<WeaponKind, { file: string; tiers: TierInfo[] }>>;
}
interface Loaded {
  nodes: Array<{ part: 'body' | PartName; lo: number; hi: number; obj: Object3D }>;
  tiers: TierInfo[];
}

const BASE = `${import.meta.env.BASE_URL}guns/`;
const loaded = new Map<WeaponKind, Loaded>();
let started: Promise<void> | null = null;

export function loadGunModels(): Promise<void> {
  if (started) return started;
  if (new URLSearchParams(window.location.search).get('guns') === '0') return (started = Promise.resolve());
  started = (async () => {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const m = (await res.json()) as Manifest;
    const loader = new GLTFLoader();
    await Promise.all(
      (Object.entries(m.guns) as Array<[WeaponKind, { file: string; tiers: TierInfo[] }]>).map(async ([kind, g]) => {
        try {
          const gltf = await loader.loadAsync(`${BASE}${g.file}`);
          const nodes: Loaded['nodes'] = [];
          for (const obj of gltf.scene.children) {
            const hit = /^([a-z]+)__(\d+)_(\d+)/.exec(obj.name);
            if (hit) nodes.push({ part: hit[1] as 'body' | PartName, lo: Number(hit[2]), hi: Number(hit[3]), obj });
          }
          // 几何体是所有实例共用的：换枪时不能释放（viewmodel 按这个标记跳过）
          gltf.scene.traverse((o) => {
            o.userData.shared = true;
          });
          if (nodes.length) loaded.set(kind, { nodes, tiers: g.tiers });
        } catch (e) {
          console.warn(`枪模 ${kind} 加载失败，继续用程序模型：`, e);
        }
      }),
    );
  })().catch((e: unknown) => console.warn('枪模清单加载失败，继续用程序模型：', e));
  return started;
}

export const hasGunModel = (kind: WeaponKind): boolean => loaded.has(kind);

const v3 = (a: V3): Vector3 => new Vector3(a[0], a[1], a[2]);

export function glbWeapon(kind: WeaponKind, tier: number): { group: Group; parts: Partial<Record<PartName, Group>>; info: GunInfo } | null {
  const g = loaded.get(kind);
  const t = g?.tiers[tier];
  if (!g || !t) return null;
  const group = new Group();
  const parts: Partial<Record<PartName, Group>> = {};
  for (const n of g.nodes) {
    if (tier < n.lo || tier > n.hi) continue;
    // 几何体和材质共用，只克隆节点
    const o = n.obj.clone();
    if (n.part === 'body') {
      group.add(o);
      continue;
    }
    let p = parts[n.part];
    if (!p) {
      p = parts[n.part] = new Group();
      p.position.copy(n.obj.position);
      group.add(p);
    }
    o.position.set(0, 0, 0);
    p.add(o);
  }
  return {
    group,
    parts,
    info: { gripR: v3(t.gripR), gripL: v3(t.gripL), muzzle: v3(t.muzzle), eject: v3(t.eject), sight: v3(t.sight), eyeRelief: t.eyeRelief, slideTravel: t.slideTravel, action: t.action },
  };
}

if (typeof window !== 'undefined') void loadGunModels();
