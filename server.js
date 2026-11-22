const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, ensureReady, ConfigError, hashPassword, verifyPassword, slugify } = require('./db');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;
// Üye kaydı: SIGNUPS_OPEN=1 olmadıkça kapalı. Mevcut hesaplar /giris'ten girmeye devam eder.
const SIGNUPS_OPEN = process.env.SIGNUPS_OPEN === '1';
const AUTO_HIDE_AT = 3; // bu kadar farklı kişi bildirirse rehber incelemeye kadar gizlenir

// Yöneticiler: virgülle ayrılmış kullanıcı adları (ör. ADMIN_USERNAMES=ali,ayse)
const ADMINS = new Set(String(process.env.ADMIN_USERNAMES || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isAdminName = (name) => ADMINS.has(String(name).toLowerCase());

const CATEGORIES = [
  'Zeka & Kültür',
  'Kariyer & İş',
  'Yaşam Tarzı',
  'Sanat & Estetik',
  'Spor & Sağlık',
  'İnternet Kültürü',
  'Diğer',
];
const DIFFICULTY_LABELS = ['', 'Çocuk oyuncağı', 'Kolay', 'Orta', 'Zor', 'Method oyunculuğu'];
const REPORT_REASONS = {
  kisi: 'Gerçek bir kişiyi hedef alıyor',
  nefret: 'Nefret söylemi ya da taciz',
  zarar: 'Dolandırıcılık ya da zarar verici talimat',
  spam: 'Spam ya da reklam',
  diger: 'Diğer',
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use(async (req, res, next) => {
  // Hata sayfası erken aşamada bile render edilebilsin diye varsayılanlar
  Object.assign(res.locals, {
    user: null, csrf: '', path: req.path, title: null, ticker: [], persona, openReports: 0,
    description: null, ogType: 'website', signupsOpen: SIGNUPS_OPEN,
    baseUrl: process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`,
  });
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  await ensureReady();
  next();
});

// ---------- Çerezler, oturum, CSRF ----------
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookieOpts = (maxAgeMs) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PROD,
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

app.use(async (req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);

  // CSRF: çift gönderim (çerez + gizli form alanı)
  let csrf = req.cookies.csrf;
  if (!csrf || !/^[a-f0-9]{48}$/.test(csrf)) {
    csrf = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', csrf, cookieOpts(SESSION_DAYS * 864e5));
  }
  res.locals.csrf = csrf;

  // Ziyaretçi kimliği: hesapsız beğeniler için
  let vid = req.cookies.vid;
  if (!vid || !/^[a-f0-9]{32}$/.test(vid)) {
    vid = crypto.randomBytes(16).toString('hex');
    res.cookie('vid', vid, cookieOpts(365 * 864e5));
  }
  req.visitor = vid;

  if (req.method === 'POST') {
    const sent = String(req.body?._csrf || '');
    const ok = sent.length === csrf.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(csrf));
    if (!ok) return res.status(403).render('error', { title: 'Geçersiz istek', message: 'Form süresi dolmuş olabilir. Sayfayı yenileyip tekrar dene.' });
  }

  // Oturum
  req.user = null;
  const token = req.cookies.sid;
  if (token) {
    const row = await db.get(`SELECT u.id, u.username, u.bio FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.banned = 0`, [token, Date.now()]);
    if (row) req.user = { id: row.id, username: row.username, bio: row.bio, isAdmin: isAdminName(row.username) };
  }
  if (req.user?.isAdmin) {
    res.locals.openReports = (await db.get(
      'SELECT COUNT(DISTINCT guide_id) AS n FROM reports WHERE resolved_at IS NULL')).n;
  }
  res.locals.user = req.user;
  res.locals.CATEGORIES = CATEGORIES;
  res.locals.DIFFICULTY_LABELS = DIFFICULTY_LABELS;
  res.locals.REPORT_REASONS = REPORT_REASONS;
  res.locals.ticker = await db.all(`SELECT g.slug, g.title FROM guides g JOIN users u ON u.id = g.user_id
    WHERE ${VISIBLE} ORDER BY g.created_at DESC, g.id DESC LIMIT 10`);
  res.locals.lines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  res.locals.formatDate = (s) => new Date(String(s).replace(' ', 'T') + 'Z')
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  next();
});

// "Zeki Biri Gibi Nasıl Larplanır?" -> "Zeki Biri"
function persona(title) {
  const p = String(title).replace(/\s*(gibi\s+)?nas[ıi]l\s+larplan[ıi]r\s*\??\s*$/i, '').trim();
  return p || String(title);
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    [token, userId, Date.now() + SESSION_DAYS * 864e5]);
  res.cookie('sid', token, cookieOpts(SESSION_DAYS * 864e5));
}

function requireUser(req, res, next) {
  if (req.user) return next();
  res.redirect(`/giris?sonra=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  notFound(req, res);
}

function safeNext(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

// Basit giriş denemesi sınırı (IP başına 15 dakikada 10)
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

// ---------- Rehber sorguları ----------
const VISIBLE = 'g.hidden = 0 AND u.banned = 0';
const GUIDE_SELECT = `SELECT g.*, u.username, u.banned,
  ((SELECT COUNT(*) FROM likes l WHERE l.guide_id = g.id)
    + (SELECT COUNT(*) FROM anon_likes a WHERE a.guide_id = g.id)) AS like_count
  FROM guides g JOIN users u ON u.id = g.user_id`;

const findGuide = (slug) => db.get(`${GUIDE_SELECT} WHERE g.slug = ?`, [slug]);

async function deleteGuide(id) {
  await db.run('DELETE FROM likes WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM anon_likes WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM reports WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM guides WHERE id = ?', [id]);
}

function validateGuide(body) {
  const g = {
    title: String(body.title || '').trim(),
    category: String(body.category || ''),
    difficulty: Number(body.difficulty),
    summary: String(body.summary || '').trim(),
    kit: String(body.kit || '').trim(),
    steps: String(body.steps || '').trim(),
    phrases: String(body.phrases || '').trim(),
    risks: String(body.risks || '').trim(),
  };
  const errors = [];
  if (g.title.length < 5 || g.title.length > 120) errors.push('Başlık 5 ile 120 karakter arasında olmalı.');
  if (!CATEGORIES.includes(g.category)) errors.push('Bir kategori seç.');
  if (!(g.difficulty >= 1 && g.difficulty <= 5)) errors.push('Zorluk 1 ile 5 arasında olmalı.');
  if (g.summary.length < 20 || g.summary.length > 400) errors.push('Özet 20 ile 400 karakter arasında olmalı.');
  if (g.steps.split('\n').filter((s) => s.trim()).length < 2) errors.push('En az iki adım yaz.');
  if (['kit', 'steps', 'phrases', 'risks'].some((k) => g[k].length > 6000)) {
    errors.push('Bölümlerden biri çok uzun (en fazla 6000 karakter).');
  }
  return { g, errors };
}

// ---------- Sayfalar ----------
const PAGE_SIZE = 30;

app.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const kategori = CATEGORIES.includes(req.query.kategori) ? req.query.kategori : '';
  const sirala = req.query.sirala === 'populer' ? 'populer' : 'yeni';
  const sayfa = Math.min(Math.max(parseInt(req.query.sayfa, 10) || 1, 1), 500);

  const where = [VISIBLE];
  const params = [];
  if (q) {
    where.push('(g.title LIKE ? OR g.summary LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (kategori) {
    where.push('g.category = ?');
    params.push(kategori);
  }
  const order = sirala === 'populer' ? 'like_count DESC, g.created_at DESC, g.id DESC' : 'g.created_at DESC, g.id DESC';
  const offset = (sayfa - 1) * PAGE_SIZE;

  const [rows, stats, top] = await Promise.all([
    db.all(`${GUIDE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE + 1, offset]),
    db.get(`SELECT
      (SELECT COUNT(*) FROM guides g JOIN users u ON u.id = g.user_id WHERE ${VISIBLE}) AS guides,
      (SELECT COUNT(*) FROM users WHERE banned = 0) AS users`),
    db.all(`${GUIDE_SELECT} WHERE ${VISIBLE} ORDER BY like_count DESC, g.created_at DESC LIMIT 8`),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const guides = rows.slice(0, PAGE_SIZE);
  const personas = top.map((g) => persona(g.title));

  res.render('index', {
    title: null, guides, q, kategori, sirala, stats, personas, sayfa, hasMore, offset,
    justReported: req.query.bildirildi === '1',
  });
});

app.get('/rastgele', async (req, res) => {
  const g = await db.get(`SELECT g.slug FROM guides g JOIN users u ON u.id = g.user_id
    WHERE ${VISIBLE} ORDER BY RANDOM() LIMIT 1`);
  res.set('Cache-Control', 'no-store');
  res.redirect(g ? `/rehber/${g.slug}` : '/');
});

app.get('/rehber/:slug', async (req, res) => {
  const guide = await findGuide(req.params.slug);
  const isOwner = !!guide && req.user?.id === guide.user_id;
  const isAdmin = !!req.user?.isAdmin;
  if (!guide || ((guide.hidden || guide.banned) && !isOwner && !isAdmin)) return notFound(req, res);

  const none = Promise.resolve(null);
  const [likedRow, reportedRow, reportCount, more] = await Promise.all([
    req.user
      ? db.get('SELECT 1 AS x FROM likes WHERE user_id = ? AND guide_id = ?', [req.user.id, guide.id])
      : db.get('SELECT 1 AS x FROM anon_likes WHERE visitor = ? AND guide_id = ?', [req.visitor, guide.id]),
    req.user ? db.get('SELECT 1 AS x FROM reports WHERE user_id = ? AND guide_id = ?', [req.user.id, guide.id]) : none,
    isAdmin ? db.get('SELECT COUNT(*) AS n FROM reports WHERE guide_id = ? AND resolved_at IS NULL', [guide.id]) : none,
    db.all(`${GUIDE_SELECT} WHERE ${VISIBLE} AND g.category = ? AND g.id != ?
      ORDER BY RANDOM() LIMIT 3`, [guide.category, guide.id]),
  ]);

  res.render('guide', {
    title: guide.title, description: guide.summary, ogType: 'article',
    guide, liked: !!likedRow, reported: !!reportedRow, more, isOwner,
    guideReports: reportCount ? reportCount.n : 0,
    justReported: req.query.bildirildi === '1',
  });
});

app.get('/yaz', requireUser, (req, res) => {
  res.render('form', { title: 'Rehber yaz', g: { difficulty: 3 }, errors: [], editing: null });
});

app.post('/yaz', requireUser, async (req, res) => {
  const { g, errors } = validateGuide(req.body);
  if (errors.length) return res.status(400).render('form', { title: 'Rehber yaz', g, errors, editing: null });
  const slug = await slugify(g.title);
  await db.run(`INSERT INTO guides (slug, user_id, title, category, difficulty, summary, kit, steps, phrases, risks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [slug, req.user.id, g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks]);
  res.redirect(`/rehber/${slug}`);
});

async function loadOwned(req, res) {
  const guide = await findGuide(req.params.slug);
  if (!guide) { notFound(req, res); return null; }
  if (guide.user_id !== req.user.id && !req.user.isAdmin) {
    res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu rehberi sadece yazarı düzenleyebilir.' });
    return null;
  }
  return guide;
}

app.get('/rehber/:slug/duzenle', requireUser, async (req, res) => {
  const guide = await loadOwned(req, res);
  if (guide) res.render('form', { title: 'Rehberi düzenle', g: guide, errors: [], editing: guide });
});

app.post('/rehber/:slug/duzenle', requireUser, async (req, res) => {
  const guide = await loadOwned(req, res);
  if (!guide) return;
  const { g, errors } = validateGuide(req.body);
  if (errors.length) return res.status(400).render('form', { title: 'Rehberi düzenle', g, errors, editing: guide });
  await db.run(`UPDATE guides SET title = ?, category = ?, difficulty = ?, summary = ?, kit = ?, steps = ?,
    phrases = ?, risks = ?, updated_at = datetime('now') WHERE id = ?`,
    [g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks, guide.id]);
  res.redirect(`/rehber/${guide.slug}`);
});

app.post('/rehber/:slug/sil', requireUser, async (req, res) => {
  const guide = await loadOwned(req, res);
  if (!guide) return;
  await deleteGuide(guide.id);
  res.redirect(req.user.id === guide.user_id ? `/u/${encodeURIComponent(req.user.username)}` : '/yonetim');
});

app.post('/rehber/:slug/larpladim', async (req, res) => {
  const guide = await findGuide(req.params.slug);
  if (!guide || guide.hidden || guide.banned) return notFound(req, res);
  const [table, col, who] = req.user ? ['likes', 'user_id', req.user.id] : ['anon_likes', 'visitor', req.visitor];
  const del = await db.run(`DELETE FROM ${table} WHERE ${col} = ? AND guide_id = ?`, [who, guide.id]);
  if (del.rowsAffected === 0) await db.run(`INSERT INTO ${table} (${col}, guide_id) VALUES (?, ?)`, [who, guide.id]);
  res.redirect(`/rehber/${guide.slug}#larpladim`);
});

app.post('/rehber/:slug/bildir', requireUser, async (req, res) => {
  const guide = await findGuide(req.params.slug);
  if (!guide || guide.hidden || guide.banned) return notFound(req, res);
  if (guide.user_id === req.user.id) return res.redirect(`/rehber/${guide.slug}`);
  const reason = Object.hasOwn(REPORT_REASONS, req.body.reason) ? req.body.reason : 'diger';
  const note = String(req.body.note || '').trim().slice(0, 500);

  await db.run('INSERT OR IGNORE INTO reports (guide_id, user_id, reason, note) VALUES (?, ?, ?, ?)',
    [guide.id, req.user.id, reason, note]);
  const { n } = await db.get('SELECT COUNT(*) AS n FROM reports WHERE guide_id = ? AND resolved_at IS NULL', [guide.id]);
  if (n >= AUTO_HIDE_AT) await db.run('UPDATE guides SET hidden = 1 WHERE id = ?', [guide.id]);

  res.redirect(n >= AUTO_HIDE_AT ? '/?bildirildi=1' : `/rehber/${guide.slug}?bildirildi=1#bildir`);
});

app.get('/u/:username', async (req, res) => {
  const profile = await db.get('SELECT id, username, bio, banned, created_at FROM users WHERE username = ?', [req.params.username]);
  if (!profile || (profile.banned && !req.user?.isAdmin)) return notFound(req, res);
  const isMe = req.user?.id === profile.id;
  const guides = await db.all(`${GUIDE_SELECT} WHERE g.user_id = ? ${isMe || req.user?.isAdmin ? '' : 'AND g.hidden = 0'}
    ORDER BY g.created_at DESC`, [profile.id]);
  const likesReceived = guides.reduce((n, g) => n + Number(g.like_count), 0);
  res.render('profile', { title: '@' + profile.username, description: profile.bio || `@${profile.username} adlı larpçının rehberleri.`, profile, guides, likesReceived, isMe });
});

app.post('/profil', requireUser, async (req, res) => {
  const bio = String(req.body.bio || '').trim().slice(0, 280);
  await db.run('UPDATE users SET bio = ? WHERE id = ?', [bio, req.user.id]);
  res.redirect(`/u/${encodeURIComponent(req.user.username)}`);
});

// ---------- Yönetim ----------
app.get('/yonetim', requireAdmin, async (req, res) => {
  const reported = (await db.all(`SELECT g.id, g.slug, g.title, g.hidden, g.user_id, u.username,
      COUNT(r.id) AS report_count, MAX(r.created_at) AS last_report
    FROM reports r JOIN guides g ON g.id = r.guide_id JOIN users u ON u.id = g.user_id
    WHERE r.resolved_at IS NULL GROUP BY g.id ORDER BY report_count DESC, last_report DESC`))
    .map((g) => ({ ...g }));
  const details = reported.length ? await db.all(`SELECT r.guide_id, r.reason, r.note, r.created_at, u.username
    FROM reports r JOIN users u ON u.id = r.user_id WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC`) : [];
  for (const g of reported) g.reports = details.filter((d) => d.guide_id === g.id);

  const hidden = await db.all(`SELECT g.slug, g.title, g.id, u.username FROM guides g JOIN users u ON u.id = g.user_id
    WHERE g.hidden = 1 AND g.id NOT IN (SELECT guide_id FROM reports WHERE resolved_at IS NULL)
    ORDER BY g.updated_at DESC`);
  const banned = await db.all('SELECT id, username, created_at FROM users WHERE banned = 1 ORDER BY username');
  const totals = await db.get(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM guides) AS guides,
    (SELECT COUNT(*) FROM likes) + (SELECT COUNT(*) FROM anon_likes) AS likes`);

  res.render('admin', { title: 'Yönetim', reported, hidden, banned, totals, isAdminName });
});

app.post('/yonetim/rehber/:id/:action', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const guide = await db.get('SELECT id FROM guides WHERE id = ?', [id]);
  if (!guide) return res.redirect('/yonetim');
  switch (req.params.action) {
    case 'temiz': // bildirimleri kapat, yayına al
      await db.run(`UPDATE reports SET resolved_at = datetime('now') WHERE guide_id = ? AND resolved_at IS NULL`, [id]);
      await db.run('UPDATE guides SET hidden = 0 WHERE id = ?', [id]);
      break;
    case 'gizle':
      await db.run(`UPDATE reports SET resolved_at = datetime('now') WHERE guide_id = ? AND resolved_at IS NULL`, [id]);
      await db.run('UPDATE guides SET hidden = 1 WHERE id = ?', [id]);
      break;
    case 'sil':
      await deleteGuide(id);
      return res.redirect('/yonetim');
    default:
      return notFound(req, res);
  }
  res.redirect(safeNext(req.body.sonra) === '/' ? '/yonetim' : safeNext(req.body.sonra));
});

app.post('/yonetim/kullanici/:id/:action', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT id, username FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!target) return res.redirect('/yonetim');
  if (req.params.action === 'engelle') {
    if (target.id === req.user.id || isAdminName(target.username)) return res.redirect('/yonetim');
    await db.run('UPDATE users SET banned = 1 WHERE id = ?', [target.id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [target.id]);
    await db.run(`UPDATE reports SET resolved_at = datetime('now')
      WHERE resolved_at IS NULL AND guide_id IN (SELECT id FROM guides WHERE user_id = ?)`, [target.id]);
  } else if (req.params.action === 'kaldir') {
    await db.run('UPDATE users SET banned = 0 WHERE id = ?', [target.id]);
  } else {
    return notFound(req, res);
  }
  res.redirect('/yonetim');
});

// ---------- Üyelik ----------
function signupsClosed(req, res) {
  res.status(403).render('error', {
    title: 'Kayıtlar kapalı',
    message: 'Üyelik şimdilik kapalı. Rehberleri okumaya ve larplamaya devam edebilirsin.',
  });
}

app.get('/kayit', (req, res) => {
  if (!SIGNUPS_OPEN) return signupsClosed(req, res);
  if (req.user) return res.redirect('/');
  res.render('auth', { title: 'Üye ol', mode: 'kayit', error: null, username: '', sonra: safeNext(req.query.sonra) });
});

app.post('/kayit', async (req, res) => {
  if (!SIGNUPS_OPEN) return signupsClosed(req, res);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const sonra = safeNext(req.body.sonra);
  const fail = (error) => res.status(400).render('auth', { title: 'Üye ol', mode: 'kayit', error, username, sonra });

  if (tooManyAttempts(req.ip)) return fail('Çok fazla deneme yaptın. Biraz sonra tekrar dene.');
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)) return fail('Kullanıcı adı 3-24 karakter olmalı; harf, rakam, nokta ve alt çizgi kullanabilirsin.');
  if (password.length < 8) return fail('Şifre en az 8 karakter olmalı.');
  if (await db.get('SELECT 1 FROM users WHERE username = ?', [username])) return fail('Bu kullanıcı adı alınmış.');

  const user = await db.get('INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id',
    [username, hashPassword(password)]);
  await startSession(res, user.id);
  res.redirect(sonra === '/' ? '/yaz' : sonra);
});

app.get('/giris', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth', { title: 'Giriş yap', mode: 'giris', error: null, username: '', sonra: safeNext(req.query.sonra) });
});

app.post('/giris', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const sonra = safeNext(req.body.sonra);
  const fail = (error) => res.status(400).render('auth', { title: 'Giriş yap', mode: 'giris', error, username, sonra });

  if (tooManyAttempts(req.ip)) return fail('Çok fazla deneme yaptın. Biraz sonra tekrar dene.');
  const user = await db.get('SELECT id, password_hash, banned FROM users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) return fail('Kullanıcı adı ya da şifre yanlış.');
  if (user.banned) return fail('Bu hesap kurallara aykırı içerik nedeniyle askıya alındı.');
  await startSession(res, user.id);
  res.redirect(sonra);
});

app.post('/cikis', async (req, res) => {
  if (req.cookies.sid) await db.run('DELETE FROM sessions WHERE token = ?', [req.cookies.sid]);
  res.clearCookie('sid', cookieOpts());
  res.redirect('/');
});

app.get('/hakkinda', (req, res) => res.render('about', {
  title: 'Larp nedir?', description: 'Larp ne demek? İnternet argosunda olmadığın biri gibi davranmak. How to LARP sözlüğü ve kuralları.',
}));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /yonetim\nDisallow: /yaz\nSitemap: ${res.locals.baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res) => {
  const rows = await db.all(`SELECT g.slug, g.updated_at FROM guides g JOIN users u ON u.id = g.user_id
    WHERE ${VISIBLE} ORDER BY g.created_at DESC LIMIT 5000`);
  const base = res.locals.baseUrl;
  const urls = [`<url><loc>${base}/</loc></url>`, `<url><loc>${base}/hakkinda</loc></url>`,
    ...rows.map((r) => `<url><loc>${base}/rehber/${r.slug}</loc><lastmod>${String(r.updated_at).slice(0, 10)}</lastmod></url>`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

// ---------- Hatalar ----------
function notFound(req, res) {
  res.status(404).render('error', { title: 'Bulunamadı', message: 'Bu sayfa var gibi davranıyordu ama yokmuş.' });
}
app.use(notFound);
app.use((err, req, res, _next) => {
  console.error(err);
  // Kurulum hatalarını (eksik ortam değişkeni vb.) açıkça göster; diğerlerini gizle
  const message = err instanceof ConfigError
    ? `Kurulum hatası: ${err.message}`
    : 'Sunucu tarafında bir hata oldu.';
  res.status(500).render('error', { title: 'Bir şey bozuldu', message });
});

module.exports = app;

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => console.log(`How to LARP: http://localhost:${PORT}`));
}
