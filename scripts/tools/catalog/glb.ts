// 极简 glb 写出器：只为平台自带的测试样例服务（盒子 / 圆柱拼的模型 + 节点动画 + 一张程序生成的法线贴图）。
// 不依赖浏览器（three 的 GLTFExporter 要 FileReader），Node 里直接跑。
import { deflateSync } from 'node:zlib';

export interface Geo {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

export const geo = (): Geo => ({ pos: [], nor: [], uv: [], idx: [] });

/** 盒子：(cx, cz) 是水平中心，y0 是底面 */
export function box(g: Geo, w: number, h: number, d: number, cx: number, y0: number, cz: number): Geo {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y1 = y0 + h;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  // 每个面 4 个顶点：[法线, 4 个角（逆时针，从外面看）]
  const faces: Array<[[number, number, number], number[][]]> = [
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
  ];
  for (const [n, corners] of faces) {
    const b = g.pos.length / 3;
    corners.forEach((c, i) => {
      g.pos.push(...c);
      g.nor.push(...n);
      g.uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 0 : 1);
    });
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return g;
}

/** 竖直圆柱（侧面 + 上下盖），底面在 y0 */
export function cyl(g: Geo, r: number, h: number, seg: number, cx: number, y0: number, cz: number): Geo {
  const b = g.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    for (const y of [y0, y0 + h]) {
      g.pos.push(cx + nx * r, y, cz + nz * r);
      g.nor.push(nx, 0, nz);
      g.uv.push(i / seg, y === y0 ? 1 : 0);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = b + i * 2;
    g.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  for (const [y, ny] of [
    [y0 + h, 1],
    [y0, -1],
  ] as const) {
    const c = g.pos.length / 3;
    g.pos.push(cx, y, cz);
    g.nor.push(0, ny, 0);
    g.uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      g.pos.push(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
      g.nor.push(0, ny, 0);
      g.uv.push(0.5 + Math.sin(a) * 0.5, 0.5 - Math.cos(a) * 0.5);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) g.idx.push(c, c + 1 + i, c + 2 + i);
      else g.idx.push(c, c + 2 + i, c + 1 + i);
    }
  }
  return g;
}

export interface MatDef {
  name: string;
  color: [number, number, number];
  roughness?: number;
  metalness?: number;
  emissive?: [number, number, number];
  normalImage?: number;
  alpha?: number;
}

export interface NodeDef {
  name: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
}

type Json = Record<string, unknown>;

export class Glb {
  private bin: Buffer[] = [];
  private len = 0;
  private readonly j = {
    asset: { version: '2.0', generator: 'zombie-hold konbini sample writer' },
    scene: 0,
    scenes: [{ nodes: [] as number[] }],
    nodes: [] as Json[],
    meshes: [] as Json[],
    materials: [] as Json[],
    accessors: [] as Json[],
    bufferViews: [] as Json[],
    buffers: [] as Json[],
    animations: [] as Json[],
    images: [] as Json[],
    textures: [] as Json[],
    samplers: [] as Json[],
  };

  private view(data: Buffer, target?: number): number {
    const pad = (4 - (this.len % 4)) % 4;
    if (pad) {
      this.bin.push(Buffer.alloc(pad));
      this.len += pad;
    }
    const v: Json = { buffer: 0, byteOffset: this.len, byteLength: data.length };
    if (target) v.target = target;
    this.bin.push(data);
    this.len += data.length;
    this.j.bufferViews.push(v);
    return this.j.bufferViews.length - 1;
  }

