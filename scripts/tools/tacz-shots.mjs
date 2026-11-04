// 给导入的每把 TACZ 枪自动截图：腰射、瞄准、开火、换弹、检视。
// 用法：先 npm run dev，再 npm run tacz:shots [-- --only rifle]
// 输出 .logs/shots/tacz/<栏位>-<动作>.png；不管配置里 enabled 是不是 true，都用 ?tacz=1 强制启用来截。
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'] : null))
    .filter(Boolean),
);
const url = args.url ?? 'http://127.0.0.1:5173';
const outDir = path.resolve('.logs/shots/tacz');
fs.mkdirSync(outDir, { recursive: true });

const manifest = JSON.parse(fs.readFileSync('public/tacz/manifest.json', 'utf8'));
const ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'lmg', 'launcher'];
const kinds = Object.keys(manifest.weapons).filter((k) => !args.only || k === args.only);
if (!kinds.length) {
  console.error('manifest 里没有可截图的武器，先运行 npm run tacz:import');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
});
const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${url}/?autostart=1&nolock=1&tacz=1`, { waitUntil: 'load', timeout: 60000 });
  // 等全部模型加载完（无头浏览器很慢）
  const want = kinds.length;
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => window.__app?.view.viewmodel.taczLoaded().length ?? 0);
    if (n >= want) break;
    await sleep(1000);
  }
  const loaded = await page.evaluate(() => window.__app.view.viewmodel.taczLoaded());
  console.log('已加载：', loaded.join(', '));

  const shot = async (name) => {
    const f = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: f });
    console.log('  saved', path.relative(process.cwd(), f));
  };
  for (const kind of kinds) {
    if (!loaded.includes(kind)) {
      console.log(`✗ ${kind}：模型没加载上，看下面的控制台日志`);
      continue;
    }
    console.log(`== ${kind} (${manifest.weapons[kind].dir})`);
    // 沙盒局所有武器都解锁；按数字键切枪，等掏枪动画放完
    await page.evaluate((k, order) => {
      const app = window.__app;
      app.game.loadout[k].owned = true;
      app.game.input.select = order.indexOf(k) + 1;
    }, kind, ORDER);
    await sleep(2500);
    await shot(`${kind}-hip`);
    await page.evaluate(() => (window.__app.input.rightDown = true));
    await sleep(1800);
    await shot(`${kind}-ads`);
    await page.evaluate(() => {
      window.__app.input.rightDown = false;
      window.__app.input.mouseDown = true;
    });
    await sleep(350);
    await shot(`${kind}-fire`);
    await page.evaluate(() => (window.__app.input.mouseDown = false));
    await sleep(800);
    await page.evaluate(() => window.__app.view.viewmodel.debugPlay(window.__app.view.viewmodel.debugRole('reloadTactical')));
    await sleep(900);
    await shot(`${kind}-reload`);
    await sleep(1500);
    await page.evaluate(() => window.__app.view.viewmodel.inspect());
    await sleep(2200);
    await shot(`${kind}-inspect`);
    await sleep(3000);
  }
} finally {
  await browser.close();
  if (logs.length) console.log('--- 浏览器警告 / 错误 ---\n' + logs.join('\n'));
}
