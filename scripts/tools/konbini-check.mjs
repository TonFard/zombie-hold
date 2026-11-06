// 雨夜便利店的结构指纹 + 截图：重构前后各跑一次，对比几何、交互、碰撞是否完全一致。
// 用法：node scripts/tools/konbini-check.mjs --url http://127.0.0.1:5199/konbini.html --out .logs/konbini/before.json [--shots before]
// 指纹（全部是确定性的，不依赖帧率和随机粒子）：
//   meshes：每个网格的名字、顶点数、世界坐标顶点和 / 平方和（四舍五入到 1e-3），按名字 + 校验和排序
//   inter：每个交互点的包围盒和初始提示文字；solids / walls：碰撞体和遮挡体
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
}
const url = args.url ?? 'http://127.0.0.1:5199/konbini.html';
const out = path.resolve(args.out ?? '.logs/konbini/fingerprint.json');
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--window-size=1280,720', ...(args.gpu ? ['--use-angle=d3d11', '--enable-gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 240000,
});
const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const sep = url.includes('?') ? '&' : '?';
  await page.goto(`${url}${sep}nolock=1`, { waitUntil: 'load', timeout: 120000 });
  // 用定时轮询而不是 rAF：软件渲染下一帧可能很慢，rAF 轮询会被卡住
  await page.waitForFunction(() => !!window.__k, { timeout: 240000, polling: 1000 });
  // 等 Blender 陈设包加载完（成功或失败都会把程序陈设的显隐定下来）
  const packed = url.includes('fixtures=proc')
    ? false
    : await page
        .waitForFunction(() => window.__k.W.root.children.some((o) => o.name.startsWith('Konbini | Blender')), { timeout: 120000, polling: 1000 })
        .then(() => true)
        .catch(() => false);
  const state = await page.evaluate(() => {
    const R = window.__k.W.root;
    const fb = R.children.find((o) => o.name === 'fixtures');
    return { blenderPack: R.children.some((o) => o.name.startsWith('Konbini | Blender')), proceduralFixturesVisible: fb ? fb.visible : null };
  });
  console.log(`blender pack attached=${packed} state=${JSON.stringify(state)}`);
  const fp = await page.evaluate(() => {
    const k = window.__k;
    const W = k.W;
    W.root.updateMatrixWorld(true);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const meshes = [];
    W.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      const e = o.matrixWorld.elements;
      let sx = 0, sy = 0, sz = 0, qq = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        sx += wx; sy += wy; sz += wz; qq += wx * wx + wy * wy + wz * wz;
      }
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      meshes.push({ name: o.name || o.parent?.name || '?', mat: mat?.type ?? '?', n: pos.count, s: [r3(sx), r3(sy), r3(sz)], q: Math.round(qq) });
    });
    meshes.sort((a, b) => (a.name + a.n + a.s.join()).localeCompare(b.name + b.n + b.s.join()));
    const b = (bx) => [bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z].map(r3);
    const inter = W.inter.map((it) => ({ box: b(it.box), label: it.label(), on: it.on ? it.on() : true }));
    inter.sort((p, q) => p.box.join().localeCompare(q.box.join()));
    const sol = (list) => list.map((s) => [s.minx, s.miny, s.minz, s.maxx, s.maxy, s.maxz].map(r3).join()).sort();
    let verts = 0;
    for (const m of meshes) verts += m.n;
    return { meshCount: meshes.length, verts, meshes, inter, solids: sol(W.solids.list), walls: sol(W.walls.list), ticks: W.tick.length };
  });
  fs.writeFileSync(out, JSON.stringify(fp, null, 1));
  console.log(`meshes=${fp.meshCount} verts=${fp.verts} inter=${fp.inter.length} solids=${fp.solids.length} walls=${fp.walls.length} ticks=${fp.ticks} -> ${out}`);

  // 截图：店内几个固定机位（第一人称，雨停，地面变干，减少随机粒子带来的差异）
  if (args.shots) {
    const dir = path.resolve('.logs/konbini/shots');
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(() => {
      const k = window.__k;
      if (k.weather.raining) k.weather.toggle();
    });
    const spots = [
      ['aisle', 0.8, 0.3, -3.2, Math.PI * 1.15, -0.15],
      ['cooler', -3.5, 0.3, -8.4, Math.PI, -0.1],
      ['counter', 2.6, 0.3, -6.0, Math.PI / 2, -0.25],
      ['corner', 2.6, 0.3, -8.0, Math.PI * 0.95, -0.2],
      ['endcap', 5.2, 0.3, -6.8, -Math.PI / 2, -0.2],
      ['front', 1.0, 0.15, 3.5, Math.PI, 0.02],
    ];
    for (const [name, x, y, z, yaw, pitch] of spots) {
      await page.evaluate((a) => window.__k.shot(a[0], a[1], a[2], a[3], a[4], false), [x, y, z, yaw, pitch]);
      await new Promise((r) => setTimeout(r, 2500));
      const file = path.join(dir, `${args.shots}-${name}.png`);
      await page.screenshot({ path: file });
      // 帧时间：连续 60 帧的中位数（只在 --gpu 下有意义）+ 这一帧的绘制调用
      const perf = await page.evaluate(
        () =>
          new Promise((res) => {
            const ts = [];
            let last = performance.now();
            const f = (now) => {
              ts.push(now - last);
              last = now;
              if (ts.length < 61) requestAnimationFrame(f);
              else {
                const s = ts.slice(1).sort((a, b) => a - b);
                const r = window.__k.renderer.info.render;
                res({ ms: +s[30].toFixed(1), p90: +s[54].toFixed(1), calls: r.calls, tris: r.triangles });
              }
            };
            requestAnimationFrame(f);
          }),
      );
      console.log('saved', file, JSON.stringify(perf));
    }
  }
} finally {
  await browser.close();
  console.log('--- console (all) ---');
  console.log(logs.length ? logs.slice(0, 40).join('\n') : '(none)');
}
