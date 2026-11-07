import {
  Box3,
  type BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ATOM_MANIFEST, type AtomDescriptor } from '../../game/world/assets-manifest';

/**
 * 原子资产加载器：把 assets/programs 生成的小 GLB 装进场景。
 *
 * 三条规矩：
 *
 * 1. 一个原子一个文件。运行时用 InstancedMesh 复用，但资产的粒度永远是一个零件：
 *    桌子是「桌面 + 四条腿 + 抽屉」，不是一个合并的大 mesh。书是「封面 + 书页 + 书脊」。
 * 2. 资产原点在底面中心（Y = 0），所以直接放在桌面/货架上不会陷进去。
 * 3. 加载按需：房间模块进场时才把它的原子拉进来，离开就释放。
 *
 * 一个坑：sand3d 导出 GLB 时把「毫米 → 米」的 0.001 缩放放在**节点变换**上，
 * 几何体顶点仍是毫米。取几何体而不带上节点变换，桌子就会变成 1200 米宽。
 * 所以这里把节点变换烘进几何体。
 */

const BASE = `${import.meta.env.BASE_URL}models/`;

export interface AtomInstance {
  /** 原子 id */
  id: string;
  /** 在世界里的位置（资产原点所在点） */
  position: Vector3;
  /** 绕 Y 轴的朝向，弧度 */
  yaw: number;
  /** 额外缩放 */
  scale?: number;
}

/** 一个原子里的一个网格（通常只有一个材质，一个部件）。 */
interface AtomPart {
  geometry: BufferGeometry;
  material: Material | Material[];
}

interface LoadedAtom {
  descriptor: AtomDescriptor;
  parts: AtomPart[];
  size: Vector3;
}

const cache = new Map<string, LoadedAtom>();
const pending = new Map<string, Promise<LoadedAtom | null>>();
let loader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader();
  return loader;
}

export function findAtom(id: string): AtomDescriptor | undefined {
  return ATOM_MANIFEST.find((a) => a.id === id);
}

/** 按房间模块取原子：所有 room 字段匹配的。 */
export function atomsOfRoom(room: string): AtomDescriptor[] {
  return ATOM_MANIFEST.filter((a) => a.room === room);
}

/** 按对象取原子：一个「桌子」的桌面、腿、抽屉…… */
export function atomsOfObject(object: string): AtomDescriptor[] {
  return ATOM_MANIFEST.filter((a) => a.object === object);
}

async function loadOne(descriptor: AtomDescriptor): Promise<LoadedAtom | null> {
  const cached = cache.get(descriptor.id);
  if (cached) return cached;
  const inflight = pending.get(descriptor.id);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const rel = descriptor.file.replace(/^assets\/models\//, '');
      const gltf = await getLoader().loadAsync(BASE + rel);
      const root = gltf.scene;
      root.updateMatrixWorld(true);

      const rootInverse = new Matrix4().copy(root.matrixWorld).invert();

      // 把节点变换烘进几何体：sand3d 的毫米→米缩放就在节点上。
      const parts: AtomPart[] = [];
      const worldBox = new Box3();
      root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const local = new Matrix4().multiplyMatrices(rootInverse, m.matrixWorld);
        const geo = m.geometry.clone();
        geo.applyMatrix4(local);
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        worldBox.union(geo.boundingBox as Box3);
        parts.push({ geometry: geo, material: m.material });
      });
      if (!parts.length) return null;

      const size = worldBox.getSize(new Vector3());
      const center = worldBox.getCenter(new Vector3());

      // 归一化：长边沿 X，底面在 Y = 0，水平居中。
      // 和现有 props 管线的约定一致，也让「原子放在桌面上」这件事成立。
      const swap = size.z > size.x;
      const turn = swap ? new Matrix4().makeRotationY(Math.PI / 2) : new Matrix4();
      const offset = turn.multiply(new Matrix4().makeTranslation(-center.x, -worldBox.min.y, -center.z));
      for (const part of parts) {
        part.geometry.applyMatrix4(offset);
        part.geometry.computeVertexNormals();
        part.geometry.computeBoundingBox();
      }

      const entry: LoadedAtom = { descriptor, parts, size };
      cache.set(descriptor.id, entry);
      return entry;
    } catch (err) {
      console.warn('atom failed to load', descriptor.id, err);
      return null;
    } finally {
      pending.delete(descriptor.id);
    }
  })();

  pending.set(descriptor.id, promise);
  return promise;
}

/**
 * 把一批原子实例装进一个 Group。
 * 相同 id 的实例合并成一个 InstancedMesh，所以一千本书还是一个 draw call。
 */
export async function buildAtoms(instances: AtomInstance[], parent: Group): Promise<Group> {
  const group = new Group();
  group.name = 'atoms';
  parent.add(group);

  const byId = new Map<string, AtomInstance[]>();
  for (const inst of instances) {
    const list = byId.get(inst.id);
    if (list) list.push(inst);
    else byId.set(inst.id, [inst]);
  }

  await Promise.all(
    [...byId.entries()].map(async ([id, list]) => {
      const descriptor = findAtom(id);
      if (!descriptor) {
        console.warn('unknown atom', id);
        return;
      }
      const atom = await loadOne(descriptor);
      if (!atom) return;

      const m = new Matrix4();
      const q = new Quaternion();
      const s = new Vector3();
      const up = new Vector3(0, 1, 0);

      for (const part of atom.parts) {
        const mesh = new InstancedMesh(part.geometry, part.material, list.length);
        mesh.name = id;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        list.forEach((inst, i) => {
          q.setFromAxisAngle(up, inst.yaw);
          s.setScalar(inst.scale ?? 1);
          m.compose(inst.position, q, s);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }),
  );

  return group;
}

/** 释放不再需要的原子（房间离开时调用）。 */
export function releaseAtoms(): void {
  for (const atom of cache.values()) {
    for (const part of atom.parts) part.geometry.dispose();
  }
  cache.clear();
}

/** 渲染器统计用：当前缓存了多少原子。 */
export function atomCacheSize(): number {
  return cache.size;
}

/** 一个原子的实际尺寸（米），用来核对 manifest 里写的 size_m。 */
export function atomSize(id: string): Vector3 | undefined {
  return cache.get(id)?.size;
}
