// 资产平台冒烟测试：打开 assets.html，逐个切资产 / 视图 / 光照 / 交互，截图并收集控制台错误。
// 用法：node scripts/tools/assets-check.mjs [--url http://127.0.0.1:5199/assets.html] [--gpu]
// 截图在 .logs/assets/，结果摘要打印到控制台（每个样例的校验结论、交互能否触发）。
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
}
const url = args.url ?? 'http://127.0.0.1:5199/assets.html';
const dir = path.resolve('.logs/assets');
fs.mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--window-size=1280,720', ...(args.gpu ? ['--use-angle=d3d11', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
});
const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__assets?.catalog, { timeout: 120000 });
  const shot = async (name) => {
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
    console.log('saved', name);
  };
  const ready = async () => {
    await page.waitForFunction(() => !window.__assets.ui.loading, { timeout: 60000 });
    await wait(900);
  };
  const summary = async () =>
    page.evaluate(() => {
      const A = window.__assets;
      const c = A.checks;
      return {
        id: A.ui.selected,
        v: A.ui.variant,
        tris: A.stats?.tris ?? null,
        size: A.stats?.size?.map((x) => +x.toFixed(3)) ?? null,
        errors: c.filter((x) => x.level === 'error').map((x) => `${x.title}${x.detail ? `：${x.detail}` : ''}`),
        warns: c.filter((x) => x.level === 'warn').map((x) => x.title),
        actions: A.actions.map((a) => `${a.label}[${a.available ? 'ok' : a.missing.join('/')}]`),
        error: A.ui.error,
      };
    });

  const cat = await page.evaluate(() => {
    const c = window.__assets.catalog;
    return { n: c.assets.length, samples: c.assets.filter((a) => a.file || a.variants?.some((v) => v.file)).map((a) => a.id) };
  });
  console.log(`catalog assets=${cat.n} samples=${cat.samples.join(',')}`);

  // 1. 每个样例：成品截图 + 校验摘要
  for (const id of cat.samples) {
    await page.evaluate((i) => window.__assets.select(i), id);
    await ready();
    console.log(JSON.stringify(await summary()));
    await shot(`${id}-lit`);
  }

  // 2. ATM：视图模式（白膜 / 法线贴图 / UV）+ 雨夜光照 + 切屏幕
  await page.evaluate(() => window.__assets.select('atm'));
  await ready();
  for (const v of ['clay', 'normalMap', 'uv']) {
    await page.evaluate((m) => (window.__assets.ui.view = m), v);
    await wait(500);
    await shot(`atm-${v}`);
  }
  await page.evaluate(() => {
    window.__assets.ui.view = 'lit';
    window.__assets.ui.light = 'night';
  });
  await wait(2500);
  await shot('atm-night');
  await page.evaluate(() => window.__assets.run('screen'));
  await wait(400);
  console.log('atm after run:', JSON.stringify((await summary()).actions));
  await shot('atm-night-balance');
  await page.evaluate(() => (window.__assets.ui.light = 'studio'));

  // 3. 快递柜：开 3 扇门，等动画播完；然后点视口里的门（真实鼠标点击）
  await page.evaluate(() => window.__assets.select('parcel_locker'));
  await ready();
  await page.evaluate(() => ['door:locker_01', 'door:locker_05', 'door:locker_13'].forEach((k) => window.__assets.run(k)));
  await wait(900);
  console.log('locker opened:', JSON.stringify((await page.evaluate(() => window.__assets.actions.filter((a) => a.on).map((a) => a.key)))));
  await shot('locker-open3');
  await page.evaluate(() => window.__assets.resetAll());
  await wait(300);

  // 4. 贩卖机：出货动画进行到一半时截图
  await page.evaluate(() => window.__assets.select('vending_machine'));
  await ready();
  await page.evaluate(() => window.__assets.run('buy'));
  await wait(1300);
  console.log('vending mid:', JSON.stringify((await summary()).actions));
  await shot('vending-dispense');

  // 5. 未交付的资产（占位框）+ 商品 SKU 列表
  await page.evaluate(() => window.__assets.select('drink_cooler'));
  await ready();
  console.log(JSON.stringify(await summary()));
  await shot('cooler-pending');
  await page.evaluate(() => window.__assets.select('goods_bottle'));
  await ready();
  await shot('bottle-pending');

  // 6. 真实鼠标：点视口中心（快递柜正面），看能不能点开一扇门
  await page.evaluate(() => window.__assets.select('parcel_locker'));
  await ready();
  // 把 locker_02 门板中心投影到屏幕上，用真实鼠标点它
  const box = await page.evaluate(() => window.__assets.project('locker_02'));
  console.log('locker_02 screen pos:', JSON.stringify(box));
  await page.mouse.click(box.x, box.y);
  await wait(800);
  console.log('after canvas click, open doors:', JSON.stringify(await page.evaluate(() => window.__assets.actions.filter((a) => a.on).map((a) => a.key))));
  await shot('locker-click');
  console.log('perf', JSON.stringify(await page.evaluate(() => window.__assets.perf)));
} finally {
  await browser.close();
  const bad = logs.filter((l) => /error|warn|failed/i.test(l));
  console.log('--- console (errors / warnings) ---');
  console.log(bad.length ? bad.join('\n') : '(none)');
}
