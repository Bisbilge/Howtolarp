# How to LARP

Olmadığın biri gibi davranmanın (internet argosundaki anlamıyla "larp") rehber sitesi.
Üyeler kendi "X nasıl larplanır?" rehberlerini yazar, yayınlar, düzenler; başkalarının rehberlerini "Larpladım" ile beğenir.

## Özellikler

- Üyelik: kayıt, giriş, çıkış (şifreler scrypt ile saklanır, oturumlar veritabanında)
- Rehber yazma, düzenleme, silme (yalnızca yazarı ya da yönetici)
- Her rehberde 4 bölüm: Hazırlık, Sahne talimatı, Replikler, Nerede yakalanırsın
- Kategori, larp zorluğu (1-5), arama, "yeni / çok larplanan" sıralaması
- Sosyal katman yok: herkese açık profil, takip ya da arkadaşlık bulunmaz. Rehberde yazarın adı görünür;
  üye kendi rehberlerini sadece kendisinin gördüğü **Rehberlerim** (`/rehberlerim`) sayfasından yönetir.
- **Moderasyon:** üyeler rehberleri gerekçesiyle bildirir; 3 farklı kişi bildirince rehber otomatik gizlenir.
  Yöneticiler `/yonetim` panelinden bildirimleri inceler; rehberi yayında tutar, gizler, siler ya da yazarı engeller.
- "Rastgele rol" (`/rastgele`), paylaşma butonu, repliğe dokununca kopyalama, sayfalama
- **Rehbere özel paylaşım önizlemesi:** her rehber linki WhatsApp/Twitter vb.'de kendi görseliyle görünür
  (`/og/rehber/<slug>.png`, 1200×630, `og.js`: satori + resvg). Görsel CDN'de önbelleğe alınır, rehber düzenlenince yenilenir;
  üretilemezse genel `og.png` kullanılır. `sitemap.xml`, `robots.txt`
- **Spam koruması:**
  - Yeni üyelerin ilk rehberleri yönetici onayından sonra yayına girer; 2 rehberi onaylanan üye "güvenilir" olur.
    Güvenilir olmayan üyenin düzenlemesi yeniden onaya düşer.
  - Rehberlerde link/web adresi yasak; üye başına günde 5 rehber, aynı anda en fazla 3 onay bekleyen rehber.
  - Aynı bağlantıdan günde en fazla 3 hesap; hatalı giriş denemeleri IP ve kullanıcı adı başına sınırlı.
    Sınırlar veritabanında tutulur, IP adresleri sadece özet olarak 2 gün saklanır.
  - Formlarda bot tuzağı (gizli alan); isteğe bağlı Cloudflare Turnstile.
  - "admin", "editor" gibi resmi görünen ve yönetici kullanıcı adları alınamaz.
- Hesap ayarları (`/hesap`): şifre değiştirme, hesabı ve tüm içeriği silme
- Kurallar ve gizlilik sayfası (`/kurallar`); kayıtta kabul onayı
- **Görsel oluşturucu** (`/yonetim/gorsel`, sadece yönetim): seçilen rehber için Instagram gönderi (1080×1350),
  Instagram hikaye (1080×1920) ya da Twitter/X (1600×900) görselini tarayıcıda oluşturup PNG indirir;
  platforma göre hazır açıklama/tweet metni verir. Rehber seçimi aramalı.
- **Paylaşım sırası** (Yönetim → Paylaşılacaklar): yayına giren her rehber (onaylanan ya da güvenilir üyenin yazdığı)
  sıraya kendiliğinden düşer. Twitter için hazır metinli "Tweet'i aç" (önizleme görseli linkten gelir), Instagram için
  telefonda görseli paylaşım menüsüne veren "Instagram'da paylaş" düğmesi; paylaşılınca işaretlenir. Eski rehberler
  rehber sayfasındaki yönetici şeridinden sıraya eklenebilir.
