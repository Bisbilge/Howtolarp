const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, ensureReady, ConfigError, hashPassword, verifyPassword, slugify } = require('./db');
const { renderGuideImage } = require('./og');
const quiz = require('./quiz');
const { markEn } = require('./textcase');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;
// Üye kaydı açık; SIGNUPS_OPEN=0 ile geçici olarak kapatılabilir (mevcut hesaplar /giris'ten girmeye devam eder).
const SIGNUPS_OPEN = process.env.SIGNUPS_OPEN !== '0';
const AUTO_HIDE_AT = 3; // bu kadar farklı kişi bildirirse rehber incelemeye kadar gizlenir

// ---- Spam ve kötüye kullanım ayarları ----
const TRUST_AFTER = 2;            // bu kadar rehberi onaylanan üye "güvenilir" sayılır, onay beklemez
const MAX_PENDING = 3;            // güvenilir olmayan üyenin aynı anda onay bekleyen en fazla rehberi
const GUIDES_PER_DAY = 5;         // üye başına günlük en fazla rehber (yöneticiler hariç)
const SIGNUPS_PER_IP_DAY = 3;     // aynı bağlantıdan günde en fazla hesap
const LOGIN_PER_IP = 20;          // 15 dakikada aynı bağlantıdan en fazla giriş denemesi
const LOGIN_PER_USER = 8;         // 15 dakikada aynı kullanıcı adına en fazla giriş denemesi
// Herkesin alamayacağı kullanıcı adları
const RESERVED = new Set(['admin', 'administrator', 'yonetici', 'yonetim', 'moderator', 'mod', 'editor', 'editör',
  'howtolarp', 'how_to_larp', 'root', 'destek', 'support', 'sistem', 'system', 'resmi', 'official', 'staff']);
// Cloudflare Turnstile (isteğe bağlı): ikisi de tanımlıysa kayıt formunda "robot değilim" kutusu çıkar
const TURNSTILE_SITE_KEY = String(process.env.TURNSTILE_SITE_KEY || '').trim();
const TURNSTILE_SECRET = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
const ADMIN_SIGNUP_CODE = String(process.env.ADMIN_SIGNUP_CODE || '').trim();
const CONTACT_EMAIL = String(process.env.CONTACT_EMAIL || '').trim();
// Telegram bildirimi (isteğe bağlı): onay bekleyen rehber, bildirim, yeni istek ve yeni editör
const TG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const TG_API = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'; // testler için değiştirilebilir

async function telegram(method, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`${TG_API}/bot${TG_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}
// Hata olsa da sitenin işini bozmaz; Vercel'de yanıt dönmeden önce beklenir (en fazla 3 sn)
async function notifyAdmins(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const r = await telegram('sendMessage', { chat_id: TG_CHAT, text, disable_web_page_preview: true });
    if (!r.ok) console.error('telegram', r.description);
  } catch (e) {
    console.error('telegram gönderilemedi', e.message);
  }
}

// Yöneticiler: virgülle ayrılmış kullanıcı adları (ör. ADMIN_USERNAMES=ali,ayse)
const ADMINS = new Set(String(process.env.ADMIN_USERNAMES || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isAdminName = (name) => ADMINS.has(String(name).toLowerCase());
// Yönetim yetkisi: baş yönetici ya da editör rolü
const isStaff = (u) => !!u && (isAdminName(u.username) || u.role === 'editor');

// Editör davet kodu doğru mu? (ADMIN_SIGNUP_CODE, en az 8 karakter)
function codeMatches(code) {
  code = String(code || '');
  return ADMIN_SIGNUP_CODE.length >= 8 && code.length === ADMIN_SIGNUP_CODE.length &&
    crypto.timingSafeEqual(Buffer.from(code), Buffer.from(ADMIN_SIGNUP_CODE));
}

const CATEGORIES = [
  'Zeka & Kültür',
  'Kariyer & İş',
  'Yaşam Tarzı',
  'Sanat & Estetik',
  'Spor & Sağlık',
  'İnternet Kültürü',
  'Diğer',
];
// Kategori sayfaları: /kategori/<slug>
const CATEGORY_INFO = {
  'Zeka & Kültür': { slug: 'zeka-kultur', intro: 'Hiç okumadığın kitabı okumuş, hiç dinlemediğin dersi almış gibi görünmenin rehberleri: zeki biri, felsefe öğrencisi, tarih meraklısı, poliglot ve daha fazlası.' },
  'Kariyer & İş': { slug: 'kariyer-is', intro: 'Toplantıda bilgili, LinkedIn\'de vizyoner, takvimde hep meşgul görünmenin rehberleri: startup kurucusu, senior yazılımcı, yapay zeka uzmanı.' },
  'Yaşam Tarzı': { slug: 'yasam-tarzi', intro: 'Kahveden şaraba, minimalizmden ekşi mayaya: hayatını çözmüş, zevk sahibi biri gibi görünmenin rehberleri.' },
  'Sanat & Estetik': { slug: 'sanat-estetik', intro: 'Film eleştirmeni, çağdaş sanat meraklısı, indie müzik dinleyicisi: sanattan anlıyormuş gibi görünmenin rehberleri.' },
  'Spor & Sağlık': { slug: 'spor-saglik', intro: 'Ayda iki kez salona gidip her gün gidiyormuş gibi görünmenin rehberleri: maratoncu, futbol yorumcusu, 5 AM Club üyesi.' },
  'İnternet Kültürü': { slug: 'internet-kulturu', intro: 'Anime hayranı, profesyonel oyuncu, podcast\'i olan biri: internette bir şeyin uzmanı gibi görünmenin rehberleri.' },
  'Diğer': { slug: 'diger', intro: 'Hiçbir kutuya sığmayan roller: araba tutkunu ve topluluğun yazdığı diğer larp rehberleri.' },
};
const categoryBySlug = (slug) => Object.keys(CATEGORY_INFO).find((c) => CATEGORY_INFO[c].slug === slug);

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
    description: null, ogType: 'website', ogImage: null, jsonLd: null, noindex: false, canonical: null,
    CATEGORY_INFO, markEn, analytics: !!process.env.VERCEL_ENV, signupsOpen: SIGNUPS_OPEN, pendingCount: 0,
    turnstileKey: TURNSTILE_SECRET ? TURNSTILE_SITE_KEY : '', contactEmail: CONTACT_EMAIL,
    adminCodeEnabled: ADMIN_SIGNUP_CODE.length >= 8,
    baseUrl: process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`,
  });
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  // Hesap ve yönetim sayfaları arama motorlarında görünmesin
  if (/^\/(yonetim|hesap|rehberlerim|yaz|giris|kayit|cikis)(\/|$)/.test(req.path) || /\/duzenle$/.test(req.path)) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    'frame-src https://challenges.cloudflare.com',
    "connect-src 'self' https://challenges.cloudflare.com",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '));
  await ensureReady();
  next();
});

