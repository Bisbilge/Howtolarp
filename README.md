# How to LARP

Olmadığın biri gibi davranmanın (internet argosundaki anlamıyla "larp") rehber sitesi.
Üyeler kendi "X nasıl larplanır?" rehberlerini yazar, yayınlar, düzenler; başkalarının rehberlerini "Larpladım" ile beğenir.

## Özellikler

- Üyelik: kayıt, giriş, çıkış (şifreler scrypt ile saklanır, oturumlar veritabanında)
- Rehber yazma, düzenleme, silme (yalnızca yazarı ya da yönetici)
- Her rehberde 4 bölüm: Çantada olacaklar, Sahne talimatı, Replikler, Nerede yakalanırsın
- Kategori, larp zorluğu (1-5), arama, "yeni / çok larplanan" sıralaması
- Kullanıcı profilleri (`/u/kullaniciadi`)
- **Moderasyon:** üyeler rehberleri gerekçesiyle bildirir; 3 farklı kişi bildirince rehber otomatik gizlenir.
  Yöneticiler `/yonetim` panelinden bildirimleri inceler; rehberi yayında tutar, gizler, siler ya da yazarı engeller.
- "Rastgele rol" (`/rastgele`), paylaşma butonu, repliğe dokununca kopyalama, sayfalama
- Paylaşım önizlemesi (Open Graph görseli ve etiketleri), `sitemap.xml`, `robots.txt`
- CSRF koruması, giriş denemesi sınırı, otomatik HTML kaçışı
- Açık ve karanlık tema, mobil uyumlu

## Yerelde çalıştırma

Node.js 20 veya üstü gerekir.

```bash
npm install
ADMIN_USERNAMES=kullaniciadin npm start   # http://localhost:3000
```

Yerelde veritabanı `data/howtolarp.db` dosyasıdır.

**Örnek rehberler:** `seed-guides.js` dosyasına eklenen her yeni rehber, bir sonraki yüklemede (canlıda da) otomatik olarak siteye eklenir. Daha önce eklenmiş ya da sonradan silinmiş örnekler tekrar eklenmez.

## Ortam değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `ADMIN_USERNAMES` | Yönetici kullanıcı adları, virgülle ayrılmış (ör. `ali,ayse`). Bu adlarla üye olan kişi `/yonetim` paneline girer. |
| `TURSO_DATABASE_URL` | Canlı veritabanı adresi (`libsql://...turso.io`). Boşsa yerel dosya kullanılır. |
| `TURSO_AUTH_TOKEN` | Turso erişim anahtarı |
| `SITE_URL` | İsteğe bağlı. Kendi alan adını bağladığında (ör. `https://howtolarp.com`) paylaşım linkleri ve site haritası bu adresi kullanır. |
| `DB_PATH` | Yerel veritabanı dosyası (varsayılan `data/howtolarp.db`) |
| `NODE_ENV` | `production` olunca çerezler yalnızca HTTPS'te gönderilir (Vercel bunu kendisi ayarlar) |

## Vercel'de yayına alma

Vercel'de kalıcı disk olmadığı için veritabanı olarak [Turso](https://turso.tech) (SQLite uyumlu, ücretsiz katmanı var) kullanılır.

1. **Turso:** turso.tech'te hesap aç, yeni bir veritabanı oluştur (bölge olarak Frankfurt gibi yakın bir yer seç).
   Veritabanı sayfasından **URL**'yi ve **Create Token** ile bir erişim anahtarı al.
2. **Vercel:** vercel.com'da GitHub ile giriş yap, *Add New → Project* ile bu repoyu içe aktar.
   Framework olarak *Other* kalsın, build ayarlarına dokunma.
3. *Environment Variables* bölümüne şunları ekle:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_USERNAMES`
4. *Deploy*. İlk istekte tablolar ve örnek rehberler otomatik oluşturulur.
5. Siteye gidip `ADMIN_USERNAMES`'e yazdığın adla üye ol: menüde **Yönetim** linki görünür.

## Yapı

```
server.js        Rotalar, oturum, CSRF, moderasyon
db.js            Veritabanı bağlantısı (yerel dosya ya da Turso), şema, örnek veri
seed-guides.js   Örnek rehberler
api/index.js     Vercel giriş noktası
vercel.json      Vercel yönlendirme ayarları
views/           EJS şablonları
public/          CSS ve favicon
```
