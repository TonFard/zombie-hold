// 上线流程：npm run release（只验证，不发布）/ npm run release:publish（验证后发布）/ npm run release:republish（覆盖同版本）
// 做什么、为什么这样做，见 docs/RELEASE.md
import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const USAGE = `用法：node scripts/release.mjs [选项]
  （不带选项）  从已提交的 HEAD 导出 → 检查 → 打包 → 冒烟测试，不发布，不推送
  --publish     验证通过后发布：推送 main、打标签、建 GitHub Release、上传安装包
                （上次验证过的构建还对得上 HEAD 就直接用，不重打）
  --overwrite   和 --publish 一起用：同版本号已经发过时，删掉旧发布和旧标签再发
  --rebuild     不复用上次的构建，重新打
  --skip-checks 跳过类型检查和模拟测试（不建议）
  --skip-smoke  跳过启动安装包的冒烟测试（比如机器上正开着 Dawn）
`;

const argv = process.argv.slice(2);
const KNOWN = ['--publish', '--overwrite', '--rebuild', '--skip-checks', '--skip-smoke', '--help', '-h'];
const unknown = argv.filter((a) => !KNOWN.includes(a));
if (argv.includes('--help') || argv.includes('-h') || unknown.length) {
  if (unknown.length) console.error(`不认识的选项：${unknown.join(' ')}\n`);
  console.log(USAGE);
  process.exit(unknown.length ? 2 : 0);
}
const OPT = {
  publish: argv.includes('--publish'),
  overwrite: argv.includes('--overwrite'),
  rebuild: argv.includes('--rebuild'),
  skipChecks: argv.includes('--skip-checks'),
  skipSmoke: argv.includes('--skip-smoke'),
};
if (OPT.overwrite && !OPT.publish) {
  console.error('--overwrite 要和 --publish 一起用\n');
  process.exit(2);
}

// ---------------------------------------------------------------- 日志

const logDir = path.join(root, '.logs', 'release');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'release.log');
fs.writeFileSync(logFile, '');
const log = (s = '') => {
  const line = s ? `${new Date().toTimeString().slice(0, 8)} ${s}` : '';
  console.log(line);
  fs.appendFileSync(logFile, `${line}\n`);
};
class Fail extends Error {}
const fail = (msg) => {
  throw new Fail(msg);
};

// ---------------------------------------------------------------- 小工具

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 在 cwd 里跑一条命令，完整输出写进 .logs/release/<name>.log；返回 { status, text } */
function run(cmd, cwd, name, env = {}) {
  const file = path.join(logDir, `${name}.log`);
  const fd = fs.openSync(file, 'w');
  const r = spawnSync(cmd, { cwd, shell: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...env } });
  fs.closeSync(fd);
  return { status: r.status, text: fs.readFileSync(file, 'utf8'), file };
}

/** 一个步骤：打印开始 / 耗时 */
async function step(name, fn) {
  log(`▶ ${name}`);
  const t = Date.now();
  const r = await fn();
  log(`✔ ${name}（${((Date.now() - t) / 1000).toFixed(0)} 秒）`);
  return r;
}

// ---------------------------------------------------------------- 状态

const buildDir = path.join(os.tmpdir(), 'dawn-release-build');
const outDir = path.join(root, 'release');
const infoFile = path.join(outDir, 'build-info.json');
let version = '';
let tag = '';
let head = '';
let slug = '';
let notes = '';
let token = null;

