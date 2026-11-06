// 写实资源导入：按 props.config.json 下载模型、地面 / 墙面贴图、HDRI，整理到 public/props/。
//
// 用法：
//   npm run props:import               下载（有缓存就跳过）+ 减面 + 压贴图 + 生成 public/props/manifest.json
//   npm run props:import -- --only car_sedan1
//   npm run props:import -- --textures 只重新导入贴图和 HDRI（模型不动）
//   npm run props:import -- --refetch  忽略 .vendor 缓存重新下载
//
// 来源：
//   polyhaven（默认）CC0，直接下 glTF。
//   sketchfab        CC-BY，需要 .vendor/sketchfab.token（账号 API token，不进仓库），署名写进 public/props/CREDITS.md。
//
// 处理：配置里写了 "tris": N 就用 meshoptimizer 把三角形减到 N 左右（只换索引，顶点不动）；
// 贴图统一缩到 maxTexture 以内，没有透明的转成 jpg（用本机 python + Pillow）。
// 运行时（src/render/world/realProps.ts）读 manifest，enabled=false 时游戏照旧用程序模型，URL 加 ?props=1 预览。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MeshoptSimplifier } from '../../node_modules/three/examples/jsm/libs/meshopt_simplifier.module.js';

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

const args = parseArgs(process.argv);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'props.config.json'), 'utf8'));
const res = cfg.resolution ?? '1k';
const maxTex = cfg.maxTexture ?? 1024;
const cacheDir = path.join(root, '.vendor/polyhaven');
const sfCache = path.join(root, '.vendor/sketchfab');
const outDir = path.join(root, 'public/props');

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** 下载到缓存目录，已存在就跳过 */
async function download(url, file, headers = {}) {
  if (fs.existsSync(file) && !args.refetch) return;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// ---------------------------------------------------------------- 贴图缩放（python + Pillow）

const PY_RESIZE = `
import sys, json
from PIL import Image
jobs = json.loads(sys.stdin.read())
out = []
for src, dst_base, mx in jobs:
    im = Image.open(src)
    im.load()
    alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    if alpha:
        im = im.convert('RGBA')
        if im.getchannel('A').getextrema()[0] >= 250:
            alpha = False
    if not alpha:
        im = im.convert('RGB')
    w, h = im.size
    s = min(1.0, mx / max(w, h))
    if s < 1.0:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    dst = dst_base + ('.png' if alpha else '.jpg')
    if alpha:
        im.save(dst, optimize=True)
    else:
        im.save(dst, quality=86, optimize=True)
    out.append(dst)
print(json.dumps(out))
`;

/** 批量缩放贴图，返回实际输出的文件（扩展名可能变成 .jpg / .png） */
function resizeImages(jobs) {
  if (!jobs.length) return [];
  const r = spawnSync('python', ['-c', PY_RESIZE], { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`python 缩放贴图失败：${r.stderr || r.error}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// ---------------------------------------------------------------- glTF 读写

const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(gltf, bin, i) {
  const acc = gltf.accessors[i];
  const bv = gltf.bufferViews[acc.bufferView];
  const T = COMP[acc.componentType];
  const n = NCOMP[acc.type];
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? n * T.BYTES_PER_ELEMENT;
  const out = new T(acc.count * n);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let k = 0; k < acc.count; k++) {
    for (let c = 0; c < n; c++) {
      const p = off + k * stride + c * T.BYTES_PER_ELEMENT;
      out[k * n + c] = T === Float32Array ? view.getFloat32(p, true) : T === Uint32Array ? view.getUint32(p, true) : T === Uint16Array ? view.getUint16(p, true) : view.getUint8(p);
    }
  }
  return out;
}

/** 按比例减面，新索引追加到 bin 末尾 */
function simplify(gltf, bin, target, maxErr = 0.02) {
  const prims = gltf.meshes.flatMap((m) => m.primitives).filter((p) => p.indices != null && (p.mode ?? 4) === 4);
  const total = prims.reduce((a, p) => a + gltf.accessors[p.indices].count / 3, 0);
  if (total <= target) return { bin, before: total };
  const ratio = target / total;
  const chunks = [bin];
  let len = bin.byteLength;
  for (const p of prims) {
    const idx = readAccessor(gltf, bin, p.indices);
    const pos = readAccessor(gltf, bin, p.attributes.POSITION);
    const want = Math.max(36, Math.floor((idx.length * ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(new Uint32Array(idx), pos, 3, want, maxErr, maxErr > 0.02 ? [] : ['LockBorder']);
    if (out.length < 3) continue;
    const pad = (4 - (len % 4)) % 4;
    if (pad) chunks.push(new Uint8Array(pad));
    len += pad;
    const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    gltf.bufferViews.push({ buffer: 0, byteOffset: len, byteLength: bytes.byteLength, target: 34963 });
    gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5125, count: out.length, type: 'SCALAR' });
    p.indices = gltf.accessors.length - 1;
    chunks.push(bytes);
    len += bytes.byteLength;
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  gltf.buffers[0].byteLength = merged.byteLength;
  return { bin: merged, before: total };
}

/** 去掉没被引用的 bufferView 数据（减面后的旧索引、嵌入贴图），重新紧凑排列 */
function compact(gltf, bin) {
  const used = new Set();
  for (const a of gltf.accessors) {
    if (a.bufferView != null) used.add(a.bufferView);
    if (a.sparse) {
      used.add(a.sparse.indices.bufferView);
      used.add(a.sparse.values.bufferView);
    }
  }
  for (const im of gltf.images ?? []) if (im.bufferView != null) used.add(im.bufferView);
  // 仍被引用的数据里，旧索引 accessor 可能已没人用：只保留被图元 / 蒙皮 / 动画引用的 accessor
  const liveAcc = new Set();
  for (const m of gltf.meshes) {
    for (const p of m.primitives) {
      if (p.indices != null) liveAcc.add(p.indices);
      for (const v of Object.values(p.attributes)) liveAcc.add(v);
      for (const t of p.targets ?? []) for (const v of Object.values(t)) liveAcc.add(v);
    }
  }
  for (const s of gltf.skins ?? []) if (s.inverseBindMatrices != null) liveAcc.add(s.inverseBindMatrices);
  for (const an of gltf.animations ?? []) for (const s of an.samplers) liveAcc.add(s.input), liveAcc.add(s.output);
  const accMap = new Map();
  const accessors = [];
  gltf.accessors.forEach((a, i) => {
    if (!liveAcc.has(i)) return;
    accMap.set(i, accessors.length);
    accessors.push(a);
  });
  const remapAcc = (i) => accMap.get(i);
  for (const m of gltf.meshes) {
    for (const p of m.primitives) {
      if (p.indices != null) p.indices = remapAcc(p.indices);
      for (const k of Object.keys(p.attributes)) p.attributes[k] = remapAcc(p.attributes[k]);
      for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = remapAcc(t[k]);
    }
  }
  for (const s of gltf.skins ?? []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = remapAcc(s.inverseBindMatrices);
  for (const an of gltf.animations ?? []) for (const s of an.samplers) (s.input = remapAcc(s.input)), (s.output = remapAcc(s.output));
  gltf.accessors = accessors;

  const liveBv = new Set();
  for (const a of accessors) {
    if (a.bufferView != null) liveBv.add(a.bufferView);
    if (a.sparse) liveBv.add(a.sparse.indices.bufferView), liveBv.add(a.sparse.values.bufferView);
  }
  const bvMap = new Map();
  const views = [];
  const chunks = [];
  let len = 0;
  gltf.bufferViews.forEach((bv, i) => {
    if (!liveBv.has(i)) return;
    const pad = (4 - (len % 4)) % 4;
    if (pad) chunks.push(Buffer.alloc(pad)), (len += pad);
    const start = bv.byteOffset ?? 0;
    chunks.push(bin.subarray(start, start + bv.byteLength));
    bvMap.set(i, views.length);
    views.push({ ...bv, buffer: 0, byteOffset: len });
    len += bv.byteLength;
  });
  for (const a of accessors) {
    if (a.bufferView != null) a.bufferView = bvMap.get(a.bufferView);
    if (a.sparse) (a.sparse.indices.bufferView = bvMap.get(a.sparse.indices.bufferView)), (a.sparse.values.bufferView = bvMap.get(a.sparse.values.bufferView));
  }
  gltf.bufferViews = views;
  const out = Buffer.concat(chunks);
  gltf.buffers = [{ byteLength: out.byteLength }];
  return out;
}

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 glb');
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { gltf: json, bin };
}

function triCount(gltf) {
  return gltf.meshes.flatMap((m) => m.primitives).reduce((a, p) => a + (p.indices != null ? gltf.accessors[p.indices].count / 3 : 0), 0);
}

/**
 * 统一输出：<id>/<id>.gltf + <id>.bin + textures/。
 * images 来自 bufferView（glb 嵌入）或 uri（相对 srcDir）；全部缩放后写成外部文件。
 */
function writeModel(id, gltf, bin, srcDir, opt) {
  const dst = path.join(outDir, id);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.join(dst, 'textures'), { recursive: true });
  const tmp = path.join(dst, '.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const jobs = [];
  (gltf.images ?? []).forEach((im, i) => {
    let src;
    if (im.bufferView != null) {
      const bv = gltf.bufferViews[im.bufferView];
      src = path.join(tmp, `img${i}`);
      fs.writeFileSync(src, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    } else src = path.join(srcDir, decodeURIComponent(im.uri));
    jobs.push([src, path.join(dst, 'textures', `${id}_${i}`), maxTex]);
  });
  const outs = resizeImages(jobs);
  (gltf.images ?? []).forEach((im, i) => {
    const f = outs[i];
    im.uri = `textures/${path.basename(f)}`;
    im.mimeType = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
    delete im.bufferView;
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  let before = triCount(gltf);
  if (opt.tris) ({ bin, before } = simplify(gltf, bin, opt.tris, opt.error));
  bin = compact(gltf, bin);
  gltf.buffers[0].uri = `${id}.bin`;
  fs.writeFileSync(path.join(dst, `${id}.gltf`), JSON.stringify(gltf));
  fs.writeFileSync(path.join(dst, `${id}.bin`), bin);
  const tris = triCount(gltf);
  const size = fs.readdirSync(path.join(dst, 'textures')).reduce((a, f) => a + fs.statSync(path.join(dst, 'textures', f)).size, bin.byteLength);
  console.log(`  ${id.padEnd(26)} ${before !== tris ? `${before} → ${tris}` : tris} 三角形  ${(size / 1048576).toFixed(1)} MB`);
  return { file: `${id}/${id}.gltf`, tris };
}

// ---------------------------------------------------------------- 来源

async function polyhavenModel(id, opt) {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const entry = files.gltf?.[res]?.gltf;
  if (!entry) throw new Error(`没有 ${res} 的 glTF`);
  const dir = path.join(cacheDir, id);
  await download(entry.url, path.join(dir, `${id}.gltf`));
  // include 里每个文件都带自己的下载地址（贴图不在 gltf 同级目录下）
  for (const [rel, f] of Object.entries(entry.include ?? {})) await download(f.url, path.join(dir, rel));
  const gltf = JSON.parse(fs.readFileSync(path.join(dir, `${id}.gltf`), 'utf8'));
  if (gltf.buffers.length !== 1) throw new Error(`期望 1 个 buffer，实际 ${gltf.buffers.length}`);
  const bin = fs.readFileSync(path.join(dir, gltf.buffers[0].uri));
  const info = await getJson(`https://api.polyhaven.com/info/${id}`);
  const out = writeModel(id, gltf, bin, dir, opt);
  return { ...out, credit: { name: info.name, author: Object.keys(info.authors ?? {}).join(', '), license: 'CC0', url: `https://polyhaven.com/a/${id}` } };
}

function sketchfabToken() {
  const f = path.join(root, '.vendor/sketchfab.token');
  if (!fs.existsSync(f)) throw new Error('缺少 .vendor/sketchfab.token');
  return fs.readFileSync(f, 'utf8').trim();
}

async function sketchfabModel(id, opt) {
  const file = path.join(sfCache, `${opt.uid}.glb`);
  const metaFile = path.join(sfCache, `${opt.uid}.json`);
  if (!fs.existsSync(file) || args.refetch) {
    const auth = { Authorization: `Token ${sketchfabToken()}` };
    const dl = await getJson(`https://api.sketchfab.com/v3/models/${opt.uid}/download`, auth);
    if (!dl.glb?.url) throw new Error('没有 glb 下载');
    await download(dl.glb.url, file);
  }
  if (!fs.existsSync(metaFile) || args.refetch) {
    const m = await getJson(`https://api.sketchfab.com/v3/models/${opt.uid}`);
    fs.writeFileSync(metaFile, JSON.stringify({ name: m.name, author: m.user?.displayName || m.user?.username, license: m.license?.label, url: m.viewerUrl }));
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (!/^CC Attribution$|CC0|Public Domain/i.test(meta.license ?? '')) throw new Error(`许可是 ${meta.license}，不是 CC-BY / CC0`);
  const { gltf, bin } = parseGlb(fs.readFileSync(file));
  if ((gltf.extensionsUsed ?? []).some((e) => /draco|meshopt/i.test(e))) throw new Error(`用了压缩扩展 ${gltf.extensionsUsed}`);
  const out = writeModel(id, gltf, bin, sfCache, opt);
  return { ...out, credit: meta };
}

/** 地面 / 墙面平铺贴图：diff + nor_gl + arm（AO/粗糙/金属） */
async function polyhavenTexture(key, id) {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const dst = path.join(outDir, 'tex', key);
  fs.mkdirSync(dst, { recursive: true });
  for (const [map, name] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['arm', 'arm']]) {
    const f = files[map]?.[res]?.jpg;
    if (!f) throw new Error(`${id} 缺 ${map}`);
    const cached = path.join(cacheDir, 'tex', id, `${name}_${res}.jpg`);
    await download(f.url, cached);
    fs.copyFileSync(cached, path.join(dst, `${name}.jpg`));
  }
  console.log(`  贴图 ${key.padEnd(16)} ← ${id}`);
  return { dir: `tex/${key}/`, credit: { name: id, author: 'Poly Haven', license: 'CC0', url: `https://polyhaven.com/a/${id}` } };
}

// ---------------------------------------------------------------- 主流程

await MeshoptSimplifier.ready;
const ids = args.textures ? [] : args.only ? [args.only] : Object.keys(cfg.assets);
const manifestPath = path.join(outDir, 'manifest.json');
const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const manifest = { enabled: !!cfg.enabled, hdri: prev.hdri ?? null, hdriNight: prev.hdriNight ?? null, assets: args.only || args.textures ? prev.assets ?? {} : {}, textures: prev.textures ?? {} };
const credits = args.only || args.textures ? prev.credits ?? {} : {};
fs.mkdirSync(outDir, { recursive: true });
let failed = 0;
for (const id of ids) {
  const opt = cfg.assets[id] ?? {};
  try {
    const r = opt.source === 'sketchfab' ? await sketchfabModel(id, opt) : await polyhavenModel(id, opt);
    manifest.assets[id] = { file: r.file, tris: r.tris };
    credits[id] = r.credit;
  } catch (e) {
    failed++;
    console.error(`  ✗ ${id}: ${e.message}`);
  }
}
if (!args.only) {
  manifest.textures = {};
  for (const [key, id] of Object.entries(cfg.textures ?? {})) {
    try {
      const t = await polyhavenTexture(key, id);
      manifest.textures[key] = t.dir;
      credits[`tex:${key}`] = t.credit;
    } catch (e) {
      failed++;
      console.error(`  ✗ 贴图 ${key}: ${e.message}`);
    }
  }
  if (cfg.hdri) {
    const files = await getJson(`https://api.polyhaven.com/files/${cfg.hdri}`);
    const hdr = files.hdri?.[res]?.hdr;
    if (hdr) {
      const cached = path.join(cacheDir, 'hdri', `${cfg.hdri}_${res}.hdr`);
      await download(hdr.url, cached);
      fs.copyFileSync(cached, path.join(outDir, 'env.hdr'));
      manifest.hdri = 'env.hdr';
      credits.hdri = { name: cfg.hdri, author: 'Poly Haven', license: 'CC0', url: `https://polyhaven.com/a/${cfg.hdri}` };
      console.log(`  HDRI ${cfg.hdri} (${res})`);
    }
  }
  // 夜晚 HDRI（M19）：偏冷的夜空，夜里换成它做环境反射
  if (cfg.hdriNight) {
    const files = await getJson(`https://api.polyhaven.com/files/${cfg.hdriNight}`);
    const hdr = files.hdri?.[res]?.hdr;
    if (hdr) {
      const cached = path.join(cacheDir, 'hdri', `${cfg.hdriNight}_${res}.hdr`);
      await download(hdr.url, cached);
      fs.copyFileSync(cached, path.join(outDir, 'env_night.hdr'));
      manifest.hdriNight = 'env_night.hdr';
      credits.hdriNight = { name: cfg.hdriNight, author: 'Poly Haven', license: 'CC0', url: `https://polyhaven.com/a/${cfg.hdriNight}` };
      console.log(`  夜晚 HDRI ${cfg.hdriNight} (${res})`);
    }
  }
}
manifest.credits = credits;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
// 署名文件：CC-BY 要求注明作者、作品名、许可、出处
const lines = ['# 第三方美术资源', '', '| 用途 | 作品 | 作者 | 许可 | 出处 |', '|---|---|---|---|---|'];
for (const [k, c] of Object.entries(credits)) lines.push(`| ${k} | ${c.name} | ${c.author} | ${c.license} | ${c.url} |`);
fs.writeFileSync(path.join(outDir, 'CREDITS.md'), `${lines.join('\n')}\n`);
const total = fs.readdirSync(outDir, { recursive: true }).reduce((a, f) => {
  const p = path.join(outDir, f);
  return a + (fs.statSync(p).isFile() ? fs.statSync(p).size : 0);
}, 0);
console.log(`写入 ${path.relative(root, manifestPath)}：${Object.keys(manifest.assets).length} 个模型、${Object.keys(manifest.textures).length} 套贴图，共 ${(total / 1048576).toFixed(1)} MB${failed ? `，${failed} 个失败` : ''}`);
if (failed) process.exitCode = 1;