// ---------- Rehbere özel paylaşım görseli ----------
// Çerez middleware'inden ÖNCE: yanıtta Set-Cookie olmasın ki Vercel CDN önbelleğe alabilsin.
app.get('/og/rehber/:file', async (req, res) => {
  const slug = String(req.params.file).replace(/\.png$/, '');
  const guide = await db.get(`SELECT g.id, g.slug, g.title, g.category, g.difficulty, g.phrases, g.updated_at
    FROM guides g JOIN users u ON u.id = g.user_id WHERE g.slug = ? AND ${VISIBLE}`, [slug]);
  if (!guide) return res.redirect(302, '/og.png');
  try {
    const phrase = String(guide.phrases || '').split('\n').map((s) => s.trim().replace(/^["“”']+|["“”']+$/g, ''))
      .filter((s) => s && s.length <= 60)[0] || '';
    const png = await renderGuideImage({
      persona: persona(guide.title), category: guide.category, difficulty: guide.difficulty, number: guide.id, phrase,
    }, `${guide.slug}:${guide.updated_at}:${OG_RENDER}`);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.send(png);
  } catch (err) {
    console.error('og görseli üretilemedi', err);
    res.redirect(302, '/og.png');
  }
});
app.get('/og/test/:file', async (req, res) => {
  const key = String(req.params.file).replace(/\.png$/, '');
  const r = quiz.RESULTS[key];
  if (!r) return res.redirect(302, '/og.png');
  try {
    const png = await renderGuideImage({ persona: r.name, kicker: 'Hangi larpsın? Test sonucu', badge: 'TEST', phrase: 'Sen hangisisin? howtolarp.org/test' }, `test:${key}:${OG_RENDER}`);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.send(png);
  } catch (err) {
    console.error('test görseli üretilemedi', err);
    res.redirect(302, '/og.png');
  }
});
// Görsel tasarımı değişince OG_RENDER artırılır: önbellekteki eski görseller kullanılmasın
const OG_RENDER = 2;
const ogVersion = (g) => crypto.createHash('sha1').update(`${OG_RENDER}:${g.updated_at}`).digest('hex').slice(0, 8);

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
    const row = await db.get(`SELECT u.id, u.username, u.role FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.banned = 0`, [token, Date.now()]);
    if (row) {
      req.user = { id: row.id, username: row.username, role: row.role,
        isSuper: isAdminName(row.username), isAdmin: isStaff(row) };
    }
  }
  if (req.user?.isAdmin) {
    const c = await db.get(`SELECT
      (SELECT COUNT(DISTINCT guide_id) FROM reports WHERE resolved_at IS NULL) AS reports,
      (SELECT COUNT(*) FROM guides WHERE approved = 0) AS pending`);
    res.locals.openReports = Number(c.reports) + Number(c.pending);
    res.locals.pendingCount = Number(c.pending);
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

// ---------- Kötüye kullanım sınırları (veritabanında: Vercel'de bellek güvenilir değil) ----------
// IP adresleri açık tutulmaz, tek yönlü özet olarak saklanır ve 2 gün sonra silinir.
const ipKey = (req) => crypto.createHash('sha256').update(`howtolarp:${req.ip}`).digest('hex').slice(0, 24);

// Bu işlemi kaydet; pencere içinde sınırı aştıysa true döner
async function overLimit(key, limit, windowMs) {
  const now = Date.now();
  await db.run('INSERT INTO hits (key, at) VALUES (?, ?)', [key, now]);
  const { n } = await db.get('SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?', [key, now - windowMs]);
  if (Math.random() < 0.05) await db.run('DELETE FROM hits WHERE at < ?', [now - 2 * 864e5]);
  return Number(n) > limit;
}
const countHits = async (key, windowMs) =>
  Number((await db.get('SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?', [key, Date.now() - windowMs])).n);

// Botlar görünmeyen alanı da doldurur
const isBot = (body) => String(body?.website || '').trim() !== '';

async function turnstileOk(req) {
  if (!TURNSTILE_SECRET || !TURNSTILE_SITE_KEY) return true;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(req.body['cf-turnstile-response'] || ''), remoteip: req.ip }),
    });
    return (await r.json()).success === true;
  } catch {
    return false;
  }
}

// Üye güvenilir mi? (yöneticiler ve yeterince rehberi onaylanmış olanlar onay beklemez)
async function isTrusted(user) {
  if (user.isAdmin) return true;
  const { n } = await db.get('SELECT COUNT(*) AS n FROM guides WHERE user_id = ? AND approved = 1', [user.id]);
  return Number(n) >= TRUST_AFTER;
}

// ---------- Rehber sorguları ----------
const VISIBLE = 'g.hidden = 0 AND g.approved = 1 AND u.banned = 0';
const GUIDE_SELECT = `SELECT g.*, u.username, u.banned, u.role AS author_role,
  ((SELECT COUNT(*) FROM likes l WHERE l.guide_id = g.id)
    + (SELECT COUNT(*) FROM anon_likes a WHERE a.guide_id = g.id)) AS like_count,
  ((SELECT COUNT(*) FROM caught c WHERE c.guide_id = g.id)
    + (SELECT COUNT(*) FROM anon_caught ac WHERE ac.guide_id = g.id)) AS caught_count
  FROM guides g JOIN users u ON u.id = g.user_id`;

const findGuide = (slug) => db.get(`${GUIDE_SELECT} WHERE g.slug = ?`, [slug]);

// Yayına giren rehberi paylaşım sırasına ekle (zaten varsa dokunma)
const queueShare = async (id) => {
  await db.run('INSERT OR IGNORE INTO share_queue (guide_id) VALUES (?)', [id]);
  await fulfillRequests(id);
};
// Aynı rol için açık istek varsa "yazıldı" olarak işaretle
async function fulfillRequests(guideId) {
  const g = await db.get('SELECT slug, title FROM guides WHERE id = ?', [guideId]);
  if (g) await db.run('UPDATE requests SET done_slug = ? WHERE key = ? AND done_slug IS NULL', [g.slug, fold(persona(g.title)).trim()]);
}

// Paylaşım metinleri: Twitter (kısa + link, önizleme görseli link kartından gelir) ve Instagram (link profilde)
function shareTexts(guide, baseUrl) {
  const link = `${baseUrl}/rehber/${guide.slug}`;
  const short = guide.summary.length > 150 ? guide.summary.slice(0, 147).trim() + '…' : guide.summary;
  return {
    link,
    x: `Yeni rehber: ${guide.title}\n\n${short}\n\n${link}`,
    ig: `Yeni rehber: ${guide.title}\n\n${guide.summary}\n\nRehberin tamamı ve daha fazlası: howtolarp.org (link profilde)\n\n#howtolarp #larp #mizah`,
  };
}
const tweetIntent = (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

async function deleteGuide(id) {
  await db.run('DELETE FROM share_queue WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM likes WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM anon_likes WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM caught WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM anon_caught WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM reports WHERE guide_id = ?', [id]);
  await db.run('DELETE FROM guides WHERE id = ?', [id]);
}

// Link, web adresi ya da alan adı (spam'in asıl amacı budur)
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|co|xyz|ru|info|biz|me|tr|app|link|site|online|shop|store|club|live|top|vip|pro|gg|ly|to)\b)/i;

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
  if (Object.values(g).some((v) => LINK_RE.test(String(v)))) {
    errors.push('Rehberlerde link ya da web adresi paylaşılamaz.');
  }
  return { g, errors };
}

// ---------- Sayfalar ----------
const PAGE_SIZE = 30;

app.get('/', async (req, res) => {
  // Eski ?kategori= bağlantıları kalıcı olarak kategori sayfasına
  if (CATEGORIES.includes(req.query.kategori)) {
    const rest = new URLSearchParams(req.query); rest.delete('kategori');
    return res.redirect(301, `/kategori/${CATEGORY_INFO[req.query.kategori].slug}${rest.toString() ? '?' + rest : ''}`);
  }
  return renderList(req, res, '');
});

