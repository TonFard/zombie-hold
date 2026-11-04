// TACZ 枪械导入流程：按 tacz.config.json 把每个武器栏位对应的枪从 TACZ 枪包转成游戏能直接加载的格式。
//
// 用法：
//   npm run tacz:import                 按配置导入全部武器，生成 public/tacz/manifest.json
//   npm run tacz:import -- --only rifle 只导入一个栏位
//   npm run tacz:import -- --check      只检查不写文件（看哪些枪能自动转、缺什么）
//   npm run tacz:import -- --force      检查不通过也照样导出（例如栓动枪，动画会不完整）
//
// 每把枪输出到 public/tacz/<枪 id>/：
//   gun.json  模型骨骼 + 方块（基岩版几何原样保留）、用到的动画片段、动作 → 片段名的对照表、显示参数、换弹时间
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

/** TACZ 的 json 允许注释和结尾逗号 */
function parseJsonc(text) {
  const s = text.replace(/^\uFEFF/, '');
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

/** "tacz:gun/glock_17_geo" → { ns: 'tacz', p: 'gun/glock_17_geo' } */
function rl(id) {
  const i = id.indexOf(':');
  return i < 0 ? { ns: 'minecraft', p: id } : { ns: id.slice(0, i), p: id.slice(i + 1) };
}

const round = (x) => Math.round(x * 1e5) / 1e5;

// ---------------------------------------------------------------- 动画

/** 运行时会用到的通用动作片段（走路、冲刺、滑铲、瞄准），来自枪自己或默认动画 */
const MOVEMENT_CLIPS = ['idle', 'walk_forward', 'walk_backward', 'walk_sideway', 'walk_aiming', 'run_start', 'run', 'run_end', 'slide', 'slide_idle', 'slide_back', 'aim_start', 'aim', 'aim_end'];

/** 我们的武器栏位默认的射击模式（选 static_auto / static_semi 这种"快慢机位置"片段用） */
const FIRE_MODE = { pistol: 'semi', smg: 'auto', shotgun: 'semi', rifle: 'auto', sniper: 'semi', lmg: 'auto', launcher: 'semi' };

function makeAnimConverter(stats) {
  const num = (v) => {
    if (typeof v === 'number') return v;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    stats.molang++;
    return 0;
  };
  const vec3 = (v) => (Array.isArray(v) ? [num(v[0] ?? 0), num(v[1] ?? 0), num(v[2] ?? 0)] : [num(v), num(v), num(v)]);

  /**
   * 统一成 { t: [时间], pre: [x,y,z,...], post: [x,y,z,...], c: [是否 catmullrom] }。
   * 和 TACZ 一样：只有 pre 或只有 post 时两个都取它；数组 / 数字当作 0 秒处的一个关键帧。
   */
  function channel(src) {
    if (src === undefined || src === null) return null;
    if (typeof src === 'string') {
      stats.molang++;
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

  return function convertAnim(a, soundName) {
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
  };
}

/**
 * 动作 → 片段名。各枪的 Lua 状态机大多只是在"装没装扩容弹匣、什么射击模式"之间挑片段名，
 * 这里用命名规则统一挑好，运行时只认动作。
 * 扩容弹匣的片段名有好几种写法：_xmag、_xmag_1、_xmag_12、_xmag_23、_xmag_123，按数字里有没有这一级来匹配。
 */
function resolveRoles(names, fireMode) {
  const has = (n) => names.has(n);
  const pick = (...c) => c.find(has) ?? null;
  const xmag = (base, level) => {
    if (has(`${base}_xmag_${level}`)) return `${base}_xmag_${level}`;
    for (const n of names) {
      const m = n.match(new RegExp(`^${base}_xmag_(\\d+)$`));
      if (m && m[1].includes(String(level))) return n;
    }
    return has(`${base}_xmag`) ? `${base}_xmag` : null;
  };
  const levels = (base, fallback) => {
    const std = pick(base, fallback);
    return [0, 1, 2, 3].map((l) => (l === 0 ? std : (xmag(base, l) ?? std)));
  };
  // 逐发装填（管状弹仓）：intro → loop × 缺几发 → end；intro_empty 是空仓时多一个上膛动作
  const tube = has('reload_intro') && has('reload_loop') && has('reload_end');
  return {
    draw: pick('draw'),
    shoot: pick('shoot'),
    shootLast: pick('shoot_last'),
    /** 栓动 / 泵动：每发之后的拉栓（没有就是 null） */
    bolt: pick('bolt'),
    tube: tube ? { intro: 'reload_intro', introEmpty: pick('reload_intro_empty', 'reload_empty_intro', 'reload_intro'), loop: 'reload_loop', end: 'reload_end' } : null,
    reloadTactical: levels('reload_tactical', 'reload_empty'),
    reloadEmpty: levels('reload_empty', 'reload_tactical'),
    inspect: levels('inspect', 'inspect_empty'),
    inspectEmpty: levels('inspect_empty', 'inspect'),
    staticIdle: pick('static_idle'),
    boltCaught: pick('static_bolt_caught'),
    fireMode: pick(`static_${fireMode}`),
  };
}

// ---------------------------------------------------------------- 一把枪

function importGun({ kind, gunId, packDir, defaultsDir, outRoot, write, fireMode }) {
  const errors = [];
  const warnings = [];
  const assetPath = (id, dir, ext) => {
    const r = rl(id);
    return path.join(packDir, 'assets', r.ns, dir, r.p + ext);
  };
  const dataPath = (id, dir, ext) => {
    const r = rl(id);
    return path.join(packDir, 'data', r.ns, dir, r.p + ext);
  };

  const indexFile = path.join(packDir, 'data/tacz/index/guns', `${gunId}.json`);
  if (!fs.existsSync(indexFile)) return { errors: [`枪包里没有 ${gunId}（找不到 ${path.relative(process.cwd(), indexFile)}）`], warnings };
  const index = readJson(indexFile);
  const display = readJson(assetPath(index.display, 'display/guns', '.json'));
  const data = readJson(dataPath(index.data, 'data/guns', '.json'));
  const geo = readJson(assetPath(display.model, 'geo_models', '.json'))['minecraft:geometry'][0];
  const animFile = readJson(assetPath(display.animation, 'animations', '.animation.json'));

  // 枪自己的动画文件里没有的片段（idle、run、walk 之类），TACZ 会从对应的默认动画里补
  let defaults = {};
  if (display.use_default_animation) {
    const p = path.join(defaultsDir, `${display.use_default_animation}_default.animation.json`);
    if (fs.existsSync(p)) defaults = readJson(p).animations ?? {};
    else warnings.push(`找不到默认动画 ${display.use_default_animation}_default，走路 / 冲刺不会晃`);
  }
  const own = animFile.animations ?? {};
  const all = { ...defaults, ...own };
  const names = new Set(Object.keys(all));
  const roles = resolveRoles(names, fireMode);

  // ---- 检查：流程能不能自动处理这把枪
  const reloadType = data.reload?.type ?? 'magazine';
  if (reloadType !== 'magazine') errors.push(`换弹方式是 ${reloadType}（无换弹 / 背包供弹），流程暂不支持`);
  if (data.bolt === 'manual_action' && !roles.bolt) errors.push('栓动 / 泵动枪，但没有 bolt 动画');
  const boneNames = new Set((geo.bones ?? []).map((b) => b.name));
  for (const n of ['idle_view', 'iron_view']) if (!boneNames.has(n)) errors.push(`模型缺定位节点 ${n}，没法摆到镜头前`);
  for (const n of ['lefthand_pos', 'righthand_pos']) if (!boneNames.has(n)) warnings.push(`模型缺 ${n}，这只手不会画`);
  if (!boneNames.has('muzzle_pos') && !boneNames.has('muzzle_flash')) warnings.push('模型没有枪口节点，火光会在枪的原点');
  else if (!boneNames.has('muzzle_pos')) warnings.push('没有 muzzle_pos，用 muzzle_flash 当枪口');
  if (!roles.reloadTactical[0] && !roles.tube) errors.push('没有换弹动画（reload_tactical / reload_empty，或逐发装填的 reload_intro / loop / end）');
  if (!roles.shoot) warnings.push('没有 shoot 动画，开枪不会后坐');
  if (!roles.draw) warnings.push('没有 draw 动画，切枪直接出现');
  if (!roles.staticIdle) warnings.push('没有 static_idle，双手可能不在握把上');
  const poly = (geo.bones ?? []).filter((b) => b.poly_mesh).length;
  if (poly) warnings.push(`${poly} 根骨骼是 poly_mesh，暂不支持，已跳过`);

  // 状态机脚本里用到、但我们不会播的片段：意味着这把枪有流程没覆盖的特殊动作
  const roleClips = Object.values(roles).flatMap((v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v) : v));
  const used = new Set([...roleClips.filter((x) => typeof x === 'string'), ...MOVEMENT_CLIPS]);
  if (display.state_machine) {
    const lua = assetPath(display.state_machine, 'scripts', '.lua');
    if (fs.existsSync(lua)) {
      const src = fs.readFileSync(lua, 'utf8');
      const ignored = new Set();
      for (const m of src.matchAll(/runAnimation\("([a-zA-Z0-9_]+)"/g)) {
        const n = m[1];
        if (used.has(n) || /^(static_(auto|semi|burst)|switch_|crawl|melee_|put_away)/.test(n)) continue;
        ignored.add(n);
      }
      if (ignored.size) warnings.push(`脚本里有流程不会播的片段：${[...ignored].join(', ')}`);
    }
  }

  // ---- 转换（只保留会用到的片段，文件小一半以上）
  const stats = { molang: 0 };
  const convertAnim = makeAnimConverter(stats);
  const sounds = new Set();
  const soundName = (id) => {
    const r = rl(id);
    sounds.add(`${r.ns}:${r.p}`);
    return r.p;
  };
  const anims = {};
  for (const n of used) if (all[n]) anims[n] = convertAnim(all[n], soundName);
  if (stats.molang) warnings.push(`跳过 ${stats.molang} 处 Molang 表达式（按 0 处理）`);

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
    return o;
  });

  const ds = {};
  for (const [k, v] of Object.entries(display.sounds ?? {})) ds[k] = soundName(v);
  const missing = [];
  for (const s of sounds) {
    const r = rl(s);
    if (!fs.existsSync(path.join(packDir, 'assets', r.ns, 'tacz_sounds', r.p + '.ogg'))) missing.push(r.p);
  }
  if (missing.length) warnings.push(`缺 ${missing.length} 个音效文件：${missing.join(', ')}`);
  const missingSet = new Set(missing);
  for (const a of Object.values(anims)) {
    if (!a.sfx) continue;
    a.sfx = a.sfx.filter((e) => !missingSet.has(e[1]));
    if (!a.sfx.length) delete a.sfx;
  }
  for (const [k, v] of Object.entries(ds)) if (missingSet.has(v)) delete ds[k];

  const texFile = assetPath(display.texture, 'textures', '.png');
  if (!fs.existsSync(texFile)) errors.push(`找不到贴图 ${path.relative(process.cwd(), texFile)}`);

  const cubes = bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0);
  const summary = `${bones.length} 骨骼 / ${cubes} 方块 / ${Object.keys(anims).length} 动画 / ${sounds.size - missing.length} 音效`;
  if (!write || (errors.length && !args.force)) return { errors, warnings, summary };

  const out = {
    id: gunId,
    texture: { w: geo.description.texture_width, h: geo.description.texture_height },
    bones,
    anims,
    roles,
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
  const dir = path.join(outRoot, gunId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'sfx'), { recursive: true });
  for (const s of sounds) {
    const r = rl(s);
    if (missingSet.has(r.p)) continue;
    const dst = path.join(dir, 'sfx', r.p + '.ogg');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(packDir, 'assets', r.ns, 'tacz_sounds', r.p + '.ogg'), dst);
  }
  fs.writeFileSync(path.join(dir, 'gun.json'), JSON.stringify(out));
  fs.copyFileSync(texFile, path.join(dir, 'gun.png'));
  const kb = (fs.statSync(path.join(dir, 'gun.json')).size / 1024).toFixed(0);
  return { errors, warnings, summary: `${summary} / gun.json ${kb} KB`, written: true, name: index.name };
}

