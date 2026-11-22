const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'howtolarp.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guides (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS guides_user ON guides(user_id);
CREATE INDEX IF NOT EXISTS guides_created ON guides(created_at);

CREATE TABLE IF NOT EXISTS likes (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, guide_id)
);
`);

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
function slugify(text) {
  const base = String(text)
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c])
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'rehber';
  let slug = base;
  const exists = db.prepare('SELECT 1 FROM guides WHERE slug = ?');
  while (exists.get(slug)) slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  return slug;
}

// ---- Örnek içerik (veritabanı boşsa) ----
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM guides').get().n;
  if (count > 0) return;

  // Editör hesabı: rastgele şifre, giriş için kullanılmıyor.
  const editor = db
    .prepare('INSERT INTO users (username, password_hash, bio) VALUES (?, ?, ?) RETURNING id')
    .get('editor', hashPassword(crypto.randomBytes(24).toString('hex')), 'How to LARP yayın kurulu. İlk rehberleri biz yazdık, gerisi sizde.');

  const insert = db.prepare(`INSERT INTO guides
    (slug, user_id, title, category, difficulty, summary, kit, steps, phrases, risks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  for (const g of require('./seed-guides')) {
    insert.run(slugify(g.title), editor.id, g.title, g.category, g.difficulty, g.summary,
      g.kit.join('\n'), g.steps.join('\n'), g.phrases.join('\n'), g.risks.join('\n'));
  }
}
seed();

module.exports = { db, hashPassword, verifyPassword, slugify };