app.get('/kategori/:slug', async (req, res) => {
  const kategori = categoryBySlug(req.params.slug);
  if (!kategori) return notFound(req, res);
  return renderList(req, res, kategori);
});

async function renderList(req, res, kategori) {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const sirala = req.query.sirala === 'populer' ? 'populer' : 'yeni';
  const sayfa = Math.min(Math.max(parseInt(req.query.sayfa, 10) || 1, 1), 500);

  const where = [VISIBLE];
  const params = [];
  if (kategori) {
    where.push('g.category = ?');
    params.push(kategori);
  }
  const order = sirala === 'populer' ? 'like_count DESC, g.created_at DESC, g.id DESC' : 'g.created_at DESC, g.id DESC';
  const offset = (sayfa - 1) * PAGE_SIZE;

  // Arama Türkçe karakter/büyük-küçük harf duyarsız olsun diye uygulamada süzülür (SQLite LIKE sadece ASCII'yi bilir)
  const listQuery = q
    ? db.all(`${GUIDE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 3000`, params)
      .then((all) => all.filter((g) => matches(q, g.title, g.summary, g.category)).slice(offset, offset + PAGE_SIZE + 1))
    : db.all(`${GUIDE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, PAGE_SIZE + 1, offset]);
  const [rows, stats, top, requested] = await Promise.all([
    listQuery,
    db.get(`SELECT
      (SELECT COUNT(*) FROM guides g JOIN users u ON u.id = g.user_id WHERE ${VISIBLE}) AS guides,
      (SELECT COUNT(*) FROM users WHERE banned = 0 AND username != 'editor') AS users`),
    db.all(`${GUIDE_SELECT} WHERE ${VISIBLE} ORDER BY like_count DESC, g.created_at DESC LIMIT 8`),
    topRequests(6),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const guides = rows.slice(0, PAGE_SIZE);
  const personas = top.map((g) => markEn(persona(g.title)));

  const listPath = kategori ? `/kategori/${CATEGORY_INFO[kategori].slug}` : '/';
  res.render('index', {
    title: kategori ? `${kategori} larp rehberleri` : null,
    description: kategori ? CATEGORY_INFO[kategori].intro : null,
    // Arama ve sıralama sonuçları dizine girmesin; sayfalar kendi adresini göstersin
    noindex: !!q || sirala !== 'yeni',
    canonical: `${res.locals.baseUrl}${listPath}${sayfa > 1 ? `?sayfa=${sayfa}` : ''}`,
    jsonLd: !kategori && sayfa === 1 && !q ? JSON.stringify([
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'How to LARP', url: `${res.locals.baseUrl}/`, inLanguage: 'tr-TR',
        description: 'Olmadığın biri gibi davranmanın rehberleri.' },
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'How to LARP', url: `${res.locals.baseUrl}/`,
        logo: `${res.locals.baseUrl}/favicon.svg` },
    ]).replace(/</g, '\\u003c') : null,
    guides, q, kategori, sirala, stats, personas, sayfa, hasMore, offset, requested, listPath,
    justReported: req.query.bildirildi === '1',
  });
}

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
  if (!guide || ((guide.hidden || guide.banned || !guide.approved) && !isOwner && !isAdmin)) return notFound(req, res);

  const none = Promise.resolve(null);
  const [likedRow, caughtRow, reportedRow, reportCount, more] = await Promise.all([
    req.user
      ? db.get('SELECT 1 AS x FROM likes WHERE user_id = ? AND guide_id = ?', [req.user.id, guide.id])
      : db.get('SELECT 1 AS x FROM anon_likes WHERE visitor = ? AND guide_id = ?', [req.visitor, guide.id]),
    req.user
      ? db.get('SELECT 1 AS x FROM caught WHERE user_id = ? AND guide_id = ?', [req.user.id, guide.id])
      : db.get('SELECT 1 AS x FROM anon_caught WHERE visitor = ? AND guide_id = ?', [req.visitor, guide.id]),
    req.user ? db.get('SELECT 1 AS x FROM reports WHERE user_id = ? AND guide_id = ?', [req.user.id, guide.id]) : none,
    isAdmin ? db.get(`SELECT COUNT(*) AS n,
      (SELECT COUNT(*) FROM share_queue s WHERE s.guide_id = ? AND s.skipped = 0 AND (s.x_at IS NULL OR s.ig_at IS NULL)) AS queued
      FROM reports WHERE guide_id = ? AND resolved_at IS NULL`, [guide.id, guide.id]) : none,
    db.all(`${GUIDE_SELECT} WHERE ${VISIBLE} AND g.category = ? AND g.id != ?
      ORDER BY like_count DESC, g.created_at DESC LIMIT 4`, [guide.category, guide.id]),
  ]);

  const base = res.locals.baseUrl;
  const isoDate = (s) => new Date(String(s).replace(' ', 'T') + 'Z').toISOString();
  const jsonLd = (!guide.hidden && guide.approved && !guide.banned) ? JSON.stringify([
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: guide.title.slice(0, 110), description: guide.summary, inLanguage: 'tr-TR',
      image: [`${base}/og/rehber/${guide.slug}.png?v=${ogVersion(guide)}`],
      datePublished: isoDate(guide.created_at), dateModified: isoDate(guide.updated_at),
      author: { '@type': 'Person', name: guide.username },
      publisher: { '@type': 'Organization', name: 'How to LARP', url: base },
      mainEntityOfPage: `${base}/rehber/${guide.slug}`,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'How to LARP', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: guide.category, item: `${base}/kategori/${(CATEGORY_INFO[guide.category] || { slug: '' }).slug}` },
        { '@type': 'ListItem', position: 3, name: guide.title },
      ],
    },
  ]).replace(/</g, '\\u003c') : null;

  res.render('guide', {
    title: guide.title, description: guide.summary, ogType: 'article', jsonLd,
    ogImage: !guide.hidden && guide.approved && !guide.banned
      ? `${res.locals.baseUrl}/og/rehber/${guide.slug}.png?v=${ogVersion(guide)}` : null,
    guide, liked: !!likedRow, caught: !!caughtRow, reported: !!reportedRow, more, isOwner,
    guideReports: reportCount ? reportCount.n : 0,
    inShareQueue: reportCount ? Number(reportCount.queued) > 0 : false,
    justReported: req.query.bildirildi === '1',
    justSubmitted: req.query.gonderildi === '1',
    alreadyExists: req.query.varmis === '1',
  });
});

app.get('/yaz', requireUser, async (req, res) => {
  const baslik = String(req.query.baslik || '').trim().slice(0, 120);
  const [trusted, requested] = await Promise.all([isTrusted(req.user), topRequests(5)]);
  res.render('form', { noindex: true, title: 'Rehber yaz', g: { difficulty: 3, title: baslik }, errors: [], editing: null, trusted, requested });
});

app.post('/yaz', requireUser, async (req, res) => {
  const trusted = await isTrusted(req.user);
  const { g, errors } = validateGuide(req.body);
  const fail = (list) => res.status(400).render('form', { title: 'Rehber yaz', g, errors: list, editing: null, trusted, requested: [] });
  if (isBot(req.body)) return fail(['Gönderilemedi. Sayfayı yenileyip tekrar dene.']);
  if (errors.length) return fail(errors);

  if (!req.user.isAdmin) {
    const { today, pending } = await db.get(`SELECT
      (SELECT COUNT(*) FROM guides WHERE user_id = ? AND created_at > datetime('now', '-1 day')) AS today,
      (SELECT COUNT(*) FROM guides WHERE user_id = ? AND approved = 0) AS pending`, [req.user.id, req.user.id]);
    if (Number(today) >= GUIDES_PER_DAY) return fail([`Bir günde en fazla ${GUIDES_PER_DAY} rehber yazabilirsin. Yarın devam!`]);
    if (!trusted && Number(pending) >= MAX_PENDING) {
      return fail([`Onay bekleyen ${MAX_PENDING} rehberin var. Onlar incelenince yenilerini gönderebilirsin.`]);
    }
  }

  const slug = await slugify(g.title);
  await db.run(`INSERT INTO guides (slug, user_id, title, category, difficulty, summary, kit, steps, phrases, risks, approved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [slug, req.user.id, g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks, trusted ? 1 : 0]);
  if (trusted) await queueShare((await db.get('SELECT id FROM guides WHERE slug = ?', [slug])).id);
  else await notifyAdmins(`📝 Onay bekleyen yeni rehber: ${g.title}\n@${req.user.username}\n${res.locals.baseUrl}/yonetim`);
  res.redirect(`/rehber/${slug}${trusted ? '' : '?gonderildi=1'}`);
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
  if (guide) res.render('form', { title: 'Rehberi düzenle', g: guide, errors: [], editing: guide, trusted: await isTrusted(req.user) });
});

