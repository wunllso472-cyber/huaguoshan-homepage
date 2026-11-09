#!/usr/bin/env node
/**
 * 花果山个人主页 —— 零依赖 Node 服务
 * - 公开主页：/            后台管理：/admin
 * - 数据存储：data/db.json（每次写入前自动备份到 data/backups/）
 * - 上传文件：uploads/YYYY/MM/
 *
 * 用法：
 *   node server.js                       启动（默认端口 8080，可用 PORT 环境变量修改）
 *   node server.js --set-password 新密码   设置/重置后台密码
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// 仓库自带的初始数据与素材（只读来源）
const SEED_DB_FILE = path.join(ROOT, 'data', 'db.json');
const SEED_UPLOAD_DIR = path.join(ROOT, 'uploads');
// 运行时数据目录。部署到 Render 等平台时指向持久化硬盘，否则重启后数据会丢
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || SEED_UPLOAD_DIR);
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const SESSION_DAYS = 7;
const COOKIE = 'hgs_session';
const KEEP_BACKUPS = 30;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
};

// 允许后台上传的文件类型
const UPLOAD_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif',
  '.mp4', '.m4v', '.webm', '.mov', '.mp3', '.wav', '.m4a',
  '.pdf', '.html', '.pptx', '.docx', '.xlsx', '.zip',
]);

/* ------------------------------------------------------------------ 配置与密码 */

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(pwd, stored) {
  if (typeof pwd !== 'string' || !stored) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(pwd, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function setPassword(pwd) {
  const cfg = loadConfig() || {};
  cfg.passwordHash = hashPassword(pwd);
  cfg.secret = crypto.randomBytes(32).toString('hex'); // 换密码即让所有旧登录失效
  saveConfig(cfg);
  return cfg;
}

let config = loadConfig();

/* ------------------------------------------------------------------ 会话 */

function sign(value) {
  return crypto.createHmac('sha256', config.secret).update(value).digest('base64url');
}

function makeSession() {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return `${exp}.${sign(exp)}`;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || !config) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function sessionCookie(req, value, maxAgeSec) {
  const secure = (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || req.socket.encrypted ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

// 登录失败限流：同一 IP 连续失败 5 次锁 10 分钟
const loginFails = new Map();

// 只有在反向代理后面（TRUST_PROXY=1）才信任 X-Forwarded-* 头，否则可被伪造
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
function clientIp(req) {
  const fwd = TRUST_PROXY ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || '';
}

/* ------------------------------------------------------------------ 数据 */

let db = null;
let writeChain = Promise.resolve();

function loadDb() {
  if (!fs.existsSync(DB_FILE) && DB_FILE !== SEED_DB_FILE && fs.existsSync(SEED_DB_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(SEED_DB_FILE, DB_FILE);
    console.log(`已从仓库初始数据创建 ${DB_FILE}`);
  }
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    if (fs.existsSync(DB_FILE)) {
      console.error('[错误] data/db.json 解析失败，请检查或从 data/backups/ 恢复：', e.message);
      process.exit(1);
    }
    db = { profile: {}, achievements: [] };
  }
  db.profile ||= {};
  db.achievements ||= [];
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveDb() {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(async () => {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      await fsp.copyFile(DB_FILE, path.join(BACKUP_DIR, `db-${stamp()}-${crypto.randomBytes(2).toString('hex')}.json`));
      const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.startsWith('db-')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
        await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
      }
    }
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, DB_FILE);
  });
  return writeChain;
}

/* ------------------------------------------------------------------ 输入清洗 */

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function safeUrl(v) {
  const s = str(v, 2000);
  if (!s) return '';
  if (s.startsWith('/uploads/') && !s.includes('..')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

function cleanDate(v) {
  const s = str(v, 10);
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : '';
}

function cleanAchievement(input, existing) {
  const a = {
    id: existing?.id || crypto.randomBytes(5).toString('hex'),
    title: str(input.title, 120),
    date: cleanDate(input.date),
    category: str(input.category, 20) || '其他',
    award: str(input.award, 60),
    org: str(input.org, 160),
    summary: str(input.summary, 300),
    content: str(input.content, 20000),
    tags: (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(/[,，、]/))
      .map((t) => str(t, 20)).filter(Boolean).slice(0, 12),
    cover: safeUrl(input.cover),
    images: (Array.isArray(input.images) ? input.images : [])
      .map((im) => ({ url: safeUrl(im?.url), caption: str(im?.caption, 120) }))
      .filter((im) => im.url).slice(0, 80),
    videos: (Array.isArray(input.videos) ? input.videos : [])
      .map((v) => ({ url: safeUrl(v?.url), caption: str(v?.caption, 120), poster: safeUrl(v?.poster) }))
      .filter((v) => v.url).slice(0, 10),
    links: (Array.isArray(input.links) ? input.links : [])
      .map((l) => ({ label: str(l?.label, 60), url: safeUrl(l?.url) }))
      .filter((l) => l.url).slice(0, 20),
    featured: Boolean(input.featured),
    visible: input.visible !== false,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!a.cover && a.images[0]) a.cover = a.images[0].url;
  return a;
}

function cleanProfile(p) {
  const list = (v, n, max) =>
    (Array.isArray(v) ? v : String(v || '').split(/[,，、\n]/)).map((s) => str(s, max)).filter(Boolean).slice(0, n);
  const yr = p.yearReview || {};
  return {
    name: str(p.name, 30) || '花果山',
    roles: list(p.roles, 8, 20),
    heroWords: list(p.heroWords, 8, 8),
    intro: str(p.intro, 2000),
    location: str(p.location, 40),
    avatar: safeUrl(p.avatar),
    links: (Array.isArray(p.links) ? p.links : [])
      .map((l) => ({ label: str(l?.label, 30), url: safeUrl(l?.url) }))
      .filter((l) => l.url).slice(0, 10),
    yearReview: {
      title: str(yr.title, 60),
      intro: str(yr.intro, 600),
      items: (Array.isArray(yr.items) ? yr.items : [])
        .map((it) => ({ title: str(it?.title, 40), text: str(it?.text, 800) }))
        .filter((it) => it.title || it.text).slice(0, 20),
    },
    footer: str(p.footer, 200),
  };
}

/* ------------------------------------------------------------------ 工具 */

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

const fail = (res, status, message) => send(res, status, { error: message });

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('请求格式不是合法的 JSON'), { status: 400 });
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function sortedAchievements(list) {
  return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function unusedFiles() {
  const text = JSON.stringify(db);
  const files = await walk(UPLOAD_DIR);
  const out = [];
  for (const f of files) {
    const url = '/uploads/' + path.relative(UPLOAD_DIR, f).split(path.sep).join('/');
    if (!text.includes(url)) {
      const st = await fsp.stat(f);
      out.push({ url, size: st.size });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 静态文件 */

async function serveFile(req, res, file, { isUpload = false } = {}) {
  let st;
  try {
    st = await fsp.stat(file);
    if (!st.isFile()) throw new Error();
  } catch {
    return fail(res, 404, '找不到这个文件');
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': isUpload ? 'public, max-age=86400' : 'no-cache',
  };
  if (isUpload && (ext === '.html' || ext === '.svg')) {
    // 上传的 HTML（如路演页）放进沙箱：脚本可运行，但拿不到本站 Cookie 与接口
    headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-popups allow-modals allow-downloads';
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? st.size - Number(m[2]) : Number(m[1]);
      let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
      if (start < 0) start = 0;
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return pipeline(fs.createReadStream(file, { start, end }), res).catch(() => {});
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  return pipeline(fs.createReadStream(file), res).catch(() => {});
}

function resolveInside(base, rel) {
  const target = path.resolve(base, '.' + path.sep + rel);
  return target === base || target.startsWith(base + path.sep) ? target : null;
}

/* ------------------------------------------------------------------ 接口 */

async function handleApi(req, res, pathname) {
  const method = req.method;
  const authed = isAuthed(req);

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    return fail(res, 403, '请求来源不被允许');
  }

  // 公开：站点数据
  if (pathname === '/api/site' && method === 'GET') {
    const list = sortedAchievements(db.achievements).filter((a) => authed || a.visible !== false);
    return send(res, 200, { profile: db.profile, achievements: list, authed });
  }

  if (pathname === '/api/session' && method === 'GET') {
    return send(res, 200, { authed });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    const rec = loginFails.get(ip);
    if (rec && rec.until > Date.now()) {
      const min = Math.ceil((rec.until - Date.now()) / 60000);
      return fail(res, 429, `密码错误次数过多，请 ${min} 分钟后再试`);
    }
    const body = await readJson(req);
    if (!checkPassword(body.password, config.passwordHash)) {
      const r = rec && rec.until > 0 && rec.until < Date.now() ? { count: 0, until: 0 } : rec || { count: 0, until: 0 };
      r.count += 1;
      if (r.count >= 5) {
        r.until = Date.now() + 10 * 60000;
        r.count = 0;
      }
      loginFails.set(ip, r);
      return fail(res, 401, '密码不正确');
    }
    loginFails.delete(ip);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, makeSession(), SESSION_DAYS * 86400) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // 以下全部需要登录
  if (!authed) return fail(res, 401, '登录已失效，请重新登录');

  if (pathname === '/api/achievements' && method === 'POST') {
    const a = cleanAchievement(await readJson(req));
    if (!a.title) return fail(res, 400, '请填写标题');
    if (!a.date) return fail(res, 400, '请填写日期，格式如 2026-11-05、2026-11 或 2026');
    db.achievements.push(a);
    await saveDb();
    return send(res, 201, a);
  }

  const m = /^\/api\/achievements\/([a-z0-9-]+)$/i.exec(pathname);
  if (m) {
    const idx = db.achievements.findIndex((a) => a.id === m[1]);
    if (idx < 0) return fail(res, 404, '这条成果不存在，可能已被删除');
    if (method === 'PUT') {
      const a = cleanAchievement(await readJson(req), db.achievements[idx]);
      if (!a.title) return fail(res, 400, '请填写标题');
      if (!a.date) return fail(res, 400, '请填写日期，格式如 2026-11-05、2026-11 或 2026');
      db.achievements[idx] = a;
      await saveDb();
      return send(res, 200, a);
    }
    if (method === 'DELETE') {
      const [removed] = db.achievements.splice(idx, 1);
      await saveDb();
      return send(res, 200, { ok: true, removed: removed.id });
    }
  }

  if (pathname === '/api/profile' && method === 'PUT') {
    db.profile = cleanProfile(await readJson(req));
    await saveDb();
    return send(res, 200, db.profile);
  }

  if (pathname === '/api/upload' && method === 'POST') {
    const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'file'));
    const ext = path.extname(rawName).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return fail(res, 415, `不支持 ${ext || '无扩展名'} 类型的文件`);
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_UPLOAD) return fail(res, 413, `文件超过 ${MAX_UPLOAD / 1048576}MB 上限`);
    const d = new Date();
    const sub = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(UPLOAD_DIR, ...sub.split('/'));
    await fsp.mkdir(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const file = path.join(dir, name);
    let size = 0;
    try {
      const out = fs.createWriteStream(file);
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_UPLOAD) req.destroy(new Error('too large'));
      });
      await pipeline(req, out);
    } catch {
      await fsp.unlink(file).catch(() => {});
      return fail(res, 400, '上传中断，请重试');
    }
    return send(res, 201, { url: `/uploads/${sub}/${name}`, name: rawName, size, ext });
  }

  if (pathname === '/api/files/unused' && method === 'GET') {
    return send(res, 200, { files: await unusedFiles() });
  }

  if (pathname === '/api/files/unused' && method === 'DELETE') {
    const files = await unusedFiles();
    for (const f of files) {
      const p = resolveInside(UPLOAD_DIR, f.url.slice('/uploads/'.length));
      if (p) await fsp.unlink(p).catch(() => {});
    }
    return send(res, 200, { removed: files.length, bytes: files.reduce((s, f) => s + f.size, 0) });
  }

  if (pathname === '/api/password' && method === 'POST') {
    const body = await readJson(req);
    if (!checkPassword(body.oldPassword, config.passwordHash)) return fail(res, 400, '当前密码不正确');
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) return fail(res, 400, '新密码至少 8 位');
    config = setPassword(body.newPassword);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, makeSession(), SESSION_DAYS * 86400) });
  }

  return fail(res, 404, '没有这个接口');
}

