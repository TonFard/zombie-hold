// 把 TACZ 枪包里的一把枪转成游戏能直接加载的格式。
// 用法：node scripts/tools/tacz-import.mjs glock_17 [--pack 枪包目录] [--mod TACZ 模组 assets/tacz 目录] [--out public/tacz]
//
// 输出 public/tacz/<枪>/：
//   gun.json  模型骨骼 + 方块（基岩版几何原样保留）、动画（关键帧整理成统一结构）、显示参数、换弹时间
//   gun.png   贴图
//   sfx/      动画和显示配置里用到的 ogg
//
// 坐标、单位、插值规则都在运行时（src/render/tacz/）按 TACZ 的实现处理，这里只做整理，不改数值。
import fs from 'node:fs';
import path from 'node:path';

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
const gunId = args._[0];
if (!gunId) {
  console.error('用法：node scripts/tools/tacz-import.mjs <枪械 id，例如 glock_17>');
  process.exit(1);
}
const MOD = path.resolve(args.mod ?? '.vendor/tacz/src/main/resources/assets/tacz');
const PACK = path.resolve(args.pack ?? path.join(MOD, 'custom/tacz_default_gun'));
const OUT = path.resolve(args.out ?? 'public/tacz', gunId);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

/** "tacz:gun/glock_17_geo" → { ns: 'tacz', p: 'gun/glock_17_geo' } */
function rl(id) {
  const i = id.indexOf(':');
  return i < 0 ? { ns: 'minecraft', p: id } : { ns: id.slice(0, i), p: id.slice(i + 1) };
}
const assetPath = (id, dir, ext) => {
  const r = rl(id);
  return path.join(PACK, 'assets', r.ns, dir, r.p + ext);
};
const dataPath = (id, dir, ext) => {
  const r = rl(id);
  return path.join(PACK, 'data', r.ns, dir, r.p + ext);
};

// ---------------------------------------------------------------- 读配置

const index = readJson(path.join(PACK, 'data/tacz/index/guns', `${gunId}.json`));
const display = readJson(assetPath(index.display, 'display/guns', '.json'));
const data = readJson(dataPath(index.data, 'data/guns', '.json'));
const geo = readJson(assetPath(display.model, 'geo_models', '.json'))['minecraft:geometry'][0];
const animFile = readJson(assetPath(display.animation, 'animations', '.animation.json'));

// 枪自己的动画文件里没有的片段（idle、run、walk 之类），TACZ 会从对应的默认动画里补
let defaults = {};
if (display.use_default_animation) {
  const p = path.join(MOD, 'animations', `${display.use_default_animation}_default.animation.json`);
  if (fs.existsSync(p)) defaults = readJson(p).animations ?? {};
  else console.warn('找不到默认动画', p);
}

// ---------------------------------------------------------------- 动画

let molang = 0;
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  molang++;
  return 0;
};
const vec3 = (v) => (Array.isArray(v) ? [num(v[0] ?? 0), num(v[1] ?? 0), num(v[2] ?? 0)] : [num(v), num(v), num(v)]);
const round = (x) => Math.round(x * 1e5) / 1e5;

/**
 * 统一成 { t: [时间], pre: [x,y,z,...], post: [x,y,z,...], c: [是否 catmullrom] }。
 * 和 TACZ 一样：只有 pre 或只有 post 时两个都取它；数组 / 数字当作 0 秒处的一个关键帧。
 */
