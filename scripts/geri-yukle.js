// Yedekten geri yükleme.
//   Yerel dosyaya:   DB_PATH=data/yeni.db node scripts/geri-yukle.js howtolarp-yedek-....json
//   Turso'ya:        TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/geri-yukle.js yedek.json
// Hedef veritabanındaki aynı tabloların içeriği SİLİNİR ve yedektekiyle değiştirilir.
// Güvenlik için onay ister: --evet bayrağı verilmeden hiçbir şey yazmaz.
const fs = require('node:fs');
const { db, ensureReady } = require('../db');

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Kullanım: node scripts/geri-yukle.js <yedek.json> --evet');
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (backup.app !== 'howtolarp' || backup.format !== 1) throw new Error('Bu bir How to LARP yedeği değil.');

  const order = ['users', 'guides', 'likes', 'anon_likes', 'reports', 'seeded'];
  for (const t of order) console.log(`${t.padEnd(11)} ${String(backup.tables[t]?.length ?? 0).padStart(6)} satır`);
  console.log(`Yedek tarihi: ${backup.created_at}`);
  if (!process.argv.includes('--evet')) {
    console.log('\nHiçbir şey yazılmadı. Hedefteki veriler silinip yedekle değiştirilecek; emin isen --evet ekle.');
    return;
  }

  await ensureReady(); // şema, göçler, indeksler
  // Bağımlılık sırasının tersiyle temizle, sonra sırayla doldur
  for (const t of ['sessions', ...order].reverse()) await db.run(`DELETE FROM ${t}`);
  // 500'lük paketler: Turso'da her satır ayrı istek olmasın
  for (const t of order) {
    const rows = backup.tables[t] || [];
    for (let i = 0; i < rows.length; i += 500) {
      await db.batch(rows.slice(i, i + 500).map((row) => {
        const cols = Object.keys(row);
        return { sql: `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: cols.map((c) => row[c]) };
      }));
    }
    if (rows.length) console.log(`${t}: ${rows.length} satır yazıldı`);
  }
  console.log('\nGeri yükleme tamam. Herkesin yeniden giriş yapması gerekecek.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