app.post('/rehber/:slug/duzenle', requireUser, async (req, res) => {
  const guide = await loadOwned(req, res);
  if (!guide) return;
  const trusted = await isTrusted(req.user);
  const { g, errors } = validateGuide(req.body);
  if (isBot(req.body)) errors.push('Gönderilemedi. Sayfayı yenileyip tekrar dene.');
  if (errors.length) return res.status(400).render('form', { title: 'Rehberi düzenle', g, errors, editing: guide, trusted });
  // Güvenilir olmayan üyenin düzenlemesi yeniden onaya düşer (onaydan sonra spam'e çevrilmesin)
  const approved = trusted || (req.user.isAdmin && guide.user_id !== req.user.id) ? guide.approved : 0;
  await db.run(`UPDATE guides SET title = ?, category = ?, difficulty = ?, summary = ?, kit = ?, steps = ?,
    phrases = ?, risks = ?, approved = ?, updated_at = datetime('now') WHERE id = ?`,
    [g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks, approved, guide.id]);
  if (!approved && guide.approved) await notifyAdmins(`✏️ Düzenlenen rehber yeniden onay bekliyor: ${g.title}\n@${req.user.username}\n${res.locals.baseUrl}/yonetim`);
  res.redirect(`/rehber/${guide.slug}${approved ? '' : '?gonderildi=1'}`);
});

app.post('/rehber/:slug/sil', requireUser, async (req, res) => {
  const guide = await loadOwned(req, res);
  if (!guide) return;
  await deleteGuide(guide.id);
  res.redirect(req.user.id === guide.user_id ? '/rehberlerim' : '/yonetim');
});

// "Larpladım" ve "Yakalandım": aynı kişi tekrar basarsa geri alınır
const REACTIONS = { larpladim: ['likes', 'anon_likes'], yakalandim: ['caught', 'anon_caught'] };
app.post(['/rehber/:slug/larpladim', '/rehber/:slug/yakalandim'], async (req, res) => {
  const guide = await findGuide(req.params.slug);
  if (!guide || guide.hidden || guide.banned || !guide.approved) return notFound(req, res);
  const [userTable, anonTable] = REACTIONS[req.path.endsWith('/yakalandim') ? 'yakalandim' : 'larpladim'];
  const [table, col, who] = req.user ? [userTable, 'user_id', req.user.id] : [anonTable, 'visitor', req.visitor];
  const del = await db.run(`DELETE FROM ${table} WHERE ${col} = ? AND guide_id = ?`, [who, guide.id]);
  if (del.rowsAffected === 0) await db.run(`INSERT INTO ${table} (${col}, guide_id) VALUES (?, ?)`, [who, guide.id]);
  res.redirect(`/rehber/${guide.slug}#larpladim`);
});

app.post('/rehber/:slug/bildir', requireUser, async (req, res) => {
  const guide = await findGuide(req.params.slug);
  if (!guide || guide.hidden || guide.banned || !guide.approved) return notFound(req, res);
  if (guide.user_id === req.user.id) return res.redirect(`/rehber/${guide.slug}`);
  const reason = Object.hasOwn(REPORT_REASONS, req.body.reason) ? req.body.reason : 'diger';
  const note = String(req.body.note || '').trim().slice(0, 500);

  await db.run('INSERT OR IGNORE INTO reports (guide_id, user_id, reason, note) VALUES (?, ?, ?, ?)',
    [guide.id, req.user.id, reason, note]);
  const { n } = await db.get('SELECT COUNT(*) AS n FROM reports WHERE guide_id = ? AND resolved_at IS NULL', [guide.id]);
  // Yönetici ve editör rehberleri bildirimle kendiliğinden gizlenmez (toplu sahte bildirime karşı)
  const autoHide = n >= AUTO_HIDE_AT && !isStaff({ username: guide.username, role: guide.author_role }) && guide.username !== 'editor';
  if (autoHide) await db.run('UPDATE guides SET hidden = 1 WHERE id = ?', [guide.id]);
  await notifyAdmins(`${autoHide ? '🚫 Rehber bildirimlerle gizlendi' : '⚠️ Rehber bildirildi'}: ${guide.title}\nSebep: ${REPORT_REASONS[reason]} · toplam ${n} bildirim\n${res.locals.baseUrl}/yonetim`);

  res.redirect(autoHide ? '/?bildirildi=1' : `/rehber/${guide.slug}?bildirildi=1#bildir`);
});

// Sosyal katman yok: herkese açık profil sayfası tutmuyoruz.
// Eski /u/... bağlantıları ana sayfaya düşer.
app.get('/u/:username', (req, res) => res.redirect(301, '/'));

// Üyenin kendi rehberleri: sadece kendisi görür
app.get('/rehberlerim', requireUser, async (req, res) => {
  const guides = await db.all(`${GUIDE_SELECT} WHERE g.user_id = ? ORDER BY g.created_at DESC`, [req.user.id]);
  res.render('mine', { title: 'Rehberlerim', guides, noindex: true });
});

