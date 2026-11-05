// 黎明 · 云存档服务：注册 / 登录 / 上传 / 下载。零依赖（Node 内置模块），数据存在 DATA_DIR 下的 JSON 文件里。
// 接口（都返回 JSON）：
//   POST /api/register  { name, password }        → { token }
//   POST /api/login     { name, password }        → { token }
//   GET  /api/save      Authorization: Bearer t   → { save, epoch, rev, updatedAt } | { save: null, rev: 0 }
//   PUT  /api/save      Authorization: Bearer t   { save, epoch, rev } → { rev, updatedAt }
//        rev 是客户端上次拿到的版本号；对不上（另一台电脑已经写过）返回 409，客户端要先重新拉取
//   GET  /api/run       Authorization: Bearer t   → { run } | { run: null }      打到一半的检查点
//   PUT  /api/run       Authorization: Bearer t   { run }  （run 为 null = 删除）
//   POST /api/logout    Authorization: Bearer t   → { ok }   作废这个 token
//   GET  /api/health                              → { ok: true }
// 游戏只在线上存档：没登录不能玩，所有进度都在这里
// 密码用 scrypt 加盐散列存储；token 是随机串，只存它的 sha256。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8092);
const DATA = process.env.DATA_DIR ?? './data';
const MAX_BODY = 1024 * 1024; // 存档几 KB，检查点二三十 KB，给足余量
const USERS = path.join(DATA, 'users.json');
const SAVES = path.join(DATA, 'saves');
fs.mkdirSync(SAVES, { recursive: true });

/** @type {Record<string, { salt: string, hash: string, tokens: string[], createdAt: number }>} */
let users = fs.existsSync(USERS) ? JSON.parse(fs.readFileSync(USERS, 'utf8')) : {};
const persistUsers = () => {
  fs.writeFileSync(USERS + '.tmp', JSON.stringify(users));
  fs.renameSync(USERS + '.tmp', USERS);
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const NAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u;

/** 简单限流：每个 IP 每分钟最多 30 次登录 / 注册，防止暴力猜密码 */
const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > 30;
};

const send = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    // 游戏从 app://game（桌面版）或开发服务器访问，跨域
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('bad json'));
      }
    });
  });

const userOf = (req) => {
  const m = /^Bearer (\w{20,})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const t = sha(m[1]);
  for (const [name, u] of Object.entries(users)) if (u.tokens.includes(t)) return name;
  return null;
};

const issueToken = (name) => {
  const token = crypto.randomBytes(24).toString('hex');
  const u = users[name];
  u.tokens = [...u.tokens.slice(-4), sha(token)]; // 最多同时 5 台设备登录
  persistUsers();
  return token;
};

const saveFile = (name) => path.join(SAVES, `${sha(name).slice(0, 32)}.json`);
const runFile = (name) => path.join(SAVES, `${sha(name).slice(0, 32)}.run.json`);
const writeAtomic = (f, data) => {
  fs.writeFileSync(f + '.tmp', JSON.stringify(data));
  fs.renameSync(f + '.tmp', f);
};
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress ?? '';
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (url.pathname === '/api/health') return send(res, 200, { ok: true });

    if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
      if (limited(ip)) return send(res, 429, { error: '操作太频繁，过一分钟再试' });
      const { name, password } = await readBody(req);
      if (typeof name !== 'string' || !NAME_RE.test(name)) return send(res, 400, { error: '用户名 2–20 个字（字母、数字、中文、_ -）' });
      if (typeof password !== 'string' || password.length < 6 || password.length > 64) return send(res, 400, { error: '密码 6–64 位' });
      if (url.pathname === '/api/register') {
        if (users[name]) return send(res, 409, { error: '用户名已被注册' });
        const salt = crypto.randomBytes(16).toString('hex');
        users[name] = { salt, hash: hashPw(password, salt), tokens: [], createdAt: Date.now() };
        return send(res, 200, { token: issueToken(name), name });
      }
      const u = users[name];
      const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
      if (!ok) return send(res, 401, { error: '用户名或密码不对' });
      return send(res, 200, { token: issueToken(name), name });
    }

    const name = url.pathname.startsWith('/api/') ? userOf(req) : null;
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      if (name) {
        const t = sha(/^Bearer (\w+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
        users[name].tokens = users[name].tokens.filter((x) => x !== t);
        persistUsers();
      }
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/save') {
      if (!name) return send(res, 401, { error: '登录已过期，请重新登录' });
      const f = saveFile(name);
      if (req.method === 'GET') {
        const rec = readJson(f);
        return send(res, 200, rec ? { rev: 1, ...rec } : { save: null, rev: 0 });
      }
      if (req.method === 'PUT') {
        const { save, epoch, rev } = await readBody(req);
        if (typeof save !== 'object' || save === null || save.version !== 2) return send(res, 400, { error: '存档格式不对' });
        const cur = readJson(f);
        const curRev = cur ? (cur.rev ?? 1) : 0;
        // 乐观锁：另一台电脑在你上次拉取之后写过，就不能直接覆盖
        if (Number.isInteger(rev) && rev !== curRev) return send(res, 409, { error: '存档在别处被更新了', rev: curRev });
        const rec = { save, epoch: Number.isInteger(epoch) ? epoch : 0, rev: curRev + 1, updatedAt: Date.now() };
        writeAtomic(f, rec);
        return send(res, 200, { rev: rec.rev, updatedAt: rec.updatedAt });
      }
    }

    if (url.pathname === '/api/run') {
      if (!name) return send(res, 401, { error: '登录已过期，请重新登录' });
      const f = runFile(name);
      if (req.method === 'GET') return send(res, 200, { run: readJson(f)?.run ?? null });
      if (req.method === 'PUT') {
        const { run } = await readBody(req);
        if (run === null) {
          if (fs.existsSync(f)) fs.unlinkSync(f);
          return send(res, 200, { ok: true });
        }
        if (typeof run !== 'string' || run.length > MAX_BODY) return send(res, 400, { error: '检查点格式不对' });
        writeAtomic(f, { run, updatedAt: Date.now() });
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : 'bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`dawn-save listening on ${PORT}, data in ${path.resolve(DATA)}`));
