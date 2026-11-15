// 消耗品包导入：把 LRTactical「Stims & Stuffs」资源包（TACZ 那一家的格式：基岩版几何 + 关键帧动画）转成开放世界能直接用的东西。
//
// 用法：
//   node scripts/tools/stims-import.mjs                 按下面的清单全部导入，生成 public/stims/manifest.json
//   node scripts/tools/stims-import.mjs --check         只检查、只打印，不写文件
//   node scripts/tools/stims-import.mjs --pack <目录>   资源包解开的位置（默认 .vendor/stims/x）
//   node scripts/tools/stims-import.mjs --out <目录>    输出位置（默认 public/stims）
//
// 每样东西输出到 public/stims/<包里的 id>/：
//   view.json  第一人称用：骨骼 + 方块（原样保留）、要播的动画片段、片段里「该出声」的时刻（只留时刻和我们自己分的类）
//   tex.png    贴图
//   world.glb  掉在地上的样子：所有方块烘成一个网格、贴图嵌在里面，真实大小（米），原点在底面中心，长边顺着 X
// 再加一份 public/stims/manifest.json：{ items: { <包里的 id>: { world, size, clips } }, hands: { fists: … } }
//
// 授权：这个包写的是 All Rights Reserved，只能本机用——public/stims/ 不进 git、不进发行包，包里的文件不要拷到别的地方。
// 包里的 .ogg 一个都不导入（有些文件名带着别的商业游戏的音频命名），声音由游戏自己合成。
// 坐标、插值规则和枪一样在运行时（src/render/tacz/）处理；world.glb 的烘焙照着 src/render/tacz/model.ts 的规则做。
import fs from 'node:fs';
import path from 'node:path';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    } else a._.push(argv[i]);
  }
  return a;
}

