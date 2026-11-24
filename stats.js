// Larp istatistikleri: /istatistik sayfası ve yönetimdeki "Larp raporu" görseli için.
// Sayılar gerçek: "Ben de larpladım" / "Yakalandım" düğmeleri, test sonuçları ve istekler.
// Az veri olan kutular hiç gösterilmez (bkz. MIN_*), "bugün 2 kez larplandı" gibi hüzünlü sayılar çıkmasın.

const PERIODS = {
  gun: { since: '-1 day', label: 'Bugün', of: 'Günün', lower: 'bugün' },
  hafta: { since: '-7 days', label: 'Bu hafta', of: 'Haftanın', lower: 'bu hafta' },
  ay: { since: '-30 days', label: 'Bu ay', of: 'Ayın', lower: 'bu ay' },
  tum: { since: null, label: 'Tüm zamanlar', of: 'Tüm zamanların', lower: 'şimdiye kadar' },
};
const MIN_HEADLINE = 20; // otomatik dönem seçimi: en az bu kadar larplama olan en kısa dönem
const MIN_RATIO_LARPS = 5; // en riskli/en güvenli larp için rehber başına en az larplama
const MIN_HOUR = 15; // larp saati için zamanı bilinen en az larplama
const MIN_NIGHT = 3;
const MIN_CITY = 5;
const MIN_QUIZ = 10;
const MIN_REQUEST_VOTES = 2;

