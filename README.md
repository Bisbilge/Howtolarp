# How to LARP

Olmadığın biri gibi davranmanın (internet argosundaki anlamıyla "larp") rehber sitesi.
Üyeler kendi "X nasıl larplanır?" rehberlerini yazar, yayınlar, düzenler; başkalarının rehberlerini "Larpladım" ile beğenir.

## Özellikler

- Üyelik: kayıt, giriş, çıkış (şifreler scrypt ile saklanır, oturumlar veritabanında)
- Rehber yazma, düzenleme, silme (yalnızca yazarı)
- Her rehberde 4 bölüm: Gerekenler, Adım adım, Söylenecek cümleler, İfşa olma riskleri
- Kategori, larp zorluğu (1-5), arama, "en yeni / en çok larplanan" sıralaması
- Kullanıcı profilleri (`/u/kullaniciadi`) ve profil yazısı
- CSRF koruması, giriş denemesi sınırı, otomatik HTML kaçışı
- Açık ve karanlık tema, mobil uyumlu

## Çalıştırma

Node.js 22.13 veya üstü gerekir (yerleşik `node:sqlite` kullanılıyor, ek veritabanı kurulumu yok).

```bash
npm install
npm start          # http://localhost:3000
```

İlk açılışta `data/howtolarp.db` oluşturulur ve 6 örnek rehber eklenir.

| Ortam değişkeni | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Sunucu portu |
| `DB_PATH` | `data/howtolarp.db` | SQLite dosyası |
| `NODE_ENV` | | `production` olunca çerezler `Secure` olur (HTTPS gerekir) |

## Yayına alma

Kalıcı diski olan herhangi bir Node.js sunucusunda çalışır (Render, Railway, Fly.io, bir VPS).
`DB_PATH`'i kalıcı bir diske yönlendir; aksi halde yeniden başlatmada veriler silinir.

## Yapı

```
server.js        Rotalar, oturum, CSRF
db.js            Şema, şifre fonksiyonları, örnek veri yükleme
seed-guides.js   Örnek rehberler
views/           EJS şablonları
public/          CSS ve favicon
```