/** 这一家的 json 允许注释和结尾逗号 */
function parseJsonc(text) {
  const s = text.replace(/^﻿/, '');
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && s[i + 1] === '*') {
      i = s.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
const readJson = (p) => parseJsonc(fs.readFileSync(p, 'utf8'));
const round = (x) => Math.round(x * 1e5) / 1e5;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- 清单

/**
 * 包里的 id、在包里的哪一类、对应游戏里的哪个物品、真实的东西最长的一边有多长（米）、第一人称要播哪些片段。
 * 包里的模型是按「拿在方块人手里好看」做的，比真东西大，所以地上的模型按真实尺寸重新定大小。
 */
const ITEMS = [
  { pack: 'adrenaline_stim', cat: 'consumable', item: 'stim', length: 0.14, clips: ['draw', 'use', 'put_away'] },
  { pack: 'cigars', cat: 'consumable', item: 'cigarettes', length: 0.095, clips: ['draw', 'use', 'put_away'] },
  { pack: 'golden_star', cat: 'consumable', item: 'balm', length: 0.05, clips: ['draw', 'use', 'put_away'] },
  { pack: 'big_cheese', cat: 'consumable', item: 'cheese', length: 0.22, clips: ['draw', 'use', 'put_away'] },
  { pack: 'hopium', cat: 'consumable', item: 'injector', length: 0.17, clips: ['draw', 'use', 'put_away'] },
  { pack: 'rgd_5', cat: 'throwable', item: 'grenade', length: 0.117, clips: ['draw', 'unlock_safe', 'throw', 'put_away'] },
];
/** 只有手的动作（空手的拳头）：没有地上的模型 */
const HANDS = [{ pack: 'fists', cat: 'melee', clips: ['draw', 'front_swing_1', 'front_swing_2', 'left_swing_1', 'right_swing_1', 'put_away'] }];

const HAND_POS = new Set(['lefthand_pos', 'righthand_pos']);

// ---------------------------------------------------------------- 动画（和 tacz-import.mjs 同一套输出格式）

/**
 * 片段里的音效关键帧只留「什么时候」和我们自己分的一类（运行时按类合成声音）；包里的音频文件和它的名字都不带走。
 * cloth 衣服 / 手的摩擦 · click 咔哒 · hiss 嘶 · breath 吸气 / 呼气 · squish 挤药膏 · bite 咬 · inject 扎针 · pin 保险销 · throw 扔
 */
function soundKind(effect) {
  const n = String(effect).replace(/^.*[:/]/, '');
  if (/throw/.test(n)) return 'throw';
  if (/pin/.test(n)) return 'pin';
  if (/lighter_fire|charge/.test(n)) return 'hiss';
  if (/drag|exhale/.test(n)) return 'breath';
  if (/squish/.test(n)) return 'squish';
  if (/eat/.test(n)) return 'bite';
  if (/stim_use|healed|poke/.test(n)) return 'inject';
  if (/open|close|screw|select|button|pullout/.test(n)) return 'click';
  return 'cloth';
}

function makeAnimConverter(stats) {
  const num = (v) => {
    if (typeof v === 'number') return v;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    stats.molang++;
    return 0;
  };
  const vec3 = (v) => (Array.isArray(v) ? [num(v[0] ?? 0), num(v[1] ?? 0), num(v[2] ?? 0)] : [num(v), num(v), num(v)]);

  /** 统一成 { t: [时间], pre: [x,y,z,...], post: [x,y,z,...], c: [是否 catmullrom] }（src/render/tacz/types.ts 的 Channel） */
  function channel(src) {
    if (src === undefined || src === null) return null;
    if (typeof src === 'string' && !Number.isFinite(Number(src))) {
      stats.molang++;
      return null;
    }
    let entries;
    if (typeof src === 'number' || typeof src === 'string' || Array.isArray(src)) entries = [[0, src]];
    else {
      entries = [];
      for (const [k, v] of Object.entries(src)) {
        const t = Number(k);
        if (!Number.isFinite(t)) {
          stats.molang++;
          return null;
        }
        entries.push([t, v]);
      }
      entries.sort((a, b) => a[0] - b[0]);
    }
    const out = { t: [], pre: [], post: [], c: [] };
    for (const [t, v] of entries) {
      let pre;
      let post;
      let cat = 0;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        pre = v.pre ?? v.post;
        post = v.post ?? v.pre;
        if (pre === undefined) continue;
        cat = v.lerp_mode === 'catmullrom' ? 1 : 0;
      } else pre = post = v;
      out.t.push(round(t));
      out.pre.push(...vec3(pre).map(round));
      out.post.push(...vec3(post).map(round));
      out.c.push(cat);
    }
    return out.t.length ? out : null;
  }

  return function convertAnim(a) {
    const bones = {};
    let end = 0;
    for (const [bone, chs] of Object.entries(a.bones ?? {})) {
      const b = {};
      for (const key of ['position', 'rotation', 'scale']) {
        const c = channel(chs[key]);
        if (!c) continue;
        b[key] = c;
        end = Math.max(end, c.t[c.t.length - 1]);
      }
      if (Object.keys(b).length) bones[bone] = b;
    }
    const marks = [];
    for (const [k, v] of Object.entries(a.sound_effects ?? {})) {
      const list = Array.isArray(v) ? v : [v];
      for (const e of list) if (e?.effect) marks.push([round(Number(k)), soundKind(e.effect)]);
    }
    marks.sort((x, y) => x[0] - y[0]);
    return { clip: { bones }, end, marks };
  };
}

function convertBones(list) {
  return list.map((b) => {
    const o = { name: b.name, pivot: b.pivot ?? [0, 0, 0] };
    if (b.parent) o.parent = b.parent;
    if (b.rotation) o.rotation = b.rotation;
    if (b.mirror) o.mirror = true;
    if (b.cubes?.length) {
      o.cubes = b.cubes.map((c) => {
        const q = { origin: c.origin, size: c.size, uv: c.uv };
        if (c.rotation) q.rotation = c.rotation;
        if (c.pivot) q.pivot = c.pivot;
        if (c.inflate) q.inflate = c.inflate;
        if (c.mirror) q.mirror = true;
        return q;
      });
    }
    return o;
  });
}

// ---------------------------------------------------------------- 地上的模型：方块烘成一个网格

const NORMAL = { down: [0, -1, 0], up: [0, 1, 0], west: [-1, 0, 0], north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1] };
/** Java 空间里的东 / 西、上 / 下取的是基岩版里对面的贴图（和 model.ts 的 FACE_OF 一样） */
const FACE_OF = { east: 'west', west: 'east', up: 'down', down: 'up', north: 'north', south: 'south' };

