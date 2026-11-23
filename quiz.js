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
};

const QUESTIONS = [
  {
    q: 'Bir partiye girdin. İlk ne yaparsın?',
    a: [
      ['Köşede durup herkesi uzaktan izlerim', ['film']],
      ['Kendimi "girişimciyim" diye tanıtırım', ['startup']],
      ['Mutfağa gidip kahve makinesine bakarım', ['kahve']],
      ['İlk duyduğum cümleyi "aslında" diye düzeltirim', ['zeki']],
    ],
  },
  {
    q: 'Sabah alarmın çaldı.',
    a: [
      ['Alarm mı? Ben zaten 5\'te kalktım', ['sabah']],
      ['Ertelerim. Evren beni hazır olunca uyandırır', ['spirituel']],
      ['Önce kahve, sonra konuşuruz', ['kahve']],
      ['Yataktan çıkmadan maillere bakarım', ['startup']],
    ],
  },
  {
    q: 'Biri sana bir soru sordu, cevabını bilmiyorsun.',
    a: [
      ['"It depends."', ['senior']],
      ['"İlginç, ama tersi de savunulabilir."', ['zeki']],
      ['Omuz silkip "bilmem" derim', ['cool']],
      ['"Bunun cevabı aslında sende."', ['spirituel']],
    ],
  },
  {
    q: 'Hafta sonu planın ne?',
    a: [
      ['Kimsenin bilmediği üç saatlik bir film', ['film']],
      ['Uzun koşu, sonra yeşil smoothie', ['sabah']],
      ['Side project\'ime çalışırım (aslında dizi izlerim)', ['senior']],
      ['Plan yapmam, akışına bırakırım', ['cool']],
    ],
  },
  {
    q: 'Instagram\'a en çok ne paylaşırsın?',
    a: [
      ['Latte art', ['kahve']],
      ['Hiçbir şey. Gizem önemli', ['cool']],
      ['Kitap kapağı ve altına ince bir alıntı', ['zeki']],
      ['"Bugün 7 saattir ayaktayım" hikayesi', ['sabah']],
    ],
  },
  {
    q: 'En sık kurduğun cümle hangisi?',
    a: [
      ['"Pivot yapmamız lazım."', ['startup']],
      ['"Bu biraz neye göre olduğuna bağlı."', ['senior']],
      ['"Görüntü yönetmeni resmen şov yapmış."', ['film']],
      ['"Enerjin bugün biraz farklı."', ['spirituel']],
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
