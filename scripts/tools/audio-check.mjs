// 音频自检：用 OfflineAudioContext 把每个音效渲染成采样，检查是否有声音、有没有 NaN、会不会爆音、尾巴是否过长。
// 听感没法在这里验证，这里只验证"确实出声、数值健康"。
// 用法：先 npm run dev，再 node scripts/tools/audio-check.mjs [--url http://127.0.0.1:5173/]
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:5173/';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

let failed = 0;
const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${url}?nopost=1`, { waitUntil: 'load', timeout: 60000 });

  const rows = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { Sfx } = await import('/src/audio/sfx.ts');
    const { Ambience } = await import('/src/audio/ambience.ts');

    const SR = 44100;
    const SECONDS = 4;
    /** 渲染一段，返回统计数据 */
    const render = async (play) => {
      const ctx = new OfflineAudioContext(2, SR * SECONDS, SR);
      const engine = new AudioEngine(ctx);
      engine.setVolume(1);
      const sfx = new Sfx(engine);
      play(sfx, engine);
      const voices = engine.voices;
      const buf = await ctx.startRendering();
      let peak = 0;
      let sum = 0;
      let nan = 0;
      let lastAudible = 0;
      let n = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
          const v = d[i];
          if (Number.isNaN(v) || !Number.isFinite(v)) {
            nan++;
            continue;
          }
          const a = Math.abs(v);
          if (a > peak) peak = a;
          sum += v * v;
          n++;
          if (a > 0.002 && i / SR > lastAudible) lastAudible = i / SR;
        }
      }
      return { peak, rms: Math.sqrt(sum / n), nan, tail: lastAudible, voices };
    };

    const cases = [
      ['shot.pistol', (s) => s.shot('pistol')],
      ['shot.smg', (s) => s.shot('smg')],
      ['shot.shotgun', (s) => s.shot('shotgun')],
      ['shot.rifle', (s) => s.shot('rifle')],
      ['shot.launcher', (s) => s.shot('launcher')],
      ['turretShot', (s) => s.turretShot(4, 0)],
      ['reload.start', (s) => s.reload(true, 'rifle')],
      ['reload.start.shotgun', (s) => s.reload(true, 'shotgun')],
      ['reload.end', (s) => s.reload(false, 'rifle')],
      ['weaponSwitch', (s) => s.weaponSwitch()],
      ['impact.flesh', (s) => s.impact(3, 0, true)],
      ['impact.wall', (s) => s.impact(3, 0, false)],
      ['crit', (s) => s.crit(3, 0)],
      ['explosion.big', (s) => s.explosion(5, 0, true)],
      ['explosion.small', (s) => s.explosion(5, 0, false)],
      ['acid', (s) => s.acid(4, 0)],
      ['growl.walker', (s) => s.growl('walker', 6, 0)],
      ['growl.runner', (s) => s.growl('runner', 6, 0)],
      ['growl.bloater', (s) => s.growl('bloater', 6, 0)],
      ['growl.breaker', (s) => s.growl('breaker', 6, 0)],
      ['growl.colossus', (s) => s.growl('colossus', 6, 0)],
      ['die.walker', (s) => s.zombieDie('walker', 5, 0)],
      ['die.runner', (s) => s.zombieDie('runner', 5, 0)],
      ['die.bloater', (s) => s.zombieDie('bloater', 5, 0)],
      ['die.breaker', (s) => s.zombieDie('breaker', 5, 0)],
      ['die.colossus', (s) => s.zombieDie('colossus', 5, 0)],
      ['attack.structure', (s) => s.zombieAttack('breaker', 'structure', 4, 0)],
      ['attack.player', (s) => s.zombieAttack('walker', 'player', 2, 0)],
      ['attack.core', (s) => s.zombieAttack('colossus', 'core', 4, 0)],
      ['playerHurt', (s) => s.playerHurt(15)],
      ['playerDie', (s) => s.playerDie()],
      ['coreHit', (s) => s.coreHit()],
      ['structureHit', (s) => s.structureHit(4, 0)],
      ['built.barricade', (s) => s.structureBuilt('barricade', 3, 0)],
      ['built.turret', (s) => s.structureBuilt('turret', 3, 0)],
      ['built.spikes', (s) => s.structureBuilt('spikes', 3, 0)],
      ['sold', (s) => s.structureSold(3, 0)],
      ['broken', (s) => s.structureBroken(3, 0)],
      ['spikes', (s) => s.spikes(3, 0)],
      ['repair', (s) => s.repair(2, 0)],
      ['pickup', (s) => s.pickup(1, 0, 20)],
      ['buildToggle', (s) => s.buildToggle(true)],
      ['uiClick', (s) => s.uiClick()],
      ['uiBuy', (s) => s.uiBuy()],
      ['uiDeny', (s) => s.uiDeny()],
      ['dayStart', (s) => s.dayStart()],
      ['nightStart', (s) => s.nightStart(false)],
      ['nightStart.boss', (s) => s.nightStart(true)],
      ['dawn', (s) => s.dawn()],
      ['cardPick', (s) => s.cardPick()],
      ['win', (s) => s.win()],
      ['lose', (s) => s.lose()],
    ];

    const out = [];
    for (const [name, fn] of cases) out.push({ name, ...(await render(fn)) });

    // 极端情况：同一瞬间 300 个混合声音，看压缩器和音源上限能不能兜住
    const kinds = ['pistol', 'smg', 'shotgun', 'rifle', 'launcher'];
    out.push({
      name: 'STRESS.300mixed',
      ...(await render((s, e) => {
        for (let i = 0; i < 300; i++) {
          // 每次放行：清掉节流记录，模拟最坏情况
          e.last.clear();
          s.shot(kinds[i % 5]);
          s.explosion((i % 9) - 4, 0, i % 2 === 0);
          s.zombieDie('walker', (i % 11) - 5, 3);
        }
      })),
    });

    // 环境声：夜晚模式下渲染 4 秒（风 + 嗡鸣 + 心跳）
    {
      const ctx = new OfflineAudioContext(2, SR * SECONDS, SR);
      const engine = new AudioEngine(ctx);
      engine.setVolume(1);
      const amb = new Ambience(engine);
      amb.start();
      amb.setMode('night');
      amb.update(0.016, 0.8);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      let sum = 0;
      let nan = 0;
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (!Number.isFinite(v)) nan++;
        else {
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
      }
      out.push({ name: 'ambience.night', peak, rms: Math.sqrt(sum / d.length), nan, tail: SECONDS, voices: 0 });
    }
    return out;
  });

  console.log('name'.padEnd(22), 'peak'.padStart(7), 'rms'.padStart(8), 'tail(s)'.padStart(8), 'nan', 'voices');
  for (const r of rows) {
    const problems = [];
    if (r.nan > 0) problems.push('NaN');
    if (r.peak < 0.01) problems.push('无声');
    if (r.peak > 1.0) problems.push('爆音');
    if (r.name.startsWith('STRESS') && r.voices > 56) problems.push('音源超限');
    if (!r.name.startsWith('STRESS') && !r.name.startsWith('ambience') && r.tail > 3.2) problems.push('尾巴过长');
    if (r.name.startsWith('ambience') && r.rms > 0.08) problems.push('环境声过响');
    if (problems.length) failed++;
    // 峰值贴着软削波上限（0.9 左右）说明这个声音已经被压扁，只提示不判失败
    const warn = !problems.length && r.peak >= 0.89 && !r.name.startsWith('STRESS') ? '  (近削波)' : '';
    console.log(r.name.padEnd(22), r.peak.toFixed(3).padStart(7), r.rms.toFixed(4).padStart(8), r.tail.toFixed(2).padStart(8), String(r.nan).padStart(3), String(r.voices).padStart(6), problems.length ? '  <-- ' + problems.join(',') : warn);
  }
} finally {
  await browser.close();
  console.log('--- console ---');
  console.log(logs.filter((l) => !l.includes('[vite]')).join('\n') || '(no console output)');
}
console.log(failed ? `FAILED: ${failed}` : 'ALL OK');
process.exit(failed ? 1 : 0);
