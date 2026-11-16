// 换弹音效跟着换弹速度走：npm run sim:retime
// 换弹动画是按游戏的换弹时间压快的；音效采样要跟着压（audio/stretch.ts），不然手都到了声音还没到。
// 这里检查三样：
//   1. 合成的信号：压短 / 拉长以后，每一下响声都落在「原来的时刻 ÷ 倍速」上，响声本身一个采样点都没改；
//   2. 动画播放器：标在 0 秒的音效要响（以前被漏掉）、音效回调拿到的倍速是对的；
//   3. 46 把枪的真实采样（需要 ffmpeg；没有就跳过）：每一把枪换弹被压了几倍，压完以后响声偏了多少毫秒。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findOnsets, onsetLead, retime } from '../../src/audio/stretch';
import { GUNS } from '../../src/game/data/guns';
import { WEAPONS, statsAt } from '../../src/game/data/weapons';
import { compileClip, Runner } from '../../src/render/tacz/anim';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const ms = (n: number, sr: number) => (n / sr) * 1000;

// ---------------------------------------------------------------- 1. 合成信号
const SR = 44100;

/** 确定的伪随机数（每次跑结果一样） */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** 一段「动作音效」：很轻的底噪，上面在 at（秒）各有一下 30 毫秒的响声 */
function clicks(dur: number, at: number[], seed = 7): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.round(dur * SR));
  for (let i = 0; i < x.length; i++) x[i] = r() * 0.004;
  for (const t of at) {
    const a = Math.round(t * SR);
    for (let i = 0; i < SR * 0.03 && a + i < x.length; i++) x[a + i] = (x[a + i] as number) + r() * 0.8 * Math.exp(-i / (SR * 0.006));
  }
  return x;
}

/** out 里和 src[from, from+len) 逐点相同的那一段从哪开始（在 near 附近找）；找不到返回 -1 */
function locate(out: Float32Array, src: Float32Array, from: number, len: number, near: number, span: number): number {
  for (let d = 0; d <= span; d++) {
    for (const o of d === 0 ? [near] : [near - d, near + d]) {
      if (o < 0 || o + len > out.length) continue;
      let same = true;
      for (let i = 0; i < len; i++) {
        if (out[o + i] !== src[from + i]) {
          same = false;
          break;
        }
      }
      if (same) return o;
    }
  }
  return -1;
}

console.log('== 合成信号：响声落在「原来的时刻 ÷ 倍速」上，响声本身不变 ==');
{
  const at = [0.12, 0.45, 0.8, 1.31];
  const src = clicks(1.6, at);
  const found = findOnsets([src], SR).map((n) => (n + onsetLead(SR)) / SR);
  check(found.length === at.length && found.every((t, i) => Math.abs(t - (at[i] as number)) < 0.002), `找到 ${found.length} 下响声，位置误差 < 2 毫秒（${found.map((t) => t.toFixed(3)).join(' / ')}）`);

  for (const rate of [1.25, 1.5, 2, 2.75, 3.4, 0.8]) {
    const out = retime([src], SR, rate)[0] as Float32Array;
    let worst = 0;
    let intact = 0;
    for (const t of at) {
      const a = Math.round(t * SR);
      // 响声的头 12 毫秒必须原样出现在结果里
      const len = Math.round(SR * 0.012);
      const want = Math.round((t * SR) / rate);
      const got = locate(out, src, a, len, want, Math.round(SR * 0.01));
      if (got >= 0) {
        intact++;
        worst = Math.max(worst, Math.abs(ms(got - want, SR)));
      }
    }
    const wantLen = src.length / rate;
    const lenOk = rate > 1 ? out.length <= wantLen + SR * 0.21 && out.length >= wantLen - 2 : out.length >= src.length;
    // 响声的起点是按 1 毫秒一格找的，所以时刻最多差 1 毫秒（听不出来；一帧画面是 16 毫秒）
    check(intact === at.length && worst < 1 && lenOk, `×${rate}：${intact}/${at.length} 下响声原样保留，时刻最多偏 ${worst.toFixed(2)} 毫秒；长度 ${(src.length / SR).toFixed(2)} → ${(out.length / SR).toFixed(2)} 秒`);
  }
}

console.log('\n== 只压前半段（换弹到「可以开火」之后动画回到原速） ==');
{
  const at = [0.2, 0.7, 1.5, 2.1];
  const src = clicks(2.6, at, 11);
  const rate = 2;
  const until = 1.0;
  const out = retime([src], SR, rate, until)[0] as Float32Array;
  const want = at.map((t) => (t <= until ? t / rate : until / rate + (t - until)));
  let worst = 0;
  let intact = 0;
  at.forEach((t, i) => {
    const got = locate(out, src, Math.round(t * SR), Math.round(SR * 0.012), Math.round((want[i] as number) * SR), Math.round(SR * 0.01));
    if (got >= 0) {
      intact++;
      worst = Math.max(worst, Math.abs(ms(got - (want[i] as number) * SR, SR)));
    }
  });
  check(intact === at.length && worst < 1, `前 ${until} 秒 ×${rate}、之后原速：响声应在 ${want.map((t) => t.toFixed(2)).join(' / ')} 秒，最多偏 ${worst.toFixed(2)} 毫秒`);
  const same = retime([src], SR, 1.0004)[0] as Float32Array;
  check(same.length === src.length && same.every((v, i) => v === src[i]), '倍速 ≈ 1：原样返回');
}

