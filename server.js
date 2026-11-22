const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, hashPassword, verifyPassword, slugify } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;

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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use((req, res, next) => {
  // Hata sayfası erken aşamada bile render edilebilsin diye varsayılanlar
  Object.assign(res.locals, { user: null, csrf: '', path: req.path, title: null });
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
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

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);

  // CSRF: çift gönderim (çerez + gizli form alanı)
  let csrf = req.cookies.csrf;
  if (!csrf || !/^[a-f0-9]{48}$/.test(csrf)) {
    csrf = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', csrf, cookieOpts(SESSION_DAYS * 864e5));
  }
  res.locals.csrf = csrf;

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
    const row = db.prepare(`SELECT u.id, u.username, u.bio FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
    if (row) req.user = { ...row };
  }
  res.locals.user = req.user;
  res.locals.path = req.path;
  res.locals.CATEGORIES = CATEGORIES;
  res.locals.DIFFICULTY_LABELS = DIFFICULTY_LABELS;
  res.locals.lines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  res.locals.formatDate = (s) => new Date(s.replace(' ', 'T') + 'Z')
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  next();
});

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  res.cookie('sid', token, cookieOpts(SESSION_DAYS * 864e5));
}

function requireUser(req, res, next) {
  if (req.user) return next();
  res.redirect(`/giris?sonra=${encodeURIComponent(req.originalUrl)}`);
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
const GUIDE_SELECT = `SELECT g.*, u.username,
  (SELECT COUNT(*) FROM likes l WHERE l.guide_id = g.id) AS like_count
  FROM guides g JOIN users u ON u.id = g.user_id`;

function findGuide(slug) {
  return db.prepare(`${GUIDE_SELECT} WHERE g.slug = ?`).get(slug);
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
  for (const k of ['kit', 'steps', 'phrases', 'risks']) {
    if (g[k].length > 6000) errors.push('Bölümlerden biri çok uzun (en fazla 6000 karakter).');
  }
  return { g, errors };
}

// ---------- Sayfalar ----------
app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const kategori = CATEGORIES.includes(req.query.kategori) ? req.query.kategori : '';
  const sirala = req.query.sirala === 'populer' ? 'populer' : 'yeni';

  const where = [];
  const params = [];
  if (q) {
    where.push('(g.title LIKE ? OR g.summary LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (kategori) {
    where.push('g.category = ?');
    params.push(kategori);
  }
  const order = sirala === 'populer' ? 'like_count DESC, g.created_at DESC' : 'g.created_at DESC, g.id DESC';
  const guides = db.prepare(`${GUIDE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order} LIMIT 60`).all(...params);

  const stats = db.prepare(`SELECT (SELECT COUNT(*) FROM guides) AS guides,
    (SELECT COUNT(*) FROM users) AS users`).get();

  res.render('index', { title: null, guides, q, kategori, sirala, stats });
});

app.get('/rehber/:slug', (req, res) => {
  const guide = findGuide(req.params.slug);
  if (!guide) return notFound(req, res);
  const liked = req.user
    ? !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND guide_id = ?').get(req.user.id, guide.id)
    : false;
  const more = db.prepare(`${GUIDE_SELECT} WHERE g.category = ? AND g.id != ?
    ORDER BY g.created_at DESC LIMIT 3`).all(guide.category, guide.id);
  res.render('guide', { title: guide.title, guide, liked, more, isOwner: req.user?.id === guide.user_id });
});

app.get('/yaz', requireUser, (req, res) => {
  res.render('form', { title: 'Rehber yaz', g: { difficulty: 3 }, errors: [], editing: null });
});

app.post('/yaz', requireUser, (req, res) => {
  const { g, errors } = validateGuide(req.body);
  if (errors.length) return res.status(400).render('form', { title: 'Rehber yaz', g, errors, editing: null });
  const slug = slugify(g.title);
  db.prepare(`INSERT INTO guides (slug, user_id, title, category, difficulty, summary, kit, steps, phrases, risks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(slug, req.user.id, g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks);
  res.redirect(`/rehber/${slug}`);
});

function loadOwned(req, res) {
  const guide = findGuide(req.params.slug);
  if (!guide) { notFound(req, res); return null; }
  if (guide.user_id !== req.user.id) {
    res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu rehberi sadece yazarı düzenleyebilir.' });
    return null;
  }
  return guide;
}

app.get('/rehber/:slug/duzenle', requireUser, (req, res) => {
  const guide = loadOwned(req, res);
  if (guide) res.render('form', { title: 'Rehberi düzenle', g: guide, errors: [], editing: guide });
});

app.post('/rehber/:slug/duzenle', requireUser, (req, res) => {
  const guide = loadOwned(req, res);
  if (!guide) return;
  const { g, errors } = validateGuide(req.body);
  if (errors.length) return res.status(400).render('form', { title: 'Rehberi düzenle', g, errors, editing: guide });
  db.prepare(`UPDATE guides SET title = ?, category = ?, difficulty = ?, summary = ?, kit = ?, steps = ?,
    phrases = ?, risks = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks, guide.id);
  res.redirect(`/rehber/${guide.slug}`);
});

app.post('/rehber/:slug/sil', requireUser, (req, res) => {
  const guide = loadOwned(req, res);
  if (!guide) return;
  db.prepare('DELETE FROM guides WHERE id = ?').run(guide.id);
  res.redirect(`/u/${encodeURIComponent(req.user.username)}`);
});

app.post('/rehber/:slug/larpladim', requireUser, (req, res) => {
  const guide = findGuide(req.params.slug);
  if (!guide) return notFound(req, res);
  const del = db.prepare('DELETE FROM likes WHERE user_id = ? AND guide_id = ?').run(req.user.id, guide.id);
  if (del.changes === 0) db.prepare('INSERT INTO likes (user_id, guide_id) VALUES (?, ?)').run(req.user.id, guide.id);
  res.redirect(`/rehber/${guide.slug}#larpladim`);
});

app.get('/u/:username', (req, res) => {
  const profile = db.prepare('SELECT id, username, bio, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return notFound(req, res);
  const guides = db.prepare(`${GUIDE_SELECT} WHERE g.user_id = ? ORDER BY g.created_at DESC`).all(profile.id);
  const likesReceived = guides.reduce((n, g) => n + g.like_count, 0);
  res.render('profile', { title: profile.username, profile, guides, likesReceived, isMe: req.user?.id === profile.id });
});

app.post('/profil', requireUser, (req, res) => {
  const bio = String(req.body.bio || '').trim().slice(0, 280);
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
  res.redirect(`/u/${encodeURIComponent(req.user.username)}`);
});

// ---------- Üyelik ----------
app.get('/kayit', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth', { title: 'Üye ol', mode: 'kayit', error: null, username: '', sonra: safeNext(req.query.sonra) });
});

app.post('/kayit', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const sonra = safeNext(req.body.sonra);
  const fail = (error) => res.status(400).render('auth', { title: 'Üye ol', mode: 'kayit', error, username, sonra });

  if (tooManyAttempts(req.ip)) return fail('Çok fazla deneme yaptın. Biraz sonra tekrar dene.');
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)) return fail('Kullanıcı adı 3-24 karakter olmalı; harf, rakam, nokta ve alt çizgi kullanabilirsin.');
  if (password.length < 8) return fail('Şifre en az 8 karakter olmalı.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail('Bu kullanıcı adı alınmış.');

  const user = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id')
    .get(username, hashPassword(password));
  startSession(res, user.id);
  res.redirect(sonra === '/' ? '/yaz' : sonra);
});

app.get('/giris', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth', { title: 'Giriş yap', mode: 'giris', error: null, username: '', sonra: safeNext(req.query.sonra) });
});

app.post('/giris', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const sonra = safeNext(req.body.sonra);
  const fail = (error) => res.status(400).render('auth', { title: 'Giriş yap', mode: 'giris', error, username, sonra });

  if (tooManyAttempts(req.ip)) return fail('Çok fazla deneme yaptın. Biraz sonra tekrar dene.');
  const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return fail('Kullanıcı adı ya da şifre yanlış.');
  startSession(res, user.id);
  res.redirect(sonra);
});

app.post('/cikis', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid', cookieOpts());
  res.redirect('/');
});

app.get('/hakkinda', (req, res) => res.render('about', { title: 'Larp nedir?' }));

// ---------- Hatalar ----------
function notFound(req, res) {
  res.status(404).render('error', { title: 'Bulunamadı', message: 'Bu sayfa var gibi davranıyordu ama yokmuş.' });
}
app.use(notFound);
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Bir şey bozuldu', message: 'Sunucu tarafında bir hata oldu.' });
});

// Süresi dolan oturumları temizle
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

app.listen(PORT, () => console.log(`How to LARP: http://localhost:${PORT}`));