/** 一个方块的 6 个面（顶点在 Java 空间、像素单位）：照搬 src/render/tacz/model.ts 的 cubeQuads */
function cubeQuads(c, x0, y0, z0, W, H) {
  const d = c.inflate ?? 0;
  let x = x0 - d;
  const y = y0 - d;
  const z = z0 - d;
  let X = x0 + c.size[0] + d;
  const Y = y0 + c.size[1] + d;
  const Z = z0 + c.size[2] + d;
  const box = Array.isArray(c.uv);
  const mirror = box && !!c.mirror;
  if (mirror) [x, X] = [X, x];
  const v1 = [x, y, z];
  const v2 = [X, y, z];
  const v3 = [X, Y, z];
  const v4 = [x, Y, z];
  const v5 = [x, y, Z];
  const v6 = [X, y, Z];
  const v7 = [X, Y, Z];
  const v8 = [x, Y, Z];
  const verts = { down: [v6, v5, v1, v2], up: [v3, v4, v8, v7], west: [v1, v5, v8, v4], north: [v2, v1, v4, v3], east: [v6, v2, v3, v7], south: [v5, v6, v7, v8] };
  const rect = {};
  if (box) {
    const [ox, oy] = c.uv;
    const dx = Math.trunc(c.size[0]);
    const dy = Math.trunc(c.size[1]);
    const dz = Math.trunc(c.size[2]);
    const p1 = ox + dz;
    const p2 = ox + dz + dx;
    const p3 = ox + dz + dx + dx;
    const p4 = ox + dz + dx + dz;
    const p5 = ox + dz + dx + dz + dx;
    const p6 = oy + dz;
    const p7 = oy + dz + dy;
    rect.down = [p1, oy, p2, p6];
    rect.up = [p2, p6, p3, oy];
    rect.west = [ox, p6, p1, p7];
    rect.north = [p1, p6, p2, p7];
    rect.east = [p2, p6, p4, p7];
    rect.south = [p4, p6, p5, p7];
  } else {
    for (const dir of Object.keys(verts)) {
      const f = c.uv[FACE_OF[dir]];
      if (f) rect[dir] = [f.uv[0], f.uv[1], f.uv[0] + f.uv_size[0], f.uv[1] + f.uv_size[1]];
    }
  }
  const out = [];
  for (const dir of Object.keys(verts)) {
    const r = rect[dir];
    if (!r) continue;
    const [u1, vv1, u2, vv2] = r;
    let vs = verts[dir];
    // glTF 的贴图 v 轴朝下（原点在左上角），所以直接用像素比例，不用 1 - v
    let uvs = [
      [u2 / W, vv1 / H],
      [u1 / W, vv1 / H],
      [u1 / W, vv2 / H],
      [u2 / W, vv2 / H],
    ];
    let n = NORMAL[dir];
    if (mirror) {
      vs = [...vs].reverse();
      uvs = [...uvs].reverse();
      n = [-n[0], n[1], n[2]];
    }
    out.push({ v: vs, uv: uvs, n });
  }
  return out;
}

/**
 * 静止姿势（不带动画）下把所有方块烘成一个网格。hidden = 平时看不见的骨骼（拿在手上待机时缩放是 0 的：打火机的火、烟、特效面片），
 * 连同它下面的一起不要；手臂的占位方块也不要。返回的顶点还在模型空间（1 = 一格 = 16 像素）
 */