// ---------------------------------------------------------------- 主流程

const args = parseArgs(process.argv);
const configFile = path.resolve(args.config ?? 'tacz.config.json');
const config = readJson(configFile);
const outRoot = path.resolve(args.out ?? 'public/tacz');
const defaultsDir = path.resolve(config.defaultAnimations ?? '.vendor/tacz/src/main/resources/assets/tacz/animations');
const write = args.check !== 'true';
const only = args.only;

const kinds = Object.keys(config.weapons ?? {}).filter((k) => !only || k === only);
if (only && !kinds.length) {
  console.error(`配置里没有栏位 ${only}`);
  process.exit(1);
}
const manifestFile = path.join(outRoot, 'manifest.json');
// 只导入一个栏位时保留其他栏位的结果
const manifest = { enabled: !!config.enabled, weapons: {} };
if (only && fs.existsSync(manifestFile)) Object.assign(manifest.weapons, readJson(manifestFile).weapons ?? {});

let failed = 0;
for (const kind of kinds) {
  const w = config.weapons[kind];
  const packKey = w.pack ?? Object.keys(config.packs)[0];
  const packDir = path.resolve(config.packs[packKey] ?? packKey);
  const label = `${kind.padEnd(8)} ${w.gun}`;
  if (!fs.existsSync(packDir)) {
    console.log(`✗ ${label}\n    枪包目录不存在：${packDir}`);
    failed++;
    continue;
  }
  let r;
  try {
    r = importGun({ kind, gunId: w.gun, packDir, defaultsDir, outRoot, write, fireMode: w.fireMode ?? FIRE_MODE[kind] ?? 'auto' });
  } catch (e) {
    r = { errors: [`读取失败：${e.message}`], warnings: [] };
  }
  const ok = r.errors.length === 0;
  if (!ok) failed++;
  const mark = ok ? (r.warnings.length ? '△' : '✓') : r.written ? '!' : '✗';
  console.log(`${mark} ${label}${r.summary ? `  (${r.summary})` : ''}`);
  for (const e of r.errors) console.log(`    错误：${e}`);
  for (const x of r.warnings) console.log(`    提示：${x}`);
  if (r.written) manifest.weapons[kind] = { dir: w.gun, warnings: r.warnings, errors: r.errors };
  else if (write) delete manifest.weapons[kind];
}

if (write) {
  // 全量导入时清掉不再使用的旧目录
  if (!only && fs.existsSync(outRoot)) {
    const keep = new Set(Object.values(manifest.weapons).map((w) => w.dir));
    for (const d of fs.readdirSync(outRoot, { withFileTypes: true })) if (d.isDirectory() && !keep.has(d.name)) fs.rmSync(path.join(outRoot, d.name), { recursive: true, force: true });
  }
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`\n→ ${path.relative(process.cwd(), manifestFile)}：${Object.keys(manifest.weapons).length} 个栏位，游戏里${manifest.enabled ? '已启用' : '未启用（URL 加 ?tacz=1 预览）'}`);
}
if (failed) {
  console.log(`${failed} 个栏位没通过检查${args.force ? '（--force 已照样导出）' : '，加 --force 可以照样导出'}`);
  process.exitCode = 1;
}