// ---------- Yönetim ----------
app.get('/yonetim', requireAdmin, async (req, res) => {
  const reported = (await db.all(`SELECT g.id, g.slug, g.title, g.hidden, g.user_id, u.username, u.role,
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
  const totals = await db.get(`SELECT
    (SELECT COUNT(*) FROM users WHERE username != 'editor') AS users,
    (SELECT COUNT(*) FROM users WHERE username != 'editor' AND created_at > datetime('now', '-1 day')) AS users_today,
    (SELECT COUNT(*) FROM users WHERE username != 'editor' AND created_at > datetime('now', '-7 day')) AS users_week,
    (SELECT COUNT(*) FROM guides) AS guides,
    (SELECT COUNT(*) FROM likes) + (SELECT COUNT(*) FROM anon_likes) AS likes`);
  const newestUsers = await db.all(`${MEMBER_SELECT} WHERE u.username != 'editor' ORDER BY u.created_at DESC, u.id DESC LIMIT 10`);

  const pending = await db.all(`SELECT g.id, g.slug, g.title, g.summary, g.category, g.created_at, g.user_id, u.username, u.role,
      (SELECT COUNT(*) FROM guides x WHERE x.user_id = g.user_id AND x.approved = 1) AS author_approved
    FROM guides g JOIN users u ON u.id = g.user_id
    WHERE g.approved = 0 AND u.banned = 0 ORDER BY g.created_at ASC LIMIT 100`);

  const editors = await db.all(`SELECT id, username, created_at FROM users WHERE role = 'editor' ORDER BY username`);
  const canBan = (u) => !isAdminName(u.username) && (req.user.isSuper || u.role !== 'editor');

  // Rehber arama (tüm rehberler: yayında, bekleyen, gizli)
  const q = String(req.query.q || '').trim().slice(0, 80);
  const found = q ? (await db.all(`SELECT g.slug, g.title, g.category, g.approved, g.hidden, u.username FROM guides g
      JOIN users u ON u.id = g.user_id ORDER BY g.created_at DESC LIMIT 2000`))
    .filter((g) => matches(q, g.title, g.category, g.username)).slice(0, 50) : null;

  // Paylaşılacaklar: en az bir platformda paylaşılmamış, atlanmamış, yayında olan rehberler (eskiden yeniye)
  const shares = (await db.all(`SELECT s.guide_id, s.x_at, s.ig_at, s.queued_at, g.slug, g.title, g.summary, g.category
    FROM share_queue s JOIN guides g ON g.id = s.guide_id JOIN users u ON u.id = g.user_id
    WHERE s.skipped = 0 AND (s.x_at IS NULL OR s.ig_at IS NULL) AND ${VISIBLE}
    ORDER BY s.queued_at ASC LIMIT 50`)).map((r) => {
    const t = shareTexts(r, res.locals.baseUrl);
    return { ...r, tweetUrl: tweetIntent(t.x) };
  });

  const tg = { token: !!TG_TOKEN, chat: !!TG_CHAT, msg: String(req.query.tg || '').slice(0, 500) };
  res.render('admin', { title: 'Yönetim', reported, hidden, banned, totals, pending, editors, canBan, isAdminName, TRUST_AFTER, q, found, shares, tg, newestUsers });
});

// ---------- Yedek (sadece baş yönetici) ----------
// Oturumlar ve geçici sınır kayıtları hariç tüm tablolar tek JSON dosyası olarak iner.
// Geri yükleme: node scripts/geri-yukle.js <dosya>  (README'ye bakın)
const BACKUP_TABLES = ['users', 'guides', 'likes', 'anon_likes', 'caught', 'anon_caught', 'reports', 'seeded', 'share_queue', 'requests', 'request_votes'];
app.get('/yonetim/yedek', requireAdmin, async (req, res) => {
  if (!req.user.isSuper) return notFound(req, res);
  const tables = {};
  for (const t of BACKUP_TABLES) {
    const r = await db.run(`SELECT * FROM ${t}`);
    tables[t] = r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="howtolarp-yedek-${stamp}.json"`);
  res.set('Cache-Control', 'no-store');
  res.send(JSON.stringify({ app: 'howtolarp', format: 1, created_at: new Date().toISOString(), tables }));
});

// Türkçe karakter ve büyük/küçük harf duyarsız arama için sadeleştirme ("Çağdaş" ~ "cagdas")
const TR_FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
const fold = (t) => String(t || '').toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => TR_FOLD[c])
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const matches = (q, ...fields) => { const f = fold(q).trim(); return !f || fields.some((x) => fold(x).includes(f)); };

// Görsel oluşturucu: Instagram gönderi (1080x1350), Instagram hikaye (1080x1920), Twitter/X (1600x900)
const IMAGE_FORMATS = ['post', 'story', 'x'];
// Eski adres yeni sayfaya yönlenir
app.get('/yonetim/instagram', requireAdmin, (req, res) =>
  res.redirect(301, '/yonetim/gorsel' + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '')));
app.get('/yonetim/gorsel', requireAdmin, async (req, res) => {
  const all = await db.all(`SELECT g.slug, g.title, g.category, g.created_at FROM guides g JOIN users u ON u.id = g.user_id
    WHERE ${VISIBLE} ORDER BY g.created_at DESC, g.id DESC LIMIT 2000`);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const list = all.filter((g) => matches(q, g.title, g.category)).map((g) => ({ ...g, key: fold(`${g.title} ${g.category}`) }));
  const slug = String(req.query.rehber || list[0]?.slug || all[0]?.slug || '');
  const guide = slug ? await findGuide(slug) : null;
  const format = IMAGE_FORMATS.includes(req.query.format) ? req.query.format : 'post';
  const texts = guide ? shareTexts(guide, res.locals.baseUrl) : null;
  const share = guide ? await db.get('SELECT x_at, ig_at, skipped FROM share_queue WHERE guide_id = ?', [guide.id]) : null;
  res.render('gorsel', { title: 'Görsel oluştur', list, guide, format, q, texts, share,
    tweetUrl: texts ? tweetIntent(texts.x) : null });
});

// ---------- Üyeler ----------
const MEMBER_SELECT = `SELECT u.id, u.username, u.role, u.banned, u.created_at,
  (SELECT COUNT(*) FROM guides g WHERE g.user_id = u.id) AS guide_count,
  (SELECT COUNT(*) FROM guides g WHERE g.user_id = u.id AND g.approved = 1) AS approved_count
  FROM users u`;
app.get('/yonetim/uyeler', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  const sayfa = Math.min(Math.max(parseInt(req.query.sayfa, 10) || 1, 1), 1000);
  const per = 50;
  const all = await db.all(`${MEMBER_SELECT} WHERE u.username != 'editor' ORDER BY u.created_at DESC, u.id DESC LIMIT 5000`);
  const filtered = q ? all.filter((u) => matches(q, u.username)) : all;
  const members = filtered.slice((sayfa - 1) * per, sayfa * per);
  res.render('members', { title: 'Üyeler', members, q, sayfa, total: filtered.length, hasMore: filtered.length > sayfa * per,
    canBan: (u) => !isAdminName(u.username) && (req.user.isSuper || u.role !== 'editor'), isAdminName, TRUST_AFTER });
});

// Telegram kurulumu (sadece baş yönetici)
app.post('/yonetim/telegram/:action', requireAdmin, async (req, res) => {
  if (!req.user.isSuper) return notFound(req, res);
  let msg;
  try {
    if (!TG_TOKEN) msg = 'TELEGRAM_BOT_TOKEN tanımlı değil.';
    else if (req.params.action === 'test') {
      if (!TG_CHAT) msg = 'TELEGRAM_CHAT_ID tanımlı değil. Önce "Sohbet kimliğini bul"u kullan.';
      else {
        const r = await telegram('sendMessage', { chat_id: TG_CHAT, text: '✅ How to LARP bildirimleri çalışıyor.' });
        msg = r.ok ? 'Test mesajı gönderildi, Telegram\'a bak.' : `Gönderilemedi: ${r.description}`;
      }
    } else if (req.params.action === 'bul') {
      const r = await telegram('getUpdates', {});
      if (!r.ok) msg = `Telegram hatası: ${r.description}`;
      else {
        const chats = new Map();
        for (const u of r.result || []) {
          const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
          if (c) chats.set(String(c.id), c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '');
        }
        msg = chats.size
          ? 'Bulunan sohbetler: ' + [...chats].map(([id, name]) => `${name} → ${id}`).join(' · ') + '. Bu numarayı TELEGRAM_CHAT_ID olarak gir.'
          : 'Sohbet bulunamadı. Telegram\'da botuna bir mesaj yaz (ör. "merhaba"), sonra tekrar dene.';
      }
    } else return notFound(req, res);
  } catch (e) {
    msg = `Telegram'a ulaşılamadı: ${e.message}`;
  }
  res.redirect(`/yonetim?tg=${encodeURIComponent(msg)}#telegram`);
});