console.log('\n== 不出爆音：接口处没有突然的跳变 ==');
{
  // 一直响着的摩擦声（没有清楚的响声）压到一半：接口只能靠交叉淡化
  const r = rng(3);
  const src = new Float32Array(SR);
  let lp = 0;
  for (let i = 0; i < src.length; i++) {
    lp += (r() - lp) * 0.02;
    src[i] = lp * 3 * (0.6 + 0.4 * Math.sin(i / 900));
  }
  const jump = (x: Float32Array) => {
    let m = 0;
    for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs((x[i] as number) - (x[i - 1] as number)));
    return m;
  };
  const out = retime([src], SR, 2)[0] as Float32Array;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  let peak0 = 0;
  for (const v of src) peak0 = Math.max(peak0, Math.abs(v));
  check(jump(out) <= jump(src) * 1.5 && peak <= peak0 * 1.45, `×2：相邻采样点最大跳变 ${jump(out).toFixed(4)}（原来 ${jump(src).toFixed(4)}），峰值 ${peak.toFixed(3)}（原来 ${peak0.toFixed(3)}）`);
  check(!out.some((v) => Number.isNaN(v)), '没有 NaN');
  check(retime([new Float32Array(0)], SR, 2)[0]?.length === 0 && (retime([new Float32Array(SR)], SR, 2)[0] as Float32Array).length === SR / 2, '空采样、全静音的采样不出错');
}

// ---------------------------------------------------------------- 2. 动画播放器
console.log('\n== 动画播放器：0 秒的音效、倍速 ==');
{
  const clip = compileClip('reload', { bones: { a: { position: { t: [0, 2], v: [0, 0, 0, 0, 0, 0] } } }, sfx: [[0, 'start'], [0.5, 'magout'], [1.2, 'magin'], [1.8, 'end']] } as never);
  // 换弹：由游戏进度推着走，动画 1.6 秒处「可以开火」，游戏里 0.8 秒换完 → 2 倍速
  const cool = 1.6;
  const total = 0.8;
  const heard: Array<[string, number, number, number]> = [];
  const r = new Runner(clip, 'once');
  r.speed = 0;
  let t = 0;
  const dt = 1 / 60;
  while (t < total) {
    t = Math.min(total, t + dt);
    r.advance(dt, (p, s, at) => heard.push([p, s, at, t]));
    r.seek((t / total) * cool, (p, s, at) => heard.push([p, s, at, t]), cool / total);
  }
  r.speed = 1;
  for (let i = 0; i < 60; i++) {
    t += dt;
    r.advance(dt, (p, s, at) => heard.push([p, s, at, t]));
  }
  check(heard.map((h) => h[0]).join(',') === 'start,magout,magin,end', `四个音效各响一次，顺序对（${heard.map((h) => h[0]).join(' → ')}）`);
  check(heard[0]?.[3] !== undefined && heard[0][3] <= dt * 1.01, `标在 0 秒的那一声在第一帧就响（${((heard[0]?.[3] ?? 9) * 1000).toFixed(0)} 毫秒）`);
  check(heard.slice(0, 3).every((h) => Math.abs(h[1] - 2) < 1e-9) && heard[3]?.[1] === 1, `压着的那一段回调给的是 2 倍速，收尾是原速（${heard.map((h) => h[1]).join(' / ')}）`);
  const when = heard.slice(0, 3).map((h) => h[3]);
  check(when.every((w, i) => Math.abs(w - (heard[i] as [string, number, number, number])[2] / 2) <= dt), `响的时刻 = 动画里的时刻 ÷ 2（${when.map((w) => w.toFixed(2)).join(' / ')} 秒）`);

  // 自己往前走的片段（检视、掏枪）：0 秒的音效也要响，而且只响一次
  const r2 = new Runner(clip, 'once');
  const h2: string[] = [];
  for (let i = 0; i < 150; i++) r2.advance(dt, (p) => h2.push(p));
  check(h2.join(',') === 'start,magout,magin,end', `自己播的片段：0 秒的音效也响、不重复（${h2.join(' → ')}）`);
  // 循环片段：每一圈的 0 秒音效各响一次
  const loop = new Runner(compileClip('walk', { bones: { a: { position: { t: [0, 1], v: [0, 0, 0, 0, 0, 0] } } }, sfx: [[0, 'step']] } as never), 'loop');
  let steps = 0;
  for (let i = 0; i < 60 * 3 + 2; i++) loop.advance(dt, () => steps++);
  check(steps === 4, `循环片段 3 秒：0 秒的音效响 ${steps} 次（开头 1 次 + 每圈 1 次）`);
}

