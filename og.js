// Rehbere özel paylaşım görseli (Open Graph, 1200x630): satori ile tasarım -> SVG, resvg ile PNG.
const fs = require('node:fs');
const path = require('node:path');
const satori = require('satori').default || require('satori');
const { Resvg, initWasm } = require('@resvg/resvg-wasm');

const C = { bg: '#ecebe6', ink: '#0b0b0b', lime: '#c8ff1a', pink: '#ff2e88', mute: '#5f5f5a', light: '#ecebe6' };
const FONT_DIR = path.join(__dirname, 'assets', 'og-fonts');

let ready;
function init() {
  ready ||= (async () => {
    await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const f = (file) => fs.readFileSync(path.join(FONT_DIR, file));
    return [
      { name: 'Anton', data: f('Anton_400Regular.ttf'), weight: 400, style: 'normal' },
      { name: 'Archivo', data: f('Archivo_400Regular.ttf'), weight: 400, style: 'normal' },
      { name: 'Mono', data: f('JetBrainsMono_700Bold.ttf'), weight: 700, style: 'normal' },
    ];
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// Küçük bir öğe oluşturucu (JSX yerine)
const el = (type, style, ...children) => ({
  type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});
const { upperMixed } = require('./textcase');
const up = (t) => upperMixed(t);

function personaSize(text) {
  const n = text.length;
  if (n <= 12) return 150;
  if (n <= 18) return 118;
  if (n <= 26) return 96;
  return 80;
}

function tree({ persona, category, difficulty, number, phrase, kicker, badge }) {
  const size = personaSize(persona);
  return el('div', { width: 1200, height: 630, flexDirection: 'column', background: C.bg, color: C.ink, position: 'relative' },
    // Üst bant
    el('div', { height: 66, background: C.ink, alignItems: 'center', justifyContent: 'space-between', padding: '0 48px' },
      el('div', { alignItems: 'center' },
        el('div', { fontFamily: 'Anton', fontSize: 32, color: C.light }, 'HOW TO'),
        el('div', { fontFamily: 'Anton', fontSize: 32, background: C.lime, color: C.ink, padding: '0 10px', marginLeft: 10 }, 'LARP')),
      el('div', { fontFamily: 'Mono', fontSize: 20, color: C.light, letterSpacing: 3 }, 'HOWTOLARP.ORG')),
    // Gövde
    el('div', { flexDirection: 'column', padding: '34px 48px 0', flexGrow: 1 },
      el('div', { fontFamily: 'Mono', fontSize: 20, color: C.pink, letterSpacing: 3 }, up(kicker || `${category} · Zorluk ${difficulty}/5`)),
      el('div', { fontFamily: 'Anton', fontSize: size, lineHeight: 1.12, marginTop: 14, maxWidth: 880, maxHeight: size * 2.3, overflow: 'hidden', flexWrap: 'wrap' }, up(persona)),
      el('div', { alignItems: 'center', marginTop: 10 },
        el('div', { position: 'relative', fontFamily: 'Anton', fontSize: 58, color: C.mute },
          'OLMA.',
          el('div', { position: 'absolute', left: 0, right: 0, top: 38, height: 9, background: C.pink })),
        el('div', { fontFamily: 'Anton', fontSize: 58, background: C.lime, color: C.ink, padding: '6px 16px 0', marginLeft: 18 }, 'ÖYLE GÖRÜN.')),
      phrase
        ? el('div', { marginTop: 'auto', marginBottom: 40, alignSelf: 'flex-start', maxWidth: 900, background: C.ink, color: C.light,
            fontFamily: 'Anton', fontSize: 34, padding: '12px 20px 10px' }, kicker ? up(phrase) : `“${up(phrase)}”`)
        : el('div', {})),
    // Numara rozeti
    el('div', { position: 'absolute', right: 52, top: 104, width: 168, height: 168, borderRadius: 84, background: C.pink,
      alignItems: 'center', justifyContent: 'center', transform: 'rotate(10deg)' },
      el('div', { fontFamily: 'Anton', fontSize: 54, color: C.ink }, badge || `#${String(number).padStart(3, '0')}`)));
}

// Aynı sunucu örneğinde tekrar üretmemek için küçük bellek önbelleği
const cache = new Map();
async function renderGuideImage(data, key) {
  if (cache.has(key)) return cache.get(key);
  const fonts = await init();
  const svg = await satori(tree(data), { width: 1200, height: 630, fonts });
  const png = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}

module.exports = { renderGuideImage };
