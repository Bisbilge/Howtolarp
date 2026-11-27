// "Hangi larpsın?" testi: sorular, cevapların puanladığı sonuçlar ve sonuç hesabı.
// Sonuçlar sitedeki rehberlere başlıkla bağlanır (başlık değişirse eski başlığı da listeye ekleyin).

const RESULTS = {
  zeki: {
    name: 'Zeki Biri',
    titles: ['Zeki Biri Gibi Nasıl Larplanır?'],
    line: 'Hiçbir şey okumadan her şeyi okumuş gibi durabiliyorsun. "Aslında" kelimesi senin süper gücün.',
  },
  startup: {
    name: 'Startup Kurucusu',
    titles: ['Startup Kurucusu Nasıl Larplanır?'],
    line: 'Şirketin yok, ürünün yok, ama pitch deck\'in hazır. Her şey "erken aşamada".',
  },
  kahve: {
    name: 'Kahve Uzmanı',
    titles: ['Kahve Uzmanı Nasıl Larplanır?'],
    line: 'Her yudumda bir tasting note buluyorsun. Hazır kahve kavanozunu kimse görmemeli.',
  },
  film: {
    name: 'Film Eleştirmeni',
    titles: ['Film Eleştirmeni Nasıl Larplanır?'],
    line: 'Herkesin sevdiği filme "fena değil" diyorsun. Siyah-beyaz ve üç saatlikse daha iyi.',
  },
  senior: {
    name: 'Senior Yazılımcı',
    titles: ['Senior Yazılımcı Nasıl Larplanır?', 'Kıdemli Yazılımcı Nasıl Larplanır?'],
    line: 'Her soruya "It depends" diyorsun. Cuma günü deploy lafı geçince tüylerin diken diken.',
  },
  cool: {
    name: 'Hiçbir Şeyi Umursamayan Cool Biri',
    titles: ['Hiçbir Şeyi Umursamayan Cool Biri Nasıl Larplanır?'],
    line: 'Mesajları iki saat sonra açıyorsun. Umursamamak senin için tam zamanlı bir iş.',
  },
  spirituel: {
    name: 'Spiritüel Olarak Uyanmış Biri',
    titles: ['Spiritüel Olarak Uyanmış Biri Nasıl Larplanır?'],
    line: 'Geç kalmak değil bu, "akışa bırakmak". Evren sana bir şey söylüyor.',
  },
  sabah: {
    name: '5 AM Club Üyesi',
    titles: ['5 AM Club Üyesi Nasıl Larplanır?', 'Sabah 5 Kulübü Üyesi Nasıl Larplanır?'],
    line: 'Akşam 21.30\'da "yatıyorum" mesajı atıyorsun. Saat 11\'de uyanman ayrıntı.',
  },
  gym: {
    name: 'Spor Salonu Müdavimi',
    titles: ['Spor Salonu Müdavimi Nasıl Larplanır?'],
    line: 'Her konuyu protein miktarına bağlıyorsun. Leg day\'i bu hafta da erteledin.',
  },
  linkedin: {
    name: 'LinkedIn Thought Leader',
    titles: ['LinkedIn Thought Leader Nasıl Larplanır?'],
    line: 'Kahve sırasında yaşadığın bir anıdan dokuz maddelik liderlik dersi çıkarıyorsun. Agree?',
  },
  indie: {
    name: 'Indie Müzik Dinleyicisi',
    titles: ['Indie Müzik Dinleyicisi Nasıl Larplanır?'],
    line: 'Sevdiğin grup ünlü olduğu gün onu bırakıyorsun. "İlk albümleri daha iyiydi."',
  },
  nomad: {
    name: 'Digital Nomad',
    titles: ['Digital Nomad Nasıl Larplanır?'],
    line: 'Bilgisayarın açık, deniz manzaralı bir kafedesin. Ne iş yaptığın hâlâ belli değil.',
  },
  mesgul: {
    name: 'Çok Meşgul Biri',
    titles: ['Çok Meşgul Biri Nasıl Larplanır?'],
    line: '"Şu an çok yoğunum" senin selamlaşma şeklin. Takviminde boşluk olsa da göstermiyorsun.',
  },
  psikoloji: {
    name: 'Psikoloji Okumuş Biri',
    titles: ['Psikoloji Okumuş Biri Nasıl Larplanır?'],
    line: 'Herkesin bağlanma stilini ilk buluşmada çözüyorsun. Kendininkini sorma.',
  },
  anime: {
    name: 'Anime Hayranı',
    titles: ['Anime Hayranı Nasıl Larplanır?'],
    line: 'Filler bölümleri skip\'liyorsun, dub izleyenlere sessizce üzülüyorsun. Mangası daha iyiydi zaten.',
  },
  yetiskin: {
    name: 'Hayatını Çözmüş Yetişkin',
    titles: ['Hayatını Çözmüş Yetişkin Nasıl Larplanır?'],
    line: 'Faturaların otomatik ödemede, buzdolabında meal prep kutuları var. Çevren seni hem kıskanıyor hem korkuyor.',
  },
};