// Paylaşım sırası işlemleri: x / ig (paylaşıldı), atla, ekle (sıraya al), geri (işaretleri kaldır)
app.post('/yonetim/paylasim/:id/:action', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const sql = {
    x: `INSERT INTO share_queue (guide_id, x_at) VALUES (?, datetime('now'))
      ON CONFLICT(guide_id) DO UPDATE SET x_at = datetime('now')`,
    ig: `INSERT INTO share_queue (guide_id, ig_at) VALUES (?, datetime('now'))
      ON CONFLICT(guide_id) DO UPDATE SET ig_at = datetime('now')`,
    atla: 'UPDATE share_queue SET skipped = 1 WHERE guide_id = ?',
    geri: 'UPDATE share_queue SET x_at = NULL, ig_at = NULL, skipped = 0 WHERE guide_id = ?',
  }[req.params.action];
  if (req.params.action === 'ekle') {
    await db.run(`INSERT INTO share_queue (guide_id) VALUES (?)
      ON CONFLICT(guide_id) DO UPDATE SET x_at = NULL, ig_at = NULL, skipped = 0, queued_at = datetime('now')`, [id]);
  } else if (sql) {
    await db.run(sql, [id]);
  } else {
    return notFound(req, res);
  }
  const back = safeNext(req.body.sonra);
  res.redirect(back === '/' ? '/yonetim#paylasilacaklar' : back);
});

app.post('/yonetim/rehber/:id/:action', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const guide = await db.get('SELECT id FROM guides WHERE id = ?', [id]);
  if (!guide) return res.redirect('/yonetim');
  switch (req.params.action) {
    case 'onayla':
      await db.run('UPDATE guides SET approved = 1 WHERE id = ?', [id]);
      await queueShare(id);
      break;
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
  const target = await db.get('SELECT id, username, role FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!target) return res.redirect('/yonetim');
  if (req.params.action === 'yetki-al') {
    // Sadece baş yönetici editörlüğü geri alabilir
    if (!req.user.isSuper) return notFound(req, res);
    await db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [target.id]);
    return res.redirect('/yonetim');
  }
  if (req.params.action === 'engelle') {
    // Baş yönetici engellenemez; editörü sadece baş yönetici engelleyebilir
    if (target.id === req.user.id || isAdminName(target.username)) return res.redirect('/yonetim');
    if (target.role === 'editor' && !req.user.isSuper) return res.redirect('/yonetim');
    await db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [target.id]);
    await db.run('UPDATE users SET banned = 1 WHERE id = ?', [target.id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [target.id]);
    await db.run(`UPDATE reports SET resolved_at = datetime('now')
      WHERE resolved_at IS NULL AND guide_id IN (SELECT id FROM guides WHERE user_id = ?)`, [target.id]);
    // Onay bekleyen rehberleri kuyruktan temizlensin
    await db.run('DELETE FROM guides WHERE user_id = ? AND approved = 0', [target.id]);
  } else if (req.params.action === 'kaldir') {
    await db.run('UPDATE users SET banned = 0 WHERE id = ?', [target.id]);
  } else {
    return notFound(req, res);
  }
  res.redirect(safeNext(req.body.sonra) === '/' ? '/yonetim' : safeNext(req.body.sonra));
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
  res.render('auth', { noindex: true, title: 'Üye ol', mode: 'kayit', error: null, username: '', sonra: safeNext(req.query.sonra) });
});

// Kullanıcı adı korumalı mı? (yönetici adları ve "admin", "editor" gibi resmi görünen adlar)
const isReserved = (name) => {
  const n = String(name).toLowerCase();
  return RESERVED.has(n) || RESERVED.has(n.replace(/[._\d]/g, '')) || isAdminName(n);
};

app.post('/kayit', async (req, res) => {
  if (!SIGNUPS_OPEN) return signupsClosed(req, res);
  if (req.user) return res.redirect('/');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const sonra = safeNext(req.body.sonra);
  const fail = (error) => res.status(400).render('auth', { title: 'Üye ol', mode: 'kayit', error, username, sonra });

  if (isBot(req.body)) return fail('Kayıt tamamlanamadı. Sayfayı yenileyip tekrar dene.');
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)) return fail('Kullanıcı adı 3-24 karakter olmalı; harf, rakam, nokta ve alt çizgi kullanabilirsin.');
  if (password.length < 8) return fail('Şifre en az 8 karakter olmalı.');
  if (password.toLowerCase() === username.toLowerCase()) return fail('Şifre kullanıcı adınla aynı olamaz.');
  if (req.body.kabul !== '1') return fail('Üye olmak için kuralları ve gizlilik metnini kabul etmelisin.');
  if (await db.get('SELECT 1 FROM users WHERE username = ?', [username])) return fail('Bu kullanıcı adı alınmış.');

  // Editör davet kodu: doğruysa hesap editör olarak açılır. Yanlış denemeler günde 5 ile sınırlı.
  const code = String(req.body.admin_code || '').trim();
  let codeOk = false;
  if (code) {
    if (await overLimit(`code:${ipKey(req)}`, 5, 864e5)) return fail('Çok fazla kod denemesi yapıldı. Yarın tekrar dene.');
    codeOk = codeMatches(code);
    if (!codeOk) return fail('Editör kodu yanlış. Kodun yoksa o alanı boş bırak.');
  }
  // Yönetici adları sadece kodla, diğer korumalı adlar hiç alınamaz
  if (isReserved(username) && !(isAdminName(username) && codeOk)) {
    return fail('Bu kullanıcı adı alınamaz. Başka bir ad dene.');
  }
  if (!(await turnstileOk(req))) return fail('Robot olmadığını doğrulayamadık. Kutucuğu işaretleyip tekrar dene.');
  if (await overLimit(`signup:${ipKey(req)}`, SIGNUPS_PER_IP_DAY, 864e5)) {
    return fail('Bu bağlantıdan bugün çok fazla hesap açıldı. Yarın tekrar dene.');
  }

  const user = await db.get('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id',
    [username, hashPassword(password), codeOk ? 'editor' : 'user']);
  await startSession(res, user.id);
  if (codeOk) await notifyAdmins(`🎭 Yeni editör katıldı: @${username}`);
  res.redirect(codeOk ? '/yonetim' : (sonra === '/' ? '/yaz' : sonra));
});

app.get('/giris', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth', { noindex: true, title: 'Giriş yap', mode: 'giris', error: null, username: '', sonra: safeNext(req.query.sonra) });
});