// ---------------------------------------------------------------- 3. 真实采样
console.log('\n== 46 把枪的真实采样 ==');
const root = 'public/tacz';
let ffmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  ffmpeg = false;
}
if (!ffmpeg || !fs.existsSync(root)) {
  console.log('  （没有 ffmpeg 或没有导入枪包：这一段跳过）');
} else {
  const pcm = new Map<string, Float32Array>();
  const decode = (file: string): Float32Array | null => {
    if (!pcm.has(file)) {
      try {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
        pcm.set(file, new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.byteLength & ~3))));
      } catch {
        return null;
      }
    }
    return pcm.get(file) ?? null;
  };

  let guns = 0;
  let sounds = 0;
  let marks = 0;
  let kept = 0;
  let full = 0;
  let merged = 0;
  let worstMs = 0;
  let worstAt = '';
  let late = 0;
  let lateFixed = 0;
  let maxRate = 0;
  let longest = 0;
  const TACTICAL = 0.85;
  const HEAD = Math.round(SR * 0.002);
  const FULL = Math.round(SR * 0.008);
  for (const gun of GUNS) {
    const file = path.join(root, gun.id, 'gun.json');
    if (!fs.existsSync(file)) continue;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j.roles.tube) continue;
    guns++;
    const base = statsAt(gun.cls, WEAPONS[gun.cls].upgrades.length).reload * (gun.mul?.reload ?? 1);
    for (const [list, key, k] of [
      [j.roles.reloadTactical, 'tactical', TACTICAL],
      [j.roles.reloadEmpty, 'empty', 1],
    ] as const) {
      const clip = list?.[0] ? j.anims[list[0]] : null;
      if (!clip) continue;
      const sfx: Array<[number, string]> = clip.sfx ?? [];
      const end = Math.max(clip.len ?? 0, ...sfx.map((s) => s[0]));
      const cool = Math.min(end, j.data.reload?.cooldown?.[key] ?? end * 0.85);
      const rate = cool / (base * k);
      maxRate = Math.max(maxRate, rate);
      const whole = j.display.sounds[`reload_${key}`];
      const list2: Array<[number, string]> = sfx.length ? sfx : whole ? [[0, whole]] : [];
      for (const [at, name] of list2) {
        if (at >= cool) continue;
        const src = decode(path.join(root, gun.id, 'sfx', `${name}.ogg`));
        if (!src || src.length < 64) continue;
        sounds++;
        const until = cool - at;
        const t0 = performance.now();
        const out = retime([src], SR, rate, until)[0] as Float32Array;
        longest = Math.max(longest, performance.now() - t0);
        const edge = Math.min(src.length, until * SR);
        const lead = onsetLead(SR);
        const on = findOnsets([src], SR);
        on.forEach((m, i) => {
          const hit = m + lead;
          if (src.length - hit < HEAD) return;
          marks++;
          const map = (t: number) => (t <= edge ? t / rate : edge / rate + (t - edge));
          const want = map(hit);
          // 原来：采样照原速放，这一下响声比动画晚（或早）多少
          const drift = Math.abs(hit - want) / SR;
          if (drift > 0.04) late++;
          const got = locate(out, src, hit, HEAD, Math.round(want), Math.round(SR * 0.004));
          if (got < 0) {
            // 压完以后离下一下响声不到 11 毫秒：两下并成一下（真的换这么快时也是这样）
            if (map((on[i + 1] ?? src.length) + lead) - want < SR * 0.011) merged++;
            return;
          }
          kept++;
          if (drift > 0.04) lateFixed++;
          if (locate(out, src, hit, Math.min(FULL, src.length - hit), got, 0) >= 0) full++;
          const err = Math.abs(ms(got - want, SR));
          if (err > worstMs) {
            worstMs = err;
            worstAt = `${gun.id} ${name.split('/').pop()}`;
          }
        });
      }
    }
  }
  console.log(`  ${guns} 把弹匣枪，换弹音效 ${sounds} 个，里面一共 ${marks} 下响声；满级时换弹动画最多被压到 ×${maxRate.toFixed(2)}`);
  check(sounds > 300 && marks > 800, '采样都读到了');
  check(late > 300, `照原速放时，${late} 下响声比动画晚 / 早了 40 毫秒以上（就是「对不上」）`);
  check(kept + merged === marks && kept >= marks * 0.93, `压过以后 ${kept}/${marks} 下响声的起音原样留着（其中 ${full} 下连着 8 毫秒一点没动）；另外 ${merged} 下和紧跟着的下一下并在了一起`);
  // 采样开头 3 毫秒以内就响的那几下没法再往前挪，最多差 3 毫秒
  check(lateFixed >= late * 0.93 && worstMs < 3, `原来对不上的 ${late} 下里 ${lateFixed} 下现在对上了；最多偏 ${worstMs.toFixed(2)} 毫秒（${worstAt}）`);
  check(longest < 40, `压一个采样最慢 ${longest.toFixed(1)} 毫秒（每个采样每档速度只算一次）`);
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
