const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Yerelde: dosya tabanlı SQLite. Canlıda (Vercel): Turso.
//   TURSO_DATABASE_URL=libsql://...turso.io  TURSO_AUTH_TOKEN=...
class ConfigError extends Error {}

function makeClient() {
  const url = String(process.env.TURSO_DATABASE_URL || '').trim();
  const authToken = String(process.env.TURSO_AUTH_TOKEN || '').trim() || undefined;
  if (url) {
    if (!/^(libsql|https|wss?):\/\//.test(url)) {
      throw new ConfigError('TURSO_DATABASE_URL "libsql://" ile başlamalı. Turso panelindeki veritabanı adresini olduğu gibi kopyala.');
    }
    if (!authToken) throw new ConfigError('TURSO_AUTH_TOKEN eksik. Turso panelinden "Create Token" ile bir anahtar oluşturup Vercel\'e ekle.');
    // Uzak bağlantı için yerel (native) modül gerektirmeyen istemci
    return require('@libsql/client/web').createClient({ url, authToken });
  }
  if (process.env.VERCEL) {
    throw new ConfigError('TURSO_DATABASE_URL tanımlı değil. Vercel → Settings → Environment Variables\'a ekleyip yeniden deploy et.');
  }
  const file = process.env.DB_PATH || path.join(__dirname, 'data', 'howtolarp.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return require('@libsql/client').createClient({ url: `file:${file}` });
}

let client;
const getClient = () => (client ||= makeClient());

const db = {
  async get(sql, args = []) { return (await getClient().execute({ sql, args })).rows[0]; },
  async all(sql, args = []) { return (await getClient().execute({ sql, args })).rows; },
  async run(sql, args = []) { return getClient().execute({ sql, args }); },
  // Birden çok yazmayı tek istekte, tek işlem (transaction) olarak çalıştırır
  async batch(stmts) { return getClient().batch(stmts, 'write'); },
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    banned        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS guides (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    category   TEXT NOT NULL,
    difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
    summary    TEXT NOT NULL,
    kit        TEXT NOT NULL DEFAULT '',
    steps      TEXT NOT NULL DEFAULT '',
    phrases    TEXT NOT NULL DEFAULT '',
    risks      TEXT NOT NULL DEFAULT '',
    hidden     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS guides_user ON guides(user_id)`,
  `CREATE INDEX IF NOT EXISTS guides_created ON guides(created_at)`,
  `CREATE TABLE IF NOT EXISTS likes (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, guide_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guide_id    INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    UNIQUE (guide_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS reports_open ON reports(resolved_at, guide_id)`,
  // Hangi örnek rehberlerin eklendiğini tutar: silinen örnekler geri gelmez
  `CREATE TABLE IF NOT EXISTS seeded (title TEXT PRIMARY KEY)`,
  // Birleştirilen/kaldırılan rehberlerin eski adresleri (paylaşılmış linkler kırılmasın)
  `CREATE TABLE IF NOT EXISTS slug_redirects (old_slug TEXT PRIMARY KEY, new_slug TEXT NOT NULL)`,
  // Paylaşım sırası: yayına giren rehberler sosyal medyada paylaşılmak üzere buraya düşer
  `CREATE TABLE IF NOT EXISTS share_queue (
    guide_id  INTEGER PRIMARY KEY REFERENCES guides(id) ON DELETE CASCADE,
    queued_at TEXT NOT NULL DEFAULT (datetime('now')),
    x_at      TEXT,
    ig_at     TEXT,
    skipped   INTEGER NOT NULL DEFAULT 0
  )`,
  // Kötüye kullanım sınırları için olay kayıtları (anahtar: işlem + kişi/IP özeti)
  `CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS hits_key ON hits(key, at)`,
  // Rehber istekleri: "şunun rehberi yazılsın" önerileri ve oyları
  `CREATE TABLE IF NOT EXISTS requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    key        TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_slug  TEXT,
    hidden     INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS request_votes (
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    voter      TEXT NOT NULL,
    PRIMARY KEY (request_id, voter)
  )`,
  // "Yakalandım": rehberi deneyip ifşa olanlar (üye ve hesapsız ziyaretçi)
  `CREATE TABLE IF NOT EXISTS caught (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, guide_id)
  )`,
  `CREATE TABLE IF NOT EXISTS anon_caught (
    visitor  TEXT NOT NULL,
    guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    PRIMARY KEY (visitor, guide_id)
  )`,
  // Hesabı olmayan ziyaretçilerin beğenileri (tarayıcı çereziyle)
  `CREATE TABLE IF NOT EXISTS anon_likes (
    visitor  TEXT NOT NULL,
    guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    PRIMARY KEY (visitor, guide_id)
  )`,
];

// Sık yapılan sayımlar tüm tabloyu taramasın (beğeni sayısı her listede rehber başına hesaplanıyor)
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS likes_guide ON likes(guide_id)',
  'CREATE INDEX IF NOT EXISTS anon_likes_guide ON anon_likes(guide_id)',
  'CREATE INDEX IF NOT EXISTS caught_guide ON caught(guide_id)',
  'CREATE INDEX IF NOT EXISTS request_votes_req ON request_votes(request_id)',
  'CREATE INDEX IF NOT EXISTS anon_caught_guide ON anon_caught(guide_id)',
  'CREATE INDEX IF NOT EXISTS guides_pending ON guides(approved) WHERE approved = 0',
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
];

// Önceki sürümle oluşturulmuş veritabanlarına eksik sütunları ekle
const MIGRATIONS = [
  ['users', 'banned', 'INTEGER NOT NULL DEFAULT 0'],
  ['guides', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  // Rol: 'user' ya da 'editor' (editörler yönetim panelini kullanır). Baş yöneticiler ADMIN_USERNAMES ile belirlenir.
  ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"],
  // Onay kuyruğu: yeni üyelerin rehberleri yönetici onayına kadar 0 kalır
  ['guides', 'approved', 'INTEGER NOT NULL DEFAULT 1'],
  ['seeded', 'guide_id', 'INTEGER'],
  ['seeded', 'hash', 'TEXT'],
  // Larplama/yakalanma zamanı (günün/haftanın en çokları için). Eski kayıtlarda boş kalır.
  ['likes', 'at', 'TEXT'],
  ['anon_likes', 'at', 'TEXT'],
  ['caught', 'at', 'TEXT'],
  ['anon_caught', 'at', 'TEXT'],
];

// ---- Şifreler (scrypt, ek bağımlılık yok) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---- Slug ----
const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
async function slugify(text) {
  const base = String(text)
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c])
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'rehber';
  let slug = base;
  while (await db.get('SELECT 1 FROM guides WHERE slug = ?', [slug])) {
    slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }
  return slug;
}

// ---- Kurulum: şema, göç, örnek içerik ----
async function setup() {
  await getClient().batch(['PRAGMA foreign_keys = ON', ...SCHEMA], 'write');
  for (const [table, col, def] of MIGRATIONS) {
    const cols = await db.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === col)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  // Göçlerden sonra: yeni sütunları kullanan indeksler
  await getClient().batch(INDEXES, 'write');

  await seedGuides();
  await dedupeGuides();
}

// Örnek rehberler. seed-guides.js'te:
//  - yeni eklenen rehber bir sonraki yüklemede siteye eklenir,
//  - metni değişen rehber sitede de güncellenir (başlığı değişirse eski başlık `key` olarak yazılır),
//  - siteden silinen örnek geri gelmez.
const seedHash = (g) => crypto.createHash('sha1')
  .update(JSON.stringify([g.title, g.category, g.difficulty, g.summary, g.kit, g.steps, g.phrases, g.risks]))
  .digest('hex');

async function seedGuides() {
  const seeds = require('./seed-guides');
  const rows = new Map((await db.all('SELECT title, guide_id, hash FROM seeded')).map((r) => [r.title, r]));
  const work = seeds.map((g) => ({ g, key: g.key || g.title, hash: seedHash(g) }))
    .filter(({ key, hash }) => rows.get(key)?.hash !== hash);
  if (!work.length) return;

  // Editör hesabı: rastgele şifre, giriş için kullanılmıyor. (Aynı anda açılan kopyalar çakışmasın)
  await db.run('INSERT OR IGNORE INTO users (username, password_hash, bio) VALUES (?, ?, ?)',
    ['editor', hashPassword(crypto.randomBytes(24).toString('hex')), 'How to LARP yayın kurulu. İlk rehberleri biz yazdık, gerisi sizde.']);
  const editor = await db.get('SELECT id FROM users WHERE username = ?', ['editor']);
  const fields = (g) => [g.title, g.category, g.difficulty, g.summary,
    g.kit.join('\n'), g.steps.join('\n'), g.phrases.join('\n'), g.risks.join('\n')];
  const findOld = async (key, g) => (await db.get(
    'SELECT id FROM guides WHERE user_id = ? AND title IN (?, ?) ORDER BY id LIMIT 1', [editor.id, key, g.title]))?.id;
  const firstRun = rows.size === 0;

  // Vercel'de birden çok sunucu kopyası aynı anda açılabilir. Her örnek için önce seeded tablosunda
  // "sahiplen" (tek bir yazma, veritabanı sıralar); sahiplenemeyen kopya o örneği atlar. Böylece
  // aynı rehber iki kez eklenmez ya da iki kez güncellenmez.
  for (const { g, key, hash } of work) {
    const row = rows.get(key);
    const claim = row
      ? await db.run('UPDATE seeded SET hash = ? WHERE title = ? AND hash IS ?', [hash, key, row.hash ?? null])
      : await db.run('INSERT OR IGNORE INTO seeded (title, hash) VALUES (?, ?)', [key, hash]);
    if (claim.rowsAffected === 0) continue; // başka bir kopya bu örneği hallediyor

    let id = row ? (row.guide_id ?? await findOld(key, g)) : await findOld(key, g);
    if (id) {
      // Var olan örneği güncelle (yalnızca hâlâ editörün rehberiyse)
      await db.run(`UPDATE guides SET title = ?, category = ?, difficulty = ?, summary = ?, kit = ?, steps = ?,
        phrases = ?, risks = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`, [...fields(g), id, editor.id]);
    } else if (!row) {
      // Hiç eklenmemiş: yeni rehber
      id = (await db.get(`INSERT INTO guides (slug, user_id, title, category, difficulty, summary, kit, steps, phrases, risks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [await slugify(g.title), editor.id, ...fields(g)])).id;
      if (!firstRun) await db.run('INSERT OR IGNORE INTO share_queue (guide_id) VALUES (?)', [id]);
    }
    // row var ama rehber bulunamadı: sitede silinmiş, geri getirme
    await db.run('UPDATE seeded SET guide_id = ? WHERE title = ?', [id ?? null, key]);
  }
}