app.post('/giris', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const sonra = safeNext(req.body.sonra);
  const fail = (error) => res.status(400).render('auth', { title: 'Giriş yap', mode: 'giris', error, username, sonra });

  if (isBot(req.body)) return fail('Giriş yapılamadı. Sayfayı yenileyip tekrar dene.');
  if (!(await turnstileOk(req))) return fail('Robot olmadığını doğrulayamadık. Kutucuğu işaretleyip tekrar dene.');
  const window = 15 * 60e3;
  if (await countHits(`login:${ipKey(req)}`, window) >= LOGIN_PER_IP ||
      await countHits(`login-user:${username.toLowerCase()}`, window) >= LOGIN_PER_USER) {
    return fail('Çok fazla hatalı deneme yapıldı. 15 dakika sonra tekrar dene.');
  }
  const user = await db.get('SELECT id, password_hash, banned FROM users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    // Sadece hatalı denemeler sayılır
    await overLimit(`login:${ipKey(req)}`, LOGIN_PER_IP, window);
    await overLimit(`login-user:${username.toLowerCase()}`, LOGIN_PER_USER, window);
    return fail('Kullanıcı adı ya da şifre yanlış.');
  }
  if (user.banned) return fail('Bu hesap kurallara aykırı içerik nedeniyle askıya alındı.');
  await startSession(res, user.id);
  res.redirect(sonra);
});

app.post('/cikis', async (req, res) => {
  if (req.cookies.sid) await db.run('DELETE FROM sessions WHERE token = ?', [req.cookies.sid]);
  res.clearCookie('sid', cookieOpts());
  res.redirect('/');
});

// ---------- Hesap ayarları ----------
app.get('/hesap', requireUser, (req, res) => {
  res.render('account', { noindex: true, title: 'Hesap ayarları', msg: req.query.ok === '1' ? 'Şifren değişti.' : null, error: null });
});

app.post('/hesap/sifre', requireUser, async (req, res) => {
  const fail = (error) => res.status(400).render('account', { title: 'Hesap ayarları', msg: null, error });
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (await countHits(`pw:${req.user.id}`, 15 * 60e3) >= LOGIN_PER_USER) return fail('Çok fazla deneme. 15 dakika sonra tekrar dene.');
  if (!verifyPassword(current, user.password_hash)) {
    await overLimit(`pw:${req.user.id}`, LOGIN_PER_USER, 15 * 60e3);
    return fail('Mevcut şifren yanlış.');
  }
  if (next.length < 8) return fail('Yeni şifre en az 8 karakter olmalı.');
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(next), req.user.id]);
  // Diğer cihazlardaki oturumları kapat, bu cihazda yeni oturum aç
  await db.run('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
  await startSession(res, req.user.id);
  res.redirect('/hesap?ok=1');
});

// Var olan hesaba editör kodu girme
app.post('/hesap/kod', requireUser, async (req, res) => {
  const fail = (error) => res.status(400).render('account', { title: 'Hesap ayarları', msg: null, error });
  if (req.user.isAdmin) return res.redirect('/yonetim');
  if (await overLimit(`code:${ipKey(req)}`, 5, 864e5)) return fail('Çok fazla kod denemesi yapıldı. Yarın tekrar dene.');
  if (!codeMatches(String(req.body.code || '').trim())) return fail('Editör kodu yanlış.');
  await db.run(`UPDATE users SET role = 'editor' WHERE id = ?`, [req.user.id]);
  await notifyAdmins(`🎭 Yeni editör katıldı: @${req.user.username}`);
  res.redirect('/yonetim');
});

app.post('/hesap/sil', requireUser, async (req, res) => {
  const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (req.body.onay !== 'SİL' || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return res.status(400).render('account', { title: 'Hesap ayarları', msg: null,
      error: 'Hesabı silmek için şifreni ve onay kutusuna büyük harflerle SİL yazmalısın.' });
  }
  const id = req.user.id;
  for (const g of await db.all('SELECT id FROM guides WHERE user_id = ?', [id])) await deleteGuide(g.id);
  await db.run('DELETE FROM likes WHERE user_id = ?', [id]);
  await db.run('DELETE FROM reports WHERE user_id = ?', [id]);
  await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  await db.run('DELETE FROM users WHERE id = ?', [id]);
  res.clearCookie('sid', cookieOpts());
  res.render('error', { title: 'Hesabın silindi', message: 'Hesabın ve yazdığın tüm rehberler kalıcı olarak silindi. Sahne seni özleyecek.', user: null });
});

app.get('/kurallar', (req, res) => res.render('rules', {
  title: 'Kurallar ve gizlilik', description: 'How to LARP topluluk kuralları ve gizlilik metni.',
}));

// ---------- Rehber istekleri ----------
const voterId = (req) => (req.user ? `u:${req.user.id}` : `v:${req.visitor}`);
function topRequests(limit) {
  return db.all(`SELECT r.id, r.text, (SELECT COUNT(*) FROM request_votes v WHERE v.request_id = r.id) AS votes
    FROM requests r WHERE r.hidden = 0 AND r.done_slug IS NULL ORDER BY votes DESC, r.created_at DESC LIMIT ?`, [limit]);
}
// "Şair Gibi Nasıl Larplanır?" ya da "şair" -> "Şair"
function cleanRequest(t) {
  const p = persona(String(t || '').replace(/\s+/g, ' ').trim());
  return p ? p.charAt(0).toLocaleUpperCase('tr') + p.slice(1) : '';
}

app.get('/istekler', async (req, res) => {
  const [open, done, myVotes] = await Promise.all([
    db.all(`SELECT r.id, r.text, r.created_at, (SELECT COUNT(*) FROM request_votes v WHERE v.request_id = r.id) AS votes
      FROM requests r WHERE r.hidden = 0 AND r.done_slug IS NULL ORDER BY votes DESC, r.created_at DESC LIMIT 100`),
    db.all(`SELECT r.text, r.done_slug FROM requests r JOIN guides g ON g.slug = r.done_slug JOIN users u ON u.id = g.user_id
      WHERE r.hidden = 0 AND ${VISIBLE} ORDER BY g.created_at DESC LIMIT 12`),
    db.all('SELECT request_id FROM request_votes WHERE voter = ?', [voterId(req)]),
  ]);
  const voted = new Set(myVotes.map((v) => Number(v.request_id)));
  res.render('requests', {
    title: 'Rehber istekleri', description: 'Hangi rolün rehberi yazılsın? Öner, oy ver ya da kendin yaz.',
    open, done, voted, error: null, text: '', added: req.query.eklendi === '1',
  });
});

app.post('/istekler', async (req, res) => {
  const text = cleanRequest(req.body.text);
  const fail = async (error) => {
    const open = await topRequests(100);
    res.status(400).render('requests', { title: 'Rehber istekleri', open, done: [], voted: new Set(), error, text, added: false });
  };
  if (isBot(req.body)) return fail('Gönderilemedi. Sayfayı yenileyip tekrar dene.');
  if (text.length < 3 || text.length > 60) return fail('Rol adı 3 ile 60 karakter arasında olmalı (ör. "Şarap uzmanı").');
  if (LINK_RE.test(text)) return fail('Link ya da web adresi yazılamaz.');
  const key = fold(text).trim();

  let row = await db.get('SELECT id, hidden, done_slug FROM requests WHERE key = ?', [key]);
  if (row && row.done_slug) return res.redirect(`/rehber/${row.done_slug}`); // zaten yazılmış
  // Bu rolün rehberi zaten varsa isteğe gerek yok: rehbere götür
  const existing = (await db.all(`SELECT g.slug, g.title FROM guides g JOIN users u ON u.id = g.user_id WHERE ${VISIBLE}`))
    .find((g) => fold(persona(g.title)).trim() === key);
  if (existing) return res.redirect(`/rehber/${existing.slug}?varmis=1`);
  if (!row) {
    if (await overLimit(`istek:${ipKey(req)}`, 5, 864e5)) return fail('Bugün yeterince öneri yaptın. Yarın tekrar gel!');
    row = await db.get('INSERT INTO requests (text, key) VALUES (?, ?) RETURNING id, hidden', [text, key]);
    await notifyAdmins(`💡 Yeni rehber isteği: ${text}`);
  }
  await db.run('INSERT OR IGNORE INTO request_votes (request_id, voter) VALUES (?, ?)', [row.id, voterId(req)]);
  res.redirect(`/istekler?eklendi=1#istek-${row.id}`);
});