function channel(src) {
  if (src === undefined || src === null) return null;
  if (typeof src === 'string') {
    molang++;
    return null;
  }
  let entries;
  if (typeof src === 'number' || Array.isArray(src)) entries = [[0, src]];
  else {
    entries = [];
    for (const [k, v] of Object.entries(src)) {
      const t = Number(k);
      if (!Number.isFinite(t)) {
        // 时间轴本身是表达式：TACZ 直接放弃整条通道
        molang++;
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

const sounds = new Set();
const soundName = (id) => {
  const r = rl(id);
  sounds.add(`${r.ns}:${r.p}`);
  return r.p;
};

function convertAnim(a) {
  const bones = {};
  for (const [bone, chs] of Object.entries(a.bones ?? {})) {
    const b = {};
    for (const key of ['position', 'rotation', 'scale']) {
      const c = channel(chs[key]);
      if (c) b[key] = c;
    }
    if (Object.keys(b).length) bones[bone] = b;
  }
  const sfx = [];
  for (const [k, v] of Object.entries(a.sound_effects ?? {})) {
    const list = Array.isArray(v) ? v : [v];
    for (const e of list) if (e?.effect) sfx.push([round(Number(k)), soundName(e.effect)]);
  }
  sfx.sort((x, y) => x[0] - y[0]);
  const out = { bones };
  if (typeof a.animation_length === 'number') out.len = a.animation_length;
  if (a.loop !== undefined) out.loop = a.loop;
  if (sfx.length) out.sfx = sfx;
  return out;
}

const anims = {};
for (const [name, a] of Object.entries(defaults)) anims[name] = convertAnim(a);
for (const [name, a] of Object.entries(animFile.animations ?? {})) anims[name] = convertAnim(a);

// ---------------------------------------------------------------- 几何

// 只保留运行时要用的字段
const bones = (geo.bones ?? []).map((b) => {
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
  if (b.poly_mesh) console.warn('骨骼', b.name, '是 poly_mesh，暂不支持，已跳过');
  return o;
});

// ---------------------------------------------------------------- 显示参数、换弹时间

const ds = {};
for (const [k, v] of Object.entries(display.sounds ?? {})) ds[k] = soundName(v);
const out = {
  id: gunId,
  texture: { w: geo.description.texture_width, h: geo.description.texture_height },
  bones,
  anims,
  display: {
    modelFov: display.model_fov ?? 70,
    zoomModelFov: display.zoom_model_fov ?? display.model_fov ?? 70,
    ironZoom: display.iron_zoom ?? 1,
    sounds: ds,
  },
  data: {
    rpm: data.rpm,
    ammo: data.ammo_amount,
    drawTime: data.draw_time,
    putAwayTime: data.put_away_time,
    bolt: data.bolt,
    reload: data.reload ?? null,
  },
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });

let copied = 0;
const missing = [];
const missingNames = new Set();
for (const s of sounds) {
  const r = rl(s);
  const src = path.join(PACK, 'assets', r.ns, 'tacz_sounds', r.p + '.ogg');
  const dst = path.join(OUT, 'sfx', r.p + '.ogg');
  if (!fs.existsSync(src)) {
    missing.push(s);
    missingNames.add(r.p);
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}
// 找不到文件的音效从动画里去掉，运行时就不会去请求它
for (const a of Object.values(anims)) {
  if (!a.sfx) continue;
  a.sfx = a.sfx.filter((e) => !missingNames.has(e[1]));
  if (!a.sfx.length) delete a.sfx;
}
for (const [k, v] of Object.entries(ds)) if (missingNames.has(v)) delete ds[k];

fs.writeFileSync(path.join(OUT, 'gun.json'), JSON.stringify(out));
fs.copyFileSync(assetPath(display.texture, 'textures', '.png'), path.join(OUT, 'gun.png'));

const size = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log(`${gunId}: ${bones.length} 根骨骼，${bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0)} 个方块`);
console.log(`动画 ${Object.keys(anims).length} 个：${Object.keys(anims).join(', ')}`);
console.log(`音效 ${copied} 个${missing.length ? `，缺 ${missing.length} 个：${missing.join(', ')}` : ''}`);
if (molang) console.log(`跳过 ${molang} 处 Molang 表达式（按 0 处理）`);
console.log(`→ ${path.relative(process.cwd(), OUT)}  gun.json ${size(path.join(OUT, 'gun.json'))}`);