- **Hangi larpsın? testi** (`/test`): 6 soru, 8 dengeli sonuç; her sonucun paylaşılabilir sayfası ve görseli
- **Yakalandım** butonu: rehberi deneyip ifşa olanların sayısı
- **Rehber istekleri** (`/istekler`): rol önerisi ve oylama (hesapsız), "Bunu ben yazarım" ile başlığı hazır form;
  rol yayına girince istek kendiliğinden "yazıldı" olur. Var olan rol istenirse rehbere yönlendirir.
- Rehber formunda tarayıcıya taslak kaydı; ana sayfa araması Türkçe karakter duyarsız; rehberlerde Article JSON-LD
- Yazı tipleri sitede barındırılır (`public/fonts`, OFL lisanslı); Google Fonts'a istek gitmez
- CSRF koruması, Content-Security-Policy, otomatik HTML kaçışı
- Açık ve karanlık tema, mobil uyumlu

## Yerelde çalıştırma

Node.js 20 veya üstü gerekir.

```bash
npm install
ADMIN_USERNAMES=kullaniciadin npm start   # http://localhost:3000
```

Yerelde veritabanı `data/howtolarp.db` dosyasıdır.

**Örnek rehberler:** `seed-guides.js` dosyasına eklenen yeni rehber bir sonraki yüklemede (canlıda da) siteye eklenir; metni değiştirilen rehber sitede de güncellenir. Başlığı değiştirirken eski başlığı `key` alanına yaz ki aynı rehber güncellensin. Siteden silinen örnekler geri gelmez.

## Ortam değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `SIGNUPS_OPEN` | Üye kaydı varsayılan olarak açıktır. `0` yapılırsa geçici olarak kapanır (mevcut hesaplar `/giris`'ten girmeye devam eder). Ziyaretçiler her durumda hesapsız "Larpladım" diyebilir. |
| `ADMIN_SIGNUP_CODE` | Editör davet kodu (en az 8 karakter). Kayıtta "Editör kodun var mı?" alanına ya da Hesap ayarlarına girilirse hesap **editör** olur: rehber onaylar, bildirimlere bakar, normal üyeleri engeller. Baş yöneticiler (`ADMIN_USERNAMES`) editörlerin yetkisini panelden alabilir. Kod sızarsa değiştirmen yeterli; yanlış denemeler günde 5 ile sınırlı. |
| `CONTACT_EMAIL` | Gizlilik sayfasında gösterilecek iletişim adresi (önerilir). |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | İsteğe bağlı. İkisi de girilirse kayıt ve giriş formlarında Cloudflare "robot değilim" kutusu çıkar. Widget'ta tanımlı olmayan bir adresten (ör. `*.vercel.app`) giriş yapılamaz. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | İsteğe bağlı. Onay bekleyen rehber, bildirim, yeni istek ve yeni editörde Telegram mesajı. Sohbet kimliği Yönetim → Telegram bildirimi → "Sohbet kimliğini bul" ile öğrenilir. |
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
og.js            Rehbere özel paylaşım görseli (assets/og-fonts yazı tipleriyle)
api/index.js     Vercel giriş noktası
vercel.json      Vercel yönlendirme ayarları
views/           EJS şablonları
public/          CSS ve favicon
```

## Yayın düzeni

- Canlı site `main` dalından yayınlanır (Vercel → Settings → Environments → Production → Branch Tracking: `main`).
- `main`'e gönderilen her değişiklik birkaç dakika içinde canlıya çıkar.
- Bir şey bozulursa: Vercel → Deployments → sorunsuz önceki yükleme → ⋯ → **Promote to Production** (anında geri alma).

## Yedek

- **Almak:** Yönetim → **Yedek indir** (sadece `ADMIN_USERNAMES`'teki baş yöneticiler görür). Hesaplar, rehberler,
  beğeniler, bildirimler tek JSON dosyasına iner. Dosyada şifre özetleri de var: paylaşmayın.
- **Geri yüklemek** (hedefteki veriyi silip yedekle değiştirir):

  ```bash
  # önce ne yükleneceğini gösterir, hiçbir şey yazmaz
  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/geri-yukle.js howtolarp-yedek-....json
  # onaylamak için --evet ekleyin
  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/geri-yukle.js howtolarp-yedek-....json --evet
  ```