  private accessor(arr: Float32Array | Uint32Array, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4', target?: number, minmax = false): number {
    const comp = arr instanceof Float32Array ? 5126 : 5125;
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const a: Json = { bufferView: this.view(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), target), componentType: comp, count: arr.length / n, type };
    if (minmax) {
      const min = new Array(n).fill(Infinity);
      const max = new Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        const k = i % n;
        min[k] = Math.min(min[k], arr[i] as number);
        max[k] = Math.max(max[k], arr[i] as number);
      }
      a.min = min;
      a.max = max;
    }
    this.j.accessors.push(a);
    return this.j.accessors.length - 1;
  }

  material(m: MatDef): number {
    const pbr: Json = { baseColorFactor: [...m.color, m.alpha ?? 1], roughnessFactor: m.roughness ?? 0.6, metallicFactor: m.metalness ?? 0 };
    const out: Json = { name: m.name, pbrMetallicRoughness: pbr };
    if (m.emissive) out.emissiveFactor = m.emissive;
    if (m.normalImage !== undefined) out.normalTexture = { index: this.texture(m.normalImage) };
    if (m.alpha !== undefined && m.alpha < 1) out.alphaMode = 'BLEND';
    this.j.materials.push(out);
    return this.j.materials.length - 1;
  }

  png(data: Buffer): number {
    this.j.images.push({ bufferView: this.view(data), mimeType: 'image/png' });
    return this.j.images.length - 1;
  }

  private texture(image: number): number {
    if (!this.j.samplers.length) this.j.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    this.j.textures.push({ sampler: 0, source: image });
    return this.j.textures.length - 1;
  }

  mesh(name: string, prims: Array<[Geo, number]>): number {
    const primitives = prims.map(([g, mat]) => ({
      attributes: {
        POSITION: this.accessor(new Float32Array(g.pos), 'VEC3', 34962, true),
        NORMAL: this.accessor(new Float32Array(g.nor), 'VEC3', 34962),
        TEXCOORD_0: this.accessor(new Float32Array(g.uv), 'VEC2', 34962),
      },
      indices: this.accessor(new Uint32Array(g.idx), 'SCALAR', 34963),
      material: mat,
    }));
    this.j.meshes.push({ name, primitives });
    return this.j.meshes.length - 1;
  }

  node(n: NodeDef, root = false): number {
    const out: Json = { name: n.name };
    if (n.mesh !== undefined) out.mesh = n.mesh;
    if (n.translation) out.translation = n.translation;
    if (n.rotation) out.rotation = n.rotation;
    if (n.scale) out.scale = n.scale;
    if (n.children?.length) out.children = n.children;
    this.j.nodes.push(out);
    const i = this.j.nodes.length - 1;
    if (root) this.j.scenes[0]?.nodes.push(i);
    return i;
  }

  animation(name: string, channels: Array<{ node: number; path: 'translation' | 'rotation' | 'scale'; times: number[]; values: number[] }>): void {
    const samplers: Json[] = [];
    const chans: Json[] = [];
    for (const c of channels) {
      const input = this.accessor(new Float32Array(c.times), 'SCALAR', undefined, true);
      const output = this.accessor(new Float32Array(c.values), c.path === 'rotation' ? 'VEC4' : 'VEC3');
      samplers.push({ input, output, interpolation: 'LINEAR' });
      chans.push({ sampler: samplers.length - 1, target: { node: c.node, path: c.path } });
    }
    this.j.animations.push({ name, samplers, channels: chans });
  }

  toBuffer(): Buffer {
    const pad = (4 - (this.len % 4)) % 4;
    if (pad) {
      this.bin.push(Buffer.alloc(pad));
      this.len += pad;
    }
    this.j.buffers = [{ byteLength: this.len }];
    const j: Json = { ...this.j };
    for (const k of ['animations', 'images', 'textures', 'samplers'] as const) if (!(this.j[k] as unknown[]).length) delete j[k];
    let json = Buffer.from(JSON.stringify(j), 'utf8');
    const jp = (4 - (json.length % 4)) % 4;
    if (jp) json = Buffer.concat([json, Buffer.alloc(jp, 0x20)]);
    const bin = Buffer.concat(this.bin);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x46546c67, 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
    const ch = (type: number, data: Buffer): Buffer => {
      const h = Buffer.alloc(8);
      h.writeUInt32LE(data.length, 0);
      h.writeUInt32LE(type, 4);
      return Buffer.concat([h, data]);
    };
    return Buffer.concat([head, ch(0x4e4f534a, json), ch(0x004e4942, bin)]);
  }
}

/** 绕 Y 轴的四元数 */
export const qy = (a: number): [number, number, number, number] => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

// ---------------------------------------------------------------- PNG（法线贴图）
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** 从高度场算切线空间法线贴图（OpenGL 约定：绿色向上，和 glTF 一致） */
export function normalFromHeight(w: number, h: number, height: (x: number, y: number) => number, strength = 2): Buffer {
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (height((x + 1) % w, y) - height((x - 1 + w) % w, y)) * strength;
      const dy = (height(x, (y + 1) % h) - height(x, (y - 1 + h) % h)) * strength;
      // 图片的 y 向下，切线空间的 v 向上：dy 取反
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 3;
      px[i] = Math.round((nx * 0.5 + 0.5) * 255);
      px[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      px[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return encodePng(w, h, px);
}
