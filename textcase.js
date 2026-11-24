// Büyük harfe çevirirken Türkçe ve İngilizce kelimeleri ayırmak için.
// Site Türkçe (lang="tr"): CSS ile büyük harf yapılınca "i" her zaman "İ" olur. Bu Türkçe kelimelerde doğru
// ("ZEKİ BİRİ"), İngilizce kelimelerde yanlış ("FİRST", "SENİOR"). Bilinen İngilizce kelimeler
// lang="en" ile işaretlenir; tarayıcı onları "FIRST", "SENIOR" diye yazar.
// Sadece içinde "i" geçen kelimeler önemli; Türkçede de aynı yazılanlar ("film", "mini") listeye eklenmez.

const ENGLISH = new Set(`
first senior original trilogy depends it is in its this with side project instagram linkedin digital
indie vinyl tannin tannins finish blind tasting vintage single origin light hallucination context
mindset leadership thought influencer pivot agile pitch
community remote location independent nomad nomads lightsaber jedi legends machete wikipedia
sequel sequels force episode prequel prequels mandalorian skywalker
mainstream streak endgame online opening trap elo capsule wardrobe signature critic critics
transition gegenpressing pressing xg half-space low high line
smurf ranked casual main op carry meta ping skin skins gaming
filler arc skip opening ending character development source material anime binge
grain film-camera
framework deploy edge case scale kiss works machine rewrite live coding junior dark mode ide pipeline commit
content creator long-form podcasting episode
journaling cold shower club
meal prep gaslighting avoidant attachment
whey protein pre-workout leg day lifting
pace long run
agent agents prompt prompts workflow workflows internal game changer insights
bitcoin mining hodl
tote bag director's cut blockbuster cinematography cinema
grinder gooseneck kettle drip pour-over natural washed brew
playlist vibe vibes ironic
hiking trail
fit product-market mrr stealth startup founder founders
fine dining umami signature
it's i i'm
acidity director distribution community-led smoothie
riemann
`.trim().split(/\s+/));

const TR_ONLY = /[çğıöşüÇĞİÖŞÜ]/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Bir kelimenin (ekleri ayrılmış) İngilizce kökü var mı? "Tannin'leri" -> kök "Tannin", ek "'leri"
function splitWord(word) {
  const m = word.match(/^([^\p{L}\d]*)([\p{L}\d][\p{L}\d-]*?)(['’][\p{L}]+)?([^\p{L}\d]*)$/u);
  if (!m) return null;
  return { pre: m[1], base: m[2], suffix: m[3] || '', post: m[4] };
}
function isEnglish(base) {
  if (!base || TR_ONLY.test(base) || !/[iI]/.test(base)) return false;
  return ENGLISH.has(base.toLowerCase());
}

// HTML: metni kaçışlar, İngilizce kökleri <span lang="en"> ile sarar (CSS büyük harf doğru çalışsın)
function markEn(text) {
  return String(text ?? '').split(/(\s+)/).map((tok) => {
    if (!tok.trim()) return tok;
    const w = splitWord(tok);
    if (!w || !isEnglish(w.base)) return esc(tok);
    return `${esc(w.pre)}<span lang="en">${esc(w.base)}</span>${esc(w.suffix)}${esc(w.post)}`;
  }).join('');
}

// Düz metin büyük harf (görsel üretimi için): İngilizce kök "en", gerisi "tr" kurallarıyla
function upperMixed(text) {
  return String(text ?? '').split(/(\s+)/).map((tok) => {
    if (!tok.trim()) return tok;
    const w = splitWord(tok);
    if (!w || !isEnglish(w.base)) return tok.toLocaleUpperCase('tr');
    return w.pre.toLocaleUpperCase('tr') + w.base.toUpperCase() + w.suffix.toLocaleUpperCase('tr') + w.post.toLocaleUpperCase('tr');
  }).join('');
}

module.exports = { markEn, upperMixed, isEnglish };