/* ------------------------------------------------------------------ 路由 */

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return fail(res, 400, '地址格式不正确');
  }

  if (pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, pathname);
    } catch (e) {
      if (!res.headersSent) return fail(res, e.status || 500, e.status ? e.message : '服务器出错了，请查看服务日志');
      console.error(e);
      return;
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '不支持的请求方式');

  if (pathname.startsWith('/uploads/')) {
    const rel = pathname.slice('/uploads/'.length);
    let file = resolveInside(UPLOAD_DIR, rel);
    // 上传目录在持久化硬盘上时，仓库自带的初始素材仍从代码目录读取，不必复制
    if (file && UPLOAD_DIR !== SEED_UPLOAD_DIR && !fs.existsSync(file)) file = resolveInside(SEED_UPLOAD_DIR, rel);
    return file ? serveFile(req, res, file, { isUpload: true }) : fail(res, 404, '找不到这个文件');
  }

  if (pathname === '/' || pathname === '/index.html') return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
  if (pathname === '/admin' || pathname === '/admin/') return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'));

  const file = resolveInside(PUBLIC_DIR, pathname.slice(1));
  return file ? serveFile(req, res, file) : fail(res, 404, '找不到这个页面');
}

/* ------------------------------------------------------------------ 启动 */

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--set-password');
  if (i >= 0) {
    const pwd = args[i + 1];
    if (!pwd || pwd.length < 8) {
      console.error('用法：node server.js --set-password 新密码（至少 8 位）');
      process.exit(1);
    }
    setPassword(pwd);
    console.log('后台密码已更新，所有旧登录已失效。');
    return;
  }

  if (!config || !config.passwordHash) {
    const pwd = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    config = setPassword(pwd);
    if (!process.env.ADMIN_PASSWORD) {
      console.log('\n========================================');
      console.log(' 首次启动，已生成后台密码：' + pwd);
      console.log(' 请登录 /admin 后在「设置」里修改。');
      console.log('========================================\n');
    }
  }

  loadDb();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  http
    .createServer((req, res) => {
      handle(req, res).catch((e) => {
        console.error(e);
        if (!res.headersSent) fail(res, 500, '服务器出错了');
      });
    })
    .listen(PORT, HOST, () => {
      console.log(`花果山主页已启动：http://localhost:${PORT}    后台：http://localhost:${PORT}/admin`);
      console.log(`数据目录：${DATA_DIR}    上传目录：${UPLOAD_DIR}`);
    });
}

main();