// Türkiye'nin 81 ili: Vercel'in şehir adını ("Izmir", "Istanbul") doğru yazıma çevirmek için
const PROVINCES = `Adana Adıyaman Afyonkarahisar Ağrı Aksaray Amasya Ankara Antalya Ardahan Artvin Aydın Balıkesir Bartın Batman
Bayburt Bilecik Bingöl Bitlis Bolu Burdur Bursa Çanakkale Çankırı Çorum Denizli Diyarbakır Düzce Edirne Elazığ Erzincan Erzurum
Eskişehir Gaziantep Giresun Gümüşhane Hakkari Hatay Iğdır Isparta İstanbul İzmir Kahramanmaraş Karabük Karaman Kars Kastamonu
Kayseri Kilis Kırıkkale Kırklareli Kırşehir Kocaeli Konya Kütahya Malatya Manisa Mardin Mersin Muğla Muş Nevşehir Niğde Ordu
Osmaniye Rize Sakarya Samsun Şanlıurfa Siirt Sinop Sivas Şırnak Tekirdağ Tokat Trabzon Tunceli Uşak Van Yalova Yozgat Zonguldak`.split(/\s+/);
const plain = (t) => String(t || '').toLocaleLowerCase('tr').replace(/[çğıiöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u' }[c]))
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const PROVINCE_BY_KEY = new Map(PROVINCES.map((p) => [plain(p), p]));
PROVINCE_BY_KEY.set('icel', 'Mersin');
PROVINCE_BY_KEY.set('izmit', 'Kocaeli');
PROVINCE_BY_KEY.set('adapazari', 'Sakarya');
PROVINCE_BY_KEY.set('antakya', 'Hatay');
PROVINCE_BY_KEY.set('urfa', 'Şanlıurfa');

// Larplamanın yapıldığı şehir (sadece Türkiye, sadece şehir adı; IP saklanmaz). Vercel dışında boş.
function cityOf(req) {
  if (String(req.get('x-vercel-ip-country') || '').toUpperCase() !== 'TR') return null;
  let raw = '';
  try { raw = decodeURIComponent(String(req.get('x-vercel-ip-city') || '')).trim(); } catch { return null; }
  if (!raw) return null;
  return PROVINCE_BY_KEY.get(plain(raw)) || raw.slice(0, 40);
}

module.exports = function makeStats({ db, VISIBLE, persona, quizResults }) {
  const win = (since, extra = '') => {
    const conds = [since ? `at > datetime('now', '${since}')` : '', extra].filter(Boolean);
    return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  };
  const larpsIn = (where, cols = 'guide_id') => `(SELECT ${cols} FROM likes ${where} UNION ALL SELECT ${cols} FROM anon_likes ${where})`;
  const caughtIn = (where) => `(SELECT guide_id FROM caught ${where} UNION ALL SELECT guide_id FROM anon_caught ${where})`;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

  async function count(sub) {
    const r = await db.get(`SELECT COUNT(*) AS n FROM ${sub} x`);
    return Number(r.n);
  }

  // Dönem verilmezse: en az MIN_HEADLINE larplama olan en kısa dönem
  async function pickPeriod() {
    for (const k of ['gun', 'hafta', 'ay']) {
      if (await count(larpsIn(win(PERIODS[k].since))) >= MIN_HEADLINE) return k;
    }
    return 'tum';
  }

  async function compute(periodKey) {
    const P = PERIODS[periodKey];
    const W = win(P.since);
    const s = { period: periodKey, P };

    s.larps = await count(larpsIn(W));
    s.caught = await count(caughtIn(W));
    s.caughtPct = pct(s.caught, s.larps);

    const top = await db.all(`SELECT g.slug, g.title, COUNT(*) AS n FROM ${larpsIn(W)} l
      JOIN guides g ON g.id = l.guide_id JOIN users u ON u.id = g.user_id
      WHERE ${VISIBLE} GROUP BY g.id ORDER BY n DESC, g.id DESC LIMIT 1`);
    if (top[0]) s.topGuide = { ...top[0], name: persona(top[0].title), n: Number(top[0].n) };

    const cat = await db.get(`SELECT g.category, COUNT(*) AS n FROM ${larpsIn(W)} l
      JOIN guides g ON g.id = l.guide_id JOIN users u ON u.id = g.user_id
      WHERE ${VISIBLE} GROUP BY g.category ORDER BY n DESC LIMIT 1`);
    if (cat) s.topCategory = { name: cat.category, n: Number(cat.n), pct: pct(Number(cat.n), s.larps) };

    // En riskli / en güvenli larp: tüm zamanlar (oran için yeterli veri lazım)
    const per = await db.all(`SELECT g.slug, g.title,
        (SELECT COUNT(*) FROM likes WHERE guide_id = g.id) + (SELECT COUNT(*) FROM anon_likes WHERE guide_id = g.id) AS l,
        (SELECT COUNT(*) FROM caught WHERE guide_id = g.id) + (SELECT COUNT(*) FROM anon_caught WHERE guide_id = g.id) AS c
      FROM guides g JOIN users u ON u.id = g.user_id WHERE ${VISIBLE}`);
    const rated = per.map((g) => ({ slug: g.slug, name: persona(g.title), l: Number(g.l), c: Number(g.c) }))
      .filter((g) => g.l >= MIN_RATIO_LARPS)
      .map((g) => ({ ...g, pct: Math.min(100, pct(g.c, g.l)) }));
    if (rated.length >= 2) {
      const risky = [...rated].sort((a, b) => b.pct - a.pct || b.c - a.c)[0];
      const safe = [...rated].sort((a, b) => a.pct - b.pct || b.l - a.l)[0];
      if (risky.pct > 0) s.risky = risky;
      if (safe.slug !== risky.slug) s.safe = safe;
    }

    // Larp saati (Türkiye saati = UTC+3)
    const timed = larpsIn(win(P.since, 'at IS NOT NULL'), "guide_id, strftime('%H', at, '+3 hours') AS h");
    const hours = await db.all(`SELECT h, COUNT(*) AS n FROM ${timed} x GROUP BY h ORDER BY n DESC, h DESC`);
    const timedTotal = hours.reduce((a, r) => a + Number(r.n), 0);
    if (timedTotal >= MIN_HOUR) s.peakHour = { hour: Number(hours[0].h), n: Number(hours[0].n), pct: pct(Number(hours[0].n), timedTotal) };
    const night = await db.get(`SELECT g.slug, g.title, COUNT(*) AS n FROM ${timed} x
      JOIN guides g ON g.id = x.guide_id JOIN users u ON u.id = g.user_id
      WHERE ${VISIBLE} AND x.h IN ('00','01','02','03','04') GROUP BY g.id ORDER BY n DESC, g.id DESC LIMIT 1`);
    if (night && Number(night.n) >= MIN_NIGHT) s.night = { slug: night.slug, name: persona(night.title), n: Number(night.n) };

    // Şehirler
    const cityRows = larpsIn(win(P.since, 'city IS NOT NULL'), 'guide_id, city');
    const cities = await db.all(`SELECT city, COUNT(*) AS n FROM ${cityRows} x GROUP BY city ORDER BY n DESC LIMIT 3`);
    if (cities.length && Number(cities[0].n) >= MIN_CITY) {
      s.cities = [];
      for (const c of cities) {
        if (Number(c.n) < MIN_CITY) break;
        const fav = await db.get(`SELECT g.title, COUNT(*) AS n FROM ${cityRows} x
          JOIN guides g ON g.id = x.guide_id JOIN users u ON u.id = g.user_id
          WHERE ${VISIBLE} AND x.city = ? GROUP BY g.id ORDER BY n DESC, g.id DESC LIMIT 1`, [c.city]);
        s.cities.push({ city: c.city, n: Number(c.n), fav: fav ? persona(fav.title) : null });
      }
    }

    // Test
    const quiz = await db.all(`SELECT key, COUNT(*) AS n FROM quiz_results ${W} GROUP BY key ORDER BY n DESC`);
    const quizTotal = quiz.reduce((a, r) => a + Number(r.n), 0);
    if (quizTotal >= MIN_QUIZ && quizResults[quiz[0].key]) {
      s.quiz = { name: quizResults[quiz[0].key].name, key: quiz[0].key, pct: pct(Number(quiz[0].n), quizTotal), total: quizTotal };
    }

    // En çok beklenen istek (dönemden bağımsız)
    const req = await db.get(`SELECT r.text, COUNT(v.voter) AS n FROM requests r JOIN request_votes v ON v.request_id = r.id
      WHERE r.hidden = 0 AND r.done_slug IS NULL GROUP BY r.id ORDER BY n DESC, r.id LIMIT 1`);
    if (req && Number(req.n) >= MIN_REQUEST_VOTES) s.request = { text: req.text, n: Number(req.n) };

    const totals = await db.get(`SELECT
      (SELECT COUNT(*) FROM guides g JOIN users u ON u.id = g.user_id WHERE ${VISIBLE}) AS guides,
      (SELECT COUNT(DISTINCT g.user_id) FROM guides g JOIN users u ON u.id = g.user_id WHERE ${VISIBLE} AND u.username != 'editor') AS authors,
      (SELECT COUNT(*) FROM users WHERE username != 'editor' AND banned = 0) AS members`);
    s.totals = { guides: Number(totals.guides), authors: Number(totals.authors), members: Number(totals.members) };
    return s;
  }

  return { PERIODS, pickPeriod, compute };
};

// Yorum satırları (sayfada ve görselde aynı)
module.exports.quips = {
  caught(p) {
    if (p < 5) return 'Ülke olarak rol yapmakta çok iyiyiz.';
    if (p < 15) return 'Fena değil. Ama biri seni izliyor.';
    if (p < 30) return 'Biraz daha prova lazım.';
    return 'Rehberleri sonuna kadar okuyun lütfen.';
  },
  hour(h) {
    if (h < 6) return 'Uyuyamayanlar burada.';
    if (h < 12) return 'Sabah sabah rol kesiyoruz.';
    if (h < 18) return 'Mesai saatinde, evet. Patronun görmesin.';
    return 'Akşam yemeğinden sonra sahne bizim.';
  },
};
// Sayıya iyelik eki: %6'sı, %45'i, %30'u, %100'ü (sayının okunuşuna göre)
const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
function sayiEki(n) {
  n = Math.abs(Math.round(Number(n) || 0));
  const word = n === 0 ? 'sıfır' : n % 10 ? ONES[n % 10] : n % 100 ? TENS[(n / 10) % 10] : n % 1000 ? 'yüz' : 'bin';
  const vowels = word.match(/[aeıioöuü]/g);
  const last = vowels[vowels.length - 1];
  const v = { a: 'ı', ı: 'ı', e: 'i', i: 'i', o: 'u', u: 'u', ö: 'ü', ü: 'ü' }[last];
  return `'${/[aeıioöuü]$/.test(word) ? 's' : ''}${v}`;
}
module.exports.sayiEki = sayiEki;
module.exports.PERIODS = PERIODS;
module.exports.cityOf = cityOf;
