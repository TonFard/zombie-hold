// 用本机 Edge 无头截图并收集浏览器控制台日志。
// 用法：node scripts/tools/shots.mjs --url http://127.0.0.1:5173 --out .logs/shots/a.png [--wait 2500] [--eval "window.__dbg?.foo()"] [--w 1280] [--h 720]
// --gpu：用本机显卡（ANGLE D3D11）而不是软件渲染，测帧率用
// 多步骤：--steps 文件.json，格式 [{"wait":500},{"eval":"..."},{"key":"KeyW","hold":600},{"click":[x,y]},{"shot":"name"}]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      a[k] = v;
    }
  }
  return a;
}

const args = parseArgs(process.argv);
const url = args.url ?? 'http://127.0.0.1:5173';
const w = Number(args.w ?? 1280);
const h = Number(args.h ?? 720);
const outDir = path.resolve(args.dir ?? '.logs/shots');
fs.mkdirSync(outDir, { recursive: true });

const logs = [];
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    `--window-size=${w},${h}`,
    ...(args.gpu ? ['--use-angle=d3d11', '--enable-gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
  ],
  defaultViewport: { width: w, height: h },
});

try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  const shot = async (name) => {
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('saved', file);
  };

  if (args.steps) {
    // 容忍 UTF-8 BOM（Windows 下的编辑器和 PowerShell 经常会带上）
    const steps = JSON.parse(fs.readFileSync(args.steps, 'utf8').replace(/^\uFEFF/, ''));
    for (const s of steps) {
      // goto：相对 --url 的查询串（例如 "?lobby=1&nolock=1"），用来跨页面测试流程
      if (s.goto) await page.goto(new URL(s.goto, url).href, { waitUntil: 'load', timeout: 60000 });
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      if (s.eval) {
        const res = await page.evaluate(s.eval);
        if (res !== undefined) console.log('eval =>', JSON.stringify(res));
      }
      if (s.key) {
        await page.keyboard.down(s.key);
        await new Promise((r) => setTimeout(r, s.hold ?? 100));
        await page.keyboard.up(s.key);
      }
      if (s.move) await page.mouse.move(s.move[0], s.move[1]);
      if (s.click) await page.mouse.click(s.click[0], s.click[1]);
      if (s.shot) await shot(s.shot);
    }
  } else {
    await new Promise((r) => setTimeout(r, Number(args.wait ?? 2500)));
    if (args.eval) console.log('eval =>', JSON.stringify(await page.evaluate(args.eval)));
    await shot(path.basename(args.out ?? 'shot.png', '.png'));
  }
} finally {
  await browser.close();
  console.log('--- console ---');
  console.log(logs.length ? logs.join('\n') : '(no console output)');
}