function bakeMesh(geo, hidden) {
  const W = geo.description.texture_width;
  const H = geo.description.texture_height;
  const byName = new Map();
  for (const b of geo.bones ?? []) byName.set(b.name, b);
  const world = new Map();
  const flip = new Matrix4().makeRotationZ(Math.PI);
  const worldOf = (b) => {
    const hit = world.get(b.name);
    if (hit) return hit;
    const parent = b.parent ? byName.get(b.parent) : undefined;
    const p = b.pivot ?? [0, 0, 0];
    const pos = parent ? new Vector3(p[0] - parent.pivot[0], parent.pivot[1] - p[1], p[2] - parent.pivot[2]) : new Vector3(p[0], 24 - p[1], p[2]);
    pos.multiplyScalar(1 / 16);
    const r = b.rotation ?? [0, 0, 0];
    const local = new Matrix4().compose(pos, new Quaternion().setFromEuler(new Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'ZYX')), new Vector3(1, 1, 1));
    const m = (parent ? worldOf(parent).clone() : flip.clone()).multiply(local);
    world.set(b.name, m);
    return m;
  };
  const isHidden = (b) => {
    for (let q = b; q; q = q.parent ? byName.get(q.parent) : undefined) if (hidden.has(q.name) || q.name.endsWith('_illuminated')) return true;
    return false;
  };
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const m = new Matrix4();
  const v = new Vector3();
  const nv = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const pts = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  let cubes = 0;
  for (const b of geo.bones ?? []) {
    if (!b.cubes?.length || HAND_POS.has(b.name) || isHidden(b)) continue;
    const bw = worldOf(b);
    for (const c of b.cubes) {
      let x;
      let y;
      let z;
      if (c.rotation) {
        const cp = c.pivot ?? b.pivot;
        x = c.origin[0] - cp[0];
        y = cp[1] - c.origin[1] - c.size[1];
        z = c.origin[2] - cp[2];
        const e = new Euler(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, 'ZYX');
        m.compose(new Vector3((cp[0] - b.pivot[0]) / 16, (b.pivot[1] - cp[1]) / 16, (cp[2] - b.pivot[2]) / 16), new Quaternion().setFromEuler(e), new Vector3(1, 1, 1));
      } else {
        x = c.origin[0] - b.pivot[0];
        y = b.pivot[1] - c.origin[1] - c.size[1];
        z = c.origin[2] - b.pivot[2];
        m.identity();
      }
      m.premultiply(bw);
      cubes++;
      for (const q of cubeQuads(c, x, y, z, W, H)) {
        for (let i = 0; i < 4; i++) pts[i].set(q.v[i][0] / 16, q.v[i][1] / 16, q.v[i][2] / 16).applyMatrix4(m);
        // 压扁成一条线的面（厚度是 0 的方块的侧面）不要
        e1.subVectors(pts[1], pts[0]);
        e2.subVectors(pts[2], pts[0]);
        const geoN = v.crossVectors(e1, e2);
        e1.subVectors(pts[2], pts[0]);
        e2.subVectors(pts[3], pts[0]);
        const area = geoN.length() + e1.cross(e2).length();
        if (area < 1e-9) continue;
        nv.set(q.n[0], q.n[1], q.n[2]).transformDirection(m);
        const base = pos.length / 3;
        for (let i = 0; i < 4; i++) {
          pos.push(pts[i].x, pts[i].y, pts[i].z);
          nor.push(nv.x, nv.y, nv.z);
          uv.push(q.uv[i][0], q.uv[i][1]);
        }
        // 三角形的绕向要和法线一致（材质是双面的：绕向反了的话背面那一侧的光照会算反）
        if (geoN.dot(nv) >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  return { pos, nor, uv, idx, cubes };
}

/**
 * 摆成「躺在地上」：最长的一边顺着 X，最薄的一边朝上，缩放到真实大小，原点挪到底面中心。
 * 只做旋转不做镜像（贴图上的字不会反）
 */
function layFlat(mesh, length) {
  const { pos, nor } = mesh;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], pos[i + k]);
    hi[k] = Math.max(hi[k], pos[i + k]);
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
  const [ax, az, ay] = order;
  // 新的 (X, Y, Z) = 旧的 (ax, ay, ±az)；行列式要是 +1
  const parity = (ax === 0 && ay === 1 && az === 2) || (ax === 1 && ay === 2 && az === 0) || (ax === 2 && ay === 0 && az === 1) ? 1 : -1;
  const k = length / ext[ax];
  const cx = (lo[ax] + hi[ax]) / 2;
  const cz = (lo[az] + hi[az]) / 2;
  for (let i = 0; i < pos.length; i += 3) {
    const p = [pos[i], pos[i + 1], pos[i + 2]];
    const n = [nor[i], nor[i + 1], nor[i + 2]];
    pos[i] = (p[ax] - cx) * k;
    pos[i + 1] = (p[ay] - lo[ay]) * k;
    pos[i + 2] = (p[az] - cz) * k * parity;
    nor[i] = n[ax];
    nor[i + 1] = n[ay];
    nor[i + 2] = n[az] * parity;
  }
  return [round(ext[ax] * k), round(ext[ay] * k), round(ext[az] * k)];
}

/** 写一个 glb：一个网格、一个材质（贴图嵌在里面，最近邻采样，透明的像素镂空，双面） */
function writeGlb(file, mesh, png, name) {
  const vcount = mesh.pos.length / 3;
  const big = vcount > 65535;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], mesh.pos[i + k]);
    hi[k] = Math.max(hi[k], mesh.pos[i + k]);
  }
  const parts = [
    Buffer.from(new Float32Array(mesh.pos).buffer),
    Buffer.from(new Float32Array(mesh.nor).buffer),
    Buffer.from(new Float32Array(mesh.uv).buffer),
    Buffer.from(big ? new Uint32Array(mesh.idx).buffer : new Uint16Array(mesh.idx).buffer),
    png,
  ];
  const views = [];
  const chunks = [];
  let off = 0;
  for (const p of parts) {
    const pad = (4 - (p.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: p.length });
    chunks.push(p);
    if (pad) chunks.push(Buffer.alloc(pad));
    off += p.length + pad;
  }
  views[0].target = views[1].target = views[2].target = 34962;
  views[3].target = 34963;
  const gltf = {
    asset: { version: '2.0', generator: 'zombie-hold stims-import' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.1, roughnessFactor: 0.7 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vcount, type: 'VEC3', min: lo.map(round), max: hi.map(round) },
      { bufferView: 1, componentType: 5126, count: vcount, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: vcount, type: 'VEC2' },
      { bufferView: 3, componentType: big ? 5125 : 5123, count: mesh.idx.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: off }],
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, json, bh, bin]));
}