function loadToken() {
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (env) return env.trim();
  const f = path.join(os.tmpdir(), 'gh_tok.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
}

const apiHeaders = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dawn-release' });
const gh = (method, url, body) =>
  fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    method,
    headers: { ...apiHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
/** 带认证的 git 网络操作（token 不进远端地址，也不进日志） */
function gitNet(...a) {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  try {
    return execFileSync('git', ['-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    fail(`git ${a[0]} 失败：${String(e.stderr || e.message).replaceAll(basic, '***').trim().slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- 1. 预检

async function preflight() {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  version = pkg.version;
  tag = `v${version}`;
  if (lock.version !== version || lock.packages?.['']?.version !== version) fail(`package-lock.json 的版本（${lock.version}）和 package.json（${version}）对不上`);
  if (git('branch', '--show-current') !== 'main') fail('只能在 main 分支上发布');
  head = git('rev-parse', 'HEAD');
  const m = git('remote', 'get-url', 'origin').match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!m) fail('origin 不是 GitHub 地址');
  slug = m[1];

  const notesFile = path.join(root, 'docs', 'release-notes', `${tag}.md`);
  if (!fs.existsSync(notesFile) || !fs.readFileSync(notesFile, 'utf8').trim()) fail(`缺发布说明：docs/release-notes/${tag}.md`);
  notes = fs.readFileSync(notesFile, 'utf8');
  try {
    git('ls-files', '--error-unmatch', `docs/release-notes/${tag}.md`);
  } catch {
    log(`⚠ 发布说明还没提交（docs/release-notes/${tag}.md）`);
  }

  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
  log(`版本 ${version}，HEAD ${head.slice(0, 7)}（${git('log', '-1', '--format=%s')}）`);
  log(`工作区有 ${dirty} 个未提交的文件：它们不会进安装包，只有已提交的 HEAD 会被打包`);

  if (OPT.publish) {
    token = loadToken();
    if (!token) fail('没找到 GitHub token：设环境变量 GH_TOKEN，或把 token 放进 %TEMP%\\gh_tok.txt');
    const me = await gh('GET', '/user');
    if (!me.ok) fail(`token 不能用（GET /user -> ${me.status}）`);
    const scopes = me.headers.get('x-oauth-scopes') ?? '';
    if (!/\brepo\b/.test(scopes)) fail(`token 缺少 repo 权限（现有：${scopes || '无'}）`);
    log(`GitHub 账号 ${(await me.json()).login}，仓库 ${slug}`);

    const rel = await gh('GET', `/repos/${slug}/releases/tags/${tag}`);
    const tagOnRemote = gitNet('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '';
    if ((rel.ok || tagOnRemote) && !OPT.overwrite) fail(`${tag} 已经发布过了。要覆盖请用 npm run release:republish（旧发布和旧标签会被删除）；否则先改 package.json 的版本号`);
    if (rel.ok) log(`⚠ ${tag} 已存在，将被覆盖`);
  }
}

// ---------------------------------------------------------------- 2. 导出 HEAD

function safeRemove(dir) {
  if (!fs.existsSync(dir)) return;
  if (path.basename(dir) !== 'dawn-release-build' || !path.resolve(dir).startsWith(path.resolve(os.tmpdir()))) fail(`拒绝删除 ${dir}`);
  const nm = path.join(dir, 'node_modules');
  if (fs.existsSync(nm)) {
    // node_modules 是指回仓库的链接：只摘链接，绝不递归进去删
    try {
      execSync(`cmd /c rmdir "${nm}"`, { stdio: 'ignore' });
    } catch {}
    if (fs.existsSync(nm) && fs.lstatSync(nm).isSymbolicLink()) fail(`摘不掉 ${nm} 这个链接，停下来免得误删仓库的 node_modules`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function exportHead() {
  safeRemove(buildDir);
  fs.mkdirSync(buildDir, { recursive: true });
  execSync(`git archive ${head} --format=tar | tar -xf - -C "${buildDir}"`, { stdio: 'ignore' });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(buildDir, 'node_modules'), 'junction');
  const v = readJson(path.join(buildDir, 'package.json')).version;
  if (v !== version) fail(`导出的版本（${v}）和工作区（${version}）不一致：package.json 的改动没提交？`);
}

// ---------------------------------------------------------------- 3. 检查（在导出的 HEAD 上跑，测的就是要发的）

// 类型检查不在这里：下面打包用的 npm run build 开头就是 vue-tsc --noEmit
const CHECKS = [
  ['sim:meta（存档 / 局外 / 随身武器 / 更新不清档）', 'npx tsx scripts/sims/meta.ts'],
  ['sim:extras', 'npx tsx scripts/sims/extras.ts'],
  ['sim:stats', 'npx tsx scripts/sims/stats.ts'],
  ['sim:stars', 'npx tsx scripts/sims/stars.ts'],
  ['sim:combat', 'npx tsx scripts/sims/combat.ts'],
  ['check:balance', 'npx tsx scripts/check-balance.ts'],
  ['sim:progress', 'npx tsx scripts/sims/progress.ts'],
];

function checks() {
  CHECKS.forEach(([name, cmd], i) => {
    const t = Date.now();
    const r = run(cmd, buildDir, `check-${i}`);
    const bad = r.status !== 0 || /\bFAIL\b|error TS/.test(r.text);
    log(`  ${bad ? '✘' : '✔'} ${name}（${((Date.now() - t) / 1000).toFixed(0)} 秒）`);
    if (bad) {
      const lines = r.text.split('\n').filter((l) => /FAIL|error TS|Error/.test(l)).slice(0, 8);
      fail(`${name} 没通过（完整输出：${path.relative(root, r.file)}）\n${lines.join('\n')}`);
    }
  });
}

// ---------------------------------------------------------------- 4. 打包

function build() {
  let r = run('npm run build', buildDir, 'build');
  if (r.status !== 0) fail(`npm run build 失败（${path.relative(root, r.file)}）`);
  // 用本机已装的 electron，不联网下载（国内网络下载 electron 会卡很久）
  const dist = path.join(root, 'node_modules', 'electron', 'dist').replace(/\\/g, '/');
  r = run(`npx electron-builder --win -c.electronDist="${dist}"`, buildDir, 'electron-builder', { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  if (r.status !== 0) fail(`electron-builder 失败（${path.relative(root, r.file)}）`);

  const rel = path.join(buildDir, 'release');
  const want = [`Dawn-Setup-${version}.exe`, `Dawn-Portable-${version}.exe`, `Dawn-Setup-${version}.exe.blockmap`];
  if (fs.existsSync(path.join(rel, 'latest.yml'))) want.push('latest.yml');
  const files = {};
  fs.mkdirSync(outDir, { recursive: true });
  for (const n of want) {
    const f = path.join(rel, n);
    if (!fs.existsSync(f)) fail(`没打出 ${n}`);
    const size = fs.statSync(f).size;
    if (n.endsWith('.exe') && size < 50 * 1048576) fail(`${n} 只有 ${mb(size)}，不正常`);
    fs.copyFileSync(f, path.join(outDir, n));
    files[n] = { size, sha256: sha256(path.join(outDir, n)) };
    log(`  ${n}  ${mb(size)}  sha256 ${files[n].sha256.slice(0, 12)}…`);
  }
  return files;
}

// ---------------------------------------------------------------- 5. 冒烟：启动打好的 Dawn.exe

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

function dawnRunning() {
  const out = execSync('tasklist /fi "imagename eq Dawn.exe" /fo csv /nh', { encoding: 'utf8' });
  return /Dawn\.exe/i.test(out);
}

async function smoke() {
  if (dawnRunning()) fail('机器上已经开着 Dawn.exe（单实例锁会让冒烟测试的窗口自己退出）。关掉它再试，或加 --skip-smoke');
  const exe = path.join(buildDir, 'release', 'win-unpacked', 'Dawn.exe');
  if (!fs.existsSync(exe)) fail('没找到 win-unpacked/Dawn.exe');
  const { default: puppeteer } = await import('puppeteer-core');
  const port = await freePort();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => (exited = true));
  const kill = () => {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {}
  };
  try {
    let browser = null;
    for (let i = 0; i < 40 && !browser; i++) {
      if (exited) fail('Dawn.exe 启动后自己退出了');
      await new Promise((r) => setTimeout(r, 750));
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }).catch(() => null);
    }
    if (!browser) fail('连不上 Dawn.exe 的调试端口');
    const page = (await browser.pages()).find((p) => p.url().startsWith('app://')) ?? (await browser.pages())[0];
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let body = '';
    for (let i = 0; i < 40 && !body.includes('开始生存'); i++) {
      await new Promise((r) => setTimeout(r, 500));
      body = await page.evaluate(() => document.body.innerText).catch(() => '');
    }
    await new Promise((r) => setTimeout(r, 2500));
    const title = await page.title();
    const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
    await browser.disconnect();
    log(`  页面 ${page.url()}，标题「${title}」，画布 ${canvases} 个，页面错误 ${errors.length} 个`);
    if (title !== '黎明') fail(`标题不对：${title}`);
    if (!body.includes('开始生存')) fail('主菜单没出来');
    if (canvases < 1) fail('没有游戏画布');
    if (errors.length) fail(`页面报错：${errors[0]}`);
  } finally {
    kill();
  }
}

// ---------------------------------------------------------------- 6. 上一次验证过的构建还能不能直接用

function reusableBuild() {
  if (OPT.rebuild || !fs.existsSync(infoFile)) return null;
  const info = readJson(infoFile);
  if (info.commit !== head || info.version !== version) return null;
  if (info.checks !== 'passed' && !OPT.skipChecks) return null;
  if (info.smoke !== 'passed' && !OPT.skipSmoke) return null;
  for (const [n, f] of Object.entries(info.files)) {
    const p = path.join(outDir, n);
    if (!fs.existsSync(p) || fs.statSync(p).size !== f.size || sha256(p) !== f.sha256) return null;
  }
  return info;
}

// ---------------------------------------------------------------- 7. 发布

async function publish(info) {
  const files = Object.keys(info.files);

  // 旧发布存一份，出问题好还原
  const oldRes = await gh('GET', `/repos/${slug}/releases/tags/${tag}`);
  const old = oldRes.ok ? await oldRes.json() : null;
  if (old) {
    const f = path.join(logDir, `old-${tag}.json`);
    fs.writeFileSync(f, JSON.stringify({ tagTarget: gitNet('ls-remote', 'origin', `refs/tags/${tag}^{}`), release: old }, null, 2));
    log(`  旧发布信息存到 ${path.relative(root, f)}`);
  }

  gitNet('push', 'origin', 'main');
  log('  main 已推送（普通快进，不强推）');

  if (old) {
    const d = await gh('DELETE', `/repos/${slug}/releases/${old.id}`);
    if (d.status !== 204) fail(`删旧发布失败（${d.status}）`);
    log('  旧发布已删除');
  }
  if (gitNet('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '') {
    gitNet('push', 'origin', `:refs/tags/${tag}`);
    log('  远端旧标签已删除');
  }
  try {
    git('tag', '-d', tag);
  } catch {}
  git('tag', '-a', tag, '-m', `黎明 Dawn ${tag}`, head);
  gitNet('push', 'origin', `refs/tags/${tag}`);
  log(`  标签 ${tag} → ${head.slice(0, 7)} 已推送`);

  const cr = await gh('POST', `/repos/${slug}/releases`, { tag_name: tag, name: `黎明 Dawn ${tag}`, body: notes, draft: false, prerelease: false });
  if (!cr.ok) fail(`创建发布失败：${cr.status} ${(await cr.text()).slice(0, 200)}`);
  const rel = await cr.json();
  log(`  发布已创建：${rel.html_url}`);

  for (const name of files) {
    const file = path.join(outDir, name);
    const size = info.files[name].size;
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const cur = (await (await gh('GET', `/repos/${slug}/releases/${rel.id}`)).json()).assets.find((a) => a.name === name);
      if (cur && cur.state === 'uploaded' && cur.size === size) {
        done = true;
        break;
      }
      if (cur) await gh('DELETE', `/repos/${slug}/releases/assets/${cur.id}`);
      log(`  上传 ${name}（${mb(size)}）第 ${attempt} 次`);
      try {
        const up = await fetch(`https://uploads.github.com/repos/${slug}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { ...apiHeaders(), 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
          body: fs.readFileSync(file),
          signal: AbortSignal.timeout(300000), // 以前有一次上传卡住不动，必须有超时
        });
        if (up.ok) done = true;
        else log(`    失败 ${up.status} ${(await up.text()).slice(0, 120)}`);
      } catch (e) {
        log(`    异常 ${e.name}: ${e.message}`);
      }
    }
    if (!done) fail(`${name} 上传了 3 次都没成功。发布已经建好但文件不全：${rel.html_url}（修好网络后用 npm run release:republish 重来）`);
  }
}

// ---------------------------------------------------------------- 8. 发布后核对

async function verifyPublished(info) {
  const problems = [];
  const remoteTag = gitNet('ls-remote', 'origin', `refs/tags/${tag}^{}`).split('\t')[0];
  const remoteMain = gitNet('ls-remote', 'origin', 'refs/heads/main').split('\t')[0];
  if (remoteTag !== head) problems.push(`远端标签指向 ${remoteTag.slice(0, 7)}，应为 ${head.slice(0, 7)}`);
  if (remoteMain !== head) problems.push(`远端 main 是 ${remoteMain.slice(0, 7)}，应为 ${head.slice(0, 7)}`);
  const rel = await (await gh('GET', `/repos/${slug}/releases/tags/${tag}`)).json();
  if (rel.draft) problems.push('发布还是草稿');
  for (const [n, f] of Object.entries(info.files)) {
    const a = rel.assets.find((x) => x.name === n);
    if (!a || a.state !== 'uploaded' || a.size !== f.size) problems.push(`${n} 不完整`);
  }
  const latest = await (await gh('GET', `/repos/${slug}/releases/latest`)).json();
  if (latest.tag_name !== tag) problems.push(`latest 是 ${latest.tag_name}，不是 ${tag}`);
  if (problems.length) fail(`发布后核对没通过：\n${problems.join('\n')}`);
  log(`  远端标签和 main 都在 ${head.slice(0, 7)}；${Object.keys(info.files).length} 个文件齐全，大小一致；latest = ${tag}`);
  return rel.html_url;
}

// ---------------------------------------------------------------- 主流程

const t0 = Date.now();
let ok = false;
try {
  log(`上线流程：${OPT.publish ? (OPT.overwrite ? '验证并发布（覆盖同版本）' : '验证并发布') : '只验证（不发布）'}`);
  await step('预检', preflight);

  let info = OPT.publish ? reusableBuild() : null;
  if (info) {
    log(`复用上次验证过的构建（提交 ${info.commit.slice(0, 7)}，检查 ${info.checks}，冒烟 ${info.smoke}，文件 sha256 对得上）`);
  } else {
    await step('导出已提交的 HEAD', exportHead);
    if (OPT.skipChecks) log('⚠ 跳过检查');
    else await step(`检查（${CHECKS.length} 项，在导出的 HEAD 上跑）`, checks);
    const files = await step('打包（vite build + electron-builder）', build);
    if (OPT.skipSmoke) log('⚠ 跳过冒烟测试');
    else await step('冒烟测试（启动打好的 Dawn.exe）', smoke);
    info = { version, commit: head, builtAt: new Date().toISOString(), checks: OPT.skipChecks ? 'skipped' : 'passed', smoke: OPT.skipSmoke ? 'skipped' : 'passed', files };
    fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
  }

  if (OPT.publish) {
    await step(`发布 ${tag}`, () => publish(info));
    const url = await step('核对远端', () => verifyPublished(info));
    log('');
    log(`🎉 ${tag} 已上线：${url}`);
  } else {
    log('');
    log(`验证通过。安装包在 release/，要发布请运行：npm run release:publish${'（同版本已发过就用 npm run release:republish）'}`);
  }
  ok = true;
} catch (e) {
  log('');
  log(`✘ 失败：${e instanceof Fail ? e.message : e.stack}`);
} finally {
  try {
    safeRemove(buildDir);
  } catch (e) {
    log(`⚠ 临时目录没清掉：${e.message}`);
  }
  log(`总耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟，日志 ${path.relative(root, logFile)}`);
}
process.exit(ok ? 0 : 1);