// Kopya rehberleri teke indirir. Kalan rehbere, silinen kopyaya gelen beğeni, yakalandım,
// bildirim ve paylaşım kayıtları taşınır; kopyanın eski adresi kalan rehbere yönlenir.
async function mergeGuide(dup, keep) {
  if (dup === keep) return;
  const keepSlug = (await db.get('SELECT slug FROM guides WHERE id = ?', [keep]))?.slug;
  const dupSlug = (await db.get('SELECT slug FROM guides WHERE id = ?', [dup]))?.slug;
  if (!keepSlug || !dupSlug) return;
  await db.batch([
    { sql: 'INSERT OR IGNORE INTO likes (user_id, guide_id) SELECT user_id, ? FROM likes WHERE guide_id = ?', args: [keep, dup] },
    { sql: 'INSERT OR IGNORE INTO anon_likes (visitor, guide_id) SELECT visitor, ? FROM anon_likes WHERE guide_id = ?', args: [keep, dup] },
    { sql: 'INSERT OR IGNORE INTO caught (user_id, guide_id) SELECT user_id, ? FROM caught WHERE guide_id = ?', args: [keep, dup] },
    { sql: 'INSERT OR IGNORE INTO anon_caught (visitor, guide_id) SELECT visitor, ? FROM anon_caught WHERE guide_id = ?', args: [keep, dup] },
    { sql: `INSERT OR IGNORE INTO reports (guide_id, user_id, reason, note, created_at, resolved_at)
            SELECT ?, user_id, reason, note, created_at, resolved_at FROM reports WHERE guide_id = ?`, args: [keep, dup] },
    { sql: `INSERT OR IGNORE INTO share_queue (guide_id, queued_at, x_at, ig_at, skipped)
            SELECT ?, queued_at, x_at, ig_at, skipped FROM share_queue WHERE guide_id = ?`, args: [keep, dup] },
    { sql: 'UPDATE seeded SET guide_id = ? WHERE guide_id = ?', args: [keep, dup] },
    { sql: 'UPDATE requests SET done_slug = ? WHERE done_slug = ?', args: [keepSlug, dupSlug] },
    { sql: 'UPDATE slug_redirects SET new_slug = ? WHERE new_slug = ?', args: [keepSlug, dupSlug] },
    { sql: 'INSERT OR REPLACE INTO slug_redirects (old_slug, new_slug) VALUES (?, ?)', args: [dupSlug, keepSlug] },
    ...['likes', 'anon_likes', 'caught', 'anon_caught', 'reports', 'share_queue'].map((t) => ({ sql: `DELETE FROM ${t} WHERE guide_id = ?`, args: [dup] })),
    { sql: 'DELETE FROM guides WHERE id = ?', args: [dup] },
  ]);
  console.log(`kopya rehber birleştirildi: ${dupSlug} -> ${keepSlug}`);
}