// ---------------------------------------------------------------- 一样东西

function importOne({ def, packDir, ns, outRoot, write, world }) {
  const errors = [];
  const warnings = [];
  const A = path.join(packDir, 'assets', ns);
  const geoFile = path.join(A, 'geo_models', def.cat, `${def.pack}_geo.json`);
  const animFile = path.join(A, 'animations', def.cat, `${def.pack}.animation.json`);
  const displayFile = path.join(A, 'display', def.cat, `${def.pack}.json`);
  for (const f of [geoFile, animFile]) if (!fs.existsSync(f)) return { errors: [`找不到 ${path.relative(process.cwd(), f)}`], warnings };
  const geo = readJson(geoFile)['minecraft:geometry'][0];
  const anims = readJson(animFile).animations ?? {};
  // 贴图：display 里写的那张；没有 display 就按命名找
  let texFile = '';
  if (fs.existsSync(displayFile)) {
    const t = String(readJson(displayFile).texture ?? '');
    const i = t.indexOf(':');
    if (t) texFile = path.join(packDir, 'assets', i < 0 ? ns : t.slice(0, i), 'textures', `${t.slice(i + 1)}.png`);
  }
  if (!texFile || !fs.existsSync(texFile)) {
    const guess = [`${def.pack}_uv.png`, `${def.pack}.png`].map((n) => path.join(A, 'textures', def.cat, n)).find((f) => fs.existsSync(f));
    // 只有手的那一组（拳头）：模型里只有两条手臂的占位方块，本来就不画，没有贴图也行
    if (guess) texFile = guess;
    else if (world) errors.push('找不到贴图');
    else texFile = '';
  }

  const boneNames = new Set((geo.bones ?? []).map((b) => b.name));
  if (!boneNames.has('idle_view')) errors.push('模型缺定位节点 idle_view，没法摆到镜头前');
  for (const n of HAND_POS) if (!boneNames.has(n)) warnings.push(`模型缺 ${n}，这只手不会画`);
  const poly = (geo.bones ?? []).filter((b) => b.poly_mesh).length;
  if (poly) warnings.push(`${poly} 根骨骼是 poly_mesh，不支持，已跳过`);

  const stats = { molang: 0 };
  const convertAnim = makeAnimConverter(stats);
  const outAnims = {};
  const marks = {};
  const lengths = {};
  for (const n of ['static_idle', ...def.clips]) {
    const a = anims[n];
    if (!a) {
      if (n !== 'static_idle') errors.push(`没有 ${n} 片段`);
      continue;
    }
    const r = convertAnim(a);
    outAnims[n] = r.clip;
    if (r.marks.length) marks[n] = r.marks;
    if (n !== 'static_idle') lengths[n] = round(r.end);
  }
  if (stats.molang) warnings.push(`跳过 ${stats.molang} 处 Molang 表达式（按 0 处理）`);

  const bones = convertBones(geo.bones ?? []);
  const cubes = bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0);
  let size = null;
  let mesh = null;
  if (world) {
    // 拿在手上待机时缩放是 0 的骨骼：地上的模型里也不要
    const hidden = new Set();
    for (const [bone, b] of Object.entries(outAnims.static_idle?.bones ?? {})) {
      const s = b.scale;
      if (s && Math.abs(s.post[0]) < 1e-3 && Math.abs(s.post[1]) < 1e-3 && Math.abs(s.post[2]) < 1e-3) hidden.add(bone);
    }
    mesh = bakeMesh(geo, hidden);
    if (!mesh.idx.length) errors.push('地上的模型是空的');
    else size = layFlat(mesh, def.length);
  }
  const clipText = Object.entries(lengths).map(([k, v]) => `${k} ${v.toFixed(2)}s`).join(' · ');
  const summary = `${bones.length} 骨骼 / ${cubes} 方块 / ${clipText}${mesh ? ` / 地上 ${mesh.idx.length / 3} 三角形，${size.map((v) => (v * 100).toFixed(1)).join(' × ')} 厘米` : ''}`;
  if (!write || errors.length) return { errors, warnings, summary };

  const dir = path.join(outRoot, def.pack);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const view = { id: def.pack, texture: { w: geo.description.texture_width, h: geo.description.texture_height }, bones, anims: outAnims, marks, fov: 70 };
  fs.writeFileSync(path.join(dir, 'view.json'), JSON.stringify(view));
  if (texFile) fs.copyFileSync(texFile, path.join(dir, 'tex.png'));
  const entry = { view: `${def.pack}/view.json`, tex: texFile ? `${def.pack}/tex.png` : null, clips: lengths };
  if (mesh && size) {
    writeGlb(path.join(dir, 'world.glb'), mesh, fs.readFileSync(texFile), def.pack);
    entry.world = `${def.pack}/world.glb`;
    entry.size = size;
    entry.item = def.item;
  }
  const files = fs.readdirSync(dir).map((f) => `${f} ${(fs.statSync(path.join(dir, f)).size / 1024).toFixed(1)} KB`);
  return { errors, warnings, summary, entry, files };
}

