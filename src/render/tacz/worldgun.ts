import { Box3, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, TextureLoader, Vector3, type BufferGeometry, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { compileClip, Pose, Track } from './anim';
import { TaczModel } from './model';
import type { AttJson, GunJson } from './types';

/**
 * 第三人称的枪（士兵手里拿的、死后掉在地上的）：和第一人称用的是同一份 TACZ 模型，
 * 但不要骨骼和动画——摆成持枪姿势（static_idle）以后把所有方块并成一个几何体，一把枪一次绘制。
 *
 * 坐标：右手握把在原点，+Z 是枪口方向，+Y 朝上，单位米。左手扶的位置、枪口、枪托尾端都换算到这个坐标里，
 * 士兵模型按它们摆手（见 actors/soldiers.ts）。
 */
export interface WorldGun {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** 左手扶的位置（护木 / 弹匣井 / 另一只手握着的地方） */
  fore: Vector3;
  muzzle: Vector3;
  /** 枪托尾端、枪口的 z（握把在 0） */
  back: number;
  front: number;
}

/**
 * TACZ 模型（1 = 一格）到世界（米）的缩放。TACZ 的枪是按"拿在方块人手里好看"做的，差不多是真枪的三倍大：
 * 格洛克 17 在模型里从握把到枪口 0.61 格（真枪 0.20 米），沙漠之鹰 0.82 格（0.27 米），量下来都是 0.33 左右
 */
export const WORLD_GUN_SCALE = 0.34;

const cache = new Map<string, WorldGun | null>();
const loading = new Set<string>();

/** 拿一把枪的世界模型：没加载好返回 null（同时开始加载），加载失败以后一直是 null */
export function worldGun(id: string): WorldGun | null {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  if (!loading.has(id)) {
    loading.add(id);
    load(id)
      .then((g) => cache.set(id, g))
      .catch((e: unknown) => {
        console.warn(`世界枪模 ${id} 加载失败：`, e);
        cache.set(id, null);
      });
  }
  return null;
}

/** 已经加载好的枪模（调试 / 测量用） */
export const worldGunCache = cache;

/** 刀按真实大小画：M9 刺刀全长约 30 厘米（模型里 0.97 格） */
export const KNIFE_SCALE = 0.31;
let knife: WorldGun | null | undefined;

/**
 * 刀的世界模型（对战里士兵手里拿的、玩家第一人称拿的）：和 WorldGun 一样的格式——握把中间在原点，+Z 是刀尖方向，
 * +Y 是刀背，单位米；muzzle = 刀尖，fore 不用。没加载好返回 null（同时开始加载），加载失败以后一直是 null
 */
export function worldKnife(): WorldGun | null {
  if (knife !== undefined) return knife;
  knife = null;
  loadKnife()
    .then((k) => (knife = k))
    .catch((e: unknown) => console.warn('刀的模型加载失败（npm run melee:import 生成）：', e));
  return null;
}

async function loadKnife(): Promise<WorldGun> {
  const base = `${import.meta.env.BASE_URL}tacz/_att/bayonet_m9/`;
  const res = await fetch(`${base}att.json`);
  if (!res.ok) throw new Error(`${base}att.json: HTTP ${res.status}`);
  const json = (await res.json()) as AttJson;
  const tex = await new TextureLoader().loadAsync(`${base}att.png`);
  const model = new TaczModel(json, tex, 'attachment');
  const m = new Matrix4();
  for (const [, n] of model.nodes) {
    model.localMatrix(n, null, m);
    for (const o of n.objs) o.matrix.copy(m);
  }
  model.root.matrixAutoUpdate = false;
  model.root.matrix.makeRotationZ(Math.PI);
  model.root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  const grip = new Box3();
  const blade = new Box3();
  const walk = (o: Object3D, bone: string): void => {
    const mesh = o as Mesh;
    const name = mesh.isMesh ? bone : o.name || bone;
    if (mesh.isMesh) {
      const g = mesh.geometry.clone();
      g.deleteAttribute('color');
      g.applyMatrix4(mesh.matrixWorld);
      g.computeBoundingBox();
      if (bone === 'grip') grip.union(g.boundingBox as Box3);
      else if (bone === 'blade') blade.union(g.boundingBox as Box3);
      parts.push(g);
    }
    for (const c of o.children) walk(c, name);
  };
  walk(model.root, '');
  if (!parts.length || grip.isEmpty() || blade.isEmpty()) throw new Error('刀的模型里没找到 grip / blade');
  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  model.root.traverse((o) => (o as Mesh).geometry?.dispose());
  // 握把中间挪到原点；刀尖朝 +Z（模型里刀尖在 −Z 那头）
  const gc = grip.getCenter(new Vector3());
  const tipZ = blade.getCenter(new Vector3()).z < gc.z ? blade.min.z : blade.max.z;
  const to = new Matrix4().makeScale(KNIFE_SCALE, KNIFE_SCALE, KNIFE_SCALE);
  if (tipZ < gc.z) to.multiply(new Matrix4().makeRotationY(Math.PI));
  to.multiply(new Matrix4().makeTranslation(-gc.x, -gc.y, -gc.z));
  geometry.applyMatrix4(to);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const out = geometry.boundingBox as Box3;
  const material = new MeshStandardMaterial({ map: model.material.map, roughness: 0.45, metalness: 0.55, alphaTest: 0.5, side: DoubleSide });
  const tip = new Vector3(0, 0, out.max.z);
  return { geometry, material, fore: tip.clone(), muzzle: tip, back: out.min.z, front: out.max.z };
}

async function load(id: string): Promise<WorldGun> {
  const base = `${import.meta.env.BASE_URL}tacz/${id}/`;
  const res = await fetch(`${base}gun.json`);
  if (!res.ok) throw new Error(`${base}gun.json: HTTP ${res.status}`);
  const json = (await res.json()) as GunJson;
  const tex = await new TextureLoader().loadAsync(`${base}gun.png`);
  return bake(json, new TaczModel(json, tex));
}

function bake(json: GunJson, model: TaczModel): WorldGun {
  // 持枪姿势：枪身的骨骼基本不动，双手（方块手臂）摆到握把和护木上
  const pose = new Pose(json.bones.map((b) => b.name));
  const idle = json.roles.staticIdle ? json.anims[json.roles.staticIdle] : undefined;
  if (idle) {
    const track = new Track(false);
    track.play(compileClip('static_idle', idle), 'hold');
    track.advance(0, null);
    track.apply(pose);
  }
  const m = new Matrix4();
  for (const [name, n] of model.nodes) {
    model.localMatrix(n, pose.v.get(name) ?? null, m);
    for (const o of n.objs) o.matrix.copy(m);
  }
  // Java 模型空间 y 朝下：绕 Z 转 180° 翻回来（和视角模型一样）
  model.root.matrixAutoUpdate = false;
  model.root.matrix.makeRotationZ(Math.PI);
  model.root.updateMatrixWorld(true);

  const parts: BufferGeometry[] = [];
  const hands: Array<Vector3 | null> = [null, null];
  const walk = (o: Object3D): void => {
    if (!o.visible) return;
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      const hand = o.parent?.name === 'righthand_pos' ? 0 : o.parent?.name === 'lefthand_pos' ? 1 : -1;
      if (hand >= 0) {
        // 方块手臂不画，只取手掌那头的位置（方块 y 最小的一端往里 2 像素）
        const g = mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox as Box3;
        hands[hand] = new Vector3((b.min.x + b.max.x) / 2, b.min.y + 2 / 16, (b.min.z + b.max.z) / 2).applyMatrix4(mesh.matrixWorld);
      } else if ((mesh.material as { visible?: boolean }).visible !== false) {
        const g = mesh.geometry.clone();
        g.deleteAttribute('color');
        g.applyMatrix4(mesh.matrixWorld);
        parts.push(g);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(model.root);
  if (!parts.length) throw new Error(`${json.id}: 模型是空的`);
  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  model.root.traverse((o) => (o as Mesh).geometry?.dispose());

  geometry.computeBoundingBox();
  const box = (geometry.boundingBox as Box3).clone();
  const muzzleNode = model.nodes.get('muzzle_flash')?.objs[0] ?? model.nodes.get('muzzle_pos')?.objs[0];
  const muzzle = muzzleNode ? muzzleNode.getWorldPosition(new Vector3()) : new Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
  // 没找到手（个别枪没有持枪姿势）：握把按枪身后三分之一、偏下估
  const mid = (box.min.z + box.max.z) / 2;
  const fwd = muzzle.z < mid ? -1 : 1;
  const len = box.max.z - box.min.z;
  const grip = hands[0] ?? new Vector3((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * 0.3, mid - fwd * len * 0.15);
  const fore = hands[1] ?? grip.clone().add(new Vector3(0, 0.05, fwd * len * 0.3));

  // 换到「握把在原点、+Z 朝枪口、米」
  const to = new Matrix4().makeScale(WORLD_GUN_SCALE, WORLD_GUN_SCALE, WORLD_GUN_SCALE);
  if (fwd < 0) to.multiply(new Matrix4().makeRotationY(Math.PI));
  to.multiply(new Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z));
  geometry.applyMatrix4(to);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const out = geometry.boundingBox as Box3;
  const material = new MeshStandardMaterial({ map: model.material.map, roughness: 0.62, metalness: 0.15, alphaTest: 0.5, side: DoubleSide });
  return { geometry, material, fore: fore.applyMatrix4(to), muzzle: muzzle.applyMatrix4(to), back: out.min.z, front: out.max.z };
}
