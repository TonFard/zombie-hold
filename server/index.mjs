// 黎明 · 云存档服务：注册 / 登录 / 上传 / 下载。零依赖（Node 内置模块），数据存在 DATA_DIR 下的 JSON 文件里。
// 接口（都返回 JSON）：
//   POST /api/register  { name, password }        → { token }
//   POST /api/login     { name, password }        → { token }
//   GET  /api/save      Authorization: Bearer t   → { save, updatedAt } | { save: null }
//   PUT  /api/save      Authorization: Bearer t   { save, epoch } → { updatedAt }
//   GET  /api/health                              → { ok: true }
// 密码用 scrypt 加盐散列存储；token 是随机串，只存它的 sha256。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8092);
const DATA = process.env.DATA_DIR ?? './data';
const MAX_BODY = 512 * 1024; // 一份存档几 KB，给足余量
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

    if (url.pathname === '/api/save') {
      const name = userOf(req);
      if (!name) return send(res, 401, { error: '请先登录' });
      const f = saveFile(name);
      if (req.method === 'GET') {
        if (!fs.existsSync(f)) return send(res, 200, { save: null });
        return send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
      }
      if (req.method === 'PUT') {
        const { save, epoch } = await readBody(req);
        if (typeof save !== 'object' || save === null || save.version !== 2) return send(res, 400, { error: '存档格式不对' });
        // epoch：客户端的存档纪元，游戏更新后旧纪元的云存档不再下发
        const rec = { save, epoch: Number.isInteger(epoch) ? epoch : 0, updatedAt: Date.now() };
        fs.writeFileSync(f + '.tmp', JSON.stringify(rec));
        fs.renameSync(f + '.tmp', f);
        return send(res, 200, { updatedAt: rec.updatedAt });
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : 'bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`dawn-save listening on ${PORT}, data in ${path.resolve(DATA)}`));