// ---------------------------------------------------------------- 主流程

const args = parseArgs(process.argv);
const packDir = path.resolve(args.pack ?? '.vendor/stims/x');
const outRoot = path.resolve(args.out ?? 'public/stims');
const write = args.check !== 'true';
if (!fs.existsSync(packDir)) {
  console.error(`资源包目录不存在：${packDir}`);
  process.exit(1);
}
const metaFile = path.join(packDir, 'gunpack.meta.json');
const ns = fs.existsSync(metaFile) ? (readJson(metaFile).namespace ?? 'stimshot') : 'stimshot';
const infoFile = path.join(packDir, 'assets', ns, 'gunpack_info.json');
const info = fs.existsSync(infoFile) ? readJson(infoFile) : {};
console.log(`资源包 ${ns}（${(info.authors ?? []).join('、') || '作者不明'}；授权：${info.license ?? '没写'}）→ ${path.relative(process.cwd(), outRoot)}${write ? '' : '（只检查）'}`);

const manifest = { items: {}, hands: {} };
let failed = 0;
for (const [list, world, into] of [
  [ITEMS, true, manifest.items],
  [HANDS, false, manifest.hands],
]) {
  for (const def of list) {
    let r;
    try {
      r = importOne({ def, packDir, ns, outRoot, write, world });
    } catch (e) {
      r = { errors: [`读取失败：${e.message}`], warnings: [] };
    }
    const ok = r.errors.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? (r.warnings.length ? '△' : '✓') : '✗'} ${def.pack.padEnd(16)}${def.item ? ` → ${def.item.padEnd(10)}` : ''}  (${r.summary ?? ''})`);
    for (const e of r.errors) console.log(`    错误：${e}`);
    for (const x of r.warnings) console.log(`    提示：${x}`);
    if (r.files) console.log(`    ${r.files.join(' · ')}`);
    if (r.entry) into[def.pack] = r.entry;
  }
}

if (write) {
  fs.mkdirSync(outRoot, { recursive: true });
  // 清掉不在清单里的旧目录
  const keep = new Set([...Object.keys(manifest.items), ...Object.keys(manifest.hands)]);
  for (const d of fs.readdirSync(outRoot, { withFileTypes: true })) if (d.isDirectory() && !keep.has(d.name)) fs.rmSync(path.join(outRoot, d.name), { recursive: true, force: true });
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(outRoot, 'NOTICE.md'),
    [
      '# 消耗品的模型和动作',
      '',
      `这个目录是 \`node scripts/tools/stims-import.mjs\` 从 LRTactical「Stims & Stuffs」资源包（命名空间 ${ns}，作者 ${(info.authors ?? []).join('、') || '不明'}）转出来的：`,
      '模型、贴图、第一人称的动作片段。包的授权写的是 All Rights Reserved，所以这个目录不进 git、不进发行包，只在本机用。',
      '包里的音频一个都没有导入，游戏里的声音是自己合成的。',
      '',
    ].join('\n'),
  );
  console.log(`\n→ ${path.relative(process.cwd(), path.join(outRoot, 'manifest.json'))}：${Object.keys(manifest.items).length} 样东西，${Object.keys(manifest.hands).length} 组手的动作`);
}
if (failed) {
  console.log(`${failed} 样没通过检查`);
  process.exitCode = 1;
}