const QUESTIONS = [
  {
    q: 'Bir partiye girdin. İlk ne yaparsın?',
    a: [
      ['Köşede durup herkesi uzaktan izlerim', ['film', 'cool']],
      ['Kendimi "girişimciyim" diye tanıtırım', ['startup', 'linkedin']],
      ['Herkesin enerjisini okumaya başlarım', ['spirituel', 'psikoloji']],
      ['Telefona bakıp "Bir mail atmam lazım" derim', ['mesgul', 'nomad']],
    ],
  },
  {
    q: 'Sabah alarmın çaldı.',
    a: [
      ['Alarm mı? Ben zaten 5\'te kalktım', ['sabah', 'gym']],
      ['Ertelerim. Evren beni hazır olunca uyandırır', ['spirituel', 'cool']],
      ['Önce kahve, sonra konuşuruz', ['kahve', 'senior']],
      ['"Bir bölüm daha" dediğim için 4\'te yattım', ['anime', 'film']],
    ],
  },
  {
    q: 'Biri sana bir soru sordu, cevabını bilmiyorsun.',
    a: [
      ['"It depends."', ['senior', 'zeki']],
      ['"Araştırıp sana dönerim." (Asla dönmem)', ['mesgul', 'yetiskin']],
      ['"Bu soru aslında senin hakkında çok şey söylüyor."', ['psikoloji', 'spirituel']],
      ['Omuz silkip "bilmem" derim', ['cool', 'indie']],
    ],
  },
  {
    q: 'Hafta sonu planın ne?',
    a: [
      ['Kimsenin bilmediği bir grubun konseri', ['indie', 'film']],
      ['Uzun koşu, sonra "koşudan öğrendiklerim" paylaşımı', ['gym', 'linkedin']],
      ['Side project\'ime çalışırım (aslında dizi izlerim)', ['senior', 'startup']],
      ['Haftanın yemeklerini hazırlayıp kutulara koyarım', ['yetiskin', 'gym']],
    ],
  },
  {
    q: 'Instagram\'a en çok ne paylaşırsın?',
    a: [
      ['Latte art', ['kahve', 'nomad']],
      ['Hiçbir şey. Gizem önemli', ['cool', 'zeki']],
      ['Kitap kapağı ve altına ince bir alıntı', ['zeki', 'psikoloji']],
      ['Bir animeden kare ve derin bir replik', ['anime', 'indie']],
    ],
  },
  {
    q: 'En sık kurduğun cümle hangisi?',
    a: [
      ['"Pivot yapmamız lazım."', ['startup', 'linkedin']],
      ['"Görüntü yönetmeni resmen şov yapmış."', ['film', 'anime']],
      ['"Bu senin çocukluğunla ilgili olabilir."', ['psikoloji', 'zeki']],
      ['"Şu an çok yoğunum, sonra konuşalım."', ['mesgul', 'yetiskin']],
    ],
  },
  {
    q: 'Bir arkadaşın derdini anlatıyor. Sen ne yaparsın?',
    a: [
      ['"Bundan bir LinkedIn postu çıkar" diye düşünürüm', ['linkedin', 'startup']],
      ['"Her şey olması gerektiği gibi" derim', ['spirituel', 'sabah']],
      ['Kahve ısmarlarım, gerisi kendiliğinden çözülür', ['kahve', 'sabah']],
      ['Excel\'de bir çözüm planı hazırlarım', ['yetiskin', 'senior']],
    ],
  },
  {
    q: 'Tatil deyince aklına ne geliyor?',
    a: [
      ['Tatil mi? Ben her yerden çalışıyorum', ['nomad', 'mesgul']],
      ['Gittiğim şehrin en iyi üçüncü dalga kahvecisi', ['kahve', 'nomad']],
      ['Japonya. Sadece Japonya.', ['anime', 'indie']],
      ['Otelin spor salonu yoksa o otele gitmem', ['gym', 'sabah']],
    ],
  },
];

// Cevaplar: her soru için 0-3 arası seçim. Eşitlikte cevaplara göre sabit ama çeşitli bir seçim yapılır.
function score(answers) {
  const pts = Object.fromEntries(Object.keys(RESULTS).map((k) => [k, 0]));
  answers.forEach((choice, i) => {
    const opt = QUESTIONS[i] && QUESTIONS[i].a[choice];
    if (opt) opt[1].forEach((k) => { pts[k] += 2 / opt[1].length; });
  });
  const max = Math.max(...Object.values(pts));
  const tied = Object.keys(pts).filter((k) => pts[k] === max);
  const seed = answers.reduce((n, c, i) => n + (c + 1) * (i + 3), 0);
  return tied[seed % tied.length];
}

module.exports = { RESULTS, QUESTIONS, score };
