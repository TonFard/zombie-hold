// 近战的资源（npm run melee:import）：
//   1. 刀的模型：TACZ 默认枪包里的 M9 刺刀（GPL-3.0，和枪一样）→ public/tacz/_att/bayonet_m9/att.json + att.png
//   2. 第三人称的挥刀动作：EMA（Exception Melee Animation）jar 里的 player_animation 片段 → public/melee/clips.json
//      片段的作者是 Better Combat 的 Daedelus；EMA 自己标的是 MIT，Better Combat 的仓库是 GPL-3.0、CurseForge 上写的是保留所有权利——
//      授权说不清，所以 public/melee/ 不进 git、不进发行包，只在本机用。没有这个文件时游戏里用程序写的简单动作。
// 来源目录：.vendor/tacz（tacz:import 用的那份）、.vendor/ema/x（jar 解出来的 assets）。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const TACZ = path.join(root, '.vendor/tacz/src/main/resources/assets/tacz/custom/tacz_default_gun/assets/tacz');
const EMA = path.join(root, '.vendor/ema/x/assets/exception_melee_animation/player_animation');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

// ---------------------------------------------------------------- 刀
function knife() {
  const geoFile = path.join(TACZ, 'geo_models/attachment/bayonet_m9_geo.json');
  const texFile = path.join(TACZ, 'textures/attachment/uv/bayonet_m9.png');
  if (!fs.existsSync(geoFile) || !fs.existsSync(texFile)) {
    console.log('没找到 TACZ 默认枪包里的 M9 刺刀（.vendor/tacz），刀的模型跳过');
    return;
  }
  const geo = readJson(geoFile)['minecraft:geometry'][0];
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
  const out = {
    id: 'bayonet_m9',
    texture: { w: geo.description.texture_width, h: geo.description.texture_height },
    bones,
    display: { scope: false, sight: false, zoom: [], views: [1], fov: null, showMount: true, heightAdjust: 0 },
  };
  const dir = path.join(root, 'public/tacz/_att/bayonet_m9');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'att.json'), JSON.stringify(out));
  fs.copyFileSync(texFile, path.join(dir, 'att.png'));
  console.log(`刀：${bones.length} 根骨头，${bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0)} 个方块 → public/tacz/_att/bayonet_m9/`);
}

// ---------------------------------------------------------------- 动作
/** 游戏里的三种挥法各用哪个片段 */
const CLIPS = { slashL: 'one_handed_slash_horizontal_right', slashR: 'one_handed_slash_horizontal_left', stab: 'one_handed_stab' };
const PARTS = ['torso', 'head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
const CH = ['pitch', 'yaw', 'roll'];

function clips() {
  if (!fs.existsSync(EMA)) {
    console.log('没找到 EMA 的动作（.vendor/ema/x），挥刀动作跳过（游戏里用程序动作）');
    return;
  }
  const out = {};
  for (const [key, name] of Object.entries(CLIPS)) {
    const e = readJson(path.join(EMA, `${name}.json`)).emote;
    if (e.degrees) throw new Error(`${name}: 角度是度，没处理`);
    /** parts[部位][通道] = [[tick, 值, 缓动], …] */
    const parts = {};
    for (const m of e.moves) {
      for (const p of PARTS) {
        const v = m[p];
        if (!v) continue;
        for (const c of CH) {
          if (typeof v[c] !== 'number') continue;
          (((parts[p] ??= {})[c] ??= [])).push([m.tick, +v[c].toFixed(4), m.easing === 'EASEINQUAD' ? 1 : m.easing === 'EASEOUTQUAD' ? 2 : 0]);
        }
      }
    }
    for (const p of Object.values(parts)) for (const list of Object.values(p)) list.sort((a, b) => a[0] - b[0]);
    out[key] = { src: name, begin: e.beginTick, end: e.endTick, stop: e.stopTick, parts };
  }
  const dir = path.join(root, 'public/melee');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'clips.json'), JSON.stringify(out));
  fs.writeFileSync(
    path.join(dir, 'NOTICE.md'),
    [
      '# 挥刀动作',
      '',
      'clips.json 是从 Exception Melee Animation（EMA，CurseForge 项目 1763296，作者 ComeFromEleven）的 jar 里取的三个 player_animation 片段转出来的：',
      Object.values(CLIPS).map((n) => `\`${n}\``).join('、') + '。',
      '片段文件里写的作者是 Daedelus（Better Combat）。EMA 的 mods.toml 标 MIT；Better Combat 的仓库是 GPL-3.0，CurseForge 页面上写的是保留所有权利。',
      '',
      '授权说不清，所以这个目录不进 git、不进发行包，只在本机用。重新生成：`npm run melee:import`。',
      '',
    ].join('\n'),
  );
  console.log(`动作：${Object.keys(out).join(', ')} → public/melee/clips.json`);
}

knife();
clips();