async function dedupeGuides() {
  // 1) Örnek rehberler: aynı örneğe ait (eski ya da yeni başlıkla) birden çok editör rehberi varsa,
  //    seeded tablosunun gösterdiği kalır, diğerleri birleştirilir.
  const editor = await db.get('SELECT id FROM users WHERE username = ?', ['editor']);
  if (editor) {
    const seeded = new Map((await db.all('SELECT title, guide_id FROM seeded')).map((r) => [r.title, r.guide_id]));
    const mine = await db.all('SELECT id, title FROM guides WHERE user_id = ?', [editor.id]);
    for (const g of require('./seed-guides')) {
      const key = g.key || g.title;
      const keep = seeded.get(key);
      if (!keep) continue; // örnek silinmiş ya da henüz eklenmemiş
      for (const r of mine) {
        if (Number(r.id) !== Number(keep) && (r.title === key || r.title === g.title)) await mergeGuide(Number(r.id), Number(keep));
      }
    }
  }
  // 2) Herhangi bir yazarın birebir aynı rehberleri (ör. "Yayınla"ya iki kez basılmış): en eskisi kalır
  const groups = await db.all(`SELECT MIN(id) AS keep, GROUP_CONCAT(id) AS ids FROM guides
    GROUP BY user_id, title, summary, steps HAVING COUNT(*) > 1`);
  for (const gr of groups) {
    for (const dup of String(gr.ids).split(',').map(Number)) await mergeGuide(dup, Number(gr.keep));
  }
}

// Her sunucu örneğinde bir kez çalışır; istekler bunu bekler.
let ready;
const ensureReady = () => (ready ||= setup().catch((e) => { ready = null; throw e; }));

module.exports = { db, ensureReady, ConfigError, hashPassword, verifyPassword, slugify };