app.post('/istekler/:id/oy', async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.get('SELECT id FROM requests WHERE id = ? AND hidden = 0 AND done_slug IS NULL', [id]);
  if (!r) return res.redirect('/istekler');
  const del = await db.run('DELETE FROM request_votes WHERE request_id = ? AND voter = ?', [id, voterId(req)]);
  if (del.rowsAffected === 0) await db.run('INSERT INTO request_votes (request_id, voter) VALUES (?, ?)', [id, voterId(req)]);
  res.redirect(`/istekler#istek-${id}`);
});

app.post('/istekler/:id/gizle', requireAdmin, async (req, res) => {
  await db.run('UPDATE requests SET hidden = 1 WHERE id = ?', [Number(req.params.id)]);
  res.redirect('/istekler');
});

// ---------- "Hangi larpsın?" testi ----------
app.get('/test', (req, res) => res.render('test', {
  title: 'Hangi larpsın?', description: '6 soruda hangi rolü larpladığını bul. Sonucunu paylaş, arkadaşların da çözsün.',
  questions: quiz.QUESTIONS,
}));

app.get('/test/sonuc', (req, res) => {
  const answers = quiz.QUESTIONS.map((_, i) => Number(req.query[`s${i + 1}`]));
  if (answers.some((a) => !(a >= 0 && a <= 3))) return res.redirect('/test');
  res.redirect(`/test/sonuc/${quiz.score(answers)}`);
});

app.get('/test/sonuc/:key', async (req, res) => {
  const r = quiz.RESULTS[req.params.key];
  if (!r) return notFound(req, res);
  const placeholders = r.titles.map(() => '?').join(', ');
  const guide = await db.get(`SELECT g.slug, g.title FROM guides g JOIN users u ON u.id = g.user_id
    WHERE ${VISIBLE} AND g.title IN (${placeholders}) LIMIT 1`, r.titles);
  const url = `${res.locals.baseUrl}/test/sonuc/${req.params.key}`;
  const shareText = `"Hangi larpsın?" testinde ${r.name} çıktım 😅 Sen hangisisin?`;
  res.render('test-result', {
    title: `${r.name} larpçısısın`, description: r.line, result: r, key: req.params.key, guide, noindex: true,
    ogImage: `${res.locals.baseUrl}/og/test/${req.params.key}.png?v=${OG_RENDER}`,
    tweetUrl: tweetIntent(`${shareText}\n\n${url}`),
    waUrl: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`,
    shareUrl: url,
  });
});

// "Larp ne demek?" sözlük sayfası (eski /hakkinda adresi buraya yönlenir)
const LARP_FAQ = [
  { q: 'LARP neyin kısaltması?', a: 'İngilizce live action role-playing, yani "canlı rol yapma oyunu" ifadesinin kısaltması. Oyuncuların kostümle bir karakteri gerçek mekanda canlandırdığı oyunlar için kullanılır.' },
  { q: 'İnternette larp ne anlama geliyor?', a: 'Olmadığın biri gibi davranmak, bir rolü gerçekmiş gibi oynamak. Örneğin hiç okumadığın kitabı okumuş gibi konuşmak ya da şirketin yokken kendini kurucu diye tanıtmak.' },
  { q: 'Larplamak ne demek?', a: 'Larp yapmak, yani bir rolü oynamak, öyleymiş gibi davranmak. "Entelektüel larplıyor", "CEO larpı yapıyor" gibi kullanılır.' },
  { q: 'Larpçı kime denir?', a: 'Bir rolü oynayan, kendini olduğundan farklı gösteren kişiye. Çoğu zaman şakayla karışık söylenir.' },
  { q: 'Larp nasıl okunur?', a: 'Yazıldığı gibi, tek hece: "larp". Fiil hali "larplamak", geçmiş zamanı "larpladım" diye çekimlenir.' },
  { q: 'Larp ile cosplay arasındaki fark ne?', a: 'Cosplay bir karakterin görünüşünü, yani kostümünü taklit etmektir. Larp ise davranışı taklit etmek; kostüm gerekmez.' },
];
app.get('/hakkinda', (req, res) => res.redirect(301, '/larp-ne-demek'));
app.get('/larp-ne-demek', (req, res) => {
  const base = res.locals.baseUrl;
  res.render('about', {
    title: 'Larp ne demek? Larplamak anlamı ve örnekleri',
    description: 'Larp ne demek, larplamak ne anlama gelir? İnternet argosundaki anlamı, kelimenin kökeni ve günlük kullanımdan örnekler.',
    ogType: 'article', faqs: LARP_FAQ,
    jsonLd: JSON.stringify([
      { '@context': 'https://schema.org', '@type': 'Article', headline: 'Larp ne demek? Larplamak anlamı ve örnekleri',
        description: 'Larp kelimesinin internet argosundaki anlamı, kökeni ve kullanım örnekleri.', inLanguage: 'tr-TR',
        mainEntityOfPage: `${base}/larp-ne-demek`, image: [`${base}/og.png`],
        author: { '@type': 'Organization', name: 'How to LARP' }, publisher: { '@type': 'Organization', name: 'How to LARP', url: base } },
      { '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: LARP_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ]).replace(/</g, '\\u003c'),
  });
});


app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /yonetim\nDisallow: /yaz\nDisallow: /hesap\nDisallow: /rehberlerim\nSitemap: ${res.locals.baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res) => {
  const rows = await db.all(`SELECT g.slug, g.updated_at FROM guides g JOIN users u ON u.id = g.user_id
    WHERE ${VISIBLE} ORDER BY g.created_at DESC LIMIT 5000`);
  const base = res.locals.baseUrl;
  const urls = [`<url><loc>${base}/</loc></url>`, `<url><loc>${base}/larp-ne-demek</loc></url>`, `<url><loc>${base}/kurallar</loc></url>`, `<url><loc>${base}/test</loc></url>`, `<url><loc>${base}/istekler</loc></url>`,
    ...Object.values(CATEGORY_INFO).map((c) => `<url><loc>${base}/kategori/${c.slug}</loc></url>`),
    ...rows.map((r) => `<url><loc>${base}/rehber/${r.slug}</loc><lastmod>${String(r.updated_at).slice(0, 10)}</lastmod></url>`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

// ---------- Hatalar ----------
function notFound(req, res) {
  res.status(404).render('error', { noindex: true, title: 'Bulunamadı', message: 'Bu sayfa var gibi davranıyordu ama yokmuş.' });
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
